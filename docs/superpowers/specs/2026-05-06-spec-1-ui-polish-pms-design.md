# Spec 1 — UI polish del PMS y bug sweep

**Fecha:** 2026-05-06
**Estado:** Draft — awaiting user review
**Alcance:** Tasks 1, 2, 3, 4, 7, 8 del brief original
**Fuera de alcance:** Tasks 5 y 6 (perfil + 2FA + Resend) → Spec 2 separado.

## Objetivos

Mejorar la UX diaria del PMS sin agregar infraestructura nueva:

- Operadores pueden marcar días específicos del calendario (feriados, eventos, temporada alta, notas) y verlos resaltados en grilla.
- En Caja, los cobros de reserva muestran el nombre del huésped pagador en lugar del UUID truncado.
- Las barras diagonales que indican días bloqueados / mantenimiento / mensual son legibles a primera vista.
- El formulario de huésped tiene un selector de país buscable y un combobox de código telefónico, ambos con default Argentina.
- El bug visual en el detalle de ticket de mantenimiento queda corregido.
- Los bugs de severidad ALTA y MEDIA detectados durante la investigación quedan corregidos en este mismo spec.
- Se documenta que el realtime del calendario ya funciona correctamente y no requiere cambios.

## Restricciones

- Stack: Next.js 16 App Router · React 19 (Compiler ON) · Tailwind v4 + shadcn `new-york` · Supabase (schema `apartcba`).
- Datos: server actions (`"use server"`) usan `createAdminClient()` y filtran por `organization_id`.
- UI en es-AR.
- No mockear DB en cualquier verificación.
- No tocar Resend / email — eso es Spec 2.

---

## Tarea 1 — Calendar marks (resaltar días)

### Objetivo

Permitir que un usuario con rol `admin` o `recepcion` haga click en el header de una columna de día (DayChip) en la grilla del PMS y marque ese día con uno de cuatro estilos predefinidos. La marca es **org‑wide** (todos los miembros de la organización la ven). Cada marca tiene un `color` (categoría) y un `label` corto opcional.

### Modelo de datos

Nueva tabla `apartcba.calendar_marks`:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `organization_id` | `uuid` | FK a `apartcba.organizations(id)`, `ON DELETE CASCADE`, `NOT NULL` |
| `marked_date` | `date` | el día marcado, `NOT NULL` |
| `color` | `text` | enum constraint: `'feriado' | 'evento' | 'temporada_alta' | 'nota'` |
| `label` | `text` | opcional, máx. 80 chars (descripción corta tipo "Feriado nacional" / "Cumple Juan") |
| `created_by` | `uuid` | FK a `apartcba.user_profiles(id)`, `ON DELETE SET NULL` |
| `created_at` | `timestamptz` | default `now()` |

Constraints:
- `UNIQUE (organization_id, marked_date)` — una marca por día por org. Reabrir el popover sobre un día ya marcado edita la marca existente.
- `CHECK (color IN ('feriado','evento','temporada_alta','nota'))`.
- Índice: `(organization_id, marked_date)` — query típica filtra por rango.

RLS habilitado por consistencia con el resto del schema, pero la frontera real son los server actions (igual que el resto del proyecto, ver `CLAUDE.md`).

### Migration

Archivo nuevo: `supabase/migrations/003_calendar_marks.sql`.
Crea la tabla, índice, constraints, RLS placeholder.
Idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

### TypeScript types

Agregar a `src/lib/types/database.ts`:

```ts
export type CalendarMarkColor = "feriado" | "evento" | "temporada_alta" | "nota";

export interface CalendarMark {
  id: string;
  organization_id: string;
  marked_date: string; // YYYY-MM-DD
  color: CalendarMarkColor;
  label: string | null;
  created_by: string | null;
  created_at: string;
}
```

### Constantes

Agregar a `src/lib/constants.ts`:

```ts
export const CALENDAR_MARK_META: Record<CalendarMarkColor, { label: string; bg: string; ring: string; text: string }> = {
  feriado:        { label: "Feriado",        bg: "rgba(244,63,94,0.18)",   ring: "rgb(244,63,94)",   text: "rgb(244,63,94)" },
  evento:         { label: "Evento",         bg: "rgba(168,85,247,0.18)",  ring: "rgb(168,85,247)",  text: "rgb(168,85,247)" },
  temporada_alta: { label: "Temp. alta",     bg: "rgba(245,158,11,0.20)",  ring: "rgb(245,158,11)",  text: "rgb(245,158,11)" },
  nota:           { label: "Nota",           bg: "rgba(20,184,166,0.18)",  ring: "rgb(20,184,166)",  text: "rgb(20,184,166)" },
};
```

### Server actions (nuevo archivo `src/lib/actions/calendar-marks.ts`)

Cada acción sigue el patrón canónico: `requireSession() → getCurrentOrg() → Zod validate → admin client → revalidatePath`.

- `listCalendarMarks({ from, to }: { from: string; to: string }): Promise<CalendarMark[]>`
  - Lectura. Filtra por `organization_id`, `marked_date` BETWEEN from AND to.
- `upsertCalendarMark(input: { date: string; color: CalendarMarkColor; label?: string }): Promise<CalendarMark>`
  - **Permission gate:** solo `admin` o `recepcion`. Throw `Error("No autorizado")` si no.
  - Upsert por `(organization_id, marked_date)`.
  - `created_by = session.userId`.
  - `revalidatePath("/dashboard/unidades")`.
- `deleteCalendarMark(date: string): Promise<void>`
  - Mismo permission gate.
  - Delete por `(organization_id, marked_date)`.
  - `revalidatePath("/dashboard/unidades")`.

### UI

#### Wiring del data fetching

`src/app/dashboard/unidades/page.tsx` (server component) ya carga datos para el board. Agregar `listCalendarMarks({ from: rangeStart, to: rangeEnd })` al `Promise.all`. Pasar `marks` como prop al `<PmsBoard />`.

#### Cambios en `pms-board.tsx`

1. Aceptar `marks: CalendarMark[]` como prop.
2. Construir `marksByDate: Map<string, CalendarMark>` con `useMemo`.
3. **DayChip (líneas 2596‑2634):**
   - Agregar `onClick` que abre el `<CalendarMarkPopover />`.
   - Si la fecha tiene marca: aplicar `box-shadow: inset 0 -3px 0 ${meta.ring}` + bg sutil (`meta.bg`) en el chip; mostrar el `label` truncado si entra; tooltip con label completo.
4. **Columna del día:**
   - Cuando hay marca, agregar una capa `pointer-events-none absolute inset-0 ${meta.bg}` debajo de la grilla de pills (z-index entre el gradiente weekend y las pills).
   - Esa capa cubre desde el header hasta el final del scroll vertical de la columna.
5. **Realtime:** la suscripción existente a `bookings` no aplica acá. Agregar segunda suscripción a `apartcba.calendar_marks` con el mismo patrón (`channel("apartcba:calendar_marks:" + organizationId)`), filtrando por `organization_id`. Update del estado local de marks en eventos INSERT/UPDATE/DELETE.

#### Componente nuevo `src/components/units/pms/calendar-mark-popover.tsx`

Popover con:
- Cuatro botones de color (radio group visual).
- Input de label opcional (máx 80 chars, placeholder "Ej: Feriado nacional").
- Botón "Guardar" (disabled durante pending) y "Borrar marca" si ya existe.
- "Cancelar" cierra sin cambios.

Props: `{ date: string; existingMark: CalendarMark | null; onClose: () => void }`. Internamente usa `upsertCalendarMark` / `deleteCalendarMark`.

#### Permisos UI y server-side

Agregar un resource nuevo `calendar_marks` al permission system:

- `src/lib/permissions.ts`: agregar `"calendar_marks"` a la union type `Resource`.
- `src/lib/constants.ts` `DEFAULT_ROLE_PERMISSIONS`:
  - `admin`: `{ view: true, edit: true }`
  - `recepcion`: `{ view: true, edit: true }`
  - `mantenimiento` / `limpieza` / `owner_view`: `{ view: true, edit: false }`

Lectura (`view`) está abierta a todos para que vean los días marcados; solo edit gatea la creación / borrado.

UI: el click del DayChip abre el popover si `can(role, "calendar_marks", "edit")`. Si no, el chip muestra la marca pero no abre popover.

Server actions: `upsertCalendarMark` y `deleteCalendarMark` revalidan `can(role, "calendar_marks", "edit")` antes de proceder; throw `Error("No autorizado")` si no.

### Vista mensual

`pms-monthly-board.tsx` no tiene columna por día — tiene celdas mes/unidad. Out of scope para este spec. Si quieren ver marcas allí, lo agregamos después como una pequeña pill "X marcas en mayo" sobre el header del mes.

### Edge cases

- Múltiples usuarios marcando el mismo día simultáneamente → upsert resuelve con last-write-wins.
- Marca de día anterior a hoy: permitida (tiene sentido para retrospectiva).
- Marca de día más de 1 año en el futuro: permitida (planeamiento de temporadas).
- `label` con caracteres raros / emoji: permitido (text en Postgres).

---

## Tarea 2 — Nombre del pagador en Caja

### Objetivo

En la lista de "Movimientos recientes" de Caja, las filas con `category = 'booking_payment'` muestran actualmente `"Cobro de reserva 481ab64c"`. Reemplazar por `"Cobro · María González"` donde el nombre viene de `bookings.guest_id → guests.full_name`. Filas no‑booking conservan su `description` actual.

### Estrategia

**Lectura, no escritura.** No tocamos `bookings.ts:116` ni descripciones en DB. Joineamos al leer.

### Cambios en `src/lib/actions/cash.ts`

`listMovements({ accountId, ... })` actualmente devuelve filas planas. Lo extendemos para joinear:

```ts
const { data } = await admin
  .from("cash_movements")
  .select(`
    *,
    account:cash_accounts(id, name, color),
    linked_booking:bookings!cash_movements_ref_id_fkey(
      id,
      guest:guests(id, full_name)
    )
  `)
  .eq("organization_id", organization.id)
  .order("occurred_at", { ascending: false });
```

**Cuidado:** `cash_movements.ref_id` es un `uuid` genérico que puede apuntar a `bookings`, `payment_schedules`, `owner_settlements`, etc. (según `ref_type`). Supabase no permite FK polimórfico, así que el `.bookings!cash_movements_ref_id_fkey` solo funciona si **existe** un FK declarado de `cash_movements.ref_id` a `bookings.id`. Si no existe (probable), hacemos un segundo query manual:

```ts
const bookingMovementIds = movements
  .filter((m) => m.ref_type === "booking" && m.ref_id)
  .map((m) => m.ref_id);
const { data: bookings } = await admin
  .from("bookings")
  .select("id, guest:guests(full_name)")
  .in("id", bookingMovementIds);
const bookingMap = new Map(bookings.map((b) => [b.id, b]));
// merge en cada movement: m.linked_booking = bookingMap.get(m.ref_id) ?? null
```

Esto evita N+1 (un solo query extra) y no asume FK declarado. **Ese es el approach final.**

Mismo tratamiento para `ref_type = 'payment_schedule'`: 1 query extra a `payment_schedules` joinado a `bookings → guests`.

### Cambios en tipos

En `src/components/cash/movements-list.tsx`, extender el type `Movement` (o exportar uno nuevo desde `cash.ts`):

```ts
export type MovementWithLinks = CashMovement & {
  account: { id: string; name: string; color: string | null } | null;
  linked_guest_name: string | null;
};
```

`linked_guest_name` se calcula en la action y se pasa como string plano — el componente no necesita conocer el detalle del schedule vs booking.

