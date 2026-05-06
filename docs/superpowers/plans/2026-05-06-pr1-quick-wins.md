# PR 1 — Quick wins (UI polish + bug sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En un solo PR, aplicar 9 mejoras de UI / bug fixes sin migrations ni dependencias nuevas: contraste de barras del PMS, fix visual del botón de mantenimiento, varios bugs ALTA/MEDIA en tickets y caja, y el cambio de display "Cobro de reserva XXXXX" → "Cobro · Nombre del huésped" en la lista de movimientos.

**Architecture:** Cada fix es local a uno o dos archivos. No hay nuevos módulos ni tablas. Para el payer name agregamos un join read-side en `listMovements` (un query extra batch); para el bulk balance reemplazamos N+1 por dos queries totales. Verificación: `tsc --noEmit`, `lint`, `build`, smoke manual.

**Tech Stack:** Next.js 16 App Router · React 19 (Compiler) · TypeScript · Tailwind v4 · shadcn · Supabase (`apartcba` schema) · Server actions con `createAdminClient`. Sin test runner — verificación por tipo + lint + manual.

**Spec:** [`docs/superpowers/specs/2026-05-06-spec-1-ui-polish-pms-design.md`](../specs/2026-05-06-spec-1-ui-polish-pms-design.md) · sección PR 1.

**Convención de commits:** un commit por task. Mensaje en español, prefijo `fix:` o `feat:` según el caso. No skipear hooks. Branch base: `main`.

---

## Pre-flight

- [ ] **Confirmar working tree del usuario y crear branch**

El working tree tiene cambios sin commitear de varias features que el usuario está trabajando. NO commitear arriba de eso. Antes de tocar nada:

Run:
```bash
git status --short | head -20
git branch --show-current
```

Si la rama actual es `main` y hay archivos modificados:
1. Preguntar al usuario si quiere stashear los cambios actuales para que arranquemos PR1 limpio, o si esos cambios son parte de PR1 / otro PR.
2. Si confirma stash: `git stash push -u -m "wip pre-PR1"`.
3. Crear la rama feature: `git checkout -b feat/pr1-quick-wins`.

Si la rama actual ya es una rama feature distinta de main, frenar y consultar.

- [ ] **Verificar working tree limpio para los archivos que vamos a tocar**

Run:
```bash
git status --short src/components/units/pms/pms-constants.ts \
  src/components/tickets/ticket-detail-dialog.tsx \
  src/components/tickets/mobile-ticket-editor.tsx \
  src/components/tickets/ticket-photos-section.tsx \
  src/app/dashboard/page.tsx \
  src/app/dashboard/caja/page.tsx \
  src/lib/actions/cash.ts \
  src/components/cash/movements-list.tsx
```
Expected: ninguno listado. Si alguno aparece, frenar y consultar.

- [ ] **Verificar que el repo compila antes de tocar nada**

Run:
```bash
npx tsc --noEmit && npm run lint
```
Expected: ambos exit 0. Si rompen sin que tocaste nada, frenar y consultar — hay regresiones previas que no son nuestras.

---

## Task 1 — Subir contraste de las barras diagonales del PMS

**Goal:** Las rayas de booking mensual y los overlays de unidad bloqueada/limpieza/mantenimiento se notan a primera vista.

**Files:**
- Modify: `src/components/units/pms/pms-constants.ts:105-148`

- [ ] **Step 1: leer el bloque actual**

Read `src/components/units/pms/pms-constants.ts` líneas 100‑148 para confirmar que ves los patrones que vas a reemplazar (`UNIT_OVERLAY_STYLE` y `BOOKING_MODE_OVERLAY.mensual.stripePattern`).

- [ ] **Step 2: subir contraste de `UNIT_OVERLAY_STYLE.limpieza`**

En `src/components/units/pms/pms-constants.ts`, reemplazar el bloque `limpieza`:

Antes (línea 105‑110):
```ts
  limpieza: {
    pattern:
      "repeating-linear-gradient(135deg, rgba(6,182,212,0.18) 0 8px, rgba(6,182,212,0.06) 8px 16px)",
    label: "Limpieza",
    hex: "#06b6d4",
  },
```

Después:
```ts
  limpieza: {
    pattern:
      "linear-gradient(rgba(6,182,212,0.10), rgba(6,182,212,0.10)), repeating-linear-gradient(135deg, rgba(6,182,212,0.40) 0 8px, rgba(6,182,212,0.14) 8px 16px)",
    label: "Limpieza",
    hex: "#06b6d4",
  },
```

- [ ] **Step 3: subir contraste de `UNIT_OVERLAY_STYLE.mantenimiento`**

Antes (línea 111‑116):
```ts
  mantenimiento: {
    pattern:
      "repeating-linear-gradient(135deg, rgba(249,115,22,0.18) 0 8px, rgba(249,115,22,0.06) 8px 16px)",
    label: "Mantenimiento",
    hex: "#f97316",
  },
```

Después:
```ts
  mantenimiento: {
    pattern:
      "linear-gradient(rgba(249,115,22,0.10), rgba(249,115,22,0.10)), repeating-linear-gradient(135deg, rgba(249,115,22,0.40) 0 8px, rgba(249,115,22,0.14) 8px 16px)",
    label: "Mantenimiento",
    hex: "#f97316",
  },
```

- [ ] **Step 4: subir contraste de `UNIT_OVERLAY_STYLE.bloqueado`**

