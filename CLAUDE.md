# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 + shadcn/ui (style "new-york", `@/components/ui`) · Supabase (Postgres + Auth + Realtime + Storage) · `@dnd-kit` for the PMS Grid / Kanban · `@xyflow/react` for the CRM workflow builder · Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) for CRM AI · `resend` for email · `mapbox-gl` / `react-map-gl` for the marketplace map · `zustand` for some client state · React Compiler enabled (`reactCompiler: true` in `next.config.ts`).

`whatsapp-gateway/` is a **second, independent project** — a standalone Node/TS microservice with its own `package.json` and `Dockerfile`, deployed separately on Railway. It is excluded from the Next.js build and lint (`eslint.config.mjs` ignores `whatsapp-gateway/**`).

## Commands

```bash
npm run dev        # next dev on port 3001 (NOT 3000)
npm run build
npm run lint
npx tsc --noEmit   # typecheck

# whatsapp-gateway is a separate project — work on it from its own dir:
cd whatsapp-gateway && npm install && npm run dev   # tsx watch
cd whatsapp-gateway && npm run typecheck
```

There is no test runner configured. Don't claim tests pass — run `tsc --noEmit` and `lint` instead.

## Required environment

Four vars are needed for the app to boot at all:

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`. The `service_role` key must never be placed in a `NEXT_PUBLIC_*` slot — it would be bundled to the browser.

Feature subsystems need more (all server-only; `.env.example` has the full annotated list):
- **Crons** — `CRON_SECRET` (Vercel cron auth), `PG_CRON_SECRET` (Supabase pg_cron → `/api/cron/from-pg`).
- **Email (Resend)** — `RESEND_API_KEY`, `SYSTEM_EMAIL_FROM`, `SYSTEM_EMAIL_FROM_NAME`, `PLATFORM_FALLBACK_FROM`, `PLATFORM_FALLBACK_FROM_NAME`.
- **Inbound email** — `RESEND_INBOUND_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN`.
- **CRM WhatsApp** — `META_GRAPH_API_VERSION`, `META_WEBHOOK_DEFAULT_TOKEN` (Cloud API); `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_SECRET` (Baileys gateway).
- **CRM AI** — `VERCEL_AI_GATEWAY_API_KEY` (only if an org picks `chat_provider = 'vercel_gateway'`).

Per-org third-party secrets (Meta access tokens, each org's own Anthropic/OpenAI key) are **not** env vars — they live in Supabase Vault, configured through the dashboard UI. `whatsapp-gateway/` has its own separate `.env` (see `whatsapp-gateway/.env.example`).

## Big-picture architecture

**Multi-tenant on a shared schema.** All Apart Cba tables live in the Postgres schema `apartcba` (not `public` — the same Supabase project hosts another product, "TextOS", in `public`). Both Supabase clients in `src/lib/supabase/` are pinned with `db: { schema: "apartcba" }`, so calls like `admin.from("bookings")` resolve to `apartcba.bookings` automatically. Every tenant-scoped table has `organization_id`; access is filtered by `.eq("organization_id", organization.id)` in server actions.

**Three Supabase client factories** (`src/lib/supabase/server.ts`):
- `createClient()` — SSR cookie-bound, uses anon key. Used for `auth.getUser()` and other auth-flow calls.
- `createAdminClient()` — service_role, pinned to `apartcba` schema. Used for **all data reads and mutations** in server actions; org scoping is enforced in code, not by RLS.
- `createAuthAdminClient()` — service_role without schema pin, for cross-schema admin ops (e.g. inviting users via the Supabase Auth Admin API).

There is also a browser `createClient()` in `src/lib/supabase/client.ts` (anon, schema-pinned) — used sparingly for realtime / read-only browser fetches.

RLS policies exist (see the migrations), but because server actions use the service role, **the de-facto security boundary is the action layer, not the database**. Always preserve `requireSession()` + `getCurrentOrg()` + an explicit `organization_id` filter in any new query.

**Secrets live in Supabase Vault.** Per-org third-party credentials — Meta WhatsApp/Instagram access tokens, webhook verify tokens, each org's own AI API key — are stored in Supabase Vault, never in app tables or env. CRM tables hold only a `*_secret_id` UUID; `src/lib/crm/encryption.ts` wraps the `SECURITY DEFINER` Postgres functions (`crm_vault_*`) that read/write Vault, so plaintext never reaches the client bundle.

**Server actions are the only data layer.** Everything in `src/lib/actions/*.ts` is `"use server"`. The canonical pattern in every mutating action:

```ts
"use server";
const session = await requireSession();          // redirects to /login if missing
const { organization, role } = await getCurrentOrg(); // resolves active org via cookie
const validated = someZodSchema.parse(input);    // Zod for input validation
const admin = createAdminClient();
const { data, error } = await admin.from("…")
  .insert({ ...validated, organization_id: organization.id, created_by: session.userId })
  ...;
revalidatePath("/dashboard/…");                  // and any other pages that show this data
```

When changing data that appears on multiple routes (e.g. a booking shows up in `/dashboard/reservas`, `/dashboard/unidades/kanban`, the unit detail page), revalidate **all** of them — there is no global cache invalidation.

**The live layer (`src/lib/realtime/`).** The PMS is a shared board: two people looking at the same calendar must see the same thing. `revalidatePath` only helps the *next* navigation, so an open tab is kept fresh by Supabase Realtime through one shared layer — never by a per-component `supabase.channel(...)`.

- `manager.ts` — browser singleton. One channel per `(table, filter)` with ref-counting, backoff reconnect, connection state, and a **resync bus**. Postgres Changes has no replay: anything that happens while the socket is down is lost forever, so the manager emits `resync` on `visibilitychange`→visible (after ≥15 s hidden), `pageshow` from bfcache, `online`, a channel recovering, and a 90-s watchdog that compares `max(updated_at)` in the DB against the newest event seen. It also watches `onAuthStateChange`: when the session dies, supabase-js silently starts sending the anon key to already-joined channels — RLS stops matching, the channel stays `joined` and mute. That surfaces as `auth-lost`, never as a green dot.
- `use-live.ts` — `useLiveStatus()` (connection), `useLiveTable()` (surgical row merge; **always implement `onResync`**), `useLiveRefresh()` (throttled `router.refresh()` for server-rendered screens), `useFlashIds()` (highlight what just changed).
- `live-context.tsx` — `LiveProvider` mounted in `/dashboard/layout.tsx` and `/m/layout.tsx`; supplies `organizationId` / `userId` / `role` so no hook needs prop-drilling.
- `gates.ts` — `defaultRefreshGate()` blocks a refresh while a dialog/popover/select/sheet is open. It deliberately does **not** match `[data-radix-popper-content-wrapper]`: tooltips use it too, and hovering anything would freeze updates.

Rules of thumb for new screens:
- Server-rendered page → drop in `<LiveRefresh tables={[…]} />` (`@/components/realtime/live-refresh`). One line; the retained-changes pill comes with it.
- Heavy client state (the PMS grid) → `useLiveTable` with a surgical merge, plus an `onResync` that re-reads the loaded window **with eviction**.
- Only tables in the `supabase_realtime` publication emit (see `pg_publication_tables`; migration `055` added `cash_movements`). `apartcba.bookings` keeps `REPLICA IDENTITY DEFAULT` **on purpose** — `FULL` would make DELETE events carry whole rows to *other tenants*, because Realtime applies neither filters nor RLS to deletes. Deletions are handled by the resync, not by the DELETE event.
- Never trust a channel payload as the whole truth for a heavy screen: use it as a trigger and re-read.

**Auth + org session model** (`src/lib/actions/auth.ts`, `src/lib/actions/org.ts`):
- `getSession()` returns `{ userId, profile, memberships }` joining `user_profiles` and `organization_members + organization` in two parallel queries (avoid N+1). Cached per-request with `React.cache`.
- `getCurrentOrg()` reads the `apartcba_org` cookie to pick which membership is active; falls back to the first active membership. A user can belong to multiple orgs and switch via `setCurrentOrg(orgId)`.
- A user with **no memberships** and `is_superadmin=false` is redirected to `/sin-acceso`. Superadmins land on `/superadmin`.

**Permissions** (`src/lib/permissions.ts` + `DEFAULT_ROLE_PERMISSIONS` in `src/lib/constants.ts`): roles are `admin | recepcion | mantenimiento | limpieza | owner_view`. Use `can(role, resource, action)` to gate UI (see `app-sidebar.tsx` for the pattern — sidebar items disappear for roles that lack `view` on that resource). Server actions don't currently re-check `can()`; they only enforce session + org scope, so **adding sensitive actions means adding a `can()` check inside the action**, not just hiding the button.

**Four route audiences:**
- `/dashboard/*` — desktop PMS. Sidebar layout (`src/app/dashboard/layout.tsx`).
- `/m/*` — mobile-first views for ops staff (cleaning, maintenance, concierge, daily report, CRM inbox). Bottom-tab nav, items filtered by role (`src/app/m/layout.tsx`).
- `/superadmin/*` — cross-org admin (creates orgs, invites users). Gated on `profile.is_superadmin`.
- The **`(marketplace)` route group** — the public guest-facing booking site ("rentOS" in UI copy). The group is unprefixed, so its pages sit at the site root (`/`, `/buscar`, `/u/[slug]`, `/checkout/[unitId]`, `/mi-cuenta/*`, `/ingresar`, …). It uses the **same Supabase Auth but a separate identity layer**: `guest_profiles` (parallel to staff `user_profiles`), guarded by `src/lib/actions/guest-auth.ts` — `requireGuestSession()` redirects to `/ingresar`, not `/login`. Forced light mode. See **Marketplace** below.

UI is in **Spanish (es-AR)**: routes (`reservas`, `reservas-pendientes`, `huéspedes`, `propietarios`, `conserjería`, `caja`, `liquidaciones`, `unidades`, `mantenimiento`, `limpieza`, `inventario`, `parte-diario`, `tareas`, `channel-manager`, `crm`, `alertas`), enum labels, and copy. Keep new strings in Spanish to match.

**CRM — omnichannel messaging + workflow automation.** `src/lib/crm/*` and the `src/lib/actions/crm-*.ts` actions power a CRM with three parts: a realtime **inbox** (`/dashboard/crm`, also `/m/crm`), a visual **workflow engine** (n8n-style node graph, `@xyflow`), and **broadcasts**. Three channels sit behind one `ChannelProvider` interface (`src/lib/crm/providers/`): WhatsApp Cloud API (`meta-cloud.ts`), WhatsApp via Baileys (`baileys.ts` — unofficial, driven by the gateway service), and Instagram DM (`instagram.ts`); `providers/factory.ts` resolves the provider from a `crm_channels` row.
- **Outbound is a transactional outbox.** Everything (workflow `send_*` nodes, broadcasts, manual replies) calls `message-sender.ts`, which inserts a `crm_messages` row + a `crm_message_outbox` row and returns — it does *not* send synchronously. `outbox.ts::processOutbox()` (run by the `from-pg` cron) does the actual `provider.send()` with exponential backoff.
- **Inbound is unified.** Both the Meta webhook (`/api/webhooks/whatsapp`) and the Baileys webhook (`/api/webhooks/baileys`) funnel into `inbound.ts::processInboundMessage()` — upsert contact (auto-linked to `guests`/`owners` by phone), upsert conversation, insert message (idempotent on `wa_message_id`), then `dispatchEvent("message.received")`. Automations fire identically regardless of channel.
- **Workflow engine** (`src/lib/crm/workflows/`): a workflow is a `crm_workflows` row holding an `@xyflow` graph JSONB + a trigger. Nodes are auto-registered by `registry.ts` from two folders — `nodes/builtin/` (channel-agnostic: send/condition/wait/AI/tag/http) and `nodes/apartcba/` (PMS-specific: create ticket, assign cleaning, etc.). `dispatcher.ts` matches events to workflows and enqueues `crm_workflow_runs`; `executor.ts` walks the graph, logs each step, and *suspends* runs on `wait_*` nodes (resumable). `validator.ts` checks graphs before save.
- **AI** (`src/lib/crm/ai/`): provider/model/key are per-org from `crm_ai_settings`; `factory.ts::getAIClientForOrg()` resolves the key from Vault. Used by the `ai_*` workflow nodes (reply / auto-tag / handoff / summarize) and Whisper transcription of voice notes. `usage.ts` enforces a monthly token budget.

Note: an older `messaging_*` table stack with the `/api/webhooks/meta/[channel]` route still exists but is **legacy** — the live CRM is the `crm_*` stack. Channel setup docs: `docs/CRM-SETUP-META.md`, `docs/CRM-SETUP-INSTAGRAM.md`.

**WhatsApp gateway.** `whatsapp-gateway/` is a separate always-on Node service (Railway) that holds the persistent WhatsApp Web socket for Baileys channels — Vercel functions are ephemeral and can't. The app calls it over HTTP (`POST /sessions/:channelId/connect|send`, bearer `WHATSAPP_GATEWAY_SECRET`); it posts inbound messages back to `/api/webhooks/baileys` with an HMAC signature. WhatsApp session credentials are persisted AES-256-GCM-encrypted in `crm_baileys_auth_state`. Run **1 replica only** — the socket is stateful. Full ops detail in `whatsapp-gateway/README.md`.

**Marketplace.** The public guest site. A "listing" is **not** a separate table — it is a `units` row with `marketplace_published = true` plus marketplace columns added by migration `016`. `searchListings()` / `getListingBySlug()` (`src/lib/actions/marketplace.ts`) are **cross-org aggregated** — no `organization_id` filter; the unit `slug` is globally unique. Booking flow: browse → `/u/[slug]` → server-recomputed quote → `/checkout/[unitId]` (needs guest session) → `submitCheckout` branches on `instant_book`: `true` inserts a confirmed `bookings` row; `false` inserts a `booking_requests` row that staff approve on `/dashboard/reservas-pendientes`. Pricing/availability logic is in `src/lib/marketplace/`.

**Channel manager & inbound email.** `/dashboard/channel-manager` manages iCal feeds (import + export) and OTA listing mappings. `ota_listings` (migration `023`) maps a `unit_id` to an external OTA id (Airbnb room id, Booking slug) — it doesn't sync anything, it's a deterministic lookup table. Inbound email: staff forward OTA confirmation emails to a per-org address `ota-<token>@<INBOUND_EMAIL_DOMAIN>`; Resend posts them to `/api/inbound/resend`; `src/lib/inbound/` parses them (airbnb/booking parsers), resolves the unit (deterministic via `ota_listings`, then fuzzy fallback), and inserts a `bookings` row directly (`status: "confirmada"`, `source: "airbnb"|"booking"`) — so the `bookings_no_overlap` constraint catches double-bookings. Note the asymmetry: inbound email creates `bookings`; the marketplace request path creates `booking_requests`.

**Solicitudes de canal — `pending` no es una reserva (migración `057`).** El feed iCal de Airbnb publica una **solicitud pendiente** con un VEVENT idéntico al de una reserva aceptada (`SUMMARY:Reserved` + código HM en la `DESCRIPTION`): por el feed solo es imposible distinguirlas. Proyectar todo llenaba el calendario de reservas fantasma que, al rechazarse la solicitud, seguían ocupando fechas hasta que una persona las cancelaba a mano (la `053` prohíbe que un proceso automático cancele una reserva).

- Una reserva externa nueva nace con `channel_reservations.external_status = 'pending'`: la fila existe y se ve, pero **no hay fila en `bookings`**. No ocupa calendario, no dispara limpiezas, no entra a KPIs ni liquidaciones, y no puede chocar con `bookings_no_overlap`.
- El único gate que escribe `bookings` sigue siendo `projectToBooking`; el corte está justo antes, en `processUpsert`, y mira el **estado de la fila**, nunca el transporte (una reserva ya confirmada que extiende fechas llega por iCal con el mismo UID y tiene que seguir pasando).
- Se promueve a `active` sólo con evidencia positiva, anotada en `promoted_source`: `email` (`ReservationEvent.confirmed`, que **sólo** setea `email-adapter.ts` en la rama `new_booking`), `email_backfill` (la confirmación había llegado antes que el iCal — pasa siempre: el mail gana la carrera por 3-5 min), `manual` (botón "Es una reserva") y `ttl` (sigue publicada pasadas 26 h, o 3 h si el check-in es en ≤2 días). **El TTL no es opcional**: medido sobre 40 días, 4 de 22 reservas reales de Airbnb nunca recibieron mail de confirmación.
- No usar `ev.transport === "email"` como discriminante de confirmación: `reprojectReservation()` fabrica un evento sintético con `transport: "email"` y lo disparan los botones "Reintentar"/"Asignar unidad" de una incidencia.
- Se descarta sola a `expired` cuando el VEVENT desaparece del feed, con los mismos umbrales de evidencia que el barrido de cancelaciones (3 lecturas / 30 min) y el mismo guard de feed vacío. No viola la `053`: no hay reserva que cancelar, y es reversible desde la UI. `expired_source` (migración `057c`) distingue el descarte automático (`feed`, revive si el VEVENT vuelve) de la decisión del operador (`manual`, no revive sola — mismo principio que `ignored`).
- Todo detrás de `channel_settings.config->'requests'` por **organización y canal** (`src/lib/channels/request-policy.ts`), default apagado y con cache de módulo de 60 s. Usar `readChannelRequestPolicies()` (devuelve `{policies, failed}`) en cualquier consumidor que ESCRIBA: tratar "no pude leer la política" como "apagada" hace que el dispatcher drene todas las solicitudes en vuelo a `bookings`.
- **Booking.com no tiene solicitudes** (sus reservas son instantáneas), así que el gate le aporta poco: sus reservas reales traen el aviso "¡Nueva reserva!" ~3 min *antes* que el iCal, así que nacen `active` sin pasar por `pending`. Lo que sí se arregló en la raíz es el ruido: un VEVENT de Booking de **más de 120 noches** entra como **cierre** (`isBlock`) y no como reserva (`ical-adapter.ts`). Son marcadores de ventana de disponibilidad que el feed regenera con UID nuevo cada día — en la unidad BRASIL generaban una reserva "confirmada" de 6 meses por día (31 en 20 días, ninguna con número) que había que cancelar a mano.
- `hold_availability` decide si la solicitud bloquea la venta en la **web propia**: `false` en Airbnb (una solicitud no es una venta; el dueño pidió que el calendario no se cierre hasta aceptarla), `true` en Booking (sus reservas son instantáneas). **No gobierna el iCal saliente**: hacia las otras OTAs se exporta siempre que la política esté encendida (`channelsExportedAsHolds`). Son dos decisiones con radio de daño distinto — "no cierro mi calendario" no puede significar "dejo de bloquear a Booking.com", que con 9 unidades conectadas a los dos canales termina en venta doble.

**Cron / background jobs — two schedulers, easy to confuse:**
- **Vercel Cron** (`vercel.json`) — only two jobs (Hobby-plan limit): `/api/cron/daily-dispatch` (03:00 UTC) and `/api/cron/parte-diario-draft` (23:00 UTC). `daily-dispatch` is a *consolidated* job — it runs iCal sync, payment reminders, daily workflow schedules, monthly AI-quota reset, check-in/out CRM events + auto-created cleaning tasks, WhatsApp template polling, and a Monday-only weekly archive. Authed by `CRON_SECRET`. The standalone `/api/cron/sync-ical` and `/api/cron/payment-reminders` routes still exist but are **not** Vercel-scheduled — their work is folded into `daily-dispatch`.
- **Supabase pg_cron** — drives the CRM. Jobs are defined at the bottom of `010_crm.sql` (apply manually in the SQL editor): a 5-min tick POSTs `/api/cron/from-pg` (the CRM runner — processes the outbox, resumes suspended runs, runs queued runs, fires sub-daily schedules, advances broadcasts), plus a 10-min `crm_close_idle_conversations()`. Authed by the `x-pg-cron-secret` header (`PG_CRON_SECRET`). Server actions also fire-and-forget `POST /api/cron/from-pg?immediate=1` for low-latency workflow runs.

The user-triggered "sync now" for iCal is the `src/lib/actions/ical.ts` action, which (unlike the cron) requires a session.

**next.config.ts.** `reactCompiler: true`. `serverActions.bodySizeLimit: "15mb"` — maintenance photos from phone cameras exceed the 1MB default and were being cut before reaching the action. `serverExternalPackages` keeps `jspdf`, `jspdf-autotable`, `ical.js`, `exceljs` out of the server bundle (Node-only / poorly tree-shaken). `optimizePackageImports` tree-shakes the `lucide-react` / `date-fns` / Radix barrels. `images.remotePatterns` allows `*.supabase.co`/`.in`; `images.qualities` whitelists `[75, 92]`. Caching headers force `no-store` on `/dashboard/*`, `/login`, and `/api/*` to keep PMS data live — don't add data-fetching to other routes assuming this; they may be cached.

**Domain shape.** The Postgres schema is the source of truth — ~30 migration files in `supabase/migrations/` (`001_apartcba_full_schema.sql` is the ~30-table base; later files add the CRM, marketplace, channel manager, inbound email, parte diario, settlements redesign, etc.), with matching TS types in `src/lib/types/database.ts` — keep them in sync when adding columns. Migrations are applied via the Supabase MCP / SQL editor; some (notably the pg_cron jobs in `010_crm.sql`) must be applied by hand. Notable invariants:
- `bookings` has an exclusion constraint `bookings_no_overlap` (uses `btree_gist`); on conflict, translate the Postgres error into Spanish copy (see `bookings.ts`). **All four booking sources — direct, marketplace, inbound-email, iCal — converge on `apartcba.bookings`**, so any write path can hit this constraint.
- `unit_owners` is N:M between units and owners with `ownership_pct` + `is_primary`.
- `cash_movements` is the financial ledger; `cash_transfers` joins two movements (debit + credit). Booking payments, owner settlements, and ticket charges all reference `cash_movements` by `cash_movement_id`.
- `owner_settlements` has `settlement_lines` (signed) summing to `net_payable`. PDF generation lives in `src/lib/pdf/settlement-pdf.ts`.
- CRM: `crm_conversations` auto-close after 24h idle; `crm_messages` are idempotent on `wa_message_id`; `crm_channels.phone_number_id` is globally unique (used for inbound webhook routing).

## Conventions worth knowing

- Path alias `@/*` → `src/*`. Components under `@/components/<domain>/`, shadcn primitives under `@/components/ui/`.
- `npm run dev` and `npm run start` both pin port **3001**. `NEXT_PUBLIC_APP_URL` should match.
- Zod schemas live alongside the action that uses them (top of each `src/lib/actions/*.ts`); use `z.coerce.number()` for form fields.
- After a write, `revalidatePath` every route that displays the affected entity. Forgetting this is the most common bug.
- When error messages from Postgres need to surface to the UI, translate constraint names (e.g. `bookings_no_overlap`, `bookings_dates_valid`) into Spanish before throwing — see `bookings.ts` for the canonical pattern.
- `createAdminClient()` bypasses RLS. **Never** call it from a client component or expose it through a non-`"use server"` module.
- Marketplace routes authenticate with `requireGuestSession()` (`src/lib/actions/guest-auth.ts`), not `requireSession()` — different identity layers (`guest_profiles` vs `user_profiles`) on the same `auth.users`.

## Región y timeouts (2026-08-30)

- Las funciones de Vercel corren en **`pdx1` (us-west-2)** porque la DB de Supabase vive ahí: cada hop REST desde `gru1` costaba ~210 ms de pura geografía. La regla es **co-localizar funciones y DB**, no "pdx1 siempre" — si Supabase se migra de región, mover `regions` en `vercel.json` en el mismo deploy. Con Fluid, `memory` NO se configura por función ni en `vercel.json` (solo genera un warning): es un setting de proyecto en el dashboard.
- Los tres factories de `src/lib/supabase/server.ts` pasan `global.fetch = fetchWithTimeout(...)` (`src/lib/supabase/fetch-with-timeout.ts`): un `AbortController` por request (NO `AbortSignal.timeout`, cuyo `TimeoutError` hace que postgrest-js reintente 3 veces) con tiers por path — auth 8 s, rest/rpc 10 s, storage 15 s, uploads 60 s — iguales en páginas, actions y crons. Al vencer, supabase-js devuelve `{ error }` (status 0), no lanza. El browser client (`client.ts`) NO tiene timeout. El JWKS de `jwks.ts` sí usa `AbortSignal.timeout(3000)` (ahí es inofensivo) y `src/proxy.ts` es fail-open: deadline de 5 s + try/catch, nunca se cuelga si Auth no responde.
- `src/app/dashboard/layout.tsx` y `src/app/m/layout.tsx` exportan `maxDuration = 60`: se hereda a todas las pages hijas y sus Server Actions (una page lo puede pisar con un valor mayor). Es un techo contra cuelgues, no un timeout funcional.
- El dispatcher de canales (`/api/cron/channel-dispatch`) loopea hasta agotar los links vencidos (o hasta ~40 s de presupuesto) y reclama con el RPC `channels_claim_due_links_v2` (migración `056`, trae la `feed_url` desencriptada; fallback automático al RPC viejo si responde PGRST202). pg_cron lo dispara **cada 2 minutos** (`*/2 * * * *`, aplicado el 2026-08-30 tras verificar el deploy; con el código viejo de un batch de 12 esa cadencia acumula backlog — si se hace rollback del dispatcher, volver el job a `* * * * *`). Detalle operativo y checklist de lentitud en `docs/OPERACIONES-PERF.md`.
