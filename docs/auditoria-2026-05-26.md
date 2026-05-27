# Auditoría integral — Apart Cba (2026-05-26)

> Tablero de trabajo para el equipo de desarrollo. Cada item incluye severidad, archivo:línea, breve descripción y recomendación. Marcá los checkbox a medida que se completen — el orden de las fases refleja prioridad de impacto + riesgo.

## Resumen ejecutivo

- **~277 hallazgos** auditados en 8 dominios (seguridad, server actions, CRM, marketplace, cron, gateway WhatsApp, esquema DB, frontend).
- **~38 críticos** que justifican freeze de features hasta remediar.
- La base es sólida: Vault para secrets, separación cliente/servidor, schema `apartcba` namespaced, patrón `requireSession + getCurrentOrg`. La deuda se acumuló en: **concurrencia**, **autorización page-level**, **endpoints públicos sin rate-limit**, **fail-open en secrets**, y **stack legacy `messaging_*` aún cableado**.
- Estimación de esfuerzo: Fase 1 (3-5 días), Fase 2 (1-2 semanas), Fase 3 (1-2 semanas), Fase 4 (continuo).

## Cómo usar este documento

- Las fases están ordenadas por urgencia, no por área. Empezar siempre por la Fase 1 sin saltearse items.
- Cada item está autocontenido: tiene la ruta del archivo, la línea aproximada y la solución concreta. No hace falta releer el reporte para arrancar.
- Antes de cerrar un item, agregar el commit hash o PR al final del bullet.
- Hay un apéndice por dominio al final con el desglose completo si querés contexto adicional.

---

## Fase 1 — Bloqueos de release (días 1-3)

> Cada uno de estos items por separado justifica frenar un release. **No mergear features nuevas hasta cerrar esta fase.**

### Seguridad / fuga de datos cross-tenant

- [ ] **CRIT-1 · Fuga cross-tenant de PII en `/mi-cuenta`**
  `src/lib/actions/marketplace-bookings.ts:412-431` — `listGuestBookings()` resuelve historial por **email crudo** contra `apartcba.guests` (que es per-org). Dos orgs que tengan un guest con el mismo email exponen reservas y montos cross-tenant.
  **Fix:** backfillar `bookings.guest_user_id` (FK a `auth.users`) en todas las reservas marketplace, y filtrar por ese FK en lugar de email. Mientras tanto, en `createMarketplaceBooking` setear `created_by` con el `guest_user_id`.

- [ ] **CRIT-2 · Inyección PostgREST vía `.or()` en búsqueda pública**
  `src/lib/actions/marketplace.ts:127-130` — `filters.city` se concatena sin sanear dentro de un `.or()`. Permite agregar predicados arbitrarios en un endpoint público sin auth.
  **Fix:** strip de `,`, `.`, `(`, `)`, `*` en el input antes de pasarlo a `.or()`, o reescribir la query con `.or([...].join(','))` y valores escapados.

- [ ] **CRIT-3 · Verificación de firma Meta es opcional**
  `src/app/api/webhooks/whatsapp/route.ts:96` — `if (appSecret) { verifySignature… }`. Si `app_secret_secret_id` es null el webhook acepta **cualquier POST**. Combinado con CRIT-4, cualquier atacante puede inyectar mensajes inbound spoofeados.
  **Fix:** invertir la condición — rechazar todo POST si el canal no tiene `app_secret` configurado.

- [ ] **CRIT-4 · Ruta legacy `meta/[channel]` sin verificación de firma**
  `src/app/api/webhooks/meta/[channel]/route.ts:51-76` — Acepta cualquier POST sin firma y escribe a las tablas `messaging_*` (que están vacías en prod — split-brain).
  **Fix:** eliminar la ruta completa (~410 LoC) o devolver `410 Gone`. Borrar tipos `Messaging*` de `src/lib/types/database.ts`. Crear migración `029_drop_legacy_messaging.sql`.

- [ ] **CRIT-5 · RLS abierta en `org_date_marks`**
  `supabase/migrations/015_org_date_marks.sql:29` — `USING (true) WITH CHECK (true)`. Acceso cross-tenant vía cliente anon.
  **Fix:** reemplazar por `USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())`.

- [ ] **CRIT-6 · Setup inicial sin auth**
  `src/app/setup/page.tsx` + `src/lib/actions/setup.ts:5-94` — `setupFirstAdmin` es Server Action pública con `createAdminClient()`, solo gateada por `count(user_profiles) > 0` (no atómica → race window).
  **Fix:** gatear con `SETUP_BOOTSTRAP_SECRET` env var de un solo uso; mover el count+insert a una función SQL `SECURITY DEFINER` con unique constraint para hacerlo atómico.

