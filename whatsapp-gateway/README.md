# rentOS WhatsApp Gateway (Baileys)

Always-on microservice that holds the **persistent WhatsApp Web socket** for
each rentOS organization. It exists because **Vercel cannot run this**: Baileys
keeps a WebSocket open 24/7 and Vercel functions are ephemeral (max 300 s,
spun down). Deployed on **Railway**.

```
rentOS (Next.js on Vercel)                 WhatsApp Gateway (Railway)            WhatsApp
 ─ Configuración → Conectar ───POST /connect──────────────▶ open socket ─────────▶ QR / pairing
 ─ outbox / automations ───────POST /send────────────────▶ humanized send ───────▶ guest
 ◀── /api/webhooks/baileys ◀── HMAC-signed events ───────── inbound / status ◀──── guest
                          (same pipeline as Meta → workflows fire identically)
 crm_baileys_sessions ◀──────── status/QR (service role) ── single writer ─ Supabase Realtime → UI
```

## Why it's safe-ish (and the ToS caveat)

Baileys is an **unofficial** reverse-engineered WhatsApp Web client. There is a
real risk WhatsApp **bans the number**, especially with automated/bulk sends.
Mitigations built in: `markOnlineOnConnect:false`, per-number min gap +
randomized jitter, `composing` presence before send, serialized send queue,
1:1 only (groups/broadcast/newsletter ignored), capped reconnect backoff.
Operational advice: **use a dedicated number**, warm it up gradually, never
cold-blast. The official Meta Cloud API path remains available per-org for orgs
that need ToS compliance.

## Deploy to Railway

1. Push this repo. In Railway: **New Project → Deploy from repo**, set the
   **root directory** to `whatsapp-gateway/` (it has its own Dockerfile).
2. Set variables (see `.env.example`):
   - `GATEWAY_SECRET` — `openssl rand -hex 32`. Must equal the app's
     `WHATSAPP_GATEWAY_SECRET`.
   - `BAILEYS_STATE_ENC_KEY` — `openssl rand -hex 32`. **Back this up.** Losing
     it forces every org to re-scan the QR.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — same project as the app.
   - `APP_WEBHOOK_URL` — `https://<app-domain>/api/webhooks/baileys`.
3. Railway gives the service a public URL. Put it in the app env as
   `WHATSAPP_GATEWAY_URL` (no trailing slash).
4. Healthcheck path is `/health` (already in `railway.json`). Keep
   **1 replica** — sessions are stateful in-process (state is durable in
   Postgres, but two replicas would both try to own the same socket).

## Local dev

```bash
cd whatsapp-gateway
cp .env.example .env   # fill values
npm install
npm run dev            # tsx watch
npm run typecheck
```

## HTTP API (all except /health require `Authorization: Bearer $GATEWAY_SECRET`)

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET  | `/health` | — | Railway healthcheck |
| POST | `/sessions/:channelId/connect` | `{ organizationId, pairingPhone? }` | Open socket. With `pairingPhone` uses pairing-code instead of QR |
| GET  | `/sessions/:channelId/status` | — | Current status + QR/pairing |
| POST | `/sessions/:channelId/send` | `{ organizationId, toPhone, body }` | Send (called by the app outbox) |
| POST | `/sessions/:channelId/read` | `{ remoteJid, messageId }` | Best-effort read receipt |
| POST | `/sessions/:channelId/logout` | — | Unlink + wipe durable state |

`channelId` is the `crm_channels.id` of that org's `provider='baileys'` channel.

## Durability

The Baileys keystore (creds + signal keys) is persisted **encrypted
(AES-256-GCM)** in `apartcba.crm_baileys_auth_state`, RLS-locked to
`service_role`. A Railway redeploy/crash calls `recoverAll()` on boot and
silently resumes every previously-online session — **no QR re-scan**.
