# Channel Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el channel manager actual en una herramienta usable end-to-end con cron automático, rate calendar interno y email parser de Airbnb/Booking, sin servicios pagos.

**Architecture:** Tres fases independientes que mergean a main por separado. Cada fase termina con `npm run build && npx tsc --noEmit && npm run lint` clean + smoke test en browser. La fase 1 (iCal hardening) refactoriza el código duplicado actual y agrega cron pg + historial. La fase 2 (rate calendar) expone `unit_pricing_rules` ya existente con UI grilla y lo conecta a `createBooking`. La fase 3 (email parser) recibe webhooks de Resend Inbound y crea bookings pendientes.

**Tech Stack:** Next.js 16 App Router · TypeScript · Supabase (schema `apartcba`) · Tailwind v4 + shadcn/ui · pg_cron + pg_net · Resend Inbound · `ical.js`.

**Spec:** [docs/superpowers/specs/2026-05-14-channel-manager-design.md](../specs/2026-05-14-channel-manager-design.md)

**Verification reminder (per CLAUDE.md):** No hay test runner. Después de cada cambio: `npx tsc --noEmit` y `npm run lint`. Al final de cada fase: `npm run build` y verificación en browser.

**Convención de commits:** Mensajes en español, scope claro. Cada task termina en un commit atómico para poder revertir granularmente.

---

## Pre-flight

- [ ] **Step 1: Verificar dependencias instaladas**

```bash
grep -E '"ical.js"|"resend"' package.json
```
Expected: `"ical.js": "^2.2.0"` presente. Resend opcional (no se usa SDK para webhook inbound, solo Node `crypto`).

- [ ] **Step 2: Confirmar settings de DB existentes (Supabase SQL Editor con role postgres)**

```sql
SELECT current_setting('apartcba.app_url', true) AS app_url,
       current_setting('apartcba.pg_cron_secret', true) AS has_secret;
```
Expected: ambos no vacíos. Si están vacíos, setear:

```sql
ALTER DATABASE postgres SET apartcba.app_url = 'https://app.apart-cba.com';
ALTER DATABASE postgres SET apartcba.pg_cron_secret = '<random-32-chars>';
```
Y reflejar `PG_CRON_SECRET=<mismo valor>` en Vercel env vars + `.env.local`.

- [ ] **Step 3: Confirmar que `PG_CRON_SECRET` está en `.env.local` y Vercel**

```bash
grep PG_CRON_SECRET .env.local
```
Expected: línea presente con el mismo valor seteado en la DB.

---

# Fase 1 — iCal sync hardening

Producirá: sync automático cada 30 min vía pg_cron, código compartido entre cron y action, historial de corridas visible, badges de salud en sidebar y página, validación de URL al crear feed.

## Task 1.1: Crear migración 018 (tabla + view + cron schedule)

**Files:**
- Create: `supabase/migrations/018_ical_sync_runs.sql`

- [ ] **Step 1: Escribir el archivo SQL**

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- iCal sync runs — historial y vista de salud por feed
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.ical_sync_runs (
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

CREATE INDEX IF NOT EXISTS idx_sync_runs_feed_started
  ON apartcba.ical_sync_runs(feed_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_org_recent
  ON apartcba.ical_sync_runs(organization_id, started_at DESC);

CREATE OR REPLACE VIEW apartcba.ical_feed_health AS
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

-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron jobs (mismo patrón que migración 010_crm.sql)
-- Si fallan acá por privilegios, copiar y ejecutar manualmente en SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

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

- [ ] **Step 2: Aplicar migración**

Opciones:
- Via MCP: `mcp__supabase-apartcba__apply_migration` con `name="018_ical_sync_runs"` y el SQL completo.
- Via Supabase Dashboard → SQL Editor (copiar/pegar, ejecutar como `postgres`).
- Via Supabase CLI: `supabase db push` si el proyecto está vinculado.

Si los `DO $crons_*$` lanzan NOTICE de privilegios, copiar solo esos bloques y ejecutar como `postgres` desde Dashboard.

- [ ] **Step 3: Verificar que la tabla, vista y crons existen**

En SQL Editor:
```sql
SELECT count(*) FROM apartcba.ical_sync_runs; -- debe devolver 0
SELECT * FROM apartcba.ical_feed_health LIMIT 1; -- estructura, sin error
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'apartcba-sync-ical%';
-- Expected: 2 rows (apartcba-sync-ical @ */30, apartcba-sync-ical-purge @ 0 4)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/018_ical_sync_runs.sql
git commit -m "feat(channel-manager): migración 018 — historial de syncs iCal + cron pg automático

- Tabla apartcba.ical_sync_runs para trackear cada corrida (cron/manual/create_feed)
- Vista apartcba.ical_feed_health derivada de últimas 24h (ok/warning/broken)
- pg_cron job apartcba-sync-ical cada 30 min llamando /api/cron/sync-ical
- pg_cron job de purga > 90 días"
```

## Task 1.2: Extraer función compartida `syncIcalFeed`

**Files:**
- Create: `src/lib/ical/sync.ts`

- [ ] **Step 1: Crear el archivo con la lógica compartida**

```typescript
// src/lib/ical/sync.ts
import ICAL from "ical.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sync de una feed iCal. Función pura sobre la DB (recibe admin client).
 * Consumida por server action (con session) y route handler (con bearer).
 */

const BLOCK_REGEX = /not available|unavailable|blocked|closed|reserved|maintenance|airbnb \(not available\)/i;
const SELF_IMPORT_PREFIX = "apartcba-";
const FETCH_TIMEOUT_MS = 15_000;

export type IcalTrigger = "cron" | "manual" | "create_feed";

export interface IcalFeedRow {
  id: string;
  organization_id: string;
  unit_id: string;
  source: string; // 'airbnb' | 'booking' | 'expedia' | 'vrbo' | 'otro'
  feed_url: string;
  active: boolean;
}

export interface SyncResult {
  imported: number;
  skipped: number;
  error?: string;
}

interface ParsedEvent {
  uid: string;
  summary: string;
  startDate: Date;
  endDate: Date;
}

export async function syncIcalFeed(
  admin: SupabaseClient,
  feed: IcalFeedRow,
  trigger: IcalTrigger,
): Promise<SyncResult> {
  const runId = await startRun(admin, feed, trigger);
  try {
    const events = await fetchAndParse(feed.feed_url);
    const result = await upsertEvents(admin, feed, events);
    await updateFeedStatus(admin, feed.id, "ok", null, result.imported);
    await finishRun(admin, runId, "ok", result, null);
    return result;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await updateFeedStatus(admin, feed.id, "error", msg, 0);
    await finishRun(admin, runId, "error", { imported: 0, skipped: 0 }, msg);
    return { imported: 0, skipped: 0, error: msg };
  }
}

async function startRun(admin: SupabaseClient, feed: IcalFeedRow, trigger: IcalTrigger): Promise<string> {
  const { data, error } = await admin
    .from("ical_sync_runs")
    .insert({
      feed_id: feed.id,
      organization_id: feed.organization_id,
      status: "running",
      trigger_source: trigger,
    })
    .select("id")
    .single();
  if (error) throw new Error(`run insert failed: ${error.message}`);
  return data!.id as string;
}

async function finishRun(
  admin: SupabaseClient,
  runId: string,
  status: "ok" | "error",
  counts: { imported: number; skipped: number },
  errorMessage: string | null,
): Promise<void> {
  await admin
    .from("ical_sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      imported_count: counts.imported,
      skipped_count: counts.skipped,
      error_message: errorMessage,
    })
    .eq("id", runId);
}

async function updateFeedStatus(
  admin: SupabaseClient,
  feedId: string,
  status: "ok" | "error",
  errorMessage: string | null,
  newlyImported: number,
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_sync_at: new Date().toISOString(),
    last_sync_status: status,
    last_sync_error: errorMessage,
  };
  if (newlyImported > 0) {
    // Solo bumpear el counter si hubo importaciones. Lectura previa para no perder histórico.
    const { data } = await admin.from("ical_feeds").select("events_imported_count").eq("id", feedId).single();
    const current = (data?.events_imported_count as number | undefined) ?? 0;
    patch.events_imported_count = current + newlyImported;
  }
  await admin.from("ical_feeds").update(patch).eq("id", feedId);
}

async function fetchAndParse(url: string): Promise<ParsedEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const jcal = ICAL.parse(text);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");
    return vevents.map((ve) => {
      const e = new ICAL.Event(ve);
      return {
        uid: e.uid ?? "",
        summary: e.summary ?? "",
        startDate: e.startDate.toJSDate(),
        endDate: e.endDate.toJSDate(),
      };
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("fetch timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertEvents(
  admin: SupabaseClient,
  feed: IcalFeedRow,
  events: ParsedEvent[],
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const e of events) {
    if (!e.uid) {
      skipped++;
      continue;
    }
    if (e.uid.startsWith(SELF_IMPORT_PREFIX)) {
      skipped++;
      continue;
    }

    // Dedup
    const { data: existing } = await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", feed.organization_id)
      .eq("unit_id", feed.unit_id)
      .eq("source", feed.source)
      .eq("external_id", e.uid)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const isBlock = BLOCK_REGEX.test(e.summary);
    const checkIn = e.startDate.toISOString().slice(0, 10);
    const checkOut = e.endDate.toISOString().slice(0, 10);

    const { error } = await admin.from("bookings").insert({
      organization_id: feed.organization_id,
      unit_id: feed.unit_id,
      source: feed.source,
      external_id: e.uid,
      status: "confirmada",
      check_in_date: checkIn,
      check_out_date: checkOut,
      check_in_time: "14:00",
      check_out_time: "10:00",
      total_amount: 0,
      notes: isBlock
        ? "Bloqueo (sin reserva real)"
        : `Importado de ${feed.source}: ${e.summary || "sin descripción"}`,
    });

    if (error) {
      // bookings_no_overlap → contar como skip, no error fatal
      if (error.message.includes("bookings_no_overlap")) {
        skipped++;
        continue;
      }
      throw new Error(`insert booking failed: ${error.message}`);
    }
    imported++;
  }

  return { imported, skipped };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: 0 errors. Si hay warnings sobre `any`, reemplazar `Record<string, unknown>` donde aplique.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ical/sync.ts
git commit -m "feat(channel-manager): extraer syncIcalFeed a lib reutilizable

Función pura sobre la DB (recibe admin client) consumida por server action
y cron route. Maneja fetch con timeout, parse iCal, dedup por UID,
detección de bloqueos, self-import guard, y rollback de bookings_no_overlap
como skip en lugar de error fatal."
```

## Task 1.3: Migrar action `syncIcalFeed` y `syncAllFeeds` al módulo compartido

**Files:**
- Modify: `src/lib/actions/ical.ts`

- [ ] **Step 1: Leer el archivo actual**

```bash
cat src/lib/actions/ical.ts | head -50
```
Identificar las funciones `syncIcalFeed` y `syncAllFeeds` y dónde llaman al parser inline.

- [ ] **Step 2: Reemplazar las funciones por wrappers**

En `src/lib/actions/ical.ts`, reemplazar la implementación inline de `syncIcalFeed` por:

```typescript
"use server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { syncIcalFeed as runSync, type IcalFeedRow } from "@/lib/ical/sync";
import { revalidatePath } from "next/cache";

export async function syncIcalFeed(feedId: string): Promise<{ imported: number; skipped: number; error?: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: feed, error } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, active")
    .eq("id", feedId)
    .eq("organization_id", organization.id)
    .single();
  if (error || !feed) throw new Error("Feed no encontrada");

  const result = await runSync(admin, feed as IcalFeedRow, "manual");
  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  return result;
}

export async function syncAllFeeds(): Promise<{ feeds: number; imported: number; skipped: number; errors: string[] }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, active")
    .eq("organization_id", organization.id)
    .eq("active", true);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const f of feeds ?? []) {
    const r = await runSync(admin, f as IcalFeedRow, "manual");
    imported += r.imported;
    skipped += r.skipped;
    if (r.error) errors.push(`${f.source}: ${r.error}`);
  }

  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  return { feeds: (feeds ?? []).length, imported, skipped, errors };
}
```

Mantener `listIcalFeeds`, `createIcalFeed`, `deleteIcalFeed`, `listUnitExportFeeds`, `rotateExportToken` tal como están (no se tocan en este step).

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/ical.ts
git commit -m "refactor(channel-manager): action syncIcalFeed consume lib compartida

Elimina ~60 LOC de lógica de parse/dedup duplicada con el cron route.
La action sigue manejando session + org + revalidatePath; la lib se
encarga de fetch, parse y upsert."
```

## Task 1.4: Migrar el cron route al módulo compartido y al nuevo header de auth

**Files:**
- Modify: `src/app/api/cron/sync-ical/route.ts`
- Modify: `src/app/api/cron/daily-dispatch/route.ts:35` (fix call al sync-ical endpoint)

- [ ] **Step 1: Reemplazar `src/app/api/cron/sync-ical/route.ts` completo**

```typescript
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncIcalFeed, type IcalFeedRow } from "@/lib/ical/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron endpoint disparado por:
 *   1. pg_cron cada 30 min (header x-pg-cron-secret)
 *   2. Daily-dispatch route (mismo header)
 *   3. Llamadas manuales del operador (mismo header desde curl)
 */
function authorize(req: Request): boolean {
  const expected = process.env.PG_CRON_SECRET;
  if (!expected) return true; // dev sin secret: permitir
  return req.headers.get("x-pg-cron-secret") === expected;
}

async function handle(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, active")
    .eq("active", true);

  let totalImported = 0;
  let totalSkipped = 0;
  const errors: { feedId: string; error: string }[] = [];

  for (const f of feeds ?? []) {
    try {
      const r = await syncIcalFeed(admin, f as IcalFeedRow, "cron");
      totalImported += r.imported;
      totalSkipped += r.skipped;
      if (r.error) errors.push({ feedId: f.id, error: r.error });
    } catch (err) {
      errors.push({ feedId: f.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    feeds: (feeds ?? []).length,
    totalImported,
    totalSkipped,
    errors,
  });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
```

- [ ] **Step 2: Actualizar la llamada en `daily-dispatch/route.ts:35`**

Leer alrededor de la línea 35:
```bash
sed -n '25,45p' src/app/api/cron/daily-dispatch/route.ts
```

Reemplazar la sección que llama al sync-ical para usar el nuevo header. Buscar:

```typescript
const icalRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/sync-ical`, {
  // ... configuración actual con Authorization Bearer si la hay
});
```

Reemplazar por:

```typescript
const icalRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/sync-ical`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-pg-cron-secret": process.env.PG_CRON_SECRET ?? "",
  },
  body: JSON.stringify({ source: "daily-dispatch", job: "sync_ical" }),
});
```

Si el archivo no usaba ningún header de auth previamente (porque pasaba por Vercel Cron con header `x-vercel-cron`), agregar el header `x-pg-cron-secret` ahora.

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: 0 errors.

- [ ] **Step 4: Smoke test manual del endpoint**

```bash
# Reemplazar <SECRET> con el valor de PG_CRON_SECRET
curl -X POST http://localhost:3001/api/cron/sync-ical \
  -H "x-pg-cron-secret: <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","job":"sync_ical"}'