- [ ] **CRIT-7 · DNI accesible cross-org**
  `src/lib/actions/team-dni.ts:23-53, 184-214` — Cualquier admin que comparta UNA org con un usuario puede ver/sobrescribir su DNI (PII gubernamental). El path en Storage es global, no por org. `upsert: true` permite tampering.
  **Fix:** scopear el DNI a la org en la que se hizo el onboarding (`user_profiles_org.dni_path`) y validar la pertenencia en `assertCanManageDni`.

- [ ] **CRIT-8 · Open redirect en login/signup del marketplace**
  `src/components/marketplace/auth-forms.tsx:17, 32, 126, 153, 157` — `redirectTo` viene de `?redirect=` sin validar.
  **Fix:** `if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) redirectTo = "/mi-cuenta"`.

- [ ] **CRIT-9 · `select("*")` filtra datos internos en payload público**
  `src/lib/actions/marketplace.ts:275-289` y `src/app/(marketplace)/checkout/[unitId]/page.tsx:41-52` — Expone `default_commission_pct`, `notes` internas, `status_changed_by` al RSC stream.
  **Fix:** enumerar columnas explícitas; crear tipo `MarketplaceListingPublic` separado de `MarketplaceListingDetailInternal`.

- [ ] **CRIT-10 · Calendario de unidades privadas accesible públicamente**
  `src/lib/marketplace/availability.ts:77-122` (vía `getListingBlockedDates`) — No chequea `marketplace_published`. Con un `unit_id` cualquiera, se descarga el calendario de ocupación de cualquier unidad.
  **Fix:** verificar `marketplace_published = true AND active = true` antes de delegar.

### Robustez de infraestructura

- [ ] **CRIT-11 · Comparación de secrets timing-unsafe + fail-open**
  5 rutas: `from-pg/route.ts:24-27`, `daily-dispatch/route.ts:23-28`, `parte-diario-draft/route.ts:19-25`, `payment-reminders/route.ts:15-21`, `sync-ical/route.ts:9-15`. Patrón `if (cronSecret) { … }` permite el bypass cuando el env var no carga; comparación con `===`.
  **Fix:** `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` con guard de longitud previo. Fail-closed en `NODE_ENV === 'production'`. Boot-time assertion que todos los secrets requeridos existan.

- [ ] **CRIT-12 · Process death cascade en WhatsApp gateway**
  `whatsapp-gateway/src/index.ts:25-27` — Solo está wired `unhandledRejection`, no `uncaughtException`. Un throw síncrono en cualquier handler de Baileys mata el proceso entero y tira **todas las sesiones de todos los inquilinos**.
  **Fix:** agregar `process.on("uncaughtException", logAndExit)` y `process.on("unhandledRejection", logAndExit)` con shutdown ordenado.

- [ ] **CRIT-13 · pg_cron envía header literal "null" → ruta fail-open**
  `supabase/migrations/010_crm.sql:825-844` + ver CRIT-11. Si la GUC `apartcba.pg_cron_secret` no está seteada (`ALTER DATABASE postgres SET ...`), `current_setting(..., true)` devuelve NULL → header `x-pg-cron-secret: null` (string) → la ruta acepta.
  **Fix:** (a) crear `029_set_app_settings.sql` documentando el `ALTER DATABASE` requerido; (b) en la ruta `from-pg`, rechazar si el header viene vacío o literal `"null"`.

- [ ] **CRIT-14 · Backportar migraciones aplicadas pero no versionadas**
  `list_migrations` reporta `secure_open_rls_policies`, `026_settlement_ordering` y `apartcba_002_functions_triggers_rls` aplicadas en prod pero **no presentes en `supabase/migrations/`**. Una fresh deploy reintroduce RLS abierta en parte_diario, daily_reports, recovery_codes, etc.
  **Fix:** generar las migraciones versionadas correspondientes leyendo el estado actual de la DB y guardarlas en `supabase/migrations/`.

---

## Fase 2 — Concurrencia y consistencia de dinero (semana 1-2)

> Bugs latentes que no aparecen con un solo usuario pero corrompen estado bajo carga real.

### Race conditions sobre dinero

