# Operaciones: región, timeouts y costo de cómputo

Última revisión: 2026-08-30 (a partir del incidente del 2026-08-29 22:00–00:00 UTC).

## 1. Topología

```
Usuario (Argentina)
   │  ~50 ms hasta el PoP gru1 de Vercel (CDN / static / ISR)
   │  ~200-230 ms hasta pdx1 (funciones dinámicas)
   ▼
Vercel Functions ─── región pdx1 (us-west-2, Portland)
   │  ~15-25 ms por request REST/RPC/Auth/Storage
   ▼
Supabase ─── proyecto fknzpkgazxoezexctcwz, us-west-2 (Oregon)
   Postgres 17.6 · max_connections=60 · shared_buffers=224 MB (instancia chica)
   API host vía Cloudflare (104.18.x / 172.64.x) → origen en Oregon
```

Cómo se verificó dónde vive Supabase (tres fuentes independientes):

- `dig AAAA db.fknzpkgazxoezexctcwz.supabase.co` → `2600:1f13:838:6e10::/64`.
- `ip-ranges.amazonaws.com` ubica `2600:1f13::/36` en **us-west-2**.
- `select inet_server_addr()` en el propio Postgres devuelve esa misma IPv6 (es la DB, no un proxy).

Lo que NO pasa por las funciones de Vercel (y por lo tanto la región no afecta):

- Realtime (WebSocket browser → Supabase directo).
- Imágenes (`render/image` de Supabase, loader custom; no se usa el optimizador de Vercel).
- Rutas ISR/estáticas servidas por el CDN (`/rentos`, assets).

## 2. Por qué pdx1 y no gru1

Hasta el 2026-08-30 `vercel.json` fijaba `regions: ["gru1"]` (São Paulo). Medido en los
`edge_logs` de Supabase para las requests que venían de las funciones (colo GRU, IP de
AWS sa-east-1): **69.5k requests/día con `origin_time` p50 = 211 ms, mínimo 178 ms**, para
cualquier path — un `HEAD` de conteo, un RPC de sesión, un `PATCH` de una fila. La DB
responde en milisegundos de un dígito; el resto es geografía GRU ↔ Oregon.

Consecuencias de esa distancia:

- Una página como `/dashboard/unidades/kanban` encadena 3 hops secuenciales (RPC de sesión →
  layout → page): ~630 ms de espera pura de red antes de renderizar.
- `/api/cron/channel-dispatch` hace 4 hops secuenciales por link (secret → iCal → GET
  reservations → PATCH link): ~0,84 s por link solo de red.
- El proxy (`src/proxy.ts`) en Next 16 es Node obligatorio y se despliega como función
  Fluid: cada refresh de token contra `/auth/v1/token` pagaba 230 ms.

Con las funciones en **pdx1** (us-west-2, la misma región AWS que la DB) cada hop pasa a
~15-25 ms. Expectativa realista, no "8x":

| Camino | Antes (gru1) | Después (pdx1) |
|---|---|---|
| Página con 3 hops (kanban), TTFB visto desde AR | ~0,85 s | ~0,45 s (≈2x) |
| Página/action de 1 hop | ~280 ms | ~250 ms (neutro) |
| Crons y webhooks (sin usuario en el medio) | 4 hops ≈ 0,84 s | ≈ 0,08 s (≈8-10x) |
| Salto usuario → función | ~50 ms | ~200-230 ms (**peor**) |

Es un trade-off: las navegaciones client-side y las Server Actions simples tienen un piso
~150 ms más alto; las páginas con varias queries y todo lo que corre sin usuario mejoran
mucho. Además pdx1 es más barato: $0.0106/GB-h vs $0.0183 en gru1 (−42 %), Active CPU
$0.128 vs $0.221 por CPU-h, Fast Origin Transfer $0.06 vs $0.41 por GB.

**Regla:** co-localizar funciones y DB. Si en el futuro el proyecto de Supabase se migra
(por ejemplo a sa-east-1 para acercarlo a los usuarios), hay que mover `regions` a `gru1`
en el mismo deploy.

Cosas que **no** hacer en `vercel.json`:

- `functions[*].memory`: con Fluid la memoria es un setting de **proyecto** (Standard 2 GB /
  1 vCPU o Performance 4 GB / 2 vCPU, en Settings → Functions → Advanced). En `vercel.json`
  solo genera un warning de build y no cambia nada.
- `functionFailoverRegions`: Enterprise only.
- Varias regiones: `vercel.json` pisa al dashboard; conviene que en Settings → Functions
  quede tildada solo pdx1 para no confundir.

## 3. Timeouts (capas, de adentro hacia afuera)

Antes del 2026-08-30 la app no tenía **ningún** timeout hacia Supabase. Cuando Supabase se
degradó (ver §5) las funciones quedaron colgadas esperando: `channel-dispatch` 30-65 s,
el kanban, y el proxy (`_middleware`) — que al colgarse devolvía 500 a todo `/dashboard`,
`/m`, `/superadmin`, `/mi-cuenta` y `/checkout`.

