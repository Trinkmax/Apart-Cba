# Setup CRM — Instagram Direct Messaging

Guía paso-a-paso para conectar tu cuenta de Instagram Business al CRM de Apart-Cba.

## Pre-requisitos

- Cuenta **Instagram Business** o **Creator** (no funciona con cuentas personales).
- Cuenta de **Facebook Page** asociada a tu IG Business (Meta Business Manager).
- App de Meta creada (la misma que usás para WhatsApp sirve, o creá una nueva).
- URL pública HTTPS de la app (Vercel preview o production).

## 1. Conectar Instagram a la Page de Facebook

1. Andá a https://www.facebook.com/business/help/connect-instagram-to-page
2. Tu IG Business debe estar conectada a una FB Page. Si no lo está, conectála desde la app de Instagram → Configuración → Cuenta → Configuración de cuenta empresarial → Conectar página de Facebook.

## 2. App de Meta — agregar producto Messenger

1. Andá a https://developers.facebook.com/apps/
2. Abrí tu app (o creá una **Business** type).
3. **Add Product → Messenger → Set up**.
4. En la sección **Instagram Settings**, click **Add or Remove Pages** → seleccioná tu Page con IG conectada.
5. Click **Generate Token**. Copiá el **Page Access Token** (lo cargás en el CRM).
   - Para producción extendé el token a "long-lived" (no expira) con:
     ```
     curl -i -X GET "https://graph.facebook.com/v22.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<SHORT_LIVED_TOKEN>"
     ```

## 3. Permisos requeridos

En Meta App → **App Review → Permissions and Features**, solicitá:
- `instagram_basic`
- `instagram_manage_messages`
- `pages_messaging`
- `pages_manage_metadata`

Para testing inicial podés usar la app en **Development Mode** sin review (solo testers/admins reciben mensajes).

## 4. Configurar Webhook

En Meta App → **Webhooks**:

1. **Add Subscription** → seleccioná **Instagram**.
2. **Callback URL**: `https://<tu-dominio>/api/webhooks/whatsapp` (sí, el mismo endpoint sirve para ambos — el handler diferencia por `object` field).
3. **Verify Token**: el mismo string que cargás en CRM Config (puede ser distinto al de WA).
4. Subscribed fields:
   - ✅ `messages`
   - ✅ `messaging_postbacks`
   - ✅ `messaging_seen` (delivery / read receipts)

5. **Verify and Save**.

Luego en **Instagram Settings → Webhooks** subscribí la Page específica.

## 5. Obtener IG Business Account ID

```bash
curl -X GET "https://graph.facebook.com/v22.0/me/accounts?access_token=<PAGE_ACCESS_TOKEN>"
```

Te devuelve un array de pages. Por cada page que tenga IG conectada:

```bash
curl -X GET "https://graph.facebook.com/v22.0/<PAGE_ID>?fields=instagram_business_account&access_token=<PAGE_ACCESS_TOKEN>"
```

Anotá:
- `instagram_business_account.id` — Lo cargás como **Instagram Business Account ID**.
- El **Page ID** del paso anterior — Lo cargás como **Page ID**.

## 6. Cargar credenciales en Apart-Cba

1. Login como admin → **Configuración → CRM**.
2. Tab **Canales → Conectar canal**.
3. **Plataforma**: Instagram DM.
4. Llenar:
   - Nombre interno: `Instagram @apartcba`
   - Instagram Business Account ID: del paso 5
   - Page ID: del paso 5
   - Username IG: `apartcba` (sin `@`)
   - **Page Access Token (long-lived)**: del paso 2
   - **App Secret**: de la app Meta (Settings → Basic)
   - **Webhook Verify Token**: el mismo del paso 4
5. Guardar.

## 7. Probar

1. Activá el switch del canal.
2. Click **Probar** → debería responder `IG @apartcba · X followers`.
3. Mandá un DM desde otra cuenta IG a `@apartcba`.
4. En **CRM → Inbox** debería aparecer la conversación con badge IG (gradiente rosa/naranja).
5. Respondé desde la app — sale via Messenger Send API.

## Diferencias funcionales vs WhatsApp

| Feature | WhatsApp Cloud | Instagram DM |
|---|---|---|
| Identificador del usuario | Phone E.164 | IGSID (Instagram-scoped User ID) |
| Templates aprobados | ✅ Sí (necesarios fuera 24h) | ❌ No usa templates |
| Mensajes proactivos | ✅ Con template aprobado | ❌ Solo dentro 24h, o tag `HUMAN_AGENT` |
| Multimedia | imágenes, audio, video, doc, location, sticker, contacts | imágenes, audio, video, doc, sticker, ig_reel, story_reply, story_mention |
| Botones interactivos | hasta 3 reply buttons | hasta 13 quick replies (texto) |
| Listas | secciones múltiples | fallback a quick replies |
| Audiencia broadcasts | guests/owners/phones list | solo conversaciones IG existentes con actividad <24h |
| Read receipts | sí | sí |
| Identidades duplicadas | guests/owners auto-link por phone | guests/owners NO se auto-linkean (no tienen IGSID guardado) |

## Casos de uso típicos

1. **Lead qualification IG → WhatsApp**:
   - Workflow: trigger `message_received` con `fromKind: lead` → IA pide número de teléfono → cuando responde con phone, auto-link a `guests` table → próxima vez podés mandar templates por WA.

2. **Auto-respuesta a story mention**:
   - Workflow: trigger `message_received` con filtro `type: story_mention` → enviar gracias + agregar tag `lead`.

3. **Reseña post-checkout en IG**:
   - Workflow: trigger `pms_event` `booking.checkout_today` + condición `contact.external_kind == "igsid"` → wait 2h → enviar pedido de reseña directo (dentro 24h del último msg).

## Limitaciones conocidas

- **24h window**: si pasaron más de 24h del último mensaje del usuario, no podés mandar nada free-form. Meta IG no soporta templates como WA. La única salida es:
  1. Tag `HUMAN_AGENT`: válido para re-engagement humano (no automatizado), expira 7 días.
  2. Esperar a que el usuario escriba primero.
- **No hay auto-link a guests por defecto**: IG users vienen sin phone. Para asociarlos a un `guest`, usá nodo `pms_link_to_booking` con strategy manual o pedile el teléfono primero.
- **Mensajes de stories**: cuando alguien menciona tu @cuenta en una story, llega como `story_mention` con la URL del story en `mediaUrl` (expira ~24h en IG).
- **Rate limit**: 100 mensajes/segundo/page. El outbox los procesa en lotes de 50 con backoff.

## Variables de entorno (idéntico a WA)

Las mismas que tenés:

```bash
META_GRAPH_API_VERSION=v22.0
META_WEBHOOK_DEFAULT_TOKEN=...    # opcional, fallback verify
PG_CRON_SECRET=...
```

No hace falta nada nuevo en `.env` — la diferenciación entre WA e IG la hace el handler en runtime.

## Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| Webhook verify falla | Verify token diferente | Asegurate que el string en Meta coincida con el de CRM Config |
| Mensajes salientes fallan #200 | Permission denied | Pedí App Review para `instagram_manage_messages` o usá testers |
| Mensajes salientes fallan #2018108 | Fuera de 24h window | Esperá a que el user escriba o usá tag HUMAN_AGENT (no implementado MVP) |
| Mensajes salientes fallan #2018278 | Recipient unavailable | El usuario bloqueó o cerró cuenta |
| No llegan inbound | Webhook no suscripto | Meta App → Webhooks → Instagram → Subscribe `messages` |
| `signature mismatch` | App Secret incorrecto | Re-cargar en CRM Config |