### Cambios en `src/components/cash/movements-list.tsx`

Líneas 74 (mobile) y 103 (desktop) — modificar la expresión de la línea principal:

```tsx
const title = m.category === "booking_payment" && m.linked_guest_name
  ? `Cobro · ${m.linked_guest_name}`
  : (m.description ?? CATEGORY_LABELS[m.category] ?? m.category);
```

### Edge cases

- Booking eliminada (`linked_guest_name = null`): fallback al `description` viejo "Cobro de reserva 481ab64c". UX no se rompe.
- Movimiento `category = 'booking_payment'` pero sin `ref_id` (data inconsistente): fallback al `description`.
- Movimientos `'Otro'` / cambio de divisas: no entran en la rama, mantienen su `description`.
- Booking sin guest (huésped no asignado todavía): `linked_guest_name = null` → fallback.

### Performance

El query extra agrega 1 ida a la DB. Para listas de 20‑50 movimientos esto es instantáneo. Si la lista crece, se puede mover a vista materializada — fuera de alcance.

---

## Tarea 3 — Contraste de barras diagonales

### Objetivo

Subir el contraste de los patrones de rayas en el PMS para que se lean a primera vista. Aplicar a **ambos sistemas** porque la captura no permite distinguir cuál es:

1. `BOOKING_MODE_OVERLAY.mensual.stripePattern` (rayas verticales sobre la barra de una reserva mensual / "USO PROPIETARIO").
2. `UNIT_OVERLAY_STYLE.{bloqueado,limpieza,mantenimiento}` (rayas diagonales sobre celda de unidad fuera de servicio).

### Cambios en `src/components/units/pms/pms-constants.ts`

#### `BOOKING_MODE_OVERLAY.mensual`

Antes:
```ts
stripePattern: "repeating-linear-gradient(0deg, transparent 0 19px, rgba(255,255,255,0.16) 19px 20px)"
```

Después:
```ts
stripePattern: "repeating-linear-gradient(0deg, transparent 0 17px, rgba(255,255,255,0.42) 17px 19px)"
```

Cambios: stripe de 1px @ 16% → 2px @ 42%, período de 20px → 19px (más denso). Mismo color blanco (queda sobre la barra de gradiente colorido de la reserva).

#### `UNIT_OVERLAY_STYLE.bloqueado`

Antes:
```ts
"repeating-linear-gradient(135deg, rgba(100,116,139,0.25) 0 8px, rgba(100,116,139,0.08) 8px 16px)"
```

Después:
```ts
`linear-gradient(rgba(100,116,139,0.10), rgba(100,116,139,0.10)),
 repeating-linear-gradient(135deg, rgba(100,116,139,0.50) 0 8px, rgba(100,116,139,0.18) 8px 16px)`
```

Capa base + rayas más intensas. Mismo cambio para `limpieza` (cyan) y `mantenimiento` (orange):

- `limpieza`: base `rgba(6,182,212,0.10)` + rayas `0.40 / 0.14`.
- `mantenimiento`: base `rgba(249,115,22,0.10)` + rayas `0.40 / 0.14`.

### Verificación

Probar en ambos modos light y dark. Compilar `npm run build` para asegurar que el CSS-in-JS no rompe SSR. Visual check en `/dashboard/unidades`.

### Riesgo

Las barras de booking en modo `mensual` se vuelven más "ruidosas" visualmente. Si la legibilidad del label de la reserva se ve afectada, se ajusta el opacity del overlay y/o se sube el `text-shadow` del label. Esto se valida durante la implementación.

---

## Tarea 4 — Selector de país + código telefónico

### Objetivo

En `<GuestFormDialog />`:

1. Reemplazar el input de texto "País" por un combobox buscable con bandera + nombre + código (ej. `🇦🇷 Argentina (+54)`). Buscar por nombre o por número.
2. Default: Argentina.
3. Almacenar **ISO alpha‑2** (`AR`) en `guests.country` (consistente con el default actual del Zod schema).
4. Agregar un combobox compacto de **código telefónico** (`+54`) a la izquierda del input "Teléfono". También buscable.
5. Al seleccionar un país en el primer combobox, autocompletar el código tel del segundo (si el usuario no lo cambió manualmente).
6. El campo `phone` sigue siendo `text`. Se almacena como `${dialCode}${number}` (ej. `+5491145678901`). No splitear en DB.

### Decisión clave: dos campos independientes en el form

País y código tel viven como dos controles separados en el dialog. El "auto‑prefill" del código tel es solo una conveniencia inicial: se sincroniza al elegir país, y a partir de ese momento el usuario puede cambiar uno sin afectar al otro.

### Nueva dependencia

```bash
npm install world-countries
```

`world-countries` es JSON estático (~11KB raw, ~1KB gzip) con metadata de ~250 países: ISO codes, dial codes (`idd.root + idd.suffixes[0]`), banderas (emoji), nombres (`name.common` en inglés, `translations.spa.common` en español).

### Helpers nuevos `src/lib/countries.ts`

```ts
import countries from "world-countries";

export interface CountryOption {
  iso2: string;        // "AR"
  name: string;        // "Argentina" (es)
  flag: string;        // "🇦🇷"
  dialCode: string;    // "+54"
}

export const COUNTRIES: CountryOption[] = countries
  .map((c) => ({
    iso2: c.cca2,
    name: c.translations?.spa?.common ?? c.name.common,
    flag: c.flag,
    dialCode: (c.idd?.root ?? "") + (c.idd?.suffixes?.[0] ?? ""),
  }))
  .filter((c) => c.dialCode.length > 1) // descarta entries sin dial code
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

export const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso2, c]));

export function findByDialCode(prefix: string): CountryOption | undefined {
  // exact match preferred; for "+1" multiple countries match — return USA
  const matches = COUNTRIES.filter((c) => c.dialCode === prefix);
  return matches.find((c) => c.iso2 === "US") ?? matches[0];
}
```

### Componente nuevo `src/components/ui/country-combobox.tsx`

Combobox shadcn (Command + Popover) que mirrora el patrón ya usado en `booking-form-dialog.tsx` para "Buscar huésped existente". Props:

```ts
interface CountryComboboxProps {
  value: string | null;            // ISO2 ("AR")
  onChange: (iso2: string) => void;
  variant?: "full" | "dial-only";  // "full" muestra "🇦🇷 Argentina (+54)"; "dial-only" solo "+54"
  placeholder?: string;
  className?: string;
}
```

Búsqueda case-insensitive sobre `name`, `iso2`, `dialCode` (incluye match por número sin el `+`). Lista virtualizada — dado que son ~250 items y `cmdk` ya filtra eficientemente, no hace falta virtualización extra.

### Cambios en `guest-form-dialog.tsx`

1. Reemplazar el `<Input>` de País por `<CountryCombobox variant="full" value={form.country} onChange={(iso2) => { setForm({ ...form, country: iso2 }); maybeSyncDialCode(iso2); }} />`.
2. Reemplazar el `<Input type="tel">` por un grupo:

```tsx
<div className="flex gap-2">
  <CountryCombobox
    variant="dial-only"
    value={dialCodeIso}
    onChange={(iso2) => setDialCodeIso(iso2)}
    className="w-24 shrink-0"
  />
  <Input
    type="tel"
    value={phoneLocal}
    onChange={(e) => setPhoneLocal(e.target.value)}
    placeholder="11 4567 8901"
  />
</div>
```

3. Helper `maybeSyncDialCode(countryIso)`: si el usuario no editó manualmente el dial code (`dialCodeUserEdited.current === false`), setear `dialCodeIso = countryIso`.
4. Submit: `phone = `${COUNTRY_BY_ISO.get(dialCodeIso).dialCode}${phoneLocal}`` (sin espacios).