1. **Fetch a Supabase con timeout por request** — los tres factories de
   `src/lib/supabase/server.ts` pasan `global: { fetch: fetchWithTimeout(pickSupabaseTimeout) }`
   (`src/lib/supabase/fetch-with-timeout.ts`). Por cada request crea un `AbortController`
   + `setTimeout` → `abort()` sin reason (`AbortError`): NO usa `AbortSignal.timeout`,
   porque su `TimeoutError` no es reconocido por postgrest-js como abort y dispara 3
   reintentos con 7 s de sleeps. Tiers por path: auth 8 s, rest/rpc 10 s, storage 15 s,
   escrituras a storage 60 s — los mismos en páginas, actions y crons. Al vencer supabase-js
   **no lanza**: `from()/rpc()` devuelven `{ error }` con status 0 y mensaje `AbortError…`
   (todavía en inglés; traducirlo es un follow-up), storage `StorageUnknownError`, auth
   `AuthRetryableFetchError` (no borra la sesión). El browser client (`client.ts`) y los
   fetch a Meta/OpenAI/Resend NO están cubiertos (follow-up). **Esta es la capa que
   realmente acota el cuelgue**; las otras son contención.
2. **JWKS** — `src/lib/supabase/jwks.ts` hace el fetch con `AbortSignal.timeout(3000)`. Como
   ya tiene stale-while-error, un timeout devuelve el JWKS anterior en vez de colgar.
3. **Proxy** — `src/proxy.ts` usa el mismo fetch con tier auth de 3 s, envuelve
   `getClaims()` (JWKS incluido) en un deadline de 5 s (`withDeadline`) + try/catch y devuelve
   la respuesta igual (fail-open). El deadline hace falta además del timeout por request:
   con el access token vencido, auth-js reintenta el refresh con backoff durante ~30 s ante
   errores retryable. Los layouts siguen gateando con `requireSession()` /
   `requireGuestSession()` (ojo: `sessionContextLoader` todavía no tiene su propio deadline
   — con token vencido y Supabase caído puede tardar ~25 s antes de redirigir a `/login`;
   el `maxDuration = 60` del layout es el techo).
4. **`maxDuration` en layouts** — `src/app/dashboard/layout.tsx` y `src/app/m/layout.tsx`
   exportan `maxDuration = 60`. En Next 16 la config de segmento se resuelve root → hoja con
   last-wins, así que aplica a todas las pages hijas **y a sus Server Actions**; una page
   puede pisarlo exportando un valor mayor. Convierte un cuelgue de 300 s (default Fluid Pro)
   en un 504 a los 60 s: no evita el error, evita facturar 5 minutos por instancia. No bajar
   de 60: bajo `/dashboard` hay actions legítimamente largas (PDF de liquidación con jspdf
   dentro de la action, `purgeTrialDemoData`, fotos de mantenimiento de hasta 15 MB hacia
   Storage).
5. **`maxDuration` en route handlers** — cada `/api/*` lo exporta y `vercel.json` lo
   duplica con el mismo valor (crons 60-300 s, webhooks 30-60 s). Mantener ambos en sync.

Del lado de los que nos llaman: el gateway de WhatsApp usa `AbortSignal.timeout(15_000)` con
reintentos, y pg_cron dispara los crons con `net.http_post` timeout 10 s desde us-west-2
(más cerca de pdx1 que de gru1).

## 4. Cómo factura Fluid compute

- **Provisioned Memory (GB-h)** se cobra por el **wall-clock del instance**, desde que
  arranca hasta que termina la última request en vuelo — **incluido el tiempo esperando
  I/O**. Una función que espera 60 s a Supabase paga 60 s de memoria aunque no haga nada.
  Es la línea dominante de la factura de este proyecto (71 GB-h en el ciclo 20/8→30/8).
- **Active CPU** se pausa durante I/O: solo cuenta el tiempo en que la función ejecuta JS.
- **Invocations**, **Fast Origin Transfer** y **Observability Events** son marginales acá.

Palancas reales sobre Provisioned Memory, en orden de impacto:

1. Menos wall-time por instancia: región co-localizada, timeouts, menos hops secuenciales.
2. Menos frecuencia/duración de los crons — `channel-dispatch` era ~70 % del costo Fluid
   (corría cada minuto, p50 4,7 s, p95 9-25 s, 2-3 h/día de función). Ahora loopea hasta
   agotar los links vencidos (presupuesto 40 s) y reclama con `channels_claim_due_links_v2`
   (migración `056`, feed_url incluida). pg_cron lo dispara cada 2 minutos (`*/2 * * * *`,
   aplicado el 2026-08-30 después de verificar corridas nuevas con `claim_rpc = v2`,
   1-3 s y `finished_at` seteado). Si se hace rollback del dispatcher al código de un
   batch de 12 por corrida, volver el job a `* * * * *` (ver SQL al final de la 056).