Antes (línea 117‑122):
```ts
  bloqueado: {
    pattern:
      "repeating-linear-gradient(135deg, rgba(100,116,139,0.25) 0 8px, rgba(100,116,139,0.08) 8px 16px)",
    label: "Bloqueado",
    hex: "#64748b",
  },
```

Después:
```ts
  bloqueado: {
    pattern:
      "linear-gradient(rgba(100,116,139,0.10), rgba(100,116,139,0.10)), repeating-linear-gradient(135deg, rgba(100,116,139,0.50) 0 8px, rgba(100,116,139,0.18) 8px 16px)",
    label: "Bloqueado",
    hex: "#64748b",
  },
```

- [ ] **Step 5: subir contraste de `BOOKING_MODE_OVERLAY.mensual.stripePattern`**

Antes (línea 139‑147):
```ts
  mensual: {
    // Pattern sutil: líneas verticales tenues cada ~20px
    stripePattern:
      "repeating-linear-gradient(0deg, transparent 0 19px, rgba(255,255,255,0.16) 19px 20px)",
    sideAccent: "#7c3aed", // violeta — borde izquierdo finito
    badgeBg: "bg-violet-100 dark:bg-violet-900/60",
    badgeText: "text-violet-700 dark:text-violet-100",
    badgeRing: "ring-violet-300/60 dark:ring-violet-700/60",
  },
```

Después:
```ts
  mensual: {
    // Pattern: líneas verticales legibles cada ~19px
    stripePattern:
      "repeating-linear-gradient(0deg, transparent 0 17px, rgba(255,255,255,0.42) 17px 19px)",
    sideAccent: "#7c3aed", // violeta — borde izquierdo finito
    badgeBg: "bg-violet-100 dark:bg-violet-900/60",
    badgeText: "text-violet-700 dark:text-violet-100",
    badgeRing: "ring-violet-300/60 dark:ring-violet-700/60",
  },
```

- [ ] **Step 6: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/units/pms/pms-constants.ts
```
Expected: ambos exit 0.

- [ ] **Step 7: smoke visual en dev**

Run en otra terminal:
```bash
npm run dev
```
Abrir `http://localhost:3001/dashboard/unidades`. Verificar:
- Una unidad en estado "Bloqueado" / "Mantenimiento" / "Limpieza" muestra rayas que se ven claramente sobre el fondo de la celda.
- Una reserva mensual (Modo "M" / violeta) muestra rayas verticales legibles sobre la barra de color.
- En modo dark también se ve bien.

Si algún patrón se ve **demasiado** intenso (oscurece el label de la reserva), bajar el alpha 0.42 → 0.32 en mensual o 0.50 → 0.40 en bloqueado y repetir.

- [ ] **Step 8: commit**

Run:
```bash
git add src/components/units/pms/pms-constants.ts
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(pms): subir contraste de barras diagonales

Las rayas de unidades bloqueadas/mantenimiento/limpieza y de reservas
mensuales eran demasiado tenues. Subimos los alphas y agregamos una
capa base de tinte para que se lean a primera vista.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Filtrar el estado actual de los chips "Mover a:" del ticket detail

**Goal:** Eliminar la duplicación visual entre el Badge del header y el chip "actual" del row de transición. El row queda con solo los estados a los que el ticket SÍ puede transicionar.

**Files:**
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:258-286`

- [ ] **Step 1: localizar el bloque y leerlo**

Run:
```bash
grep -n "Mover a:" src/components/tickets/ticket-detail-dialog.tsx
```
Expected output: `260:              <span className="text-xs text-muted-foreground mr-1">Mover a:</span>`. Después leer las líneas 256‑290 con `Read` para confirmar la JSX actual.

- [ ] **Step 2: reemplazar el render para que filtre el estado actual**

En `src/components/tickets/ticket-detail-dialog.tsx`, reemplazar el bloque exacto:

Antes:
```tsx
          {/* Cambio rápido de estado (chips) */}
          {!isEditing && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Mover a:</span>
              {(Object.keys(TICKET_STATUS_META) as TicketStatus[]).map((s) => {
                const m = TICKET_STATUS_META[s];
                const isCurrent = ticket.status === s;
                return (
                  <button
                    key={s}
                    disabled={isCurrent || isPending}
                    onClick={() => handleStatusChange(s)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                      isCurrent
                        ? "opacity-50 cursor-default"
                        : "hover:scale-[1.03] active:scale-95"
                    )}
                    style={{
                      backgroundColor: isCurrent ? m.color + "20" : m.color + "0d",
                      color: m.color,
                      borderColor: m.color + (isCurrent ? "60" : "30"),
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
```

Después:
```tsx
          {/* Cambio rápido de estado (chips) — solo estados de destino */}
          {!isEditing && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Mover a:</span>
              {(Object.keys(TICKET_STATUS_META) as TicketStatus[])
                .filter((s) => s !== ticket.status)
                .map((s) => {
                  const m = TICKET_STATUS_META[s];
                  return (
                    <button
                      key={s}
                      disabled={isPending}
                      onClick={() => handleStatusChange(s)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium border transition-all",
                        "hover:scale-[1.03] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                      )}
                      style={{
                        backgroundColor: m.color + "0d",
                        color: m.color,
                        borderColor: m.color + "30",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
            </div>
          )}
```

(Cambios: `.filter((s) => s !== ticket.status)`, eliminamos `isCurrent`, simplificamos el `disabled` y los estilos, agregamos `disabled:opacity-50` para feedback visual durante pending.)

