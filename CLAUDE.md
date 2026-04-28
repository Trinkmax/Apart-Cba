# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 + shadcn/ui (style "new-york", `@/components/ui`) · Supabase (Postgres + Auth) · `@dnd-kit` for the PMS Grid / Kanban · React Compiler enabled (`reactCompiler: true` in `next.config.ts`).

## Commands

```bash
npm run dev        # next dev on port 3001 (NOT 3000)
npm run build
npm run lint
npx tsc --noEmit   # typecheck
```

There is no test runner configured. Don't claim tests pass — run `tsc --noEmit` and `lint` instead.

## Required environment

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`. The `service_role` key must never be placed in a `NEXT_PUBLIC_*` slot — it would be bundled to the browser.

## Big-picture architecture

**Multi-tenant on a shared schema.** All Apart Cba tables live in the Postgres schema `apartcba` (not `public` — the same Supabase project hosts another product, "TextOS", in `public`). Both Supabase clients in `src/lib/supabase/` are pinned with `db: { schema: "apartcba" }`, so calls like `admin.from("bookings")` resolve to `apartcba.bookings` automatically. Every tenant-scoped table has `organization_id`; access is filtered by `.eq("organization_id", organization.id)` in server actions.

**Three Supabase client factories** (`src/lib/supabase/`):
- `createClient()` (server.ts) — SSR cookie-bound, uses anon key. Used for `auth.getUser()` and other auth-flow calls.
- `createAdminClient()` — service_role, pinned to `apartcba` schema. Used for **all data reads and mutations** in server actions; org scoping is enforced in code, not by RLS.
- `createAuthAdminClient()` — service_role without schema pin, for cross-schema admin ops (e.g. inviting users via the Supabase Auth Admin API).

There is also a browser `createClient()` in `src/lib/supabase/client.ts` (anon, schema-pinned) — used sparingly for realtime / read-only browser fetches.

RLS policies exist (see `supabase/migrations/001_apartcba_full_schema.sql`), but because server actions use the service role, **the de-facto security boundary is the action layer, not the database**. Always preserve `requireSession()` + `getCurrentOrg()` + an explicit `organization_id` filter in any new query.

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
- `getSession()` returns `{ userId, profile, memberships }` joining `user_profiles` and `organization_members + organization` in two parallel queries (avoid N+1).
- `getCurrentOrg()` reads the `apartcba_org` cookie to pick which membership is active; falls back to the first active membership. A user can belong to multiple orgs and switch via `setCurrentOrg(orgId)`.
- A user with **no memberships** and `is_superadmin=false` is redirected to `/sin-acceso`. Superadmins land on `/superadmin`.

**Permissions** (`src/lib/permissions.ts` + `DEFAULT_ROLE_PERMISSIONS` in `src/lib/constants.ts`): roles are `admin | recepcion | mantenimiento | limpieza | owner_view`. Use `can(role, resource, action)` to gate UI (see `app-sidebar.tsx` for the pattern — sidebar items disappear for roles that lack `view` on that resource). Server actions don't currently re-check `can()`; they only enforce session + org scope, so **adding sensitive actions means adding a `can()` check inside the action**, not just hiding the button.

**Three route audiences:**
- `/dashboard/*` — desktop PMS. Sidebar layout (`src/app/dashboard/layout.tsx`).
- `/m/*` — mobile-first views for ops staff (cleaning, maintenance, concierge). Bottom-tab nav, items filtered by role (`src/app/m/layout.tsx`).
- `/superadmin/*` — cross-org admin (creates orgs, invites users). Gated on `profile.is_superadmin`.

UI is in **Spanish (es-AR)**: routes (`reservas`, `huéspedes`, `propietarios`, `conserjería`, `caja`, `liquidaciones`, `unidades`, `mantenimiento`, `limpieza`, `inventario`), enum labels, and copy. Keep new strings in Spanish to match.

**iCal sync.** `/api/cron/sync-ical/route.ts` is the **only** route hit by Vercel Cron (`vercel.json`, daily 03:00 UTC, `maxDuration: 300`). It bypasses session/org context (cron has no user) and iterates all active feeds across all orgs using `createAdminClient`. Sub-daily frequency requires Vercel Pro. The `src/lib/actions/ical.ts` action is the user-triggered ("sync now") variant, which **does** require session.

**Caching headers** (`next.config.ts`): `/dashboard/*`, `/login`, and `/api/*` are forced `no-store` to keep PMS data live. Don't add data-fetching to other routes assuming this — they may be cached.

**Domain shape.** The Postgres schema (~30 tables in `001_apartcba_full_schema.sql`, plus `002_inventory_movements.sql`) and matching TS types in `src/lib/types/database.ts` are the source of truth — keep them in sync when adding columns. Notable invariants:
- `bookings` has an exclusion constraint `bookings_no_overlap` (uses `btree_gist`); on conflict, `createBooking`/`moveBooking` translate the Postgres error into Spanish copy. Re-use this translation pattern for any new booking write.
- `unit_owners` is N:M between units and owners with `ownership_pct` + `is_primary`.
- `cash_movements` is the financial ledger; `cash_transfers` joins two movements (debit + credit). Booking payments, owner settlements, and ticket charges all reference `cash_movements` by `cash_movement_id`.
- `owner_settlements` has `settlement_lines` (signed) summing to `net_payable`. PDF generation lives in `src/lib/pdf/settlement-pdf.ts`.

## Conventions worth knowing

- Path alias `@/*` → `src/*`. Components under `@/components/<domain>/`, shadcn primitives under `@/components/ui/`.
- `npm run dev` and `npm run start` both pin port **3001**. `NEXT_PUBLIC_APP_URL` should match.
- Zod schemas live alongside the action that uses them (top of each `src/lib/actions/*.ts`); use `z.coerce.number()` for form fields.
- After a write, `revalidatePath` every route that displays the affected entity. Forgetting this is the most common bug.
- When error messages from Postgres need to surface to the UI, translate constraint names (e.g. `bookings_no_overlap`, `bookings_dates_valid`) into Spanish before throwing — see `bookings.ts` for the canonical pattern.
- `createAdminClient()` bypasses RLS. **Never** call it from a client component or expose it through a non-`"use server"` module.
