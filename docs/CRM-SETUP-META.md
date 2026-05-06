# Setup CRM — WhatsApp Cloud API (Meta)

Guía paso-a-paso para conectar tu número de WhatsApp Business al CRM de Apart-Cba.

## Pre-requisitos

- Cuenta Meta Business ya verificada (✅ ya tenés esto).
- Acceso a [Meta Business Manager](https://business.facebook.com).
- Un número de teléfono que NO esté usándose en WhatsApp regular ni en otra plataforma.
- URL pública de la app (Vercel preview o production). Local con `localhost` no funciona — Meta requiere HTTPS.

## 1. Crear App en Meta Developers

1. Andá a https://developers.facebook.com/apps/
2. **My Apps → Create App**
3. Tipo: **Business**
4. Nombre: e.g. `Apart Cba CRM`
5. Asociá la cuenta Meta Business existente.

## 2. Agregar producto WhatsApp

1. En el dashboard de la app: **Add Product → WhatsApp → Set up**
2. Te pide elegir o crear una WhatsApp Business Account (WABA). Creá nueva si no tenés.
3. Apuntá:
   - **WhatsApp Business Account ID** (WABA ID)
   - **App ID**
   - **App Secret** (en Settings → Basic → App secret → Show)

## 3. Configurar el número

1. WhatsApp → **API Setup**
2. **Add phone number** y verificalo via SMS o llamada.
3. Apuntá el **Phone Number ID** (lo usás como `phone_number_id`).
4. Llenale el "Display Name" (lo que ven los clientes en su WA).

Si vas a transferir un número que ya está en uso en WhatsApp regular, primero hacé `Migrate phone number to WhatsApp Business Platform`.

## 4. Crear System User (token permanente)

El "Test access token" expira en 24h — para producción necesitás un System User token permanente.

1. Andá a [Business Settings](https://business.facebook.com/settings)
2. **Users → System Users → Add**
3. Nombre: `apartcba-crm-system`
4. Rol: **Admin**
5. **Generate New Token** → seleccioná tu app → permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
6. **Token expiration: Never**.
7. Copiá el token (no lo verás de nuevo).

## 5. Configurar webhook

1. En el dashboard de la app: **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL**: `https://<tu-dominio>/api/webhooks/whatsapp`
   (en Vercel: `https://app-name.vercel.app/api/webhooks/whatsapp`)
3. **Verify token**: inventá un string seguro, ej. `apartcba-webhook-7d4f9a2b`. Guárdalo — lo cargás también en la app.
4. Click **Verify and Save**.

Si Meta dice que falla la verificación: chequeá que la URL sea HTTPS, que el endpoint responda 200 y que el verify token coincida.

## 6. Suscribir webhook a campos

En la misma sección de Webhook:

- **Subscribed apps → Manage**:
  - ✅ `messages`
  - ✅ `message_template_status_update`

## 7. Cargar credenciales en Apart-Cba

1. Login en Apart-Cba como admin.
2. Sidebar → **Configuración → CRM** (o `/dashboard/crm/config`).
3. Tab **Canales → Conectar canal**:
   - Nombre interno: `WhatsApp Apart-Cba` (lo que vos quieras)
   - Número (E.164): `+5493515551234`
   - Phone Number ID: del paso 3
   - WABA ID: del paso 2
   - App ID: del paso 2 (opcional)
   - **Permanent Access Token**: del paso 4 (System User)
   - **App Secret**: del paso 2
   - **Webhook Verify Token**: el mismo string del paso 5
4. Guardar.

Las credenciales se encriptan con **Supabase Vault** (AES-256-GCM). La app las desencripta on-demand vía RPC `service_role`. Plaintext nunca persiste fuera de Vault.

## 8. Probar

1. En la tab Canales, activá el switch del canal recién creado.
2. Mandá un WhatsApp desde tu celu personal al número de WA Business.
3. En **CRM → Inbox** debería aparecer la conversación en segundos (Realtime).
4. Respondé desde la app — el mensaje sale al instante via outbox.

## Variables de entorno

Configurar en Vercel (`vercel env add`) y en `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=https://app-name.vercel.app
CRON_SECRET=...                          # Vercel cron auth
PG_CRON_SECRET=...                       # pg_cron → /api/cron/from-pg
META_GRAPH_API_VERSION=v22.0
META_WEBHOOK_DEFAULT_TOKEN=...           # opcional, fallback verify
VERCEL_AI_GATEWAY_API_KEY=               # solo si chat_provider=vercel_gateway
```

Generar `PG_CRON_SECRET`: `openssl rand -hex 32`

## 9. Configurar pg_cron en Supabase

Una sola vez, desde el SQL Editor de Supabase como user `postgres`:

```sql
ALTER DATABASE postgres SET apartcba.app_url = 'https://app-name.vercel.app';
ALTER DATABASE postgres SET apartcba.pg_cron_secret = '<el mismo PG_CRON_SECRET del .env>';
```

Los jobs `crm-close-idle` (cada 10 min) y `crm-dispatch-subdaily` (cada 5 min) ya quedaron creados por la migración 010. Verificalo:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'crm-%';
```

## 10. Templates (mensajes proactivos)

WhatsApp prohíbe mensajes free-form fuera de la ventana 24h del último mensaje del cliente. Para mandar un recordatorio de check-in (24h antes), debés usar un **template aprobado por Meta**.

1. **CRM → Configuración → Templates → Nuevo template**:
   - Nombre snake_case: e.g. `checkin_recordatorio`
   - Idioma: `es_AR`
   - Categoría: `UTILITY`
   - Cuerpo: `Hola {{1}}, te recordamos tu check-in en {{2}} mañana a las {{3}} hs. ¡Te esperamos!`
   - Footer: `Apart Cba`
2. Click **Crear (draft)**.
3. Click **Enviar** — submit a Meta para aprobación.
4. Meta tarda 1 minuto a 24h para aprobar/rechazar (workflow `daily-dispatch` polea status; podés refrescar manual con **Refrescar status**).
5. Una vez **APPROVED**, el template está disponible en el nodo workflow `Enviar template`.

## Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| `verify_failed` al guardar webhook | Verify token no coincide | Asegurate que el string en Meta y en CRM Config sean idénticos |
| No llegan mensajes inbound | Webhook no suscripto a `messages` | Meta dashboard → Webhook → Subscribe → messages |
| Mensajes salientes fallan con `131000` | Rate limit | El outbox reintenta con backoff exponencial (30s, 2min, 8min, 30min, 2h) |
| Mensajes fallan con `131009` | Recipient phone not opted in / fuera 24h | Usar template aprobado |
| Audio no se transcribe | OpenAI key no cargada | CRM Config → IA → API Key OpenAI Whisper |
| `signature mismatch` en webhook | App Secret incorrecto en CRM | Re-cargar app secret en Channels |

## Limites Meta a tener en cuenta

- **Rate limit**: 250 msg/seg/número (Business Initiated). El outbox los procesa en lotes de 50.
- **Sesión 24h**: pasada esa ventana del último mensaje del cliente, solo se pueden enviar templates APPROVED.
- **Tamaño media**: imágenes hasta 5MB, video 16MB, audio 16MB, documentos 100MB. Bucket Storage configurado a 25MB max.

## Soporte

- Documentación Meta: https://developers.facebook.com/docs/whatsapp/cloud-api
- Templates docs: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