```
Expected: JSON `{ok: true, feeds: N, totalImported: 0, totalSkipped: 0, errors: []}`.

Sin header → 401.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/sync-ical/route.ts src/app/api/cron/daily-dispatch/route.ts
git commit -m "refactor(channel-manager): cron sync-ical consume lib compartida + header x-pg-cron-secret

Unifica el cron con el patrón ya usado por /api/cron/from-pg.
Acepta tanto GET como POST. daily-dispatch actualizado para enviar
el header correcto al delegar."
```

## Task 1.5: Agregar tipos TS para `IcalSyncRun` y `IcalFeedHealth`

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Buscar dónde están definidos los tipos relacionados a ical_feeds**

```bash
grep -n "IcalFeed\b\|ical_feeds" src/lib/types/database.ts | head -5
```

- [ ] **Step 2: Agregar las nuevas interfaces cerca del bloque existente**

```typescript
export interface IcalSyncRun {
  id: string;
  feed_id: string;
  organization_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error";
  imported_count: number;
  skipped_count: number;
  error_message: string | null;
  trigger_source: "cron" | "manual" | "create_feed";
}

export interface IcalFeedHealth {
  feed_id: string;
  organization_id: string;
  errors_24h: number;
  last_ok_at: string | null;
  health: "ok" | "warning" | "broken";
}

export interface IcalFeedWithHealth extends IcalFeed {
  health: "ok" | "warning" | "broken";
  errors_24h: number;
  last_ok_at: string | null;
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat(types): IcalSyncRun, IcalFeedHealth, IcalFeedWithHealth"
```

## Task 1.6: Agregar actions `listIcalFeedsWithHealth` y `getSyncRunsForFeed`

**Files:**
- Modify: `src/lib/actions/ical.ts`

- [ ] **Step 1: Agregar las nuevas actions al final del archivo**

```typescript
export async function listIcalFeedsWithHealth() {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("*, units(id, code, name)")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  const { data: healthRows } = await admin
    .from("ical_feed_health")
    .select("*")
    .eq("organization_id", organization.id);

  const healthMap = new Map((healthRows ?? []).map((h) => [h.feed_id, h]));

  return (feeds ?? []).map((f) => {
    const h = healthMap.get(f.id);
    return {
      ...f,
      health: (h?.health ?? "ok") as "ok" | "warning" | "broken",
      errors_24h: (h?.errors_24h ?? 0) as number,
      last_ok_at: (h?.last_ok_at ?? null) as string | null,
    };
  });
}

export async function getSyncRunsForFeed(feedId: string, limit = 20) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("ical_sync_runs")
    .select("*")
    .eq("feed_id", feedId)
    .eq("organization_id", organization.id)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getFeedHealthSummary(): Promise<{ broken: number; warning: number; ok: number }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data } = await admin
    .from("ical_feed_health")
    .select("health")
    .eq("organization_id", organization.id);

  const summary = { broken: 0, warning: 0, ok: 0 };
  for (const r of data ?? []) {
    summary[r.health as keyof typeof summary]++;
  }
  return summary;
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/ical.ts
git commit -m "feat(channel-manager): actions listIcalFeedsWithHealth y getSyncRunsForFeed"
```

## Task 1.7: Validación de URL al crear feed (sync inmediato)

**Files:**
- Modify: `src/lib/actions/ical.ts` — función `createIcalFeed`

- [ ] **Step 1: Modificar `createIcalFeed` para hacer un sync de prueba**

Buscar la función `createIcalFeed` actual (que probablemente solo hace insert y revalidate). Reemplazar el cuerpo de la función por:

```typescript
export async function createIcalFeed(input: { unitId: string; source: string; feedUrl: string; label?: string | null }) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Validar input con el Zod schema existente (revisarlo arriba en el archivo; si se llama icalFeedSchema, mantenerlo)
  const validated = icalFeedSchema.parse(input);

  // Insertar tentativamente
  const { data: feed, error: insertErr } = await admin
    .from("ical_feeds")
    .insert({
      organization_id: organization.id,
      unit_id: validated.unitId,
      source: validated.source,
      feed_url: validated.feedUrl,
      label: validated.label ?? null,
      active: true,
    })
    .select("id, organization_id, unit_id, source, feed_url, active")
    .single();
  if (insertErr || !feed) throw new Error(insertErr?.message ?? "Error al crear feed");

  // Sync inmediato de prueba (trigger='create_feed')
  const result = await runSync(admin, feed as IcalFeedRow, "create_feed");

  if (result.error) {
    // Rollback el insert para no dejar feeds rotos
    await admin.from("ical_feeds").delete().eq("id", feed.id);
    throw new Error(`URL inválida: ${result.error}`);
  }

  revalidatePath("/dashboard/channel-manager");
  return { feedId: feed.id, imported: result.imported };
}
```

Si el archivo no importaba aún `runSync` en task 1.3, agregarlo:
```typescript
import { syncIcalFeed as runSync, type IcalFeedRow } from "@/lib/ical/sync";
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/ical.ts
git commit -m "feat(channel-manager): createIcalFeed valida la URL con un sync inmediato

Si el fetch o parse falla, rollback del insert y propaga el error al UI.
Evita que queden feeds inválidas guardadas en la DB."
```

## Task 1.8: Crear componente `SyncHistoryDialog`

**Files:**
- Create: `src/components/channel-manager/sync-history-dialog.tsx`

- [ ] **Step 1: Crear el componente**

```typescript
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getSyncRunsForFeed } from "@/lib/actions/ical";
import type { IcalSyncRun } from "@/lib/types/database";

interface Props {
  feedId: string;
  feedLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SyncHistoryDialog({ feedId, feedLabel, open, onOpenChange }: Props) {
  const [runs, setRuns] = useState<IcalSyncRun[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getSyncRunsForFeed(feedId, 20)
      .then(setRuns)
      .finally(() => setLoading(false));
  }, [open, feedId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historial de sincronización — {feedLabel}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin corridas registradas todavía.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {runs.map((r) => (
              <div key={r.id} className="flex items-start justify-between rounded border p-2 text-sm">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.started_at).toLocaleString("es-AR")}
                    </span>
                    <Badge variant="outline" className="text-xs">{r.trigger_source}</Badge>
                  </div>
                  {r.error_message && (
                    <p className="text-xs text-destructive">{r.error_message}</p>
                  )}
                </div>
                <div className="text-right text-xs">
                  <div className="font-medium">{r.imported_count} importados</div>
                  <div className="text-muted-foreground">{r.skipped_count} omitidos</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: IcalSyncRun["status"] }) {
  if (status === "ok") return <Badge className="bg-emerald-600 text-white">ok</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="secondary">running</Badge>;
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/channel-manager/sync-history-dialog.tsx
git commit -m "feat(channel-manager): SyncHistoryDialog para ver últimas 20 corridas de una feed"
```

## Task 1.9: Actualizar `ChannelManagerList` con health badges y botón historial

**Files:**
- Modify: `src/components/channel-manager/channel-manager-list.tsx`

