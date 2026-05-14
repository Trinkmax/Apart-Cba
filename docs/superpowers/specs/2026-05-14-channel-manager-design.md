# Channel Manager — Iteración usable

**Fecha:** 2026-05-14
**Estado:** Aprobado por el usuario, pendiente de implementación
**Alcance:** Convertir el channel manager actual en una herramienta usable end-to-end sin depender de servicios pagos.

## Contexto y motivación

Hoy `/dashboard/channel-manager` existe con import/export de iCal, pero el cron de sync no está schedulado en `vercel.json`, hay código duplicado entre la server action y el cron handler, no hay historial de sincronizaciones, y la integración con bookings se limita a fechas. El usuario quiere que el operador del PMS pueda operar Airbnb/Booking sin salir continuamente de Apart Cba, con presupuesto cero.

El alcance acordado cubre tres dominios:
1. **iCal sync hardening** — dejar el sync automático y observable.
2. **Rate calendar** — UI en el dashboard para administrar `unit_pricing_rules` existentes y conectar el cálculo de precio al flow de bookings.
3. **Email parser** — recibir notificaciones de Airbnb/Booking via Resend Inbound y crear bookings en estado pendiente.

Lo que queda explícitamente fuera de esta iteración:
- Integraciones API oficiales con Airbnb / Booking (requieren certificación y/o partner program).
- Channel managers comerciales (Hostaway, Smoobu, etc.).
- Mensajería del huésped (Airbnb/Booking) — postergado.
- Push automático de precios a OTAs — el operador sigue copiando manualmente.
- WhatsApp/Instagram inbox (la tabla `crm_channels` existe pero queda fuera de este diseño).
- Vista mobile dedicada para channel manager.

## Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│                       DASHBOARD (Next.js)                        │
│  /dashboard/channel-manager      /dashboard/unidades/[id]/precios│
│  /dashboard/configuracion/inbound-email                          │
└──────────┬──────────────────────────────┬───────────────────────┘
           ▼                              ▼
    src/lib/ical/sync.ts          src/lib/pricing/resolve.ts
    src/lib/inbound/parsers/*     src/lib/actions/pricing.ts
           │                              │
           ▼                              ▼
    ical_feeds                     unit_pricing_rules (existente)
    ical_sync_runs (NUEVA)         units.base_price    (existente)
    ical_feed_health (VIEW)
    inbound_email_log (NUEVA)
    organizations.inbound_email_token (COLUMNA)
    notifications (CHECK extendido)
           ▲                              ▲
           │                              │
    pg_cron @ */30                Resend Inbound webhook
    POST /api/cron/sync-ical      POST /api/inbound/resend
```

Principios:
- **Server actions = capa de datos.** Toda mutación pasa por `requireSession()` + `getCurrentOrg()` + filtro `organization_id`.
- **pg_cron es la fuente del schedule sub-diario.** No usamos Vercel cron porque el plan free no soporta sub-diario; el patrón ya está establecido en migración 010 (CRM).
- **`/api/cron/sync-ical` queda como endpoint HTTP** invocado tanto por pg_cron como por el botón "Sincronizar todos". Validación por header `x-pg-cron-secret` (mismo patrón que `/api/cron/from-pg`, migración 010). La validación actual del endpoint que usa `Authorization: Bearer` debe migrarse a este nuevo formato para unificar.
- **Funciones puras compartidas** entre action y route handler para evitar la duplicación actual.

---

## Bloque 1 — iCal sync hardening

### Migración `018_ical_sync_runs.sql`

```sql
CREATE TABLE apartcba.ical_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES apartcba.ical_feeds(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','ok','error')),
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  trigger_source text NOT NULL CHECK (trigger_source IN ('cron','manual','create_feed'))
);

CREATE INDEX idx_sync_runs_feed_started ON apartcba.ical_sync_runs(feed_id, started_at DESC);
CREATE INDEX idx_sync_runs_org_recent ON apartcba.ical_sync_runs(organization_id, started_at DESC);