3. Tarifa regional (pdx1 −42 % vs gru1).

Lo que **no** es una palanca: `memory` por función (no existe con Fluid).

## 5. Incidente de referencia (2026-08-29 22:00–00:00 UTC)

Supabase entero se degradó sin 5xx: `origin_time` promedio 4-6 s con máximos de ~298 s;
`/auth/v1/.well-known/jwks.json` promedio 36-113 s; `/auth/v1/token` 23 s; Storage 1,5 s.
**Postgres no estaba lento** (los jobs SQL de pg_cron seguían en ~300 ms; `max_exec_time`
del dispatcher < 1 s). Fue la capa de API/Auth, no la DB. Del lado de Vercel las funciones
quedaron colgadas y el ciclo de facturación mostró un pico de GB-h.

Lección: sin timeouts, un incidente de Supabase se convierte en un incidente de costo y de
disponibilidad propio (el proxy sin try/catch tiraba 500 en toda la app).

## 6. Checklist: "qué mirar" si vuelve la lentitud

Preguntar primero **dónde** está el tiempo. En orden:

1. **¿Es la red o es Supabase?** — Supabase Studio → Logs → **Edge logs**, filtrar
   `/rest/v1/*` y mirar `response.origin_time` agrupado por colo:
   - p50 < ~40 ms desde las funciones (colo PDX/SEA, asOrganization "Amazon.com, Inc."):
     normal post-región.
   - p50 ~200 ms: las funciones no están en pdx1 (verificar `x-vercel-id` en un `curl -sI`
     a prod: debe ser `gru1::pdx1::…`, PoP gru1 + función pdx1).
   - p50 de segundos o máximos de minutos para cualquier path: degradación de Supabase
     (API/Auth), como el 2026-08-29. Chequear status.supabase.com.
2. **¿Es Postgres?** — `pg_stat_statements` (`mean_exec_time`, `max_exec_time`) y los
   **Postgres logs**. Si las queries siguen en ms y `origin_time` es alto, no es la DB.
   Recordar los límites de la instancia: `max_connections=60` — el dispatcher reclama
   ~12 conexiones por corrida; un pico de conexiones se ve como "lento" sin que la DB
   esté ocupada.
3. **Auth / JWKS** — en Edge logs filtrar `/auth/v1/.well-known/jwks.json` y
   `/auth/v1/token`. Si el JWKS tarda, el proxy tiene stale-while-error + timeout de 3 s,
   pero un token vencido igual necesita `/auth/v1/token`. Un JWKS lento se manifiesta
   como logins/refresh lentos, no como queries lentas.
4. **Dispatcher de canales** — `select started_at, duration_ms, links_claimed, …
   from apartcba.channel_sync_runs order by started_at desc limit 50`. `duration_ms` p50
   esperado ~1,5-2,5 s (era 4,7 s en gru1). Si sube: mirar qué feed iCal está tardando
   (timeout 10 s por fetch) más que la DB. Ojo: la tabla crece 1 fila por corrida y no se
   purga sola; si supera decenas de miles de filas conviene un `delete` de las viejas.
5. **PostgREST logs** — `Warp server error: Thread killed by timeout manager` (~2k/día) es
   ruido benigno de keep-alive. Lo que sí cuesta son las recargas del schema cache
   ("Creating partitions for realtime.messages", ~26/día, ~1,4 s de catálogo cada una): si
   se disparan, hay DDL corriendo (Realtime reinicializando el tenant o migraciones).
6. **Realtime** — `invalid column for filter organization_id` en los Postgres logs son
   canales que se unen con la anon key sin sesión (anon no tiene grants en `apartcba.*`);
   no afectan latencia REST pero indican que el manager está reintentando sin auth.
7. **Vercel** — Observability → Functions: duración p50/p95 por ruta y GB-h. Un salto de
   GB-h sin salto de invocaciones = funciones colgadas esperando (mirar los puntos 1 y 3).
   `_middleware` con duraciones de decenas de segundos = el proxy esperando a Auth.

Mediciones de aceptación después de un cambio de región o de timeouts:

- `curl -sI https://www.apartcba.com/buscar` → `x-vercel-id: gru1::pdx1::…`.
- Edge logs: `origin_time` p50 de `/rest/v1/*` desde las funciones < 40 ms.
- Kanban con la misma cuenta antes/después: ~0,85 s → ~0,45 s de TTFB.
- `channel_sync_runs.duration_ms` p50: 4,7 s → ~1,5-2,5 s.
- Loguear `process.env.VERCEL_REGION` desde `src/proxy.ts` en el primer deploy para confirmar
  que el proxy también corre en pdx1 (la doc no lo dice con esas palabras; el incidente sí
  mostró `_middleware` como función colgada).