### Edición de huéspedes existentes (mapeo legacy)

Al abrir el dialog en modo edición:
- `country`:
  - Si tiene 2 chars y existe en `COUNTRY_BY_ISO` → preseleccionar.
  - Si no, buscar en `COUNTRIES` por `name` (case-insensitive, normalizado sin acentos) — si match único, usar ese ISO2.
  - Si no hay match, default a `AR` y mostrar toast "País '{value}' no reconocido, se usó Argentina por defecto" en consola (sin alarmar al usuario).
  - El form siempre envía ISO2 — el campo legacy se "lava" silenciosamente al primer guardado.
- `phone`: regex `^\+(\d{1,4})` para extraer el prefix, buscar match exacto en `COUNTRIES` (preferencia AR si hay empate), `phoneLocal = phone.slice(prefix.length)`. Si no parsea, `dialCodeIso = "AR"` y `phoneLocal = phone` completo.

### Cambios en Zod schema (`src/lib/actions/guests.ts`)

Schema de create y update aceptan `country: z.string().length(2).regex(/^[A-Z]{2}$/).default("AR")`. El form garantiza ISO2 al submit; la action no necesita ser tolerante. Si llega un string legacy desde data antigua sin pasar por el form (improbable), la validación falla con error claro — preferimos esto a "tolerancia que enmascara bugs".

### Edge cases

- País sin dial code (Antártida): excluido por el filter en `COUNTRIES`.
- Dial codes compartidos (USA y Canadá usan `+1`): el combobox muestra ambos como entries separadas; al seleccionar país desde el primer combobox auto‑sincroniza al país elegido (no a USA por default).
- Teléfono sin prefijo en data legacy: el parser deja `dialCodeIso = "AR"` por default y `phoneLocal = el string completo`.

---

## Tarea 7 — Realtime calendario

### Objetivo

Verificar que el calendario actualice en tiempo real al crear/editar reservas.

### Estado actual (verificado)

Ya funciona. `pms-board.tsx:783‑838` tiene una suscripción `apartcba:bookings:${organizationId}` a `postgres_changes` que actualiza el estado local en INSERT/UPDATE/DELETE. Más `revalidatePath` + `router.refresh()` en `booking-form-dialog`. Doble mecanismo (realtime para inmediatez, refresh para consistencia).

### Cambios

Ninguno. Documentado y cerrado.

### Nota para el spec 1 implementador

Como Task 1 (calendar marks) agrega una segunda suscripción realtime, asegurarse de:
- Reusar el patrón existente.
- Limpiar la suscripción en `useEffect` cleanup.
- No sobrescribir el state de marks durante un drag de booking (los `pendingMutateIds` son para bookings, calendar marks tienen su propio set si es necesario).

---

## Tarea 8 — Bug visual mantenimiento + cosecha de bugs

### 8.1 Bug visual de los botones (BLOCKER del brief)

**Archivo:** `src/components/tickets/ticket-detail-dialog.tsx` líneas 258‑286.

**Causa raíz:** la fila "Mover a:" renderiza los 5 estados, incluyendo el estado actual con `opacity-50`. El chip "actual" es visualmente idéntico al Badge del header (mismas tonalidades de color, mismo border radius), creando la sensación de pill duplicado. "Esperando repuesto" tiene la etiqueta más larga y fuerza wrap en el dialog `max-w-2xl`.

**Fix:**
1. Filtrar el estado actual del map: `(Object.keys(TICKET_STATUS_META) as TicketStatus[]).filter((s) => s !== ticket.status).map(...)`.
2. Eliminar la rama `isCurrent` y todo el styling condicional asociado — todos los chips quedan en estilo "transición disponible".
3. (Opcional) Reordenar los estados en orden de progresión natural: `abierto → en_progreso → esperando_repuesto → resuelto → cerrado` para que los chips visibles cambien en orden lógico según el estado actual.

### 8.2 Bugs ALTA detectados

