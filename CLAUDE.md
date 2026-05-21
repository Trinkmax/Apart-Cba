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