- [ ] **F2-1 · Pérdida de pagos por read-modify-write**
  `src/lib/actions/bookings.ts:856-892` (`addBookingPayment`) y `src/lib/actions/payment-schedule.ts:243-261` (`markScheduleAsPaid`). Lee `paid_amount`, suma, escribe — dos cobros simultáneos pierden uno.
  **Fix:** crear RPC PostgreSQL `apartcba.booking_register_payment(booking_id uuid, amount numeric, …)` que haga `UPDATE bookings SET paid_amount = paid_amount + $1 WHERE id = $2 RETURNING …` dentro de una transacción que también inserte el `cash_movement`.

- [ ] **F2-2 · Lease split no atómico**
  `src/lib/actions/bookings.ts:148-300, 530-597` — `enforceLeaseSplitOnExisting` actualiza el row original primero, después inserta segmentos. El trigger `tg_booking_extensions_log` ya escribió. Si falla un insert, queda un `booking_extensions` huérfano.
  **Fix:** mover toda la lógica a una función SQL única `apartcba.split_booking_lease(...)` con todo en una transacción.

- [ ] **F2-3 · Append a `internal_notes` no atómico**
  `src/lib/actions/bookings.ts:944-952` en `changeBookingStatus::force_checkout` — Lee `internal_notes`, concatena, escribe. Audit entries concurrentes se pisan.
  **Fix:** `UPDATE bookings SET internal_notes = COALESCE(internal_notes || E'\\n', '') || $1 WHERE id = $2`.

- [ ] **F2-4 · `unit_owners` IDOR**
  `src/lib/actions/owners.ts:143-166` (`unlinkUnitFromOwner`) y `src/lib/actions/units.ts:331-366` (`linkOwnerToUnit/unlinkOwnerFromUnit`) — Llaman `getCurrentOrg()` y **descartan el resultado** (`await getCurrentOrg();`). Permite cross-tenant write/delete de `unit_owners` con un UUID adivinado.
  **Fix:** `const { organization } = await getCurrentOrg()` y filtrar el join por `unit.organization_id = organization.id` antes de mutar.

- [ ] **F2-5 · `setCurrentOrg` no valida membresía**
  `src/lib/actions/org.ts:62-71` — Setea la cookie con cualquier `orgId`. Hoy `getCurrentOrg()` lo intersecta con memberships, pero si algún consumidor lee la cookie directo en el futuro, es un IDOR latente.
  **Fix:** validar `session.memberships.some(m => m.organization_id === orgId) || session.profile.is_superadmin`.

### Race conditions sobre el outbox/workflows

- [ ] **F2-6 · Outbox doble-envío**
  `src/lib/crm/outbox.ts:13-44` — SELECT sin `FOR UPDATE SKIP LOCKED`. pg_cron cada 5min + cada `?immediate=1` ven el mismo `pending` y ambos envían a Meta. Mensaje WhatsApp duplicado al cliente final.
  **Fix:** función SQL `SECURITY DEFINER` que claimee los rows con `UPDATE crm_message_outbox SET status='sending' WHERE id IN (SELECT id FROM crm_message_outbox WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING ...`. La ruta solo procesa lo retornado.

- [ ] **F2-7 · Workflow runs duplicados**
  `src/lib/crm/workflows/executor.ts:30` + `src/app/api/cron/from-pg/route.ts:93-105`. Misma carrera. Resulta en tickets duplicados, AI calls duplicadas, alertas duplicadas.
  **Fix:** mismo patrón claim-by-update para `crm_workflow_runs`.

- [ ] **F2-8 · `due_broadcasts` carrera**
  `src/app/api/cron/from-pg/route.ts:140-145` — `processBroadcastBatch` puede correr 2× por broadcast.
  **Fix:** advisory lock por broadcast id, o mismo patrón claim-by-update.

- [ ] **F2-9 · AI budget TOCTOU**
  `src/lib/crm/ai/usage.ts:53-65` — Verifica budget antes, incrementa después. Varios AI nodes concurrentes superan el budget.
  **Fix:** RPC `crm_ai_increment_if_within_budget(org_id, est_tokens)` atómica.

### Constraint de overlap de reservas

- [ ] **F2-10 · `bookings_no_overlap` incompleto para `pendiente`**
  `supabase/migrations/001:260` — `WHERE status IN ('confirmada','check_in')` no incluye `'pendiente'`. Dos `pendiente` overlapping pasan sin error.
  **Fix:** decidir política — si `pendiente` debe bloquear, agregar al WHERE; si no, dejarlo así pero **documentar** que `pendiente` se valida solo a nivel app, y aplicar esa validación en TODOS los caminos (direct, marketplace approve, inbound email, iCal).