#### Bug 8.2.a — Doble fetch del timeline

`ticket-detail-dialog.tsx:128‑141`. El `useEffect` que llama `listTicketEvents` tiene `isPending` en sus deps. Cada cambio de estado dispara `isPending: true → false`, causando dos refetchs. Además `events` no se resetea entre fetchs así que el timeline parpadea con datos viejos.

**Fix:** sacar `isPending` de las deps. Si se necesita refrescar el timeline tras un cambio de estado, hacerlo explícitamente al terminar el `startTransition` (callback en `handleStatusChange`).

#### Bug 8.2.b — Race en doble‑tap (mobile editor)

`mobile-ticket-editor.tsx:54‑56`. El optimistic `setStatus(next)` se llama **antes** del check `if (next === status) return`. Doble tap rápido en dos chips distintos cometería ambos cambios.

**Fix:** mover el check arriba del `setStatus`. Y tras el commit fallido, revertir.

### 8.3 Bugs MEDIA detectados

#### Bug 8.3.a — `setState` durante render

`ticket-detail-dialog.tsx:117‑123`. El bloque `if (ticket && ticket.id !== prevTicketId) { setX(...); ... }` dentro del cuerpo del componente. Tolerado por React, pero frágil con React Compiler activo.

**Fix:** mover a `useEffect([ticket?.id])` con cleanup adecuado.

#### Bug 8.3.b — Subida de fotos sin paralelismo ni progreso

`ticket-photos-section.tsx:63‑68`. Loop `for (const file of files) await upload(file)` — secuencial, sin progreso visible.

**Fix:** `Promise.all(files.map(uploadOne))` + estado de progreso `{ uploaded: number; total: number }` en un toast persistente o en una barra inline.

#### Bug 8.3.c — Tile "Reservado" del dashboard hardcodeado

`src/app/dashboard/page.tsx:39`. El KPI "Reservado" está fijo en 0.

**Fix:** o cablear el KPI real (count de bookings con status `confirmada` o futura) o quitar el tile. Decisión: quitar el tile en este spec (no estaba en el brief, pero agregar el KPI real requiere definir la fórmula). Si el equipo lo quiere de vuelta, lo cableamos en otra pasada.

#### Bug 8.3.d — N+1 al traer balances de cuentas

`src/app/dashboard/caja/page.tsx:23`. `await Promise.all(accounts.map((a) => getAccountBalance(a.id)))` — un round‑trip por cuenta.

**Fix:** una sola action `getAccountBalances(orgId)` que devuelve `{ account_id: balance }` con un solo aggregate query (`select account_id, sum(amount) ... group by account_id`).

### 8.4 Bugs BAJA — fuera de alcance

- Photo `<Image>` sin `onError` fallback.
- Confirm delete inline rompe focus trap.

Quedan documentados aquí para una próxima pasada.

---

## Plan de implementación

Sugerimos tres PRs independientes para iterar rápido:

### PR 1 — Quick wins (zero risk)
- Tarea 2: nombre de pagador en Caja.
- Tarea 3: contraste de stripes (constants.ts).
- Tarea 8.1: fix botón mantenimiento.
- Tarea 8.2.a: useEffect doble fetch.
- Tarea 8.2.b: race en doble‑tap mobile.
- Tarea 8.3.a: setState durante render.
- Tarea 8.3.b: paralelizar subida de fotos + progreso.
- Tarea 8.3.c: quitar tile "Reservado" hardcodeado.
- Tarea 8.3.d: bulk balance query en Caja.

Sin migrations, sin nuevas dependencias, sin schema changes. Cambios localizados, deploy seguro.

### PR 2 — Country selector
- Tarea 4 completa.
- Nueva dependencia `world-countries`.
- Cambios solo en `guest-form-dialog.tsx` + dos nuevos archivos.

### PR 3 — Calendar marks
- Tarea 1 completa.
- Migration `003_calendar_marks.sql`.
- Nuevo archivo de actions, nuevo componente popover, cambios en `pms-board.tsx`.
- Realtime adicional.