CREATE VIEW apartcba.ical_feed_health AS
SELECT
  f.id AS feed_id,
  f.organization_id,
  COUNT(*) FILTER (WHERE r.status='error' AND r.started_at > now() - interval '24h') AS errors_24h,
  MAX(r.started_at) FILTER (WHERE r.status='ok') AS last_ok_at,
  CASE
    WHEN COUNT(*) FILTER (WHERE r.status='error' AND r.started_at > now() - interval '6h') >= 3 THEN 'broken'
    WHEN COUNT(*) FILTER (WHERE r.status='error' AND r.started_at > now() - interval '24h') >= 1 THEN 'warning'
    ELSE 'ok'
  END AS health
FROM apartcba.ical_feeds f
LEFT JOIN apartcba.ical_sync_runs r ON r.feed_id = f.id
GROUP BY f.id, f.organization_id;

-- pg_cron @ */30 (sigue exactamente el patrón de migración 010_crm.sql)
DO $crons_unschedule$ BEGIN
  PERFORM cron.unschedule('apartcba-sync-ical');
EXCEPTION WHEN OTHERS THEN NULL;
END $crons_unschedule$;

DO $crons_schedule$ BEGIN
  PERFORM cron.schedule(
    'apartcba-sync-ical',
    '*/30 * * * *',
    $job$
    SELECT net.http_post(
      url := current_setting('apartcba.app_url', true) || '/api/cron/sync-ical',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pg-cron-secret', current_setting('apartcba.pg_cron_secret', true)
      ),
      body := jsonb_build_object('source','pg_cron','job','sync_ical'),
      timeout_milliseconds := 60000
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule apartcba-sync-ical skipped (privileges?). Run manually.';
END $crons_schedule$;

DO $purge_unschedule$ BEGIN
  PERFORM cron.unschedule('apartcba-sync-ical-purge');
EXCEPTION WHEN OTHERS THEN NULL;
END $purge_unschedule$;

DO $purge_schedule$ BEGIN
  PERFORM cron.schedule(
    'apartcba-sync-ical-purge',
    '0 4 * * *',
    $job$ DELETE FROM apartcba.ical_sync_runs WHERE started_at < now() - interval '90 days' $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule apartcba-sync-ical-purge skipped (privileges?). Run manually.';
END $purge_schedule$;
```

**Setup manual una vez** (en Supabase SQL Editor con role `postgres`). El setting `apartcba.app_url` y `apartcba.pg_cron_secret` ya están configurados desde la migración 010 del CRM — no hay que duplicarlos. Verificar con:
```sql
SELECT current_setting('apartcba.app_url', true), current_setting('apartcba.pg_cron_secret', true);
```
Si están vacíos, ejecutar:
```sql
ALTER DATABASE postgres SET apartcba.app_url = 'https://app.apart-cba.com';
ALTER DATABASE postgres SET apartcba.pg_cron_secret = '<random-32-chars>';
```

### Refactor: `src/lib/ical/sync.ts` (nuevo)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import ICAL from "ical.js";

export interface IcalFeedRow { /* shape de ical_feeds */ }
export interface SyncResult { imported: number; skipped: number; error?: string }

const BLOCK_REGEX = /not available|unavailable|blocked|closed|reserved|maintenance|airbnb \(not available\)/i;
const SELF_IMPORT_PREFIX = "apartcba-";

export async function syncIcalFeed(
  admin: SupabaseClient,
  feed: IcalFeedRow,
  trigger: "cron" | "manual" | "create_feed"
): Promise<SyncResult> {
  const runId = await startRun(admin, feed, trigger);
  try {
    const events = await fetchAndParse(feed.feed_url);
    const result = await upsertEvents(admin, feed, events);
    await finishRun(admin, runId, "ok", result);
    return result;
  } catch (err) {
    const msg = (err as Error).message;
    await finishRun(admin, runId, "error", { imported: 0, skipped: 0 }, msg);
    return { imported: 0, skipped: 0, error: msg };
  }
}

// fetch con timeout 15s, parse iCal, dedup por (org, unit, source, external_id),
// detect block events via BLOCK_REGEX, skip self-imports por SELF_IMPORT_PREFIX,
// translate bookings_no_overlap error a skipped.
```

Consumidores:
- `src/lib/actions/ical.ts` — actions `syncIcalFeed(feedId)` y `syncAllFeeds()` (con `requireSession()`).
- `src/app/api/cron/sync-ical/route.ts` — handler POST (con GET → POST como en `/api/cron/from-pg`) autenticado por header `x-pg-cron-secret` contra `PG_CRON_SECRET` env var, itera `ical_feeds WHERE active = true` de **todas** las orgs. Se debe migrar la validación actual (`Authorization: Bearer`) al patrón nuevo. El env var `PG_CRON_SECRET` debe coincidir con `apartcba.pg_cron_secret` en la DB.
- `src/lib/actions/ical.ts:createIcalFeed` — invoca con `trigger='create_feed'` para validar URL antes de devolver.

### UI cambios

**`/dashboard/channel-manager/page.tsx`**:
- Server component lee `ical_feed_health` además de `ical_feeds`.
- `ChannelManagerList` recibe `health` por feed y muestra badge: 🟢 ok · 🟡 warning · 🔴 broken.
- Cada row tiene botón "Ver historial" → modal con últimas 20 corridas de `ical_sync_runs` para esa feed.
- Banner global rojo si hay ≥1 feed `broken`.

**`app-sidebar.tsx`**:
- Para el item "Channel Manager", calcular count de feeds en `broken` o `warning` para la org actual; mostrar badge numérico.

### Server actions

- `listIcalFeedsWithHealth()` — join con la vista.
- `getSyncRunsForFeed(feedId, limit=20)` — lee historial.
- `createIcalFeed(input)` — además del insert, llama `syncIcalFeed(... 'create_feed')` y si retorna error, rollback insert y throw.

### Verificación

- `npm run build && npx tsc --noEmit && npm run lint` pasan.
- En browser: crear una feed con URL inválida, debe rechazarse con mensaje claro.
- Crear una feed válida, ver corrida nueva en historial con status='ok'.
- Marcar feed.active=false y verificar que el cron la salta.
- Provocar 3 errores seguidos (apuntando a URL muerta) y ver badge 'broken' en sidebar.

---

## Bloque 2 — Rate calendar

### Schema

**Sin cambios.** Reusa:
- `apartcba.unit_pricing_rules` (migración 016) — campos `rule_type`, `start_date`, `end_date`, `days_of_week`, `price_multiplier`, `price_override`, `min_nights_override`, `priority`, `active`.
- `apartcba.units` — `base_price`, `base_price_currency`, `min_nights`.

### Helper `src/lib/pricing/resolve.ts`

```ts
export interface PriceBreakdown {
  perNight: { date: string; price: number; sourceRuleId: string | null }[];
  total: number;
  minStay: number;
  currency: string;
}

export async function resolvePrice(
  admin: SupabaseClient,
  unitId: string,
  checkIn: Date,   // inclusive
  checkOut: Date   // exclusive
): Promise<PriceBreakdown>
```

Algoritmo:
1. Cargar `units.base_price`, `base_price_currency`, `min_nights` y todas las rules activas de la unidad en una sola query.
2. Para cada noche del rango:
   - Filtrar rules cuyo scope incluye esa fecha.
   - Ordenar por `priority DESC, created_at ASC` (mayor prioridad gana; en empate, la más vieja).
   - Aplicar la primera: `price_override` si existe, sino `base_price * price_multiplier`.
   - Si ninguna matchea: usar `base_price` directo, `sourceRuleId=null`.
3. `minStay = max(unit.min_nights, max(rule.min_nights_override) where rule matched)`.
4. `total = sum(perNight.price)`.

### Server actions `src/lib/actions/pricing.ts`

Validados con Zod, todos requieren session + org + filtro `organization_id`:

- `getCalendarPrices(unitId, year, month)` — devuelve `{ date, price, ruleId, isBooked }[]` para pintar la grilla. `isBooked` viene de un join con `bookings` (status confirmada/check_in y rango cubriendo la fecha).
- `createDateRangeRule(input)` — `{ unitId, name, startDate, endDate, priceOverride?, priceMultiplier?, minNightsOverride?, priority }`.
- `createWeekdayRule(input)` — `{ unitId, name, daysOfWeek: number[], priceMultiplier?, priceOverride?, priority }`.
- `updateRule(id, patch)`.
- `deleteRule(id)` — soft delete vía `active=false` (mantiene historial).
- `updateUnitBasePrice(unitId, price, currency)`.

### UI `/dashboard/unidades/[id]/precios/page.tsx` (nueva ruta)

Server component:
- Header: nombre de la unidad, base price + botón "Editar base".
- Selector de mes (prev/next).
- Grilla mensual: 7 columnas (Lu-Do), filas semanas. Cada celda muestra precio resuelto y, opcionalmente, indicador si está reservada.
- Selección de rango (drag): muestra "N noches seleccionadas" + botón "Aplicar precio/min stay".
- Modal de aplicación: form con `price_override` xor `price_multiplier`, `min_nights_override`, `priority`. Submit → `createDateRangeRule`.
- Sección "Reglas activas" abajo: tabla con CRUD inline para editar/borrar reglas existentes.
- Banner si el rango seleccionado intersecta bookings confirmados existentes (warning informativo, no bloqueo).

Cliente component para la grilla por la interactividad (drag-select). El resto en RSC.

### Integración en `createBooking` (`src/lib/actions/bookings.ts`)

- Si el input `total_amount` es `0`, `null`, o no viene: llamar `resolvePrice(unitId, checkIn, checkOut)` y usar `breakdown.total`.
- Si viene con valor explícito: respetarlo (override manual del operador, ej. descuento por trato directo).
- Form del dashboard (`booking-form.tsx`): botón "Calcular precio" llama una action `previewPrice(unitId, dates)` que retorna el breakdown para mostrar en UI sin guardar.

### Verificación

- Crear rule date_range con override → la grilla muestra el precio nuevo en esas fechas.
- Crear rule weekday con multiplier 1.3 → sábados/domingos muestran precio × 1.3.
- Crear booking sin total_amount → debe llegar a DB con el monto resuelto.
- Crear booking con total_amount explícito → debe preservarse.
- Prioridades: rule de prioridad 10 gana sobre la de prioridad 5 para misma fecha.

---

## Bloque 3 — Email parser (Resend Inbound)

### Migración `019_inbound_email.sql`

```sql
ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS inbound_email_token text;

UPDATE apartcba.organizations
  SET inbound_email_token = encode(gen_random_bytes(8), 'hex')
  WHERE inbound_email_token IS NULL;

ALTER TABLE apartcba.organizations
  ALTER COLUMN inbound_email_token SET NOT NULL,
  ADD CONSTRAINT organizations_inbound_email_token_unique UNIQUE (inbound_email_token);

CREATE TABLE apartcba.inbound_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  resend_message_id text UNIQUE,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  received_at timestamptz NOT NULL DEFAULT now(),
  parser_used text,
  event_type text,
  status text NOT NULL CHECK (status IN ('parsed','unmatched','error','duplicate')),
  booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  error_message text,
  raw_size_bytes integer
);

CREATE INDEX idx_inbound_log_org_received ON apartcba.inbound_email_log(organization_id, received_at DESC);

-- Extender notifications.type
ALTER TABLE apartcba.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE apartcba.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'payment_due','payment_overdue','payment_received',
    'lease_ending_soon','lease_split_created',
    'inbound_booking_pending',
    'inbound_booking_cancelled',
    'inbound_booking_unmatched_unit',
    'channel_feed_error',
    'manual','other'
  ));
```

### Configuración Resend (manual, una vez)

**Decisión pendiente al implementar:** subdominio para los MX records. Opciones:
- `ota.apart-cba.com.ar` (subdominio dedicado, recomendado — no toca outbound)
- Dominio de prueba `resend.dev` provisto por Resend (más rápido pero no profesional)

Pasos:
1. En Resend dashboard, crear Inbound endpoint apuntando a `https://app.apart-cba.com/api/inbound/resend`.
2. Configurar 3 registros MX en Vercel DNS para el subdominio elegido apuntando a Resend.
3. Copiar el signing secret a `RESEND_INBOUND_WEBHOOK_SECRET` en Vercel env vars.
4. Guardar el dominio inbound elegido en env var `INBOUND_EMAIL_DOMAIN` para que la UI lo muestre.

### Webhook handler `src/app/api/inbound/resend/route.ts`

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1. Verificar firma HMAC del webhook usando RESEND_INBOUND_WEBHOOK_SECRET
  //    Headers de Resend: svix-id, svix-timestamp, svix-signature (formato svix).
  // 2. Parsear payload JSON.
  // 3. Extraer token de la dirección destino: ota-<token>@<inbound-domain>
  //    Si la dirección no matchea el formato → 400.
  // 4. Lookup org por inbound_email_token. Si no existe → log + 200 (no revelar).
  // 5. Determinar parser: airbnb.match() | booking.match() | null.
  // 6. Si parser null → insertar log (status='unmatched') + 200.
  // 7. Llamar parser.parse() → ParsedEvent | null.
  // 8. Si ParsedEvent.type === 'new_booking' → invocar createBookingFromInbound().
  //    Si 'cancellation' → invocar cancelBookingFromInbound().
  // 9. Log final con resultado.
  // 10. Retornar 200 (siempre que la firma sea válida; los errores van al log).
}
```

### Parsers `src/lib/inbound/parsers/`

```ts
// types.ts
export interface ResendInboundEmail {
  message_id: string;
  from: { email: string; name?: string };
  to: { email: string }[];
  subject: string;
  html?: string;
  text?: string;
  received_at: string;
}

export type ParsedEvent =
  | {
      type: "new_booking";
      guest: { name: string; email?: string; phone?: string };
      checkIn: Date;       // local date interpreted at unit timezone
      checkOut: Date;
      totalAmount: number; // en moneda del email; convertir a unit.base_price_currency si difiere
      currency: string;
      externalId: string;  // ej "HMK4XYZ123" en Airbnb, número en Booking
      listingHint?: string;
    }
  | { type: "cancellation"; externalId: string };

export interface InboundEmailParser {
  name: "airbnb" | "booking";
  match(email: ResendInboundEmail): boolean;
  parse(email: ResendInboundEmail): ParsedEvent | null;
}
```

- `airbnb.ts` — match si `from.email` ∈ {`automated@airbnb.com`, `noreply@airbnb.com`, `express@airbnb.com`} y subject matchea uno de los patterns ("Reservation Confirmed", "Cancelled by guest", "Reserva confirmada", etc., en EN y ES). Parser extrae datos del HTML estructurado de Airbnb.
- `booking.ts` — match si `from.email` ∈ {`noreply@booking.com`, `customer.service@booking.com`} y subject matchea ("New reservation", "Cancellation", "Nueva reserva", etc.). Parser de HTML de Booking.

### Service `src/lib/inbound/handler.ts`

```ts
export async function handleInboundEvent(
  admin: SupabaseClient,
  organizationId: string,
  parserName: string,
  event: ParsedEvent
): Promise<{ status: "parsed" | "duplicate" | "error"; bookingId?: string; error?: string }>
```

Resolución de unidad para `new_booking`:
1. Si `listingHint` existe, búsqueda contra `units.name`, `units.marketplace_title`, `units.code` en la org.
2. Normalización: lower, trim, sin tildes, sin caracteres especiales.
3. Match exacto primero, luego Levenshtein con threshold (cota: distancia ≤ 3 sobre strings ≥ 5 chars).
4. Si match único → `unit_id = found`. Si ambiguo o ninguno → `unit_id = null`, notificación `inbound_booking_unmatched_unit`.

Resolución de huésped:
1. Por `email` si existe.
2. Por `phone` si existe.
3. Por `name` exacto dentro de la org.
4. Si no hay match → crear nuevo en `guests`.

Inserción booking:
- `source = parserName` (ya está en BookingSource enum).
- `external_id = event.externalId`.
- `status = 'pendiente'`.
- `total_amount = event.totalAmount` (sin recalcular desde rate calendar, respetar lo que vino).
- `check_in_time = '14:00'`, `check_out_time = '10:00'`.
- `notes = 'Importado automáticamente desde email de ' + parserName`.
- Si `bookings_no_overlap` falla → log status='error', notificación crítica "Conflicto", no inserta.

Duplicate guard:
- Lookup previo por `(organization_id, source, external_id)`. Si existe → log `status='duplicate'`, retorna sin tocar.

Notificación:
- `type = 'inbound_booking_pending'`.
- `severity = 'info'` (warning si `unit_id IS NULL`).
- `ref_type = 'booking'`, `ref_id = booking.id`.
- `action_url = '/dashboard/reservas/' + booking.id`.
- `dedup_key = source + ':' + external_id` para idempotencia.
- `target_role = 'admin'` y `target_role = 'recepcion'` (dos inserts o uno con target_role array... el schema actual es text único; insertar dos rows).

### UI `/dashboard/configuracion/inbound-email/page.tsx`

- Muestra la dirección `ota-${org.inbound_email_token}@${process.env.INBOUND_EMAIL_DOMAIN}` con copy button.
- Instrucciones paso a paso para configurar email forwarding en:
  - Airbnb (Account → Notifications → Email forwarding)
  - Booking.com (Inbox → Settings)
- Botón "Rotar dirección" — confirma + regenera token.
- Tabla con últimos 50 emails recibidos (de `inbound_email_log`): timestamp, from, subject, parser_used, status, link al booking si aplica.

### Verificación

- Enviar un email de prueba a la dirección con un payload similar al de Airbnb → debería aparecer booking pendiente.
- Enviar el mismo email dos veces → segundo log debería marcarse 'duplicate', no crear booking nuevo.
- Enviar email con listing name desconocido → unit_id=null, notificación de unit unmatched.
- Enviar email de cancelación de booking inexistente → log 'unmatched', no error.
- Validar HMAC: request con firma incorrecta debe devolver 401 sin tocar DB.

---

## Orden de implementación

Cada bloque autocontenido. Se mergea a main por separado, en este orden:

1. **Bloque 1 — iCal hardening** (~1 día)
   - Riesgo bajo: refactor + tabla nueva + cron pg + UI.
   - Desbloquea sync automático real.

2. **Bloque 2 — Rate calendar** (~2 días)
   - Riesgo medio: nueva ruta UI compleja (grilla con drag), integración en createBooking.
   - Independiente del bloque 1.

3. **Bloque 3 — Email parser** (~2 días)
   - Riesgo mayor: dependencia externa (Resend), parsing frágil, edge cases con matching de unidad/huésped.
   - Independiente; depende solo de tabla `notifications` (extensión del CHECK).

## Verificación general

Después de cada bloque:
```bash
npm run build && npx tsc --noEmit && npm run lint
```

No hay test runner configurado en el proyecto. Verificación manual en browser para cada feature.

## Riesgos identificados y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Parser de email se rompe ante cambio de formato de Airbnb/Booking | Log raw structure en `inbound_email_log.raw_size_bytes` (extender a guardar HTML truncado en debug). Alertar al admin si tasa de `unmatched` supera 30% en 24h. |
| `bookings_no_overlap` rechaza importes legítimos cuando Airbnb manda overbooking | Notificación crítica + booking no se inserta. Operador resuelve manualmente. Documentar en UI. |
| pg_cron secret expuesto si alguien lee la DB | Mitigado: secret está en setting de DB (`current_setting`), no en tabla. Acceso requiere superuser. |
| Resend Inbound free se queda corto (>100 emails/día) | Monitorear desde dashboard Resend. Path de upgrade a USD 20/mes (50k/mes). |
| Rate calendar grid pesa mucho en RSC para meses con muchas reglas | Limit reglas a 50 por unidad. Si crece, paginar o cargar mes en client component. |

## Fuera de scope (postergado a futuras iteraciones)

- Push automático de precios a Airbnb/Booking (requiere API/partner).
- Mensajería del huésped (Airbnb messages, Booking inbox).
- WhatsApp/Instagram inbox unificada (la migración 010 ya tiene crm_channels base).
- Pricing dinámico vía PriceLabs/Wheelhouse.
- Multi-canal con overrides por canal (la tabla unit_pricing_rules soporta multiplier; un canal_override requeriría tabla nueva).
- Vista mobile dedicada (`/m/channel-manager`).
- Sincronización de reviews.