- [ ] **F2-11 · `booking_requests` sin exclusion constraint**
  `supabase/migrations/016:146` — Dos aprobaciones simultáneas de requests overlapping pasan el chequeo de app y ambas intentan crear el booking; la primera gana, la segunda choca contra `bookings_no_overlap` pero el `booking_requests.status='aprobada'` queda inconsistente.
  **Fix:** `SELECT … FOR UPDATE` sobre el `booking_requests` row dentro del `approveBookingRequest`, o agregar exclusion constraint también ahí.

### Cifrado del gateway

- [ ] **F2-12 · AES-256-GCM sin AAD**
  `whatsapp-gateway/src/crypto.ts:11-26` — Sin Additional Authenticated Data. Una intrusión a Supabase (o un swap malicioso entre rows) descifra cross-canal sin fallar.
  **Fix:** `cipher.setAAD(Buffer.from(\`${channelId}/${key}\`))` en encrypt y decrypt.

- [ ] **F2-13 · HMAC sin timestamp (no replay protection)**
  `whatsapp-gateway/src/webhook.ts:81-92` + `src/lib/crm/baileys-gateway.ts:50-57`. Un payload capturado puede reusarse indefinidamente. Eventos `kind:"connection"` no son idempotentes — un replay flippea `crm_channels.status`.
  **Fix:** incluir `x-baileys-timestamp` en el HMAC y rechazar deltas > 5 min.

### Money rounding

- [ ] **F2-14 · Helpers de redondeo inconsistentes**
  `Math.round(x*100)/100`, `toFixed(2)`, `(x+EPSILON)*100)/100` — cada uno aparece en varios lugares. Prorratear por noches con redondeo independiente acumula drift de centavos.
  **Fix:** crear `src/lib/money.ts` con `round2(n)` (versión EPSILON) y `distributeResidual(amounts, total)` que ajuste el último segmento para sumar exactamente al total. Reemplazar todas las variantes en `bookings.ts`, `settlements.ts`, `payment-schedule.ts`.

### Cron correctness

- [ ] **F2-15 · `daily-dispatch` calcula `today/tomorrow` en UTC**
  `src/app/api/cron/daily-dispatch/route.ts:89-90` — `new Date().toISOString().slice(0,10)` es UTC. Funciona para orgs en ART solo por coincidencia (03:00 UTC = 00:00 ART). Una org en otra TZ ya está mal.
  **Fix:** iterar orgs y calcular `today/tomorrow` con `org.timezone` (el patrón está implementado en `parte-diario-draft/route.ts:44`).

- [ ] **F2-16 · `weekly_archive` no idempotente por semana**
  `src/app/api/cron/daily-dispatch/route.ts:316-355` — Si el cron retorna 5xx y reintentan o lo disparan manualmente otra vez el mismo lunes, vuelve a archivar lo nuevo entre t1 y t2.
  **Fix:** tabla `weekly_archive_log(org_id, iso_week, ran_at)` con UNIQUE + `INSERT … ON CONFLICT DO NOTHING` como gate.

- [ ] **F2-17 · Cron parser incompleto**
  `src/app/api/cron/from-pg/route.ts:165-174` — Solo matchea `*/N * * * *`. Cualquier expresión con hora/día específico cae al fallback de "1 hora". `triggerScheduled` con default `"0 9 * * *"` dispara cada hora en vez de una vez por día.
  **Fix:** agregar dependencia `cron-parser` y parsear correctamente.

### Idempotencia

- [ ] **F2-18 · Errores de Postgres por string-match en inbound**
  `src/lib/crm/inbound.ts:120` — `if (!insErr.message.includes("uniq_crm_messages_wa_id"))`. Frágil ante upgrades de Postgres.
  **Fix:** `if (insErr.code !== '23505')`.

---

## Fase 3 — Autorización y endurecimiento (semana 2-3)

### Páginas sin chequeo de rol server-side (sidebar-only)

Crear primero el helper compartido:

```ts
// src/lib/permissions/require-can.ts
export async function requireCan(resource: Resource, action: Action) {
  const { role } = await getCurrentOrg();
  if (!can(role, resource, action)) redirect("/dashboard");
  return role;
}
```

Después aplicar en:

- [ ] `src/app/dashboard/propietarios/page.tsx:7-12` → `requireCan("owners", "view")` (expone CBUs)
- [ ] `src/app/dashboard/configuracion/equipo/page.tsx:12-13` → `requireAdminLevel(role)`
- [ ] `src/app/dashboard/configuracion/organizacion/page.tsx:13-15` → `requireAdminLevel(role)`
- [ ] `src/app/dashboard/configuracion/inbound-email/page.tsx:5-9` → `requireAdminLevel(role)` + agregar chequeo en `getInboundEmailConfig` también
- [ ] `src/app/dashboard/channel-manager/page.tsx:14-20` → `requireCan("ical", "view")`
- [ ] `src/app/dashboard/caja/[accountId]/page.tsx` → `requireCan("cash", "view")`
- [ ] `src/app/dashboard/unidades/[id]/marketplace/page.tsx` → `requireCan("units", "update")`
- [ ] `src/app/dashboard/unidades/[id]/precios/page.tsx` → `requireCan("units", "update")`
- [ ] `src/app/dashboard/tareas/page.tsx`, `alertas/page.tsx`, `inventario/page.tsx`, `limpieza/page.tsx`, `mantenimiento/page.tsx` → chequear rol según su resource

### Acciones sensibles sin `can()`

- [ ] `src/lib/actions/inbound-email.ts::rotateInboundToken` → `can(role, "settings", "update")` — hoy cualquier sesión rota el token de inbound y rompe inbound bookings hasta que staff redistribuya
- [ ] `src/lib/actions/ical.ts::rotateExportToken` → `can(role, "ical", "update")` — mismo problema clase
- [ ] `src/lib/actions/guests.ts::toggleBlacklistGuest:217-228` → `can(role, "guests", "update")`
- [ ] `src/lib/actions/units.ts::createUnit/updateUnit/changeUnitStatus/linkOwnerToUnit/unlinkOwnerFromUnit` → `can(role, "units", "create|update")`
- [ ] `src/lib/actions/tickets.ts::deleteTicket:348` → `can(role, "tickets", "delete")`
- [ ] `src/lib/actions/concierge.ts::deleteConciergeRequest/changeConciergeStatus` → `can(role, "tasks", "update|delete")`

### Rate limiting + middleware

- [ ] **Crear `src/middleware.ts`** con rate-limit IP-based usando Upstash/Vercel KV en:
  - `/ingresar`, `/registrarse` (brute force)
  - `requestGuestPasswordReset` (mailbomb)
  - `searchListings`, `quoteListing` (enumeration)
  - Endpoints del gateway WhatsApp (`/sessions/:id/send`) — protege contra abuso si el bearer leakea

### Endurecimiento de error messages

- [ ] **Mapear errores Postgres a copy en español genérico**
  `src/lib/actions/auth.ts:69` (`signIn`) — Hoy devuelve `error.message` crudo de Supabase, que revela si el email existe vs si la contraseña está mal (enumeration). Mapear a `"Email o contraseña incorrectos"` uniforme.
  Crear `src/lib/db-error.ts` con `translateDbError(error)` que strippee detalles internos de Postgres antes de re-throw.

- [ ] **HMAC con timestamp + reuso de secret**
  `whatsapp-gateway/src/crypto.ts:31,37` — Mismo `GATEWAY_SECRET` se usa como bearer auth y como HMAC key. Separar en `GATEWAY_BEARER` y `GATEWAY_HMAC_SECRET`.

- [ ] **Gateway send: cap + verificación de org**
  `whatsapp-gateway/src/server.ts:59-70` — Sin límite en `sendChain`, sin re-verificar `req.body.organizationId === session.organizationId`.
  **Fix:** cap de 100 inflight por canal; rechazar si los `organizationId` no coinciden.

- [ ] **Path traversal en media del gateway**
  `whatsapp-gateway/src/media.ts:85-90` — `upsert: true` con path derivado del `waMessageId` saneado a `_`. Distintos `waMessageId` pueden colisionar al mismo path; `contentType` del nodo se confía sin allowlist.
  **Fix:** hash SHA-256 del id como segmento del path; MIME contra allowlist.

- [ ] **Storage path injection en Baileys provider**
  `src/lib/crm/providers/baileys.ts:106-114` — El gateway envía `mediaStoragePath` sin que el app valide que empieza por `${orgId}/`.
  **Fix:** `if (!storagePath.startsWith(\`${orgId}/\`)) throw`.

### SSRF y prompt injection en CRM

- [ ] **`http_request` node permite cualquier URL (SSRF)**
  `src/lib/crm/workflows/nodes/builtin/index.ts:780-784` — `{{var}}` templating desde mensajes inbound permite apuntar al metadata service de la cloud.
  **Fix:** blocklist de `10/8`, `127/8`, `169.254/16`, `192.168/16`, `::1`; deny de `file://`, `gopher://`, esquemas no http(s).

