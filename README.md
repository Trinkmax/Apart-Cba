# Apart Cba

Sistema de gestión para departamentos temporales (PMS).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Supabase (Postgres + Auth + Realtime + Storage)
- @dnd-kit + pointer events para Kanban y Grid PMS arrastrables
- React Compiler activado

## Desarrollo local

```bash
npm install
cp .env.local.example .env.local   # completar con credenciales reales
npm run dev                         # http://localhost:3001
```

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Clave `anon` (pública, se bundlea) |
| `SUPABASE_SERVICE_ROLE_KEY` | solo server | Clave `service_role` (bypasea RLS) |
| `NEXT_PUBLIC_APP_URL` | client + server | URL pública (ej. `https://apartcba.vercel.app`) |

⚠️ **Nunca** pegar la `service_role` en un slot `NEXT_PUBLIC_*`: quedaría expuesta en el navegador.

## Deploy a Vercel

El repo ya trae `vercel.json` configurado (región GRU São Paulo, cron diario para sync de iCal, timeout de 5 min en la función de cron).

### Primera vez

```bash
# 1. Link al proyecto de Vercel (interactivo)
npx vercel link

# 2. Subir las env vars de producción
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add NEXT_PUBLIC_APP_URL production   # https://<tu-dominio>

# 3. Deploy de producción
npx vercel --prod
```

### Deploys siguientes

Basta con `git push` a la branch configurada como Production — Vercel construye y despliega automáticamente. Para previews, cualquier otra branch o PR genera una URL temporal.

### Cron de sincronización iCal

`/api/cron/sync-ical` corre **1×/día a las 03:00 UTC** (config en `vercel.json`). En plan Hobby de Vercel no se permiten frecuencias sub-diarias. Para subir a hourly, upgrade a Pro y editar el schedule a `"0 * * * *"`.

## Schema de la base

Las tablas viven en el schema `apartcba` del proyecto Supabase. El cliente server/admin de Supabase ya está configurado con `db: { schema: 'apartcba' }`, así que las queries apuntan ahí por defecto.

Migraciones en `supabase/migrations/`. El seed de demo (5 owners, 14 unidades, 40 huéspedes, 57 reservas, etc.) se carga vía el MCP de Supabase — ver `supabase/` para el SQL.

## Comandos útiles

```bash
npm run build     # build de producción
npm run lint      # ESLint
npx tsc --noEmit  # typecheck
```