- [ ] **Step 1: Inspeccionar el componente actual**

```bash
cat src/components/channel-manager/channel-manager-list.tsx
```

Identificar dónde recibe la lista de feeds (probablemente prop `feeds`). Cambiar el tipo a `IcalFeedWithHealth[]`.

- [ ] **Step 2: Agregar badges y botón "Ver historial"**

Cerca de la sección que muestra cada feed (probablemente un `.map` sobre `feeds`), agregar:

```typescript
import { Eye } from "lucide-react";
import { useState } from "react";
import { SyncHistoryDialog } from "./sync-history-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IcalFeedWithHealth } from "@/lib/types/database";

// dentro del componente, mantener "use client" si ya lo tenía
const [historyFeedId, setHistoryFeedId] = useState<string | null>(null);
const historyFeed = feeds.find((f) => f.id === historyFeedId) ?? null;

// dentro del .map(feed => ...):
<div className="flex items-center gap-2">
  <HealthBadge health={feed.health} errors24h={feed.errors_24h} />
  <Button
    size="sm"
    variant="ghost"
    onClick={() => setHistoryFeedId(feed.id)}
    title="Ver historial de sincronización"
  >
    <Eye className="h-4 w-4" />
  </Button>
  {/* ...botones existentes: sincronizar, eliminar */}
</div>

// fuera del .map, al final del componente:
{historyFeed && (
  <SyncHistoryDialog
    feedId={historyFeed.id}
    feedLabel={historyFeed.label ?? historyFeed.source}
    open={!!historyFeedId}
    onOpenChange={(o) => !o && setHistoryFeedId(null)}
  />
)}
```

Y el helper:

```typescript
function HealthBadge({ health, errors24h }: { health: "ok" | "warning" | "broken"; errors24h: number }) {
  if (health === "ok") return <Badge className="bg-emerald-600 text-white">OK</Badge>;
  if (health === "warning")
    return <Badge className="bg-amber-500 text-white">Advertencia ({errors24h})</Badge>;
  return <Badge variant="destructive">Roto ({errors24h})</Badge>;
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/channel-manager/channel-manager-list.tsx
git commit -m "feat(channel-manager): badges de salud + botón historial en lista de feeds"
```

## Task 1.10: Actualizar página `/dashboard/channel-manager` para usar `listIcalFeedsWithHealth`

**Files:**
- Modify: `src/app/dashboard/channel-manager/page.tsx`

- [ ] **Step 1: Cambiar la llamada del server component**

Reemplazar la llamada actual `listIcalFeeds()` por `listIcalFeedsWithHealth()`. Pasarle al `<ChannelManagerList feeds={feeds} />` el resultado tipado.

```typescript
// arriba del archivo
import { listIcalFeedsWithHealth, getFeedHealthSummary } from "@/lib/actions/ical";

// dentro del componente server
const feeds = await listIcalFeedsWithHealth();
const summary = await getFeedHealthSummary();

// renderizado: si summary.broken > 0, mostrar banner
{summary.broken > 0 && (
  <div className="rounded-md bg-destructive/10 border border-destructive p-3 mb-4">
    <p className="text-sm text-destructive font-medium">
      {summary.broken} {summary.broken === 1 ? "feed" : "feeds"} en estado roto. Revisá los errores abajo.
    </p>
  </div>
)}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/channel-manager/page.tsx
git commit -m "feat(channel-manager): banner global de feeds en error"
```

## Task 1.11: Badge en sidebar para feeds en error/warning

**Files:**
- Modify: `src/components/app-sidebar.tsx`

- [ ] **Step 1: Localizar el item "Channel Manager" en el sidebar**

```bash
grep -n "channel-manager\|Channel Manager\|channelManager" src/components/app-sidebar.tsx
```

- [ ] **Step 2: Inyectar el count de feeds en error**

El sidebar probablemente es un client component que recibe datos de un layout server. Para no romper el patrón, agregar la llamada a `getFeedHealthSummary()` en `src/app/dashboard/layout.tsx` y pasarlo como prop al sidebar.

En `src/app/dashboard/layout.tsx`:
```typescript
import { getFeedHealthSummary } from "@/lib/actions/ical";

// dentro del layout (server component):
const feedHealthSummary = await getFeedHealthSummary();

// pasar al sidebar:
<AppSidebar ... feedAlerts={feedHealthSummary.broken + feedHealthSummary.warning} />
```

En `src/components/app-sidebar.tsx`:
- Agregar prop `feedAlerts?: number`.
- Junto al item "Channel Manager" renderizar un badge numérico:
```typescript
{feedAlerts && feedAlerts > 0 ? (
  <Badge variant="destructive" className="ml-auto">{feedAlerts}</Badge>
) : null}
```

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/app-sidebar.tsx src/app/dashboard/layout.tsx
git commit -m "feat(channel-manager): badge numérico de feeds en error en sidebar"
```

## Task 1.12: Verificación final Fase 1

- [ ] **Step 1: Build completo**

```bash
npm run build
```
Expected: build exitoso, 0 errors. Confirmar que las rutas nuevas/modificadas aparecen.

- [ ] **Step 2: Smoke test en browser**

Iniciar `npm run dev` y verificar manualmente:

1. Ir a `/dashboard/channel-manager`. Pestaña "Importar" muestra feeds con badge OK (verde).
2. Crear feed con URL inválida (ej `https://example.com/nonexistent.ics`). Debe rechazarse con mensaje de error claro **sin guardar el feed**.
3. Crear feed con URL válida (ej feed iCal de prueba de Airbnb si tenés). Debe guardarse y mostrar status OK.
4. Click en el ícono "ojo" → modal con historial: debe mostrar la corrida `create_feed` exitosa.
5. Click en "Sincronizar" del feed → nueva entrada en historial con trigger=manual.
6. Verificar en sidebar que el item "Channel Manager" no tiene badge (si todo OK) o sí lo tiene (con count) si hay feeds rotos.

- [ ] **Step 3: Verificar que pg_cron está corriendo**

En Supabase SQL Editor (esperar ≥30 min después de aplicar la migración, o forzar):
```sql
SELECT jobid, jobname, schedule, last_start FROM cron.job
  LEFT JOIN cron.job_run_details USING (jobid)
  WHERE jobname = 'apartcba-sync-ical'
  ORDER BY start_time DESC LIMIT 5;
```
Expected: al menos 1 ejecución en `last_start` después de la última media hora. Si no apareció todavía, esperar al próximo ciclo.

- [ ] **Step 4: Tag final de fase**

```bash
git tag -a phase-1-ical-hardening -m "Fase 1: iCal hardening completa"
```

---

# Fase 2 — Rate calendar

Producirá: UI grilla en `/dashboard/unidades/[id]/precios` que resuelve precios día por día sobre `unit_pricing_rules`, CRUD de reglas date_range y weekday, autollenado de `total_amount` en `createBooking`.

## Task 2.1: Crear helper `resolvePrice`

**Files:**
- Create: `src/lib/pricing/resolve.ts`

- [ ] **Step 1: Escribir el módulo**

```typescript
// src/lib/pricing/resolve.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PerNightPrice {
  date: string; // YYYY-MM-DD
  price: number;
  sourceRuleId: string | null;
  multiplierApplied: number | null;
}

export interface PriceBreakdown {
  perNight: PerNightPrice[];
  total: number;
  minStay: number;
  currency: string;
  basePrice: number;
}

interface UnitRow {
  id: string;
  base_price: number | null;
  base_price_currency: string | null;
  min_nights: number;
}

interface PricingRuleRow {
  id: string;
  rule_type: "date_range" | "weekday";
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[] | null;
  price_multiplier: number | null;
  price_override: number | null;
  min_nights_override: number | null;
  priority: number;
  active: boolean;
  created_at: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function resolvePrice(
  admin: SupabaseClient,
  unitId: string,
  checkIn: Date,
  checkOut: Date,
): Promise<PriceBreakdown> {
  const { data: unit, error: unitErr } = await admin
    .from("units")
    .select("id, base_price, base_price_currency, min_nights")
    .eq("id", unitId)
    .single();
  if (unitErr || !unit) throw new Error("Unidad no encontrada");

  const { data: rules } = await admin
    .from("unit_pricing_rules")
    .select("id, rule_type, start_date, end_date, days_of_week, price_multiplier, price_override, min_nights_override, priority, active, created_at")
    .eq("unit_id", unitId)
    .eq("active", true);

  return resolveFromRows(unit as UnitRow, (rules ?? []) as PricingRuleRow[], checkIn, checkOut);
}

/** Función pura, separada para testear sin DB en el futuro si hace falta. */
export function resolveFromRows(
  unit: UnitRow,
  rules: PricingRuleRow[],
  checkIn: Date,
  checkOut: Date,
): PriceBreakdown {
  const basePrice = unit.base_price ?? 0;
  const currency = unit.base_price_currency ?? "ARS";
  const perNight: PerNightPrice[] = [];
  let minStay = unit.min_nights;

  const nights = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY));
  for (let i = 0; i < nights; i++) {
    const d = new Date(checkIn.getTime() + i * MS_PER_DAY);
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat

    // Filtrar rules que matchean esta noche
    const candidates = rules.filter((r) => {
      if (r.rule_type === "date_range") {
        return r.start_date && r.end_date && dateStr >= r.start_date && dateStr <= r.end_date;
      }
      // weekday
      return Array.isArray(r.days_of_week) && r.days_of_week.includes(dow);
    });

    // Ordenar por priority DESC, created_at ASC (más vieja gana en empate)
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.created_at.localeCompare(b.created_at);
    });

    const winner = candidates[0];
    let price = basePrice;
    let sourceRuleId: string | null = null;
    let multiplier: number | null = null;

    if (winner) {
      sourceRuleId = winner.id;
      if (winner.price_override !== null) {
        price = Number(winner.price_override);
      } else if (winner.price_multiplier !== null) {
        multiplier = Number(winner.price_multiplier);
        price = basePrice * multiplier;
      }
      if (winner.min_nights_override !== null) {
        minStay = Math.max(minStay, winner.min_nights_override);
      }
    }

    perNight.push({ date: dateStr, price, sourceRuleId, multiplierApplied: multiplier });
  }

  const total = perNight.reduce((acc, n) => acc + n.price, 0);
  return { perNight, total, minStay, currency, basePrice };
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/pricing/resolve.ts
git commit -m "feat(pricing): helper resolvePrice — calcula breakdown día por día desde unit_pricing_rules

Algoritmo:
- Carga base_price + reglas activas en una sola query
- Para cada noche filtra rules que matchean (date_range o weekday)
- Ordena por priority DESC, created_at ASC (más vieja gana en empate)
- Aplica price_override si existe, sino base * price_multiplier
- minStay = max(unit.min_nights, max(rule.min_nights_override) matched)"
```

## Task 2.2: Crear actions de pricing

**Files:**
- Create: `src/lib/actions/pricing.ts`

- [ ] **Step 1: Escribir el archivo**

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePrice, type PriceBreakdown } from "@/lib/pricing/resolve";

const dateRangeRuleSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priceOverride: z.coerce.number().positive().nullable().optional(),
  priceMultiplier: z.coerce.number().positive().nullable().optional(),
  minNightsOverride: z.coerce.number().int().min(1).max(365).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).default(0),
}).refine(
  (d) => d.priceOverride != null || d.priceMultiplier != null,
  { message: "Debe especificar precio o multiplicador" }
);

const weekdayRuleSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1).max(100),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  priceOverride: z.coerce.number().positive().nullable().optional(),
  priceMultiplier: z.coerce.number().positive().nullable().optional(),
  minNightsOverride: z.coerce.number().int().min(1).max(365).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).default(0),
}).refine(
  (d) => d.priceOverride != null || d.priceMultiplier != null,
  { message: "Debe especificar precio o multiplicador" }
);

async function assertUnitInOrg(admin: ReturnType<typeof createAdminClient>, unitId: string, orgId: string) {
  const { data } = await admin.from("units").select("id").eq("id", unitId).eq("organization_id", orgId).maybeSingle();
  if (!data) throw new Error("Unidad no encontrada en la organización actual");
}

export async function createDateRangeRule(input: z.input<typeof dateRangeRuleSchema>) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const v = dateRangeRuleSchema.parse(input);
  const admin = createAdminClient();
  await assertUnitInOrg(admin, v.unitId, organization.id);

  const { error } = await admin.from("unit_pricing_rules").insert({
    unit_id: v.unitId,
    organization_id: organization.id,
    name: v.name,
    rule_type: "date_range",
    start_date: v.startDate,
    end_date: v.endDate,
    price_override: v.priceOverride ?? null,
    price_multiplier: v.priceMultiplier ?? null,
    min_nights_override: v.minNightsOverride ?? null,
    priority: v.priority,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${v.unitId}/precios`);
}

export async function createWeekdayRule(input: z.input<typeof weekdayRuleSchema>) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const v = weekdayRuleSchema.parse(input);
  const admin = createAdminClient();
  await assertUnitInOrg(admin, v.unitId, organization.id);

  const { error } = await admin.from("unit_pricing_rules").insert({
    unit_id: v.unitId,
    organization_id: organization.id,
    name: v.name,
    rule_type: "weekday",
    days_of_week: v.daysOfWeek,
    price_override: v.priceOverride ?? null,
    price_multiplier: v.priceMultiplier ?? null,
    min_nights_override: v.minNightsOverride ?? null,
    priority: v.priority,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${v.unitId}/precios`);
}

export async function deleteRule(ruleId: string, unitId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  // soft delete
  const { error } = await admin
    .from("unit_pricing_rules")
    .update({ active: false })
    .eq("id", ruleId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${unitId}/precios`);
}

export async function updateUnitBasePrice(input: { unitId: string; basePrice: number; currency: string }) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const v = z.object({
    unitId: z.string().uuid(),
    basePrice: z.coerce.number().positive(),
    currency: z.string().length(3),
  }).parse(input);

  const { error } = await admin
    .from("units")
    .update({ base_price: v.basePrice, base_price_currency: v.currency })
    .eq("id", v.unitId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${v.unitId}/precios`);
}

export async function getCalendarPrices(unitId: string, year: number, month: number) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  await assertUnitInOrg(admin, unitId, organization.id);

  // Rango del mes (inclusive)
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive
  const breakdown = await resolvePrice(admin, unitId, start, end);

  // Bookings que cubran cualquier noche de este mes (para indicar isBooked)
  const startStr = start.toISOString().slice(0, 10);
  const endStr = new Date(end.getTime() - 1).toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("bookings")
    .select("check_in_date, check_out_date")
    .eq("unit_id", unitId)
    .in("status", ["confirmada", "check_in"])
    .lte("check_in_date", endStr)
    .gte("check_out_date", startStr);

  const bookedDates = new Set<string>();
  for (const b of bookings ?? []) {
    const ci = new Date(b.check_in_date);
    const co = new Date(b.check_out_date);
    const nights = Math.round((co.getTime() - ci.getTime()) / 86400000);
    for (let i = 0; i < nights; i++) {
      bookedDates.add(new Date(ci.getTime() + i * 86400000).toISOString().slice(0, 10));
    }
  }

  return {
    ...breakdown,
    perNight: breakdown.perNight.map((n) => ({ ...n, isBooked: bookedDates.has(n.date) })),
  };
}

export async function previewPrice(unitId: string, checkIn: string, checkOut: string): Promise<PriceBreakdown> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await assertUnitInOrg(admin, unitId, organization.id);
  return resolvePrice(admin, unitId, new Date(checkIn), new Date(checkOut));
}