- [ ] **`ai_response` node sin instrucción anti-prompt-injection**
  `src/lib/crm/workflows/nodes/builtin/index.ts:476-516` — Inyecta los últimos 10 mensajes inbound (usuario) en el prompt sin marcar que es contenido no confiable.
  **Fix:** cap de longitud por mensaje + delimitar con marcador y system prompt que aclare que el contenido es untrusted.

### Token comparisons

- [ ] **iCal export token no constant-time**
  `src/app/api/ical/[unitId]/route.ts:31` — `unit.ical_export_token !== token`. Token corto pero vale aplicar `crypto.timingSafeEqual`.

---

## Fase 4 — Calidad estructural (continuo)

### Patrones a estandarizar

- [ ] **Helper `guardAction`** que devuelva `{ session, organization, role }` y haga `requireSession + getCurrentOrg + can()` en una línea. ~40 server actions duplican estas 5 líneas hoy.

- [ ] **Helpers de revalidación por entidad**
  Crear `src/lib/revalidation/{booking,unit,cleaning,parte-diario}.ts` exportando `revalidate*Paths(id?)`. Reemplazar todos los `revalidatePath` ad-hoc. Hoy faltan revalidaciones críticas:
  - `cleaning.ts::updateCleaningChecklist:337-359` — no revalida `/dashboard/parte-diario`
  - `cleaning.ts::assignCleaning:315-335` — no revalida `parte-diario` ni `/m/limpieza`
  - `cleaning.ts::deleteCleaningTask:444-471` — no revalida `parte-diario`
  - `tickets.ts` (todas las mutaciones) — no revalidan `parte-diario`
  - `bookings.ts::updateBooking:824-829` — no revalida `parte-diario`, `limpieza`, `liquidaciones`
  - `bookings.ts::changeBookingStatus:966-968` — falta `parte-diario`, `unidades/calendario/mensual`, `limpieza`, `liquidaciones`
  - `owners.ts::updateOwner/archiveOwner/deleteOwner:105-141` — no revalida `liquidaciones`
  - `units.ts::updateUnit:186-189` — no revalida `reservas`, `parte-diario`, `mantenimiento`, `limpieza`
  - `guests.ts::updateGuest:212-214` — no revalida `reservas`

- [ ] **Traducción centralizada de errores de Postgres**
  `bookings.ts` repite 7× el bloque `if (msg.includes("bookings_no_overlap"))`. `marketplace-bookings.ts:264` y `booking-requests.ts:130` lo repiten. Crear `src/lib/booking-errors.ts::translateBookingError(error)` y extender a `bookings_dates_valid`, `MAX_BOOKING_NIGHTS`.

- [ ] **`@/lib/money.ts`** — ver F2-14.

- [ ] **Result shape de server actions** — Estandarizar en `{ ok: true; data } | { ok: false; reason; message }`. Hoy unas tiran `throw`, otras devuelven el entity, otras `{ ok: true }`.

- [ ] **Constantes de status de booking**
  `BOOKING_STATUSES_LIVE`, `BOOKING_STATUSES_EXCLUDED` — hoy el string `"(cancelada,no_show)"` aparece 8+ veces hardcodeado en `bookings.ts`.

- [ ] **Audit-event helper** — `tickets.ts`, `cleaning.ts`, `concierge.ts`, `settlements_audit` duplican el patrón "insertar evento en `<entity>_events`".

- [ ] **Hook de realtime estandarizado**
  Existen 3 patrones: `use-realtime-rows.ts` (correcto, con `handlersRef`), `use-inbox-realtime.ts:11-37` (incorrecto, se re-suscribe en cada render), e inline en `pms-board.tsx`/`kanban-board.tsx`/`bookings-list-client.tsx`. Migrar todos a `useRealtimeRows`.

- [ ] **Form pattern**
  Hoy hay `useState` per-field, `useTransition`, react-hook-form (`new-guest-form.tsx`). Estandarizar en React 19 `useActionState + useFormStatus` o RHF+`zodResolver` (ya está como dep).

### Performance

- [ ] **`listTeamMembers` N+1**
  `src/lib/actions/team.ts:42-49` — N llamadas a `auth.admin.getUserById`. Reemplazar por `auth.admin.listUsers({ perPage: 1000 })` y mapear.

- [ ] **`listBookings/Guests/Owners/Settlements` unbounded**
  Devuelven todos los rows de la org → MBs al cliente. Hacer paginación server-side. La PMS grid (`listBookingsInRange`) ya lo hace bien — usar de plantilla.