- [ ] **Step 3: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/tickets/ticket-detail-dialog.tsx
```
Expected: ambos exit 0.

- [ ] **Step 4: smoke en dev**

Con `npm run dev` corriendo, abrir `http://localhost:3001/dashboard/mantenimiento` y abrir el detalle de un ticket. Verificar:
- El header muestra el estado actual una sola vez (Badge tipo pill).
- El row "Mover a:" tiene 4 chips (no 5) y NO incluye el estado actual.
- Al hacer click en uno, todos los chips se ponen `opacity-50` durante el transition.
- Tras el cambio, el row se recalcula y aparece el estado anterior como destino.

- [ ] **Step 5: commit**

Run:
```bash
git add src/components/tickets/ticket-detail-dialog.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(tickets): no duplicar el estado actual en chips "Mover a:"

El row de transiciones renderizaba los 5 estados, incluido el actual
con opacity-50. El chip resultaba visualmente igual al Badge del header
y "Esperando repuesto" forzaba un wrap incómodo. Ahora solo se muestran
los 4 estados de destino reales.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Sacar `isPending` de las deps del useEffect del timeline

**Goal:** Que el timeline del ticket no se re‑fetchee dos veces por cada cambio de estado. La actualización post‑mutación se hace explícitamente al terminar el transition.

**Files:**
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:128-141`
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:152-163` (handleStatusChange)
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:165-177` (handleSave) — debe refrescar timeline también
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:179-190` (handleDelete) — no aplica, el dialog cierra

- [ ] **Step 1: arreglar el useEffect**

En `src/components/tickets/ticket-detail-dialog.tsx`, reemplazar:

Antes (líneas 125‑141):
```tsx
  // Cargamos el historial cuando el dialog se abre o tras una mutación.
  // El loading state lo derivamos de `events === null` en vez de un setState síncrono.
  const ticketId = ticket?.id;
  useEffect(() => {
    if (!open || !ticketId) return;
    let cancelled = false;
    listTicketEvents(ticketId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ticketId, isPending]);
```

Después:
```tsx
  // Cargamos el historial cuando el dialog se abre o cambia de ticket.
  // Tras una mutación local, refrescamos manualmente desde los handlers
  // (ver handleStatusChange / handleSave) en vez de re-disparar el effect
  // con isPending — eso causaba doble fetch y flicker.
  const ticketId = ticket?.id;
  useEffect(() => {
    if (!open || !ticketId) return;
    let cancelled = false;
    listTicketEvents(ticketId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ticketId]);
```

(Único cambio: sacar `isPending` de la dep array y comentar el porqué.)

- [ ] **Step 2: hacer que `handleStatusChange` refresque el timeline al terminar**

Reemplazar:

Antes (líneas 152‑163):
```tsx
  function handleStatusChange(next: TicketStatus) {
    if (!ticket) return;
    startTransition(async () => {
      try {
        await changeTicketStatus(ticket.id, next);
        onUpdated?.({ ...ticket, status: next });
        toast.success("Estado actualizado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }
```

Después:
```tsx
  function handleStatusChange(next: TicketStatus) {
    if (!ticket) return;
    const ticketId = ticket.id;
    startTransition(async () => {
      try {
        await changeTicketStatus(ticketId, next);
        onUpdated?.({ ...ticket, status: next });
        toast.success("Estado actualizado");
        // Refrescamos el timeline manualmente (antes lo hacía un useEffect
        // con isPending en deps, que disparaba doble fetch).
        try {
          const fresh = await listTicketEvents(ticketId);
          setEvents(fresh);
        } catch {
          // si falla el refresh del timeline, no es crítico
        }
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }
```

- [ ] **Step 3: hacer que `handleSave` refresque el timeline al terminar**

Reemplazar:

Antes (líneas 165‑177):
```tsx
  function handleSave() {
    if (!ticket || !form) return;
    startTransition(async () => {
      try {
        const updated = await updateTicket(ticket.id, form);
        onUpdated?.(updated);
        toast.success("Ticket actualizado");
        setIsEditing(false);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }
```

Después:
```tsx
  function handleSave() {
    if (!ticket || !form) return;
    const ticketId = ticket.id;
    startTransition(async () => {
      try {
        const updated = await updateTicket(ticketId, form);
        onUpdated?.(updated);
        toast.success("Ticket actualizado");
        setIsEditing(false);
        try {
          const fresh = await listTicketEvents(ticketId);
          setEvents(fresh);
        } catch {
          // refresh no crítico
        }
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }
```

- [ ] **Step 4: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/tickets/ticket-detail-dialog.tsx
```
Expected: ambos exit 0.

- [ ] **Step 5: smoke en dev**

Con dev server corriendo, abrir un ticket. Abrir Network tab del browser. Cambiar estado del ticket clickeando un chip "Mover a:". Verificar:
- Solo se ve **un** request a `listTicketEvents` (antes había dos).
- El timeline aparece actualizado tras el cambio (con la nueva entrada del status change).
- El timeline NO parpadea con datos viejos durante el pending.

- [ ] **Step 6: commit**

Run:
```bash
git add src/components/tickets/ticket-detail-dialog.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(tickets): evitar doble fetch del timeline al cambiar estado

isPending estaba en las deps del useEffect que carga eventos, lo que
causaba un re-fetch en cada toggle del transition. Ahora el effect solo
depende de open + ticketId y refrescamos el timeline manualmente desde
handleStatusChange y handleSave después de que la mutación commitea.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Mover el `setState` durante render del ticket detail a `useEffect`

**Goal:** Eliminar el patrón `if (ticket && ticket.id !== prevTicketId) { setX(...) }` que vive en el cuerpo del componente. Es válido pero frágil con React Compiler activo; lo movemos a un `useEffect` con `ticket?.id` como dep.

**Files:**
- Modify: `src/components/tickets/ticket-detail-dialog.tsx:110-123`

- [ ] **Step 1: leer el bloque y los imports actuales**

Read `src/components/tickets/ticket-detail-dialog.tsx` líneas 1‑30 (imports) y 105‑145 (estado + reset). Verificar que `useEffect` ya está importado.

- [ ] **Step 2: reemplazar el state init + reset-on-prop-change**

Reemplazar:

Antes (líneas 110‑123):
```tsx
  const [prevTicketId, setPrevTicketId] = useState<string | null>(ticket?.id ?? null);
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<TicketInput | null>(() => buildForm(ticket));
  // null = aún no se hizo fetch (o se cerró/cambió de ticket); [] = fetched sin eventos.
  const [events, setEvents] = useState<TicketEventWithActor[] | null>(null);
  if (ticket && ticket.id !== prevTicketId) {
    setPrevTicketId(ticket.id);
    setForm(buildForm(ticket));
    setIsEditing(false);
    setConfirmDelete(false);
    setEvents(null);
  }
```

Después:
```tsx
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<TicketInput | null>(() => buildForm(ticket));
  // null = aún no se hizo fetch (o se cerró/cambió de ticket); [] = fetched sin eventos.
  const [events, setEvents] = useState<TicketEventWithActor[] | null>(null);

  // Resetear el estado local cuando cambia de ticket. Antes esto estaba
  // como setState durante render — válido pero frágil con React Compiler.
  const lastTicketIdRef = useRef<string | null>(ticket?.id ?? null);
  useEffect(() => {
    const newId = ticket?.id ?? null;
    if (newId === lastTicketIdRef.current) return;
    lastTicketIdRef.current = newId;
    setForm(buildForm(ticket));
    setIsEditing(false);
    setConfirmDelete(false);
    setEvents(null);
  }, [ticket]);
```

- [ ] **Step 3: agregar `useRef` al import si no está**

Run:
```bash
grep -n "^import" src/components/tickets/ticket-detail-dialog.tsx | head -5
```

Si el import de `react` no incluye `useRef`, modificarlo. Buscar la línea actual con `useState`, `useEffect`, `useTransition` y agregar `useRef` a la lista.

Por ejemplo, si era:
```ts
import { useState, useEffect, useTransition } from "react";
```

Cambiar a:
```ts
import { useState, useEffect, useTransition, useRef } from "react";
```

- [ ] **Step 4: verificar que no quedaron referencias a `prevTicketId` / `setPrevTicketId`**

Run:
```bash
grep -n "prevTicketId" src/components/tickets/ticket-detail-dialog.tsx
```
Expected: `(no output)`. Si aparece algo, eliminarlo.

- [ ] **Step 5: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/tickets/ticket-detail-dialog.tsx
```
Expected: ambos exit 0.

- [ ] **Step 6: smoke en dev**

Con dev server corriendo, abrir un ticket A. Cerrar el dialog. Abrir un ticket B. Verificar:
- El form se resetea correctamente (no muestra datos del ticket A).
- `isEditing` arranca en false (no entra en modo edición pegado del ticket A).
- El timeline empieza vacío y carga el del ticket B.

- [ ] **Step 7: commit**

Run:
```bash
git add src/components/tickets/ticket-detail-dialog.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
refactor(tickets): mover setState durante render a useEffect

El reset de estado al cambiar de ticket se hacía con setState dentro del
cuerpo del componente. Es válido en React pero frágil con React Compiler
y dificulta el razonamiento sobre re-renders. Lo movemos a un useEffect
con un useRef que trackea el último ticketId visto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Race en doble‑tap del mobile editor

**Goal:** Si el usuario hace doble tap rápido en dos chips de estado distintos en mobile, no se disparan dos cambios paralelos. Usamos una guarda con `useRef` que se setea al inicio del cambio y se libera al final.

**Files:**
- Modify: `src/components/tickets/mobile-ticket-editor.tsx:1-3` (import)
- Modify: `src/components/tickets/mobile-ticket-editor.tsx:42-67` (state + handler)

- [ ] **Step 1: agregar `useRef` al import**

Reemplazar línea 3:

Antes:
```tsx
import { useState, useTransition } from "react";
```

Después:
```tsx
import { useRef, useState, useTransition } from "react";
```

- [ ] **Step 2: reemplazar `handleStatusChange` para que use una guarda**

Reemplazar el bloque (líneas 42‑67):

Antes:
```tsx
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(initialStatus);
  const [actualCost, setActualCost] = useState<string>(
    initialActualCost !== null && initialActualCost !== undefined
      ? String(initialActualCost)
      : ""
  );
  const [currency, setCurrency] = useState<string>(initialCostCurrency);
  const [statusPending, startStatusTransition] = useTransition();
  const [costPending, startCostTransition] = useTransition();

  function handleStatusChange(next: TicketStatus) {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    startStatusTransition(async () => {
      try {
        await changeTicketStatus(ticketId, next);
        toast.success("Estado actualizado");
        router.refresh();
      } catch (e) {
        setStatus(prev);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }
```

Después:
```tsx
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>(initialStatus);
  const [actualCost, setActualCost] = useState<string>(
    initialActualCost !== null && initialActualCost !== undefined
      ? String(initialActualCost)
      : ""
  );
  const [currency, setCurrency] = useState<string>(initialCostCurrency);
  const [statusPending, startStatusTransition] = useTransition();
  const [costPending, startCostTransition] = useTransition();
  // Guarda síncrona contra doble-tap. statusPending tiene un delay de un
  // render antes de propagarse al disabled de los botones, por lo que un
  // tap muy rápido podía iniciar dos transitions en paralelo.
  const inflightStatus = useRef(false);

  function handleStatusChange(next: TicketStatus) {
    if (inflightStatus.current) return;
    if (next === status) return;
    inflightStatus.current = true;
    const prev = status;
    setStatus(next);
    startStatusTransition(async () => {
      try {
        await changeTicketStatus(ticketId, next);
        toast.success("Estado actualizado");
        router.refresh();
      } catch (e) {
        setStatus(prev);
        toast.error("Error", { description: (e as Error).message });
      } finally {
        inflightStatus.current = false;
      }
    });
  }
```

- [ ] **Step 3: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/tickets/mobile-ticket-editor.tsx
```
Expected: ambos exit 0.

- [ ] **Step 4: smoke en dev**

Con dev server, abrir desde mobile o devtools en modo móvil `http://localhost:3001/m/mantenimiento/<ticket-id>`. Hacer doble‑tap rápido en dos chips distintos. Verificar:
- Solo se dispara un request a la red.
- Solo aparece un toast "Estado actualizado".
- El estado final coincide con el primer tap (o el último según cuál llegó primero al guard).

- [ ] **Step 5: commit**

Run:
```bash
git add src/components/tickets/mobile-ticket-editor.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(tickets): evitar race condition en doble-tap del editor mobile

useTransition activa statusPending en el siguiente render, por lo que
un doble-tap muy rápido podía disparar dos cambios de estado en
paralelo. Agregamos una guarda síncrona con useRef.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Subida de fotos del ticket en paralelo + indicador de progreso

**Goal:** Subir múltiples fotos en paralelo (no secuencial) y mostrar un contador de progreso al usuario.

**Files:**
- Modify: `src/components/tickets/ticket-photos-section.tsx:35-78` (state + handleFiles + botón)

- [ ] **Step 1: agregar state de progreso**

En `src/components/tickets/ticket-photos-section.tsx`, reemplazar la línea 35:

Antes:
```tsx
  const [uploading, setUploading] = useState(false);
```

Después:
```tsx
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const uploading = uploadProgress !== null;
```

- [ ] **Step 2: reemplazar `handleFiles` para subir en paralelo**

Reemplazar (líneas 59‑78, considerando que la línea de `setUploading` ya cambió):

Antes:
```tsx
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const att = await uploadTicketPhoto(ticketId, fd);
        setAttachments((cur) => [att, ...cur]);
      }
      toast.success(
        files.length === 1 ? "Foto subida" : `${files.length} fotos subidas`
      );
    } catch (e) {
      toast.error("Error al subir", { description: (e as Error).message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
```

Después:
```tsx
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploadProgress({ done: 0, total: list.length });
    let succeeded = 0;
    const errors: string[] = [];
    await Promise.all(
      list.map(async (file) => {
        const fd = new FormData();
        fd.append("file", file);
        try {
          const att = await uploadTicketPhoto(ticketId, fd);
          setAttachments((cur) => [att, ...cur]);
          succeeded += 1;
          setUploadProgress((p) =>
            p ? { done: p.done + 1, total: p.total } : null
          );
        } catch (e) {
          errors.push((e as Error).message);
        }
      })
    );
    if (succeeded > 0) {
      toast.success(
        succeeded === 1 ? "Foto subida" : `${succeeded} fotos subidas`
      );
    }
    if (errors.length > 0) {
      toast.error(
        errors.length === 1 ? "Error al subir 1 foto" : `Error al subir ${errors.length} fotos`,
        { description: errors[0] }
      );
    }
    setUploadProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  }
```

- [ ] **Step 3: actualizar el botón "Agregar" para mostrar progreso**

Buscar el bloque del botón (alrededor de las líneas 114‑128). Reemplazar:

Antes:
```tsx
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          {uploading ? "Subiendo…" : "Agregar"}
        </Button>
```

Después:
```tsx
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 tabular-nums"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          {uploading
            ? `Subiendo ${uploadProgress!.done}/${uploadProgress!.total}…`
            : "Agregar"}
        </Button>
```

- [ ] **Step 4: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/components/tickets/ticket-photos-section.tsx
```
Expected: ambos exit 0.

- [ ] **Step 5: smoke en dev**

Con dev server, abrir un ticket en `/dashboard/mantenimiento`. Subir 3‑5 fotos a la vez. Verificar:
- El botón muestra "Subiendo 1/5…", "Subiendo 2/5…", etc., en tiempo real.
- Las fotos aparecen en el grid de a una a medida que cada upload termina.
- Los uploads ocurren en paralelo (en Network tab se ven varios POST simultáneos, no secuenciales).
- Si una foto falla, las demás siguen y aparece toast de error específico al final.

- [ ] **Step 6: commit**

Run:
```bash
git add src/components/tickets/ticket-photos-section.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(tickets): paralelizar subida de fotos + mostrar progreso

Antes las fotos se subían en serie con un único "Subiendo…" sin
indicación. Ahora corren en paralelo con Promise.all y el botón muestra
"Subiendo N/M…" actualizado por foto. Los errores parciales no abortan
el resto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Quitar el tile "Reservado" hardcodeado del dashboard

**Goal:** El tile "Reservado" del status grid del dashboard tiene `count: 0` siempre y es clickeable, lo que confunde. Mientras no exista el KPI, lo sacamos.

**Files:**
- Modify: `src/app/dashboard/page.tsx:35-61`

- [ ] **Step 1: reemplazar el array para sacar la entrada `reservado`**

En `src/app/dashboard/page.tsx`, reemplazar:

Antes (línea 35‑42):
```tsx
      {/* Status grid de units — 2 columnas en mobile, denso pero legible */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {[
          { status: "disponible", count: kpis.totals.available_units },
          { status: "reservado", count: 0 },
          { status: "ocupado", count: kpis.totals.occupied_units },
          { status: "limpieza", count: kpis.totals.cleaning_units },
          { status: "mantenimiento", count: kpis.totals.maintenance_units },
        ].map(({ status, count }) => {
```

Después:
```tsx
      {/* Status grid de units — 2 columnas en mobile, denso pero legible */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[
          { status: "disponible", count: kpis.totals.available_units },
          { status: "ocupado", count: kpis.totals.occupied_units },
          { status: "limpieza", count: kpis.totals.cleaning_units },
          { status: "mantenimiento", count: kpis.totals.maintenance_units },
        ].map(({ status, count }) => {
```

(También cambiamos `lg:grid-cols-5` → `lg:grid-cols-4` y `sm:grid-cols-3` → `sm:grid-cols-2` para que las 4 tiles llenen la grilla con buen ancho.)

- [ ] **Step 2: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/app/dashboard/page.tsx
```
Expected: ambos exit 0.

- [ ] **Step 3: smoke en dev**

Abrir `http://localhost:3001/dashboard`. Verificar:
- El status grid muestra 4 tiles (Disponible, Ocupado, Limpieza, Mantenimiento) — sin Reservado.
- En mobile las 4 tiles se ven 2x2.
- En desktop las 4 ocupan una fila uniforme.

- [ ] **Step 4: commit**

Run:
```bash
git add src/app/dashboard/page.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
fix(dashboard): quitar tile "Reservado" hardcodeado a 0

El tile mostraba siempre 0 y era clickeable, llevaba a kanban con
información engañosa. Lo retiramos hasta que tengamos un KPI real
para "Reservado".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Bulk balance query en Caja (eliminar N+1)

**Goal:** Reemplazar el `Promise.all(accounts.map((a) => getAccountBalance(a.id)))` por una sola function que trae todos los balances en 2 queries totales.

**Files:**
- Modify: `src/lib/actions/cash.ts` (agregar `getAccountBalances`)
- Modify: `src/app/dashboard/caja/page.tsx:17-23` (usar la nueva función)

- [ ] **Step 1: agregar `getAccountBalances` a `cash.ts`**

En `src/lib/actions/cash.ts`, justo después del cierre de `getAccountBalance` (línea 184), agregar la nueva función:

```ts
/**
 * Devuelve todos los balances de las cuentas de la org en 2 queries totales,
 * evitando el N+1 que tenía /dashboard/caja al llamar getAccountBalance por
 * cada cuenta. El resultado es un map { account_id → balance }; las cuentas
 * sin movimientos quedan con su opening_balance.
 */
export async function getAccountBalances(): Promise<Record<string, number>> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const [{ data: accounts }, { data: movements }] = await Promise.all([
    admin
      .from("cash_accounts")
      .select("id, opening_balance")
      .eq("organization_id", organization.id),
    admin
      .from("cash_movements")
      .select("account_id, direction, amount")
      .eq("organization_id", organization.id),
  ]);
  const map: Record<string, number> = {};
  for (const a of accounts ?? []) {
    map[a.id] = Number(a.opening_balance ?? 0);
  }
  for (const m of movements ?? []) {
    const delta = m.direction === "in" ? Number(m.amount) : -Number(m.amount);
    map[m.account_id] = (map[m.account_id] ?? 0) + delta;
  }
  return map;
}
```

- [ ] **Step 2: actualizar `src/app/dashboard/caja/page.tsx` para usarla**

Reemplazar las líneas 1‑2:

Antes:
```tsx
import { Plus, Wallet, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { listAccounts, listMovements, getAccountBalance } from "@/lib/actions/cash";
```

Después:
```tsx
import { Plus, Wallet, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { listAccounts, listMovements, getAccountBalances } from "@/lib/actions/cash";
```

Reemplazar las líneas 17‑23:

Antes:
```tsx
  const [accounts, movements, units, { role }] = await Promise.all([
    listAccounts(),
    listMovements({ limit: 100 }),
    listUnitsEnriched(),
    getCurrentOrg(),
  ]);
  const balances = await Promise.all(accounts.map((a) => getAccountBalance(a.id)));
```

Después:
```tsx
  const [accounts, movements, units, { role }, balancesMap] = await Promise.all([
    listAccounts(),
    listMovements({ limit: 100 }),
    listUnitsEnriched(),
    getCurrentOrg(),
    getAccountBalances(),
  ]);
  const balances = accounts.map((a) => balancesMap[a.id] ?? 0);
```

- [ ] **Step 3: verificar que `getAccountBalance` (singular) sigue siendo usado en otros lados antes de borrarlo**

Run:
```bash
grep -rn "getAccountBalance\b" src/ 2>&1
```
Expected: ver dónde se usa la versión singular. Si solo aparece en `cash.ts:171` (definición), `cash.ts:409` (uso interno en `getAccountStats`) y `caja/[accountId]/...` o similar, **dejarla** — no es del scope de este PR.

- [ ] **Step 4: typecheck + lint + build**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/lib/actions/cash.ts src/app/dashboard/caja/page.tsx
```
Expected: ambos exit 0.

- [ ] **Step 5: smoke en dev**

Abrir `http://localhost:3001/dashboard/caja` con la consola de red abierta. Verificar:
- La página carga.
- Los balances totales por moneda muestran los mismos valores que antes.
- En la pestaña Network del browser, hay menos requests a Supabase que antes (idealmente: 1 vez `cash_accounts` + 1 vez `cash_movements` para los balances, en vez de N+1).

- [ ] **Step 6: commit**

Run:
```bash
git add src/lib/actions/cash.ts src/app/dashboard/caja/page.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
perf(caja): bulk query de balances de cuentas

/dashboard/caja llamaba getAccountBalance por cada cuenta (N+1). Ahora
una sola getAccountBalances() trae opening + movements en 2 queries
totales y construye el map en memoria.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Mostrar el nombre del huésped pagador en Caja

**Goal:** En la lista de "Movimientos recientes", las filas de tipo `booking_payment` muestran "Cobro · María González" en vez de "Cobro de reserva 481ab64c". Filas no‑booking conservan su `description` actual. Si la reserva fue eliminada, fallback al `description`.

**Files:**
- Modify: `src/lib/actions/cash.ts:186-206` (extender `listMovements` para joinear)
- Modify: `src/components/cash/movements-list.tsx:9-20, 67-127` (extender type y display)

- [ ] **Step 1: extender `listMovements` para resolver guest_name de bookings y schedules**

En `src/lib/actions/cash.ts`, reemplazar el bloque `listMovements` (líneas 186‑206):

Antes:
```ts
export async function listMovements(filters?: {
  accountId?: string;
  fromDate?: string;
  toDate?: string;
  category?: string;
  limit?: number;
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("cash_movements")
    .select(`*, account:cash_accounts(id, name, currency, type, color), unit:units(id, code, name), owner:owners(id, full_name)`)
    .eq("organization_id", organization.id);
  if (filters?.accountId) q = q.eq("account_id", filters.accountId);
  if (filters?.fromDate) q = q.gte("occurred_at", filters.fromDate);
  if (filters?.toDate) q = q.lte("occurred_at", filters.toDate);
  if (filters?.category) q = q.eq("category", filters.category);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(filters?.limit ?? 200);
  if (error) throw new Error(error.message);
  return data ?? [];
}
```

Después:
```ts
export async function listMovements(filters?: {
  accountId?: string;
  fromDate?: string;
  toDate?: string;
  category?: string;
  limit?: number;
}) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("cash_movements")
    .select(`*, account:cash_accounts(id, name, currency, type, color), unit:units(id, code, name), owner:owners(id, full_name)`)
    .eq("organization_id", organization.id);
  if (filters?.accountId) q = q.eq("account_id", filters.accountId);
  if (filters?.fromDate) q = q.gte("occurred_at", filters.fromDate);
  if (filters?.toDate) q = q.lte("occurred_at", filters.toDate);
  if (filters?.category) q = q.eq("category", filters.category);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(filters?.limit ?? 200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    category: string;
    ref_type: string | null;
    ref_id: string | null;
    [k: string]: unknown;
  }>;
  if (rows.length === 0) return rows;

  // Resolvemos el guest_name del huésped pagador para movimientos de
  // booking_payment. Hacemos 2 queries extra (bookings + schedules)
  // para evitar N+1: ya teníamos los movements en memoria, juntamos los
  // ids y traemos las relaciones en batch.
  const bookingMovs = rows.filter(
    (r) => r.category === "booking_payment" && r.ref_id
  );
  const directBookingIds = bookingMovs
    .filter((r) => r.ref_type === "booking")
    .map((r) => r.ref_id as string);
  const scheduleIds = bookingMovs
    .filter((r) => r.ref_type === "payment_schedule")
    .map((r) => r.ref_id as string);

  const [bookingsRes, schedulesRes] = await Promise.all([
    directBookingIds.length
      ? admin
          .from("bookings")
          .select("id, guest:guests(full_name)")
          .in("id", directBookingIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({ data: [] as Array<{ id: string; guest: { full_name: string } | null }> }),
    scheduleIds.length
      ? admin
          .from("booking_payment_schedule")
          .select("id, booking_id, booking:bookings(guest:guests(full_name))")
          .in("id", scheduleIds)
          .eq("organization_id", organization.id)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            booking_id: string;
            booking: { guest: { full_name: string } | null } | null;
          }>,
        }),
  ]);

  const guestByBookingId = new Map<string, string | null>();
  for (const bk of (bookingsRes.data ?? []) as Array<{ id: string; guest: { full_name: string } | null }>) {
    guestByBookingId.set(bk.id, bk.guest?.full_name ?? null);
  }
  const guestByScheduleId = new Map<string, string | null>();
  for (const sch of (schedulesRes.data ?? []) as Array<{
    id: string;
    booking: { guest: { full_name: string } | null } | null;
  }>) {
    guestByScheduleId.set(sch.id, sch.booking?.guest?.full_name ?? null);
  }

  return rows.map((r) => {
    let guest_name: string | null = null;
    if (r.category === "booking_payment" && r.ref_id) {
      if (r.ref_type === "booking") {
        guest_name = guestByBookingId.get(r.ref_id as string) ?? null;
      } else if (r.ref_type === "payment_schedule") {
        guest_name = guestByScheduleId.get(r.ref_id as string) ?? null;
      }
    }
    return { ...r, linked_guest_name: guest_name };
  });
}
```

- [ ] **Step 2: extender el type `Movement` en `movements-list.tsx`**

En `src/components/cash/movements-list.tsx`, reemplazar el bloque del interface (líneas 9‑20):

Antes:
```tsx
interface Movement {
  id: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  account: { id: string; name: string; currency: string; color: string | null } | null;
  unit: { id: string; code: string; name: string } | null;
  owner: { id: string; full_name: string } | null;
}
```

Después:
```tsx
interface Movement {
  id: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  account: { id: string; name: string; currency: string; color: string | null } | null;
  unit: { id: string; code: string; name: string } | null;
  owner: { id: string; full_name: string } | null;
  /** Inyectado por listMovements para mostrar el nombre del huésped en cobros de reserva. */
  linked_guest_name?: string | null;
}
```

- [ ] **Step 3: actualizar el display title en mobile y desktop**

Encontrar las dos líneas que renderizan el título (línea 74 mobile, línea 103 desktop) y reemplazarlas por una expresión que prefiere el guest_name.

Justo antes del `return` en el `.map((m) =>` (línea ~50, después del bloque de `iconCls`/`amountCls`/`icon`), agregar:

```tsx
          const title =
            m.category === "booking_payment" && m.linked_guest_name
              ? `Cobro · ${m.linked_guest_name}`
              : m.description ?? CATEGORY_LABELS[m.category] ?? m.category;
```

Después, reemplazar la línea 74:

Antes:
```tsx
                    <div className="text-sm font-medium truncate">
                      {m.description ?? CATEGORY_LABELS[m.category] ?? m.category}
                    </div>
```

Después:
```tsx
                    <div className="text-sm font-medium truncate">{title}</div>
```

Y reemplazar la línea 103:

Antes:
```tsx
                  <div className="text-sm font-medium truncate">{m.description ?? CATEGORY_LABELS[m.category] ?? m.category}</div>
```

Después:
```tsx
                  <div className="text-sm font-medium truncate">{title}</div>
```

- [ ] **Step 4: typecheck + lint**

Run:
```bash
npx tsc --noEmit && npm run lint -- src/lib/actions/cash.ts src/components/cash/movements-list.tsx
```
Expected: ambos exit 0.

- [ ] **Step 5: smoke en dev**

Abrir `http://localhost:3001/dashboard/caja`. Verificar:
- Filas de tipo "Reserva" muestran ahora "Cobro · {Nombre del huésped}" en lugar de "Cobro de reserva 481ab64c".
- Filas de otros tipos (Otro, Transferencia, Sueldo, etc.) mantienen su `description`.
- Si una reserva fue eliminada y el movement quedó (caso raro de orfandad), la fila cae al `description` viejo y NO crashea.

- [ ] **Step 6: commit**

Run:
```bash
git add src/lib/actions/cash.ts src/components/cash/movements-list.tsx
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(caja): mostrar nombre del huésped en movimientos de cobro

Antes los movimientos de "booking_payment" mostraban "Cobro de reserva
481ab64c" — un slice del UUID inutil para el operador. Ahora joineamos
read-side a bookings/schedules → guests y mostramos "Cobro · {nombre}".
Filas no-booking y reservas eliminadas mantienen el description viejo
como fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verificación final del PR

- [ ] **Step 1: full typecheck + lint + build**

Run:
```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: los tres exit 0.

- [ ] **Step 2: smoke pass por todas las rutas afectadas**

Con `npm run dev` corriendo, recorrer:
- `http://localhost:3001/dashboard` — sin tile "Reservado", layout balanceado.
- `http://localhost:3001/dashboard/unidades` — patrones de rayas más legibles, una unidad bloqueada/limpieza/mantenimiento se nota.
- `http://localhost:3001/dashboard/mantenimiento` — abrir un ticket, verificar que solo aparecen 4 chips "Mover a:", cambio de estado dispara un solo refresh del timeline, edición y subida múltiple de fotos funcionan.
- `http://localhost:3001/m/mantenimiento/<id>` — doble‑tap en chips de estado solo dispara un cambio.
- `http://localhost:3001/dashboard/caja` — totales por moneda correctos, lista de movimientos muestra nombre del huésped en cobros de reserva.

- [ ] **Step 3: verificar log de commits del PR**

Run:
```bash
git log --oneline main..HEAD
```
Expected: 9 commits limpios (uno por task), todos con `Co-Authored-By: Claude...`.

- [ ] **Step 4: revisar diff total**

Run:
```bash
git diff main..HEAD --stat
```
Expected: cambios solo en los archivos listados al principio del plan, sin archivos colaterales tocados.

---

## Rollback / contingencia

Si en cualquier task algo falla y no podés recuperarte fácil:
- Revertir el último commit con `git reset --hard HEAD^` (siempre que estuvieras commiteando entre tasks como indica el plan — los commits anteriores quedan a salvo).
- No usar `git push --force` ni `git reset --hard` sobre commits ya pusheados.
- Si se pierde el progreso de una task antes de commitear, `git stash` antes de cualquier cambio de branch para preservarlo.

---

## Out of scope

Estos NO se hacen en PR1 (van en PR2 o PR3 según el spec):
- Selector de país + código tel (PR2).
- Marcas de calendario (PR3 + migration).
- Bugs BAJA: photo `<Image>` sin onError, confirm-delete inline rompe focus trap.
- KPI real para "Reservado" (queda quitado, sin reemplazo).