export async function listActiveRules(unitId: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  await assertUnitInOrg(admin, unitId, organization.id);

  const { data } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .eq("unit_id", unitId)
    .eq("active", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/pricing.ts
git commit -m "feat(pricing): server actions CRUD reglas + previewPrice + getCalendarPrices

- createDateRangeRule / createWeekdayRule / deleteRule (soft) / updateUnitBasePrice
- getCalendarPrices: breakdown del mes + flag isBooked por noche
- previewPrice: usado por el form de bookings para sugerir total
- listActiveRules: para la tabla de reglas activas
- Todos los actions verifican unidad ∈ organización actual"
```

## Task 2.3: Crear la página `/dashboard/unidades/[id]/precios/page.tsx`

**Files:**
- Create: `src/app/dashboard/unidades/[id]/precios/page.tsx`

- [ ] **Step 1: Escribir el server component**

```typescript
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { getCalendarPrices, listActiveRules } from "@/lib/actions/pricing";
import { RateCalendarGrid } from "@/components/pricing/rate-calendar-grid";
import { RulesTable } from "@/components/pricing/rules-table";
import { EditBasePriceDialog } from "@/components/pricing/edit-base-price-dialog";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function UnitPricesPage({ params, searchParams }: Props) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const { id } = await params;
  const sp = await searchParams;

  const admin = createAdminClient();
  const { data: unit } = await admin
    .from("units")
    .select("id, code, name, base_price, base_price_currency, min_nights")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .single();

  if (!unit) notFound();

  const now = new Date();
  const year = sp.year ? parseInt(sp.year, 10) : now.getFullYear();
  const month = sp.month ? parseInt(sp.month, 10) : now.getMonth() + 1;

  const calendar = await getCalendarPrices(id, year, month);
  const rules = await listActiveRules(id);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Precios — {unit.name ?? unit.code}</h1>
          <p className="text-sm text-muted-foreground">
            Base: ${(unit.base_price ?? 0).toLocaleString("es-AR")} {unit.base_price_currency ?? "ARS"} /
            noche · Min stay: {unit.min_nights} {unit.min_nights === 1 ? "noche" : "noches"}
          </p>
        </div>
        <EditBasePriceDialog
          unitId={unit.id}
          currentPrice={unit.base_price ?? 0}
          currentCurrency={unit.base_price_currency ?? "ARS"}
        />
      </header>

      <RateCalendarGrid
        unitId={unit.id}
        year={year}
        month={month}
        days={calendar.perNight}
        currency={calendar.currency}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold">Reglas activas</h2>
        <RulesTable unitId={unit.id} rules={rules} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: errors sobre componentes no creados todavía (`RateCalendarGrid`, `RulesTable`, `EditBasePriceDialog`) — eso es esperado, se resuelve en los próximos tasks.

- [ ] **Step 3: Commit (defer hasta que compilen los componentes)**

Skip commit. Continuar con task 2.4.

## Task 2.4: Componente `EditBasePriceDialog`

**Files:**
- Create: `src/components/pricing/edit-base-price-dialog.tsx`

- [ ] **Step 1: Escribir el componente**

```typescript
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateUnitBasePrice } from "@/lib/actions/pricing";
import { toast } from "sonner";

interface Props { unitId: string; currentPrice: number; currentCurrency: string }

export function EditBasePriceDialog({ unitId, currentPrice, currentCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(currentPrice));
  const [currency, setCurrency] = useState(currentCurrency);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      try {
        await updateUnitBasePrice({ unitId, basePrice: parseFloat(price), currency });
        toast.success("Precio base actualizado");
        setOpen(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Editar base</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar precio base</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Precio</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={0} step={1} />
          </div>
          <div>
            <Label>Moneda</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ARS">ARS</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit (defer)**

Continuar.

## Task 2.5: Componente `RateCalendarGrid` (grilla + drag-to-select + dialog aplicar)

**Files:**
- Create: `src/components/pricing/rate-calendar-grid.tsx`
- Create: `src/components/pricing/apply-rate-dialog.tsx`

- [ ] **Step 1: Crear `apply-rate-dialog.tsx`**

```typescript
"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createDateRangeRule } from "@/lib/actions/pricing";
import { toast } from "sonner";

interface Props {
  unitId: string;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD inclusive
  open: boolean;
  onClose: () => void;
}

export function ApplyRateDialog({ unitId, startDate, endDate, open, onClose }: Props) {
  const [mode, setMode] = useState<"override" | "multiplier">("override");
  const [value, setValue] = useState("");
  const [minNights, setMinNights] = useState("");
  const [priority, setPriority] = useState("10");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (!startDate || !endDate) return;
    start(async () => {
      try {
        await createDateRangeRule({
          unitId,
          name: name || `Precio ${startDate} a ${endDate}`,
          startDate,
          endDate,
          priceOverride: mode === "override" ? Number(value) : null,
          priceMultiplier: mode === "multiplier" ? Number(value) : null,
          minNightsOverride: minNights ? Number(minNights) : null,
          priority: Number(priority),
        });
        toast.success("Regla creada");
        setValue("");
        setMinNights("");
        setName("");
        onClose();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar precio a {startDate} → {endDate}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nombre (opcional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Temporada alta" />
          </div>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "override" | "multiplier")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="override" id="override" />
              <Label htmlFor="override">Precio fijo</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="multiplier" id="multiplier" />
              <Label htmlFor="multiplier">Multiplicador del base</Label>
            </div>
          </RadioGroup>
          <div>
            <Label>{mode === "override" ? "Precio (por noche)" : "Multiplicador (ej. 1.3)"}</Label>
            <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} step={mode === "override" ? 100 : 0.05} min={0} />
          </div>
          <div>
            <Label>Min stay (opcional)</Label>
            <Input type="number" value={minNights} onChange={(e) => setMinNights(e.target.value)} min={1} placeholder="Sin override" />
          </div>
          <div>
            <Label>Prioridad (0-100, mayor gana)</Label>
            <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} min={0} max={100} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !value}>{pending ? "Guardando..." : "Aplicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Crear `rate-calendar-grid.tsx`**

```typescript
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApplyRateDialog } from "./apply-rate-dialog";

interface DayCell {
  date: string;
  price: number;
  sourceRuleId: string | null;
  multiplierApplied: number | null;
  isBooked?: boolean;
}

interface Props {
  unitId: string;
  year: number;
  month: number;
  days: DayCell[];
  currency: string;
}

export function RateCalendarGrid({ unitId, year, month, days, currency }: Props) {
  const router = useRouter();
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [applying, setApplying] = useState<{ start: string; end: string } | null>(null);

  const dayMap = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const monthDate = new Date(Date.UTC(year, month - 1, 1));
  const monthLabel = monthDate.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

  // Días en el mes (siempre desde día 1)
  const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0));
  // dow 0=domingo en JS; en es-AR la semana arranca en lunes → offset -1 mod 7
  const startOffset = (firstDayOfMonth.getUTCDay() + 6) % 7;
  const totalCells = startOffset + lastDayOfMonth.getUTCDate();
  const weeks = Math.ceil(totalCells / 7);

  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= lastDayOfMonth.getUTCDate(); day++) {
    const dateStr = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    cells.push(dayMap.get(dateStr) ?? null);
  }
  while (cells.length < weeks * 7) cells.push(null);

  function nav(delta: number) {
    let m = month + delta;
    let y = year;
    if (m === 0) { m = 12; y -= 1; }
    if (m === 13) { m = 1; y += 1; }
    router.push(`?year=${y}&month=${m}`);
  }

  function selectedRange(): { start: string; end: string } | null {
    if (!dragStart || !dragEnd) return null;
    const [a, b] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart];
    return { start: a, end: b };
  }

  function isInSelection(date: string): boolean {
    const sel = selectedRange();
    if (!sel) return false;
    return date >= sel.start && date <= sel.end;
  }

  function onMouseDown(date: string) {
    setDragStart(date);
    setDragEnd(date);
  }
  function onMouseEnter(date: string) {
    if (dragStart) setDragEnd(date);
  }
  function onMouseUp() {
    if (dragStart && dragEnd) {
      const sel = selectedRange();
      if (sel) setApplying(sel);
    }
    setDragStart(null);
    setDragEnd(null);
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="text-lg font-semibold capitalize">{monthLabel}</h2>
        <Button variant="ghost" size="sm" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground">
        {["Lu","Ma","Mi","Ju","Vi","Sa","Do"].map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 select-none" onMouseLeave={onMouseUp} onMouseUp={onMouseUp}>
        {cells.map((c, i) => (
          <div
            key={i}
            className={[
              "h-16 rounded border text-xs flex flex-col items-center justify-center cursor-pointer transition",
              c ? "" : "bg-muted/30 cursor-default",
              c && isInSelection(c.date) ? "ring-2 ring-primary bg-primary/10" : "",
              c?.isBooked ? "bg-rose-50 text-rose-700 line-through" : "",
              c?.sourceRuleId ? "border-emerald-400" : "",
            ].join(" ")}
            onMouseDown={() => c && !c.isBooked && onMouseDown(c.date)}
            onMouseEnter={() => c && !c.isBooked && onMouseEnter(c.date)}
          >
            {c && (
              <>
                <span className="text-[10px] text-muted-foreground">{parseInt(c.date.slice(8, 10), 10)}</span>
                <span className="font-medium">${Math.round(c.price).toLocaleString("es-AR")}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Arrastrá para seleccionar un rango. Las fechas reservadas (rosa) están bloqueadas. Borde verde = regla aplicada.
      </p>

      <ApplyRateDialog
        unitId={unitId}
        open={!!applying}
        startDate={applying?.start ?? null}
        endDate={applying?.end ?? null}
        onClose={() => setApplying(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit (junto con todo el bloque de pricing UI)**

Defer hasta task 2.6.

## Task 2.6: Componente `RulesTable` (CRUD reglas)

**Files:**
- Create: `src/components/pricing/rules-table.tsx`

- [ ] **Step 1: Escribir el componente**

```typescript
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import { deleteRule } from "@/lib/actions/pricing";
import { toast } from "sonner";

interface Rule {
  id: string;
  name: string;
  rule_type: "date_range" | "weekday";
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[] | null;
  price_override: number | null;
  price_multiplier: number | null;
  min_nights_override: number | null;
  priority: number;
}

const DOW_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

interface Props { unitId: string; rules: Rule[] }

export function RulesTable({ unitId, rules }: Props) {
  const [pending, start] = useTransition();

  function remove(id: string) {
    if (!confirm("¿Eliminar esta regla?")) return;
    start(async () => {
      try {
        await deleteRule(id, unitId);
        toast.success("Regla eliminada");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin reglas activas. Arrastrá en la grilla o creá una regla por día de semana.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Vigencia</TableHead>
          <TableHead>Precio / Multiplicador</TableHead>
          <TableHead>Min stay</TableHead>
          <TableHead>Prioridad</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell>{r.rule_type === "date_range" ? "Rango" : "Día de semana"}</TableCell>
            <TableCell>
              {r.rule_type === "date_range"
                ? `${r.start_date} → ${r.end_date}`
                : (r.days_of_week ?? []).map((d) => DOW_LABELS[d]).join(", ")}
            </TableCell>
            <TableCell>
              {r.price_override != null ? `$${r.price_override.toLocaleString("es-AR")}` : `× ${r.price_multiplier}`}
            </TableCell>
            <TableCell>{r.min_nights_override ?? "—"}</TableCell>
            <TableCell>{r.priority}</TableCell>
            <TableCell>
              <Button size="icon" variant="ghost" disabled={pending} onClick={() => remove(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Expected: 0 errors. Ahora sí, los 3 componentes y la página compilan.

- [ ] **Step 3: Commit todo el bloque UI**

```bash
git add src/app/dashboard/unidades/\[id\]/precios/page.tsx \
       src/components/pricing/rate-calendar-grid.tsx \
       src/components/pricing/apply-rate-dialog.tsx \
       src/components/pricing/rules-table.tsx \
       src/components/pricing/edit-base-price-dialog.tsx
git commit -m "feat(pricing): página /dashboard/unidades/[id]/precios con grilla drag-select + reglas

- Grilla mensual con precios resueltos + indicación de noches reservadas
- Drag-to-select abre dialog para crear regla date_range
- Tabla de reglas activas con soft delete
- Editar precio base de la unidad"
```

## Task 2.7: Botón de acceso desde la página de unidad

**Files:**
- Modify: `src/app/dashboard/unidades/[id]/page.tsx` (o el layout existente de unidad)

- [ ] **Step 1: Localizar la página de detalle de unidad**

```bash
ls src/app/dashboard/unidades/\[id\]/ && cat src/app/dashboard/unidades/\[id\]/page.tsx | head -40
```

- [ ] **Step 2: Agregar un botón/link a `precios`**

En el header de la página de unidad, junto a otros botones de acción:
```typescript
import Link from "next/link";
import { Button } from "@/components/ui/button";

<Button asChild variant="outline">
  <Link href={`/dashboard/unidades/${unit.id}/precios`}>Precios</Link>
</Button>
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/dashboard/unidades/\[id\]/page.tsx
git commit -m "feat(unidades): link a precios desde detalle de unidad"
```

## Task 2.8: Integrar `resolvePrice` en `createBooking`

**Files:**
- Modify: `src/lib/actions/bookings.ts`

- [ ] **Step 1: Identificar la función `createBooking`**

```bash
grep -n "export async function createBooking" src/lib/actions/bookings.ts
```

- [ ] **Step 2: Después de validar input, antes del insert, agregar autollenado**

Buscar el bloque donde se hace `admin.from("bookings").insert(...)` y antes de armar el objeto a insertar:

```typescript
import { resolvePrice } from "@/lib/pricing/resolve";

// dentro de createBooking, después de validar y antes de insertar:
let finalTotalAmount = validated.totalAmount;
if (!finalTotalAmount || finalTotalAmount === 0) {
  try {
    const breakdown = await resolvePrice(
      admin,
      validated.unitId,
      new Date(validated.checkInDate),
      new Date(validated.checkOutDate),
    );
    finalTotalAmount = breakdown.total;
  } catch {
    finalTotalAmount = 0; // no romper si falla el cálculo
  }
}

// usar finalTotalAmount en el insert en lugar de validated.totalAmount
```

Si el insert ya usa `validated.totalAmount` directamente, reemplazar por `finalTotalAmount`.

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/bookings.ts
git commit -m "feat(bookings): autollenar total_amount usando resolvePrice cuando viene vacío

Si el operador no especifica precio, calcula con las reglas activas
de la unidad. Si especifica > 0, respetar el valor (override manual)."
```

## Task 2.9: Botón "Calcular precio" en booking form

**Files:**
- Modify: `src/components/bookings/booking-form.tsx` (o nombre análogo)

- [ ] **Step 1: Localizar el form de booking**

```bash
ls src/components/bookings/ 2>/dev/null
grep -rln "checkInDate\|check_in_date" src/components/bookings/ 2>/dev/null | head -3
```

- [ ] **Step 2: Agregar botón que llama `previewPrice` y autollena el campo total**

En el componente del form (debería ser client component), cerca del campo `total_amount`:

```typescript
import { previewPrice } from "@/lib/actions/pricing";
import { useTransition } from "react";

const [calcPending, calcStart] = useTransition();

async function calcPrice() {
  if (!unitId || !checkInDate || !checkOutDate) return;
  calcStart(async () => {
    try {
      const breakdown = await previewPrice(unitId, checkInDate, checkOutDate);
      setTotalAmount(String(breakdown.total));
      toast.info(`${breakdown.perNight.length} noches × resolvedas. Total ${breakdown.currency} ${breakdown.total.toLocaleString("es-AR")}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  });
}

// junto al input de total:
<Button type="button" variant="outline" size="sm" disabled={calcPending} onClick={calcPrice}>
  {calcPending ? "Calculando..." : "Calcular"}
</Button>
```

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/bookings/booking-form.tsx
git commit -m "feat(bookings): botón Calcular precio invoca previewPrice"
```

## Task 2.10: Verificación final Fase 2

- [ ] **Step 1: Build**

```bash
npm run build
```

- [ ] **Step 2: Smoke test en browser**

```bash
npm run dev
```

1. Ir a `/dashboard/unidades/<id>/precios`. Ver grilla del mes actual con precios = base price.
2. Editar precio base → grilla refleja el nuevo base inmediatamente.
3. Drag desde día 5 hasta día 10. Modal abre. Aplicar `$60000` con prioridad 10. Confirmar.
4. Grilla muestra esos 6 días con $60000 y borde verde.
5. Crear regla weekday (manual via "Reglas activas" UI — añadir botón si no existe, o vía SQL para probar): viernes+sábado, multiplier 1.3. Ver que viernes y sábados del mes muestran $58500 (45000×1.3) si base es 45000.
6. Ir a `/dashboard/reservas/nueva`. Seleccionar unidad y rango. Click "Calcular precio". Total se autollena.
7. Crear booking sin tocar precio. Verificar que el booking en DB tiene `total_amount` = resolvePrice del rango.

- [ ] **Step 3: Tag**

```bash
git tag -a phase-2-rate-calendar -m "Fase 2: rate calendar completa"
```

---

# Fase 3 — Email parser (Resend Inbound)

Producirá: tabla de log, dirección `ota-<token>@<domain>` por org, parsers de Airbnb y Booking, webhook que crea bookings pendientes, página de configuración.

## Task 3.1: Migración 019 (tokens + inbound_email_log + notifications CHECK)

**Files:**
- Create: `supabase/migrations/019_inbound_email.sql`

- [ ] **Step 1: Escribir el archivo SQL**

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- Email parser inbound — Resend webhook
-- ════════════════════════════════════════════════════════════════════════════

-- Token único por org para la dirección ota-<token>@<domain>
ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS inbound_email_token text;

UPDATE apartcba.organizations
  SET inbound_email_token = encode(gen_random_bytes(8), 'hex')
  WHERE inbound_email_token IS NULL;

ALTER TABLE apartcba.organizations
  ALTER COLUMN inbound_email_token SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE apartcba.organizations
    ADD CONSTRAINT organizations_inbound_email_token_unique UNIQUE (inbound_email_token);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Log de cada email procesado
CREATE TABLE IF NOT EXISTS apartcba.inbound_email_log (
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

CREATE INDEX IF NOT EXISTS idx_inbound_log_org_received
  ON apartcba.inbound_email_log(organization_id, received_at DESC);

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

- [ ] **Step 2: Aplicar la migración**

(Igual flow que Task 1.1: MCP, Dashboard SQL Editor, o CLI)

- [ ] **Step 3: Verificar**

```sql
SELECT id, inbound_email_token FROM apartcba.organizations LIMIT 3;
-- Expected: cada org tiene un token hex de 16 chars

SELECT count(*) FROM apartcba.inbound_email_log;
-- Expected: 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/019_inbound_email.sql
git commit -m "feat(channel-manager): migración 019 — inbound email infra

- organizations.inbound_email_token (único, generado para orgs existentes)
- Tabla inbound_email_log para auditoría
- Extiende notifications.type con tipos de inbound (pending, cancelled, unmatched_unit, feed_error)"
```

## Task 3.2: Agregar tipos TS

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Agregar interfaces**

```typescript
export interface InboundEmailLog {
  id: string;
  organization_id: string | null;
  resend_message_id: string | null;
  from_address: string;
  to_address: string;
  subject: string | null;
  received_at: string;
  parser_used: string | null;
  event_type: string | null;
  status: "parsed" | "unmatched" | "error" | "duplicate";
  booking_id: string | null;
  error_message: string | null;
  raw_size_bytes: number | null;
}
```

Y en la interfaz `Organization` existente, agregar:
```typescript
inbound_email_token: string;
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/types/database.ts
git commit -m "feat(types): InboundEmailLog + organizations.inbound_email_token"
```

## Task 3.3: Tipos y interfaces de parsers

**Files:**
- Create: `src/lib/inbound/types.ts`

- [ ] **Step 1: Escribir el archivo**

```typescript
// src/lib/inbound/types.ts

export interface ResendInboundEmail {
  message_id: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  subject: string;
  html?: string;
  text?: string;
  received_at: string; // ISO
  /** Tamaño aproximado del payload bruto en bytes, si Resend lo provee */
  raw_size_bytes?: number;
}

export type ParsedEvent =
  | {
      type: "new_booking";
      guest: { name: string; email?: string; phone?: string };
      checkIn: string;  // YYYY-MM-DD (interpretado al estilo del email; sin TZ)
      checkOut: string; // YYYY-MM-DD
      totalAmount: number;
      currency: string;
      externalId: string;
      listingHint?: string;
    }
  | {
      type: "cancellation";
      externalId: string;
    };

export interface InboundEmailParser {
  name: "airbnb" | "booking";
  match(email: ResendInboundEmail): boolean;
  parse(email: ResendInboundEmail): ParsedEvent | null;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/inbound/types.ts
git commit -m "feat(inbound): tipos compartidos para parsers de email"
```

## Task 3.4: Parser de Airbnb

**Files:**
- Create: `src/lib/inbound/parsers/airbnb.ts`

- [ ] **Step 1: Escribir el parser**

```typescript
// src/lib/inbound/parsers/airbnb.ts
import type { InboundEmailParser, ParsedEvent, ResendInboundEmail } from "../types";

const FROM_DOMAINS = [
  "@airbnb.com",
  "@automated.airbnb.com",
  "@express.airbnb.com",
];

const SUBJECT_NEW = /reservation confirmed|reserva confirmada/i;
const SUBJECT_CANCEL = /cancell?ed|cancelada/i;

export const airbnbParser: InboundEmailParser = {
  name: "airbnb",

  match(email) {
    return FROM_DOMAINS.some((d) => email.from.email.toLowerCase().includes(d));
  },

  parse(email) {
    const body = (email.text || stripHtml(email.html || "")).trim();
    const externalId = extractConfirmationCode(body, email.subject);
    if (!externalId) return null;

    if (SUBJECT_CANCEL.test(email.subject)) {
      return { type: "cancellation", externalId };
    }

    if (SUBJECT_NEW.test(email.subject)) {
      const dates = extractDates(body);
      if (!dates) return null;
      const amount = extractAmount(body);
      const guest = extractGuest(body, email);
      const listing = extractListing(body);
      return {
        type: "new_booking",
        externalId,
        guest,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        totalAmount: amount.value,
        currency: amount.currency,
        listingHint: listing,
      };
    }
    return null;
  },
};

function stripHtml(s: string): string {
  return s.replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function extractConfirmationCode(body: string, subject: string): string | null {
  // Airbnb: códigos tipo HMK4XYZ123 (8-10 alfanum mayúsculas)
  const re = /\b([A-Z0-9]{8,12})\b/;
  const fromSubject = subject.match(re);
  if (fromSubject) return fromSubject[1];
  const fromBody = body.match(/confirmation code[:\s]+([A-Z0-9]{8,12})/i)
    ?? body.match(/código de confirmación[:\s]+([A-Z0-9]{8,12})/i);
  return fromBody?.[1] ?? null;
}

function extractDates(body: string): { checkIn: string; checkOut: string } | null {
  // Buscar patrones tipo "May 12 – May 15, 2026" o "12 May – 15 May 2026"
  // o fechas ISO "2026-05-12"
  const isoRange = body.match(/(\d{4}-\d{2}-\d{2}).{1,40}?(\d{4}-\d{2}-\d{2})/);
  if (isoRange) return { checkIn: isoRange[1], checkOut: isoRange[2] };

  // Patrón "May 12 – May 15, 2026" (mes en inglés/español, día, separador, día, año)
  const months: Record<string, number> = {
    jan: 0, ene: 0, feb: 1, mar: 2, apr: 3, abr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, ago: 7, sep: 8, oct: 9, nov: 10, dec: 11, dic: 11,
  };
  const m = body.match(/([A-Za-z]{3,10})\s+(\d{1,2}).{1,20}?([A-Za-z]{3,10})?\s*(\d{1,2}),?\s*(\d{4})/);
  if (m) {
    const m1 = months[m[1].toLowerCase().slice(0, 3)];
    const m2 = months[(m[3] ?? m[1]).toLowerCase().slice(0, 3)];
    const d1 = parseInt(m[2], 10);
    const d2 = parseInt(m[4], 10);
    const year = parseInt(m[5], 10);
    if (m1 !== undefined && m2 !== undefined) {
      return {
        checkIn: new Date(Date.UTC(year, m1, d1)).toISOString().slice(0, 10),
        checkOut: new Date(Date.UTC(year, m2, d2)).toISOString().slice(0, 10),
      };
    }
  }
  return null;
}

function extractAmount(body: string): { value: number; currency: string } {
  // Patrones tipo "$1,234.56" o "USD 1234.56" o "ARS 50000"
  const m = body.match(/(USD|ARS|EUR|\$)\s*([\d.,]+)/i);
  if (!m) return { value: 0, currency: "USD" };
  const currency = m[1] === "$" ? "USD" : m[1].toUpperCase();
  const raw = m[2].replace(/[.,](?=\d{3})/g, "").replace(",", ".");
  return { value: parseFloat(raw), currency };
}

function extractGuest(body: string, email: ResendInboundEmail): { name: string; email?: string; phone?: string } {
  // Heurística: nombre en el subject o "Reservation from <Name>"
  const m = body.match(/from\s+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+){0,3})/);
  return { name: m?.[1] ?? "Huésped Airbnb", email: undefined, phone: undefined };
}

function extractListing(body: string): string | undefined {
  // Airbnb suele mencionar el listing como "your home <Listing Title>"
  const m = body.match(/(?:your|tu)\s+(?:home|propiedad|listing)\s+(.{3,80}?)(?:\.|\n)/i);
  return m?.[1]?.trim();
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/inbound/parsers/airbnb.ts
git commit -m "feat(inbound): parser de emails de Airbnb (new booking + cancellation)

Extrae confirmation code, fechas, monto, huésped y listing hint
desde HTML/texto. Robusto a variaciones EN/ES."
```

## Task 3.5: Parser de Booking

**Files:**
- Create: `src/lib/inbound/parsers/booking.ts`

- [ ] **Step 1: Escribir el parser**

```typescript
// src/lib/inbound/parsers/booking.ts
import type { InboundEmailParser, ParsedEvent, ResendInboundEmail } from "../types";

const FROM_DOMAINS = ["@booking.com"];
const SUBJECT_NEW = /new reservation|nueva reserva/i;
const SUBJECT_CANCEL = /cancell?ation|cancelaci[óo]n/i;

export const bookingParser: InboundEmailParser = {
  name: "booking",

  match(email) {
    return FROM_DOMAINS.some((d) => email.from.email.toLowerCase().includes(d));
  },

  parse(email) {
    const body = (email.text || stripHtml(email.html || "")).trim();
    const externalId = extractReservationId(body, email.subject);
    if (!externalId) return null;

    if (SUBJECT_CANCEL.test(email.subject)) {
      return { type: "cancellation", externalId };
    }
    if (SUBJECT_NEW.test(email.subject)) {
      const dates = extractDates(body);
      if (!dates) return null;
      const amount = extractAmount(body);
      const guest = extractGuest(body);
      const listing = extractListing(body);
      return {
        type: "new_booking",
        externalId,
        guest,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        totalAmount: amount.value,
        currency: amount.currency,
        listingHint: listing,
      };
    }
    return null;
  },
};

function stripHtml(s: string): string {
  return s.replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function extractReservationId(body: string, subject: string): string | null {
  // Booking.com: número de 9-10 dígitos
  const re = /(\d{9,11})/;
  return (subject.match(re) ?? body.match(/reservation number[:\s]+(\d{9,11})/i)
    ?? body.match(/número de reserva[:\s]+(\d{9,11})/i))?.[1] ?? null;
}

function extractDates(body: string): { checkIn: string; checkOut: string } | null {
  // Booking.com formato común: "Check-in: Tuesday, 12 May 2026" "Check-out: Friday, 15 May 2026"
  const cin = matchDate(body, /check.?in[:\s]+(?:[A-Za-záéíóúñ]+,?\s*)?(\d{1,2})\s+([A-Za-záéíóúñ]+)\s+(\d{4})/i);
  const cout = matchDate(body, /check.?out[:\s]+(?:[A-Za-záéíóúñ]+,?\s*)?(\d{1,2})\s+([A-Za-záéíóúñ]+)\s+(\d{4})/i);
  if (cin && cout) return { checkIn: cin, checkOut: cout };
  return null;
}

function matchDate(body: string, re: RegExp): string | null {
  const m = body.match(re);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, ene: 0, feb: 1, mar: 2, apr: 3, abr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, ago: 7, sep: 8, oct: 9, nov: 10, dec: 11, dic: 11,
  };
  const month = months[m[2].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const day = parseInt(m[1], 10);
  const year = parseInt(m[3], 10);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function extractAmount(body: string): { value: number; currency: string } {
  const m = body.match(/(USD|EUR|ARS|\$|€)\s*([\d.,]+)/i);
  if (!m) return { value: 0, currency: "USD" };
  const sym = m[1];
  const currency = sym === "$" ? "USD" : sym === "€" ? "EUR" : sym.toUpperCase();
  const raw = m[2].replace(/[.,](?=\d{3})/g, "").replace(",", ".");
  return { value: parseFloat(raw), currency };
}

function extractGuest(body: string): { name: string; email?: string; phone?: string } {
  const m = body.match(/guest name[:\s]+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+){0,3})/i)
    ?? body.match(/nombre del hu[eé]sped[:\s]+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+){0,3})/i);
  return { name: m?.[1] ?? "Huésped Booking" };
}

function extractListing(body: string): string | undefined {
  const m = body.match(/(?:property|propiedad)[:\s]+(.{3,80}?)(?:\.|\n)/i);
  return m?.[1]?.trim();
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/inbound/parsers/booking.ts
git commit -m "feat(inbound): parser de emails de Booking.com (new reservation + cancellation)"
```

## Task 3.6: Matcher de unidad y huésped

**Files:**
- Create: `src/lib/inbound/matcher.ts`

- [ ] **Step 1: Escribir el módulo (incluye Levenshtein inline para no agregar dependencia)**

```typescript
// src/lib/inbound/matcher.ts
import type { SupabaseClient } from "@supabase/supabase-js";

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s]/g, "").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

export async function matchUnit(
  admin: SupabaseClient,
  organizationId: string,
  hint: string | undefined,
): Promise<{ unitId: string | null; ambiguous: boolean }> {
  if (!hint) return { unitId: null, ambiguous: false };
  const target = normalize(hint);

  const { data: units } = await admin
    .from("units")
    .select("id, code, name, marketplace_title")
    .eq("organization_id", organizationId)
    .eq("active", true);

  type Candidate = { id: string; score: number };
  const candidates: Candidate[] = [];

  for (const u of units ?? []) {
    const tokens = [u.code, u.name, u.marketplace_title].filter(Boolean) as string[];
    let best = Infinity;
    for (const t of tokens) {
      const n = normalize(t);
      if (!n) continue;
      // Match exacto cualquier substring
      if (n.includes(target) || target.includes(n)) {
        best = Math.min(best, 0);
        continue;
      }
      if (n.length >= 5 && target.length >= 5) {
        const d = levenshtein(n, target);
        // Threshold: distancia ≤ 3 sobre strings ≥ 5 chars
        if (d <= 3) best = Math.min(best, d);
      }
    }
    if (best !== Infinity) candidates.push({ id: u.id, score: best });
  }

  if (candidates.length === 0) return { unitId: null, ambiguous: false };
  if (candidates.length === 1) return { unitId: candidates[0].id, ambiguous: false };

  candidates.sort((a, b) => a.score - b.score);
  // Si el mejor es claramente mejor que el segundo (gap ≥ 1), tomarlo
  if (candidates[0].score < candidates[1].score) return { unitId: candidates[0].id, ambiguous: false };
  return { unitId: null, ambiguous: true };
}

export async function findOrCreateGuest(
  admin: SupabaseClient,
  organizationId: string,
  guest: { name: string; email?: string; phone?: string },
): Promise<string> {
  if (guest.email) {
    const { data } = await admin.from("guests").select("id").eq("organization_id", organizationId).eq("email", guest.email).maybeSingle();
    if (data) return data.id;
  }
  if (guest.phone) {
    const { data } = await admin.from("guests").select("id").eq("organization_id", organizationId).eq("phone", guest.phone).maybeSingle();
    if (data) return data.id;
  }
  if (guest.name) {
    const { data } = await admin.from("guests").select("id").eq("organization_id", organizationId).ilike("full_name", guest.name).maybeSingle();
    if (data) return data.id;
  }
  // Crear nuevo
  const { data: created, error } = await admin
    .from("guests")
    .insert({
      organization_id: organizationId,
      full_name: guest.name,
      email: guest.email ?? null,
      phone: guest.phone ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`crear guest: ${error.message}`);
  return created!.id as string;
}
```

- [ ] **Step 2: Verificar nombres de columnas en `guests`**

```bash
grep -A 20 "CREATE TABLE.*guests" supabase/migrations/001_apartcba_full_schema.sql | head -25
```

Si el campo es `name` y no `full_name`, ajustar `findOrCreateGuest` para usar el nombre correcto. Lo mismo para `email` / `phone`.

- [ ] **Step 3: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/inbound/matcher.ts
git commit -m "feat(inbound): matcher de unidad (Levenshtein ≤3) y find-or-create de guest

Sin dependencias nuevas — implementación inline de distancia."
```

## Task 3.7: Handler del evento parseado

**Files:**
- Create: `src/lib/inbound/handler.ts`

- [ ] **Step 1: Escribir el handler**

```typescript
// src/lib/inbound/handler.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedEvent } from "./types";
import { matchUnit, findOrCreateGuest } from "./matcher";

export interface HandlerResult {
  status: "parsed" | "duplicate" | "error";
  bookingId?: string;
  error?: string;
}

export async function handleInboundEvent(
  admin: SupabaseClient,
  organizationId: string,
  parserName: "airbnb" | "booking",
  event: ParsedEvent,
): Promise<HandlerResult> {
  if (event.type === "new_booking") {
    return await handleNewBooking(admin, organizationId, parserName, event);
  }
  return await handleCancellation(admin, organizationId, parserName, event);
}

async function handleNewBooking(
  admin: SupabaseClient,
  organizationId: string,
  parserName: "airbnb" | "booking",
  event: Extract<ParsedEvent, { type: "new_booking" }>,
): Promise<HandlerResult> {
  // Dedup
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source", parserName)
    .eq("external_id", event.externalId)
    .maybeSingle();
  if (existing) return { status: "duplicate", bookingId: existing.id };

  const unitMatch = await matchUnit(admin, organizationId, event.listingHint);
  const guestId = await findOrCreateGuest(admin, organizationId, event.guest);

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      organization_id: organizationId,
      unit_id: unitMatch.unitId,
      guest_id: guestId,
      source: parserName,
      external_id: event.externalId,
      status: "pendiente",
      check_in_date: event.checkIn,
      check_out_date: event.checkOut,
      check_in_time: "14:00",
      check_out_time: "10:00",
      total_amount: event.totalAmount,
      total_amount_currency: event.currency,
      notes: `Importado automáticamente desde email de ${parserName}`,
    })
    .select("id")
    .single();

  if (error) {
    // bookings_no_overlap → notificación crítica
    if (error.message.includes("bookings_no_overlap")) {
      await admin.from("notifications").insert({
        organization_id: organizationId,
        type: "inbound_booking_pending",
        severity: "critical",
        title: "Conflicto al importar reserva",
        body: `La reserva ${event.externalId} de ${parserName} choca con otra reserva existente. Revisá manualmente.`,
        target_role: "admin",
        action_url: "/dashboard/reservas",
        dedup_key: `${parserName}:${event.externalId}:conflict`,
      });
      return { status: "error", error: error.message };
    }
    return { status: "error", error: error.message };
  }

  // Notificación de booking pendiente
  const severity = unitMatch.unitId ? "info" : "warning";
  const title = unitMatch.unitId ? "Nueva reserva pendiente" : "Reserva pendiente sin unidad asignada";
  const dedup = `${parserName}:${event.externalId}:pending`;

  await admin.from("notifications").insert([
    {
      organization_id: organizationId,
      type: unitMatch.unitId ? "inbound_booking_pending" : "inbound_booking_unmatched_unit",
      severity,
      title,
      body: `${parserName}: ${event.guest.name} · ${event.checkIn} → ${event.checkOut}`,
      target_role: "admin",
      ref_type: "booking",
      ref_id: booking!.id,
      action_url: `/dashboard/reservas/${booking!.id}`,
      dedup_key: dedup,
    },
    {
      organization_id: organizationId,
      type: unitMatch.unitId ? "inbound_booking_pending" : "inbound_booking_unmatched_unit",
      severity,
      title,
      body: `${parserName}: ${event.guest.name} · ${event.checkIn} → ${event.checkOut}`,
      target_role: "recepcion",
      ref_type: "booking",
      ref_id: booking!.id,
      action_url: `/dashboard/reservas/${booking!.id}`,
      dedup_key: `${dedup}:rec`,
    },
  ]);

  return { status: "parsed", bookingId: booking!.id };
}

async function handleCancellation(
  admin: SupabaseClient,
  organizationId: string,
  parserName: "airbnb" | "booking",
  event: Extract<ParsedEvent, { type: "cancellation" }>,
): Promise<HandlerResult> {
  const { data: existing } = await admin
    .from("bookings")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("source", parserName)
    .eq("external_id", event.externalId)
    .maybeSingle();

  if (!existing) return { status: "error", error: "booking_not_found" };
  if (existing.status === "cancelada") return { status: "duplicate", bookingId: existing.id };

  await admin
    .from("bookings")
    .update({ status: "cancelada", notes: `Cancelación importada desde ${parserName}` })
    .eq("id", existing.id);

  await admin.from("notifications").insert({
    organization_id: organizationId,
    type: "inbound_booking_cancelled",
    severity: "warning",
    title: "Reserva cancelada por el huésped",
    body: `${parserName}: reserva ${event.externalId} cancelada.`,
    target_role: "admin",
    ref_type: "booking",
    ref_id: existing.id,
    action_url: `/dashboard/reservas/${existing.id}`,
    dedup_key: `${parserName}:${event.externalId}:cancelled`,
  });

  return { status: "parsed", bookingId: existing.id };
}
```

- [ ] **Step 2: Verificar nombres de columnas**

Confirmar que `bookings.total_amount_currency` existe (si no, omitir el campo del insert). Confirmar que `guests` tiene `full_name` (sino ajustar matcher).

```bash
grep -A 5 "total_amount_currency" supabase/migrations/001_apartcba_full_schema.sql
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/inbound/handler.ts
git commit -m "feat(inbound): handler de eventos parseados (new_booking / cancellation)

- Dedup por (org, source, external_id)
- Match de unidad heurístico via matcher.ts
- find-or-create de guest
- Notificaciones a admin + recepcion con dedup_key
- Conflicto bookings_no_overlap → notificación crítica"
```

## Task 3.8: Webhook route `/api/inbound/resend`

**Files:**
- Create: `src/app/api/inbound/resend/route.ts`

- [ ] **Step 1: Escribir el handler con verificación HMAC manual (Resend usa Svix)**

```typescript
// src/app/api/inbound/resend/route.ts
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { airbnbParser } from "@/lib/inbound/parsers/airbnb";
import { bookingParser } from "@/lib/inbound/parsers/booking";
import { handleInboundEvent } from "@/lib/inbound/handler";
import type { ResendInboundEmail } from "@/lib/inbound/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PARSERS = [airbnbParser, bookingParser];

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifySvix(req, rawBody)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: { data: ResendInboundEmail };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = payload.data;
  if (!email?.from?.email || !email?.to?.[0]?.email) {
    return NextResponse.json({ error: "malformed_email" }, { status: 400 });
  }

  const toAddr = email.to[0].email.toLowerCase();
  const tokenMatch = toAddr.match(/^ota-([a-f0-9]+)@/);
  if (!tokenMatch) {
    // No matchea formato esperado — silenciar pero log
    await logUnmatched(null, email, "address_format_mismatch");
    return NextResponse.json({ ok: true });
  }
  const token = tokenMatch[1];

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("inbound_email_token", token)
    .maybeSingle();

  if (!org) {
    await logUnmatched(null, email, "unknown_token");
    return NextResponse.json({ ok: true });
  }

  const parser = PARSERS.find((p) => p.match(email));
  if (!parser) {
    await logUnmatched(org.id, email, "no_parser_matched");
    return NextResponse.json({ ok: true });
  }

  const parsed = parser.parse(email);
  if (!parsed) {
    await logUnmatched(org.id, email, `${parser.name}_parse_returned_null`);
    return NextResponse.json({ ok: true });
  }

  const result = await handleInboundEvent(admin, org.id, parser.name, parsed);
  await admin.from("inbound_email_log").insert({
    organization_id: org.id,
    resend_message_id: email.message_id,
    from_address: email.from.email,
    to_address: toAddr,
    subject: email.subject,
    parser_used: parser.name,
    event_type: parsed.type,
    status: result.status,
    booking_id: result.bookingId ?? null,
    error_message: result.error ?? null,
    raw_size_bytes: email.raw_size_bytes ?? null,
  });

  return NextResponse.json({ ok: true, status: result.status });
}

async function logUnmatched(orgId: string | null, email: ResendInboundEmail, reason: string) {
  const admin = createAdminClient();
  await admin.from("inbound_email_log").insert({
    organization_id: orgId,
    resend_message_id: email.message_id,
    from_address: email.from.email,
    to_address: email.to[0]?.email ?? "",
    subject: email.subject,
    parser_used: null,
    event_type: null,
    status: "unmatched",
    error_message: reason,
    raw_size_bytes: email.raw_size_bytes ?? null,
  });
}

/**
 * Resend usa Svix internamente. Headers:
 *   svix-id, svix-timestamp, svix-signature
 * Signature = "v1,base64(HMAC-SHA256(secret, id.timestamp.body))"
 * Puede contener múltiples versiones separadas por espacio (futuro-compat).
 */
function verifySvix(req: Request, rawBody: string): boolean {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  if (!secret) return true; // dev sin secret: permitir
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;

  // Anti-replay: timestamp dentro de 5 min
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  if (Number.isNaN(tsNum) || Math.abs(now - tsNum) > 300) return false;

  // Resend / Svix: el secret viene como "whsec_<base64>"
  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  const signedPayload = `${id}.${ts}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedPayload).digest("base64");

  // sig puede tener formato "v1,sig1 v1,sig2"
  const versions = sig.split(" ");
  return versions.some((v) => {
    const [_version, value] = v.split(",");
    if (!value) return false;
    return safeEqual(value, expected);
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Smoke test del endpoint**

Sin firma → 401. Con firma válida → procesa.

Probar con un POST mock (firma vacía y `RESEND_INBOUND_WEBHOOK_SECRET` no seteada en dev):

```bash
curl -X POST http://localhost:3001/api/inbound/resend \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "message_id": "test-001",
      "from": { "email": "automated@airbnb.com" },
      "to": [{ "email": "ota-FAKETOKEN@apart-cba.com.ar" }],
      "subject": "Reservation confirmed for HMK4XYZ789",
      "text": "Confirmation code: HMK4XYZ789. May 20 - May 25, 2026. Total: USD 500. From Juan Perez.",
      "received_at": "2026-05-14T12:00:00Z"
    }
  }'
```
Expected: 200, status `unmatched` (token desconocido) → registrado en `inbound_email_log`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inbound/resend/route.ts
git commit -m "feat(inbound): webhook /api/inbound/resend con HMAC svix manual

- Extrae token de ota-<token>@<domain>, lookup org
- Itera parsers (airbnb, booking) y delega al handler
- Log siempre, incluso unmatched
- Verificación HMAC sin dep externa (crypto.timingSafeEqual)"
```

## Task 3.9: Página de configuración `/dashboard/configuracion/inbound-email`

**Files:**
- Create: `src/app/dashboard/configuracion/inbound-email/page.tsx`
- Create: `src/lib/actions/inbound.ts`

- [ ] **Step 1: Crear actions de inbound**

```typescript
// src/lib/actions/inbound.ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import crypto from "node:crypto";

export async function rotateInboundEmailToken() {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const newToken = crypto.randomBytes(8).toString("hex");
  const { error } = await admin
    .from("organizations")
    .update({ inbound_email_token: newToken })
    .eq("id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/configuracion/inbound-email");
  return { token: newToken };
}

export async function listInboundLog(limit = 50) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("inbound_email_log")
    .select("*")
    .eq("organization_id", organization.id)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
```

- [ ] **Step 2: Crear la página**

```typescript
// src/app/dashboard/configuracion/inbound-email/page.tsx
import { requireSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { listInboundLog } from "@/lib/actions/inbound";
import { InboundEmailClient } from "@/components/inbound/inbound-email-client";

export default async function InboundEmailPage() {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const log = await listInboundLog(50);
  const domain = process.env.INBOUND_EMAIL_DOMAIN ?? "<configurar INBOUND_EMAIL_DOMAIN>";
  const address = `ota-${organization.inbound_email_token}@${domain}`;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Email inbound de OTAs</h1>
        <p className="text-sm text-muted-foreground">
          Configurá esta dirección como destino de los emails de Airbnb / Booking.com
          para que Apart Cba cree reservas automáticamente.
        </p>
      </header>
      <InboundEmailClient address={address} log={log} />
    </div>
  );
}
```

- [ ] **Step 3: Crear el componente cliente**

```typescript
// src/components/inbound/inbound-email-client.tsx
"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { rotateInboundEmailToken } from "@/lib/actions/inbound";
import type { InboundEmailLog } from "@/lib/types/database";

export function InboundEmailClient({ address, log }: { address: string; log: InboundEmailLog[] }) {
  const [pending, start] = useTransition();

  function copy() {
    navigator.clipboard.writeText(address);
    toast.success("Dirección copiada");
  }

  function rotate() {
    if (!confirm("¿Generar nueva dirección? La anterior dejará de funcionar.")) return;
    start(async () => {
      try {
        await rotateInboundEmailToken();
        toast.success("Dirección rotada — actualizá el forward en Airbnb/Booking");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <Label>Tu dirección de OTA inbound</Label>
        <div className="mt-1 flex gap-2">
          <Input value={address} readOnly />
          <Button variant="outline" size="icon" onClick={copy}><Copy className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" onClick={rotate} disabled={pending}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Cómo configurar el forwarding</summary>
          <div className="mt-2 space-y-2 text-xs">
            <p><strong>Airbnb:</strong> Account → Notifications → Email forwarding → agregá la dirección de arriba como destino.</p>
            <p><strong>Booking.com:</strong> Inbox → Settings → email forwarding → agregar dirección.</p>
            <p className="text-muted-foreground">Cuando llega un email reconocido, Apart Cba crea una reserva pendiente y notifica.</p>
          </div>
        </details>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Últimos emails recibidos</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin emails todavía. Probá enviando un email de prueba.</p>
        ) : (
          <div className="space-y-1">
            {log.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded border p-2 text-xs">
                <div className="flex-1">
                  <div className="font-medium">{l.subject ?? "(sin subject)"}</div>
                  <div className="text-muted-foreground">{l.from_address} · {new Date(l.received_at).toLocaleString("es-AR")}</div>
                  {l.error_message && <div className="text-destructive">{l.error_message}</div>}
                </div>
                <div className="flex gap-1">
                  {l.parser_used && <Badge variant="outline">{l.parser_used}</Badge>}
                  <StatusBadge status={l.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: InboundEmailLog["status"] }) {
  if (status === "parsed") return <Badge className="bg-emerald-600 text-white">parsed</Badge>;
  if (status === "duplicate") return <Badge variant="secondary">duplicate</Badge>;
  if (status === "unmatched") return <Badge variant="outline">unmatched</Badge>;
  return <Badge variant="destructive">error</Badge>;
}
```

- [ ] **Step 4: Agregar entrada al sidebar**

Si el sidebar tiene sección "Configuración", agregar item "Email inbound" apuntando a `/dashboard/configuracion/inbound-email`. Solo visible para role `admin`.

```bash
grep -n "configuracion\|Configuración" src/components/app-sidebar.tsx | head -5
```

Agregar el item siguiendo el patrón existente.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/actions/inbound.ts \
       src/app/dashboard/configuracion/inbound-email/page.tsx \
       src/components/inbound/inbound-email-client.tsx \
       src/components/app-sidebar.tsx
git commit -m "feat(inbound): página de configuración con dirección, rotación y log

/dashboard/configuracion/inbound-email expone la dirección ota-<token>,
permite copiarla, rotarla y ver últimos 50 emails recibidos con status."
```

## Task 3.10: Verificación final Fase 3

- [ ] **Step 1: Build**

```bash
npm run build
```

- [ ] **Step 2: Configuración manual (una vez)**

1. En Resend Dashboard:
   - Crear inbound endpoint apuntando a `https://app.apart-cba.com/api/inbound/resend`.
   - Copiar el signing secret a Vercel env vars como `RESEND_INBOUND_WEBHOOK_SECRET`.
2. Agregar 3 registros MX al subdominio elegido (ej `ota.apart-cba.com.ar`) según docs Resend.
3. Agregar env var `INBOUND_EMAIL_DOMAIN=ota.apart-cba.com.ar` (o el dominio elegido) en Vercel + `.env.local`.

- [ ] **Step 3: Smoke test end-to-end**

1. Ir a `/dashboard/configuracion/inbound-email`. Ver la dirección.
2. Mandar un email de prueba desde una cuenta personal a esa dirección, con subject `Reservation confirmed for TESTCODE99` y body con fechas y precio.
3. Esperar ~5 segundos. Refresh.
4. Ver entry en el log con status apropiado (probablemente `unmatched` — porque el `from` no es `airbnb.com`).
5. Para testear el parser real: hacer forward de un email real de Airbnb/Booking a la dirección. Ver booking pendiente creado en `/dashboard/reservas`.

- [ ] **Step 4: Tag**

```bash
git tag -a phase-3-email-parser -m "Fase 3: email parser completo"
```

---

# Self-review check final

- [ ] Las tres fases mergeadas a main.
- [ ] `npm run build` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] pg_cron `apartcba-sync-ical` registrado y disparando cada 30 min.
- [ ] Resend Inbound configurado y `INBOUND_EMAIL_DOMAIN` seteada.
- [ ] Spec cubierto end-to-end.