Tarea 7 no es PR — solo nota documental en el spec.

## Files affected (resumen)

| Archivo | PR | Cambio |
|---|---|---|
| `supabase/migrations/003_calendar_marks.sql` | 3 | Nuevo |
| `src/lib/types/database.ts` | 3 | + tipos CalendarMark |
| `src/lib/constants.ts` | 3 | + CALENDAR_MARK_META |
| `src/lib/actions/calendar-marks.ts` | 3 | Nuevo |
| `src/lib/actions/cash.ts` | 1 | listMovements joinea guest |
| `src/lib/actions/guests.ts` | 2 | Zod schema country = ISO2 |
| `src/lib/countries.ts` | 2 | Nuevo |
| `src/components/units/pms/pms-board.tsx` | 3 | Acepta marks prop, DayChip clickable, overlay layer, segundo realtime |
| `src/components/units/pms/pms-constants.ts` | 1 | Bump opacity stripe patterns |
| `src/components/units/pms/calendar-mark-popover.tsx` | 3 | Nuevo |
| `src/components/cash/movements-list.tsx` | 1 | Display logic con linked_guest_name |
| `src/components/guests/guest-form-dialog.tsx` | 2 | Country+dial combobox |
| `src/components/ui/country-combobox.tsx` | 2 | Nuevo |
| `src/components/tickets/ticket-detail-dialog.tsx` | 1 | Filter current status, useEffect deps, setState→useEffect |
| `src/components/tickets/mobile-ticket-editor.tsx` | 1 | Reorder optimistic check |
| `src/components/tickets/ticket-photos-section.tsx` | 1 | Promise.all + progreso |
| `src/app/dashboard/page.tsx` | 1 | Quitar tile Reservado |
| `src/app/dashboard/caja/page.tsx` | 1 | Bulk balance query |
| `src/app/dashboard/unidades/page.tsx` | 3 | Cargar marks |
| `package.json` / `package-lock.json` | 2 | + world-countries |

## Verificación

No hay test runner. Por cada PR:
- `npx tsc --noEmit` debe pasar limpio.
- `npm run lint` debe pasar limpio.
- `npm run build` debe pasar limpio.
- Smoke test manual de la feature en `npm run dev` (puerto 3001):
  - PR1: rotar estado de un ticket en desktop (chips se ven bien) y mobile, ver que un cobro de reserva muestra nombre, ver que las stripes se notan.
  - PR2: crear/editar huésped con país argentino y luego con país extranjero (España).
  - PR3: crear feriado, ver columna resaltada, abrir en otra pestaña en otro usuario, confirmar realtime.

## Riesgos

- **Pms-board.tsx tiene 3303 líneas.** Cualquier cambio de estado allí adentro es delicado. Mitigación: mantener cambios localizados (DayChip onClick + overlay layer + segundo channel) sin tocar la lógica de bookings/drag.
- **`world-countries` data**: depende del paquete tener traducciones en español. Si no las tiene para algún ISO, fallback a inglés (ya manejado por `?? c.name.common`).
- **Migración `003_calendar_marks.sql`**: idempotente y aislada. Si rollback, es un `DROP TABLE`. Sin impacto en datos existentes.
- **Stripe pattern bump**: si bookings con texto largo en modo `mensual` se vuelven ilegibles, ajustar localmente (subir `text-shadow`, bajar opacity `0.42 → 0.32`).

## Out of scope para este spec

- Resend integration, perfil de usuario, 2FA, cambios de credenciales (Spec 2).
- Email de confirmación de reserva (Spec 2).
- Marcas de calendario en vista mensual.
- Refactor de `pms-board.tsx` (tiene 3303 líneas — fuera de alcance).
- KPI real de "Reservado" del dashboard (decidido: quitarlo en este spec).
- Bugs BAJA enumerados en 8.4.