- [ ] **Lazy-load de libs pesadas (`next/dynamic`)**
  `next/dynamic` está usado **0 veces** hoy.
  - `mapbox-gl` + `react-map-gl` en `src/components/marketplace/listings-map.tsx` → dinámico con `ssr: false`
  - `recharts` en `src/app/dashboard/page.tsx:11` (`RevenueChart`) → dinámico
  - Paneles inactivos de `dashboard/perfil/profile-tabs.tsx` (SecuritySection, AvatarUploader, DniSection) → dinámico

- [ ] **Reorders en batch**
  `units.ts::reorderUnits:294-303` y `reorderUnitsGlobal:317-325` hacen N UPDATEs en `Promise.all` (race + N+1). Reemplazar por un único `UPDATE … SET position = CASE id WHEN … END`.

- [ ] **N+1 en daily-dispatch**
  `daily-dispatch/route.ts:187-230, 252-262`. Bookings queries en serie, ensureCleaningTasks 1 round-trip por checkout, template polling con `import` dinámico dentro del loop. Paralelizar con `Promise.allSettled` + timeouts.

- [ ] **Realtime replica identity**
  Para `bookings`, `units`, `crm_messages`, `crm_conversations`, `crm_contacts` está en `DEFAULT`. Si algún cliente filtra por `organization_id` en realtime, los DELETE events se pierden. Decidir: `FULL` o documentar.

### Índices faltantes (70+ FKs)

Migración `029_add_missing_fk_indexes.sql`:

- [ ] `cleaning_tasks.booking_out_id`, `booking_in_id`, `verified_by`
- [ ] `crm_messages.contact_id`, `sender_user_id`, `reply_to_message_id`
- [ ] `crm_message_outbox.channel_id`, `conversation_id`, `message_id`
- [ ] `bookings.created_by`, `currency`
- [ ] `cash_movements.created_by`, `currency`
- [ ] `notifications.target_user_id` (parcial WHERE NOT NULL)
- [ ] `owner_settlements.last_edited_by`, `generated_by`, `reviewed_by`
- [ ] `booking_payment_schedule.cash_movement_id`
- [ ] `booking_payments.account_id`
- [ ] `crm_workflow_step_logs.organization_id`
- [ ] Resto del listado (~50 más) — generar con consulta a `pg_constraint` para no perderse ninguno

### `search_path` en SECURITY DEFINER

- [ ] Migración que aplique `ALTER FUNCTION ... SET search_path = apartcba, public` a las 11 funciones del advisor:
  `tg_crm_touch_updated_at`, `crm_select_workflows_for_event`, `crm_increment_ai_usage`, `business_days_before`, `crm_increment_quick_reply_usage`, `crm_increment_workflow_counts`, `crm_snooze_conversation`, `crm_resolve_channel_by_ig`, `crm_increment_ai_usage_v2`, `tg_schedule_touch_updated_at`, `tg_set_updated_at`.

### Extensiones en `public`

- [ ] `vector`, `pg_trgm`, `btree_gist`, `pg_net` están en `public`. Mover a schema `extensions` (atención a indexes que dependen).

### Código muerto

- [ ] `src/lib/actions/bookings.ts:1493-1500` — `moveBooking` `@deprecated`, 0 callers
- [ ] `src/lib/actions/bookings.ts:1696-1787, 1794-1844` — `mergeLeaseGroup`, `splitBookingIntoSegments`, 0 callers
- [ ] `src/app/api/webhooks/meta/[channel]/route.ts` — toda la ruta (ver CRIT-4)
- [ ] `src/lib/types/database.ts` — tipos `Messaging*`
- [ ] Tablas `messaging_*` en DB (9 tablas vacías)
- [ ] Tablas `apartcba.invoices` (0 rows, 0 refs), `apartcba.activity_log` (0 rows, 0 refs)
- [ ] `src/app/api/cron/sync-ical/route.ts` y `payment-reminders/route.ts` — ya no scheduled, su trabajo está en `daily-dispatch`
- [ ] `src/app/dashboard/conserjeria/page.tsx` y `src/app/m/conserjeria/page.tsx` — solo redirects de 6 líneas, mover a `redirects()` en `next.config.ts`
- [ ] `test-split-tmp.mjs` en root — script one-off, mover a `scripts/` o borrar
- [ ] Imports muertos: `src/app/(marketplace)/mi-cuenta/page.tsx:264-265` (`void XCircle; void MessageSquare;`), `src/components/marketplace/unit-booking-widget.tsx:113`

### Accesibilidad

