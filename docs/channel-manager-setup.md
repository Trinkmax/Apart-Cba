# Setup Channel Manager — Apart Cba

Guía paso-a-paso para configurar el Channel Manager del PMS y dejar de cargar reservas de Airbnb / Booking a mano.

## Pre-requisitos

- Acceso de **admin** a Apart Cba.
- Acceso a la cuenta de **Vercel** del proyecto (para cargar variables de entorno).
- Acceso al panel de **Resend** (https://resend.com).
- Acceso al **DNS** del dominio que vas a usar para recibir emails (para cargar registros MX).
- Acceso a las cuentas de cada **OTA** (Airbnb, Booking, Expedia, etc.) con sus listings ya publicados.

## Cómo funciona — las dos capas

El Channel Manager combina dos mecanismos independientes. Conviene entender ambos antes de empezar:

- **Capa 1 — Sincronización iCal.** Evita la **sobreventa**: mantiene sincronizadas las *fechas ocupadas* entre Apart Cba y las OTAs. Es bidireccional y se administra en **Channel Manager** (`/dashboard/channel-manager`), que tiene 3 pestañas:
  - **Importar (entrante)** — feeds iCal que traen las fechas ocupadas *desde* cada OTA.
  - **Exportar (saliente)** — un feed iCal *por unidad* que publica las fechas ocupadas de Apart Cba *hacia* las OTAs.
  - **Mapeo de listings** — asocia cada unidad con el ID de su listing en cada OTA.
  - Limitación: el iCal solo transporta fechas, **no** datos del huésped, montos ni detalle de la reserva.

- **Capa 2 — Inbound email.** Trae la **reserva completa**: el staff reenvía los mails de confirmación de Airbnb / Booking a una dirección dedicada por organización; el sistema los parsea y crea la reserva con los datos del huésped. Se administra en la página **Email Parser** (`/dashboard/configuracion/inbound-email`).

Las dos capas se complementan: el iCal te protege de la sobreventa de forma inmediata; el inbound email te ahorra la carga manual y completa los datos. El **Mapeo de listings** es el puente entre ambas — le permite al inbound email saber con certeza a qué unidad pertenece cada reserva.

---

## Sección 1 — Variables de entorno (Vercel, ambiente production)

Todas se cargan en Vercel, ambiente **Production**. Por cada una corré:

```bash
vercel env add <NOMBRE> production
```

Vercel te pide pegar el valor. Después de cargarlas todas, hacé un **redeploy** para que tomen efecto.

| Variable | Para qué sirve |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública de la app (ej. `https://app.apart-cba.com`). Las URLs de export iCal se construyen a partir de esto. **Si está mal, todas las URLs de export quedan inservibles** y las OTAs no podrán leer el calendario. |
| `CRON_SECRET` | Protege los endpoints de cron para que solo Vercel pueda dispararlos. Generar con `openssl rand -hex 32`. |
| `RESEND_API_KEY` | API key de Resend. Se usa tanto para *enviar* mails del sistema como para *leer* el contenido de los mails entrantes de las OTAs. |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Signing secret del endpoint Inbound de Resend (empieza con `whsec_`). **Sin esto, el endpoint inbound rechaza todos los mails en producción.** Se obtiene en la Sección 2. |
| `INBOUND_EMAIL_DOMAIN` | Subdominio dedicado para recibir los mails de las OTAs, ej. `ota.apart-cba.com.ar`. Las direcciones de cada org se arman con este dominio. |

Checklist:

- [ ] `NEXT_PUBLIC_APP_URL` cargada y apunta al dominio real de producción.
- [ ] `CRON_SECRET` generada con `openssl rand -hex 32`.
- [ ] `RESEND_API_KEY` cargada.
- [ ] `RESEND_INBOUND_WEBHOOK_SECRET` cargada (la completás en la Sección 2).
- [ ] `INBOUND_EMAIL_DOMAIN` cargada.
- [ ] Redeploy hecho después de cargar todo.

---

## Sección 2 — Configurar Resend para el inbound email

Resend recibe los mails de las OTAs y se los reenvía al PMS. Hay que configurar dos cosas: el **dominio** y el **endpoint Inbound**.

### 2.1 — Verificar el subdominio en Resend

1. Entrá a https://resend.com → **Domains** → **Add Domain**.
2. Cargá el mismo subdominio que pusiste en `INBOUND_EMAIL_DOMAIN` (ej. `ota.apart-cba.com.ar`).
3. Resend te muestra una lista de registros DNS. Para inbound necesitás los **registros MX** (suelen ser 3).
4. Andá al panel DNS de tu dominio y cargá **exactamente** los registros MX que indica Resend (host, prioridad y valor tal cual aparecen).
5. Volvé a Resend y esperá a que el dominio quede en estado **Verified** (la propagación DNS puede tardar de minutos a unas horas).

### 2.2 — Crear el endpoint Inbound

1. En Resend → **Inbound** → crear un endpoint nuevo.
2. **URL del endpoint:** `${NEXT_PUBLIC_APP_URL}/api/inbound/resend`
   (ej. `https://app.apart-cba.com/api/inbound/resend`).
3. Asociá el endpoint al dominio verificado en el paso 2.1.
4. Guardá y abrí el detalle del endpoint. Copiá su **signing secret** (empieza con `whsec_`).
5. Cargá ese valor en la variable `RESEND_INBOUND_WEBHOOK_SECRET` (Sección 1) y hacé redeploy.

Checklist:

- [ ] Subdominio en estado **Verified** en Resend.
- [ ] Registros MX cargados en el DNS.
- [ ] Endpoint Inbound apuntando a `${NEXT_PUBLIC_APP_URL}/api/inbound/resend`.
- [ ] Signing secret copiado a `RESEND_INBOUND_WEBHOOK_SECRET`.

---

## Sección 3 — Sincronización iCal por OTA

Repetí esta sección **por cada unidad** y **por cada OTA** donde esa unidad esté publicada. La sincronización iCal es bidireccional, así que tiene dos sentidos: **importar** y **exportar**.

> Nota: los menúes de Airbnb y Booking cambian seguido. Los pasos del lado de la OTA se describen de forma general — buscá la opción de calendario / sincronización dentro del listing.

### 3.1 — Importar (traer fechas ocupadas desde la OTA)

1. En la OTA, abrí el **listing** de la unidad.
2. Buscá la sección de **calendario / disponibilidad** y dentro la opción de **sincronizar / exportar calendario**.
3. La OTA te da una **URL iCal de exportación** (termina en `.ics`). Copiala.
4. En Apart Cba, entrá a **Channel Manager** → pestaña **Importar (entrante)**.
5. Tocá **+ Conectar feed** (arriba a la derecha).
6. Pegá la URL iCal y elegí la **unidad** que corresponde.
7. Guardá. El feed aparece en la lista; el sistema empezará a sincronizarlo.

### 3.2 — Exportar (publicar fechas ocupadas de Apart Cba hacia la OTA)

1. En Apart Cba, entrá a **Channel Manager** → pestaña **Exportar (saliente)**.
2. Ubicá la unidad en la lista y tocá **Copiar** para copiar su **URL de export**.
3. En la OTA, abrí el mismo listing → sección de calendario → opción de **importar calendario** (a veces "agregar / vincular calendario externo").
4. Pegá la URL de export y poné un nombre identificable (ej. `Apart Cba`).
5. Guardá.

Datos a tener en cuenta sobre el export:

- El feed expone **solo fechas ocupadas** — sin nombres de huéspedes ni montos, respetando privacidad.
- Las OTAs releen los calendarios importados cada **~2 a 12 horas**, no es instantáneo. Cargá las **reservas directas con anticipación** para no arriesgar doble-reserva en esa ventana.

### 3.3 — Mapeo de listings

1. En Apart Cba, entrá a **Channel Manager** → pestaña **Mapeo de listings**.
2. Tocá el botón para agregar un mapeo nuevo.
3. Asociá cada **unidad** con el **ID de su listing externo** en cada OTA:
   - **Airbnb:** el número del listing que aparece en la URL — `airbnb.com/rooms/50432101` → ID `50432101`.
   - **Booking:** el slug en la URL — `booking.com/hotel/ar/mi-departamento.html` → `mi-departamento`.
   - **Otras OTAs:** cualquier identificador estable que aparezca en sus emails de confirmación.
4. Guardá. Repetí por cada unidad y cada OTA.

Para qué sirve el mapeo: cuando llega una reserva por **inbound email** (Capa 2), el sistema usa este mapeo para identificar **con certeza** a qué unidad pertenece la reserva, sin depender de un matching frágil por nombre. Sin mapeo, las reservas entrantes pueden quedar como **No reconocido**.

Checklist por unidad:

- [ ] Feed de **importación** conectado por cada OTA donde está publicada.
- [ ] URL de **export** pegada en cada OTA.
- [ ] **Mapeo** cargado con el ID de listing de cada OTA.

---

## Sección 4 — Reenvío de mails de las OTAs

Esta es la Capa 2: que los mails de confirmación lleguen al parser.

1. Cada organización tiene una dirección de recepción única, de la forma:
   `ota-<token>@<INBOUND_EMAIL_DOMAIN>`
   (ej. `ota-a1b2c3d4@ota.apart-cba.com.ar`).
2. La dirección exacta de tu organización está visible en Apart Cba en **Configuración → Email Parser** (`/dashboard/configuracion/inbound-email`), en la tarjeta **Dirección de recepción**. Tocá **Copiar**.
3. En la casilla de correo donde el staff **recibe** los mails de Airbnb / Booking, configurá un **reenvío automático** hacia esa dirección:
   - **Airbnb:** reenviá los mails de confirmación de reserva a la dirección de recepción.
   - **Booking.com:** configurá un auto-forward desde el email del extranet hacia la dirección de recepción.
4. El sistema detecta automáticamente la OTA, extrae los datos del huésped y crea la reserva.

Notas:

- Conviene reenviar **todos** los mails de la OTA: el parser ignora lo que no reconoce y solo actúa sobre confirmaciones y cancelaciones.
- Si rotás el token en la página Email Parser (botón **Rotar token**), la dirección vieja **deja de funcionar** — hay que actualizar el reenvío con la dirección nueva.

Checklist:

- [ ] Dirección de recepción copiada desde Email Parser.
- [ ] Reenvío automático configurado en la casilla de Airbnb.
- [ ] Auto-forward configurado en el extranet de Booking.

---

## Sección 5 — Verificación y troubleshooting

### iCal (Capa 1)

- La pestaña **Importar** del Channel Manager muestra el **estado / salud** de cada feed y el **historial de sincronización**.
- Si hay feeds con errores persistentes, aparece arriba una alerta en rojo indicando cuántos están rotos. Revisá la URL del feed o verificá que el calendario sigue publicado en la OTA.
- El sync iCal corre **automáticamente 1 vez por día (03:00 UTC)** vía Vercel Cron. Para forzarlo manualmente en cualquier momento, usá el botón **Sincronizar todos** (arriba a la derecha del Channel Manager).

### Inbound email (Capa 2)

La página **Email Parser** muestra en **Últimos emails recibidos** un log de cada mail, con su estado:

| Estado | Significado | Qué hacer |
|---|---|---|
| **Parseado** | El mail se reconoció y se creó / canceló la reserva. | Nada, todo OK. |
| **No reconocido** | Llegó el mail pero ningún parser pudo extraer los datos. | Verificá que sea un mail de confirmación de Airbnb / Booking. Revisá el **Mapeo de listings**. |
| **Duplicado** | Ese mail ya se había procesado antes. | Es normal si se reenvió dos veces; no se crea reserva repetida. |
| **Error** | El mail se reconoció pero falló al crear la reserva. | Mirá el mensaje de error en rojo bajo la fila (ej. fechas que se solapan con otra reserva). |

Si **no aparece ningún mail** en el log después de reenviar uno:

- Confirmá que el dominio está **Verified** en Resend y que los MX están bien cargados.
- Confirmá que el endpoint Inbound apunta a `${NEXT_PUBLIC_APP_URL}/api/inbound/resend`.
- Confirmá que `RESEND_INBOUND_WEBHOOK_SECRET` está cargada en Vercel y que se hizo redeploy — sin el secret correcto, el endpoint **rechaza** los mails en producción.
- Confirmá que el reenvío apunta a la dirección actual (no a una con token viejo).

---

## Sección 6 — Frecuencia de sincronización

- El sync iCal está pensado para correr vía **Vercel Cron**.
- El plan **Hobby** de Vercel permite **solo crons diarios** — de ahí el schedule `0 3 * * *` (03:00 UTC, una vez por día).
- Para sincronizar **cada hora** (o más seguido) hace falta el plan **Pro** de Vercel y cambiar el schedule del cron en `vercel.json`. Ejemplo de entrada horaria:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-ical",
      "schedule": "0 * * * *"
    }
  ]
}
```

Después de editar `vercel.json`, hacé un deploy para que Vercel registre el nuevo schedule.

> Mientras tanto, en cualquier plan podés forzar el sync manualmente con el botón **Sincronizar todos** del Channel Manager.

---

## Resumen rápido

1. Cargá las 5 variables de entorno en Vercel (Sección 1) y hacé redeploy.
2. Verificá el dominio inbound en Resend y creá el endpoint Inbound (Sección 2).
3. Por cada unidad: conectá feeds de **Importar**, pegá las URLs de **Exportar** en las OTAs y cargá el **Mapeo de listings** (Sección 3).
4. Configurá el **reenvío automático** de los mails de las OTAs a la dirección de Email Parser (Sección 4).
5. Verificá en la UI: salud de feeds en Channel Manager y log de mails en Email Parser (Sección 5).
6. Si necesitás sync más frecuente que diario, pasá a Vercel Pro y ajustá `vercel.json` (Sección 6).