- [ ] `src/components/marketplace/listing-card.tsx:53-103` — `<button>` anidados dentro de `<Link>` (HTML inválido). Restructurar.
- [ ] `src/components/marketplace/unit-gallery.tsx:31-58` — `<div onClick>` sin `role`, `tabIndex`, ni keyboard handler.
- [ ] `inbox-client.tsx:122` — `confirm()` nativo para bulk actions. Reemplazar por shadcn `AlertDialog`.

### Hidratación

- [ ] Crear `<TimeAgo iso=… />` que use `useEffect` + setInterval para evitar SSR mismatch. Reemplazar las 6 inline implementations.
- [ ] `src/app/m/crm/inbox/page.tsx:47` — Server Component con `formatDistanceToNowStrict(new Date(...))` se "congela" en el momento del render. Mover a client.

### Cache headers

- [ ] `next.config.ts:44-67` — Agregar `/m/:path*` y `/mi-cuenta/:path*` al no-store list (hoy solo `/dashboard/*`, `/login`, `/api/*`).

### Logging y PII en gateway

- [ ] `whatsapp-gateway/src/session.ts:132, 372` — Números de teléfono en logs en plain text. Redactar a últimos 4 dígitos.

### Logging estructurado de errores

- [ ] Wired `Sentry.captureException` (o equivalente) en todas las rutas cron. Hoy fallos silenciosos a las 03:00 UTC pasan desapercibidos.

### Reproducibilidad del gateway

- [ ] Commitear `whatsapp-gateway/package-lock.json` (hoy ignorado / no presente). Cambiar `npm install` → `npm ci` en Dockerfile.
- [ ] Pinear versión exacta de `@whiskeysockets/baileys` (no `^6.7.0`).

### Reconnect storm del gateway

- [ ] `whatsapp-gateway/src/session-manager.ts:54-70` — `recoverAll()` reconecta todos los canales en paralelo. Agregar jitter 250-500ms entre canales.
- [ ] Cachear `fetchLatestBaileysVersion()` a nivel proceso (hoy se llama en cada `connect()`).

---

## Apéndice — Hallazgos por dominio (resumen)

| Dominio | Crítico | Alto | Medio | Bajo | Total |
|---|---:|---:|---:|---:|---:|
| Seguridad / multi-tenant | 3 | 7 | 8 | 5 | 23 |
| Server actions (data layer) | 8 | 14 | 22 | 11 | 55 |
| CRM (workflows, outbox, AI) | 8 | 5 | 11 | 18 | 42 |
| Marketplace + guest auth | 4 | 5 | 11 | 7 | 27 |
| Cron jobs (Vercel + pg_cron) | 5 | 5 | 7 | 10 | 27 |
| WhatsApp gateway | 5 | 6 | 8 | 7 | 26 |
| DB schema / migraciones | 5 | 7 | 14 | 12 | 38 |
| Frontend / UI | 0 | 7 | 14 | 18 | 39 |
| **TOTAL** | **38** | **56** | **95** | **88** | **~277** |

---

## Notas para el equipo

1. **No hay tests automatizados.** Muchos de los bugs de concurrencia y race conditions van a aparecer en producción antes que en dev. Cuando ataquen la Fase 2, conviene escribir tests de integración mínimos contra una DB local Supabase (especialmente para los RPCs nuevos).
2. **El proyecto tiene 2 schedulers** (Vercel Cron + pg_cron) — leer la sección "Cron / background jobs" en `CLAUDE.md` antes de tocar cualquier ruta de `/api/cron/`.
3. **El proyecto tiene 2 stacks de mensajería** (`crm_*` activo, `messaging_*` legacy). El legacy se elimina en CRIT-4. No agregar features sobre `messaging_*`.
4. **El gateway WhatsApp es un proyecto Node independiente** en `whatsapp-gateway/` desplegado en Railway. Tiene su propio `package.json` y `.env.example`. Cambios ahí no salen por Vercel.
5. **Antes de tocar `bookings`**, leer cómo los 4 caminos de creación convergen (direct, marketplace, inbound email, iCal) y cómo `bookings_no_overlap` interactúa con cada uno. Es el invariante más cargado del schema.
6. **`createAdminClient()` jamás se importa desde un componente cliente.** Si la auditoría futura encuentra eso, es una vulnerabilidad crítica — service_role en el bundle del browser.

## Para profundizar

Las auditorías por dominio quedaron en los logs de la sesión que generó este documento (8 reportes detallados). Si necesitan el contexto exacto de un finding, abrir el archivo:línea y el patrón está descrito en la justificación arriba.
