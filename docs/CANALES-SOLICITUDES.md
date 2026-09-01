# Solicitudes de canal — operación

Encendido en producción el 2026-09-01 (org `Apart CBA`, Airbnb y Booking).
Diseño y racional técnico: sección "Solicitudes de canal" de `CLAUDE.md`.

## Qué cambió, en una frase

Una reserva de OTA **ya no ocupa el calendario por el solo hecho de aparecer en
el feed**. Entra como *solicitud* y se convierte en reserva cuando hay evidencia
de que la OTA la confirmó.

## El incidente que lo motivó (2026-09-01)

Los anuncios de Airbnb no tienen reserva instantánea: cada reserva empieza como
solicitud que el anfitrión acepta o rechaza. Airbnb publica esa solicitud
pendiente en el feed iCal con un VEVENT **idéntico** al de una reserva aceptada
(`SUMMARY:Reserved` + código HM en la `DESCRIPTION`, mismo prefijo de UID), así
que el pipeline la proyectaba como reserva y bloqueaba las fechas. Cuando se
rechazaba, el VEVENT desaparecía pero la reserva local seguía ocupando el
calendario hasta que una persona la cancelaba a mano.

De las 7 reservas de Airbnb creadas entre el 30/08 y el 01/09, **5 eran
solicitudes fantasma**. Y como el iCal saliente exporta todo lo que está en
`bookings`, cada fantasma además bloqueaba esas mismas fechas en Booking.com.

## Cómo se decide ahora

| Señal | Qué pasa |
|---|---|
| VEVENT nuevo en el feed | nace **solicitud** (`pending`), sin fila en `bookings` |
| Mail de confirmación de la OTA | → reserva (`promoted_source='email'`) |
| El mail había llegado **antes** que el iCal | → reserva (`email_backfill`) — pasa siempre: gana la carrera por 3-5 min |
| Botón "Es una reserva" | → reserva (`manual`) |
| Sigue publicada pasadas 26 h (3 h si llega en ≤2 días) | → reserva (`ttl`) + aviso |
| El VEVENT desaparece del feed | → **descartada sola** (`expired`) en ~30 min, sin intervención |
| Botón "Se cayó" | → descartada, y **no revive** aunque el VEVENT siga publicado |

Una solicitud **se ve** en la grilla del PMS (barra ámbar rayada en el carril
inferior, con "Ver en Airbnb" en el popover) y en `/dashboard/reservas-pendientes`,
pero no ocupa: no genera limpieza, no entra a KPIs ni liquidaciones y no puede
chocar con `bookings_no_overlap`.

## Retención de fechas (`hold_availability`)

Son dos cosas distintas y se configuran por separado:

- **Hacia las otras OTAs (iCal saliente)** — se retiene **siempre** que la
  política esté encendida. No es negociable: hay 9 unidades conectadas a Airbnb
  y Booking a la vez, y una venta en Booking es instantánea e irreversible.
- **Hacia la web propia** — lo decide `hold_availability`. Hoy: **Airbnb `false`**
  (una solicitud todavía no es una venta), **Booking `true`** (sus reservas son
  instantáneas: un VEVENT sin confirmar o es basura o ya está vendido).

Con Airbnb en `false` queda una ventana en la que recepción puede vender esas
fechas por WhatsApp. Por eso el formulario de reservas avisa (advertencia, no
bloqueo: a veces se sabe que se va a rechazar).

## Booking.com: el ruido se arregló en la raíz

Booking no tiene solicitudes, así que el gate le aporta poco: sus reservas
reales traen el aviso "¡Nueva reserva!" ~3 min *antes* que el iCal y nacen ya
confirmadas. Lo que sí se arregló es otra cosa: **un VEVENT de más de 120 noches
entra como cierre y no como reserva**. Son marcadores de ventana de
disponibilidad que el feed regenera con UID nuevo todos los días; en la unidad
BRASIL generaban una reserva "confirmada" de 6 meses **por día** (31 en 20 días,
ninguna con número de reserva) que había que cancelar a mano. Ahora ocupan el
calendario como bloqueo gris, sin huésped que completar y sin pedir cancelación.

## Qué mirar

En `/dashboard/canales`, la línea **"Solicitudes (30 días): N confirmadas · N
caídas · N sin mail de la OTA"**.

**El número que importa es el tercero.** "Sin mail" = la solicitud se dio por
confirmada sólo porque seguía publicada a las 26 h. Si ese número crece, el
reenvío de mails de la OTA a la casilla de la organización está fallando y la
red de seguridad es lo único que evita reservas invisibles.

Consultas de control:

```sql
-- (a) solicitudes vivas y su antigüedad
select u.code, cr.channel, cr.confirmation_code, cr.check_in, cr.check_out,
       round(extract(epoch from now()-cr.created_at)/3600, 1) as horas
  from apartcba.channel_reservations cr join apartcba.units u on u.id = cr.unit_id
 where cr.external_status = 'pending' order by cr.created_at;

-- (b) ALERTA si no da 0: el TTL no está corriendo
select count(*) from apartcba.channel_reservations
 where external_status = 'pending' and created_at < now() - interval '27 hours';

-- (c) invariantes — las dos deben dar 0
select count(*) from apartcba.channel_reservations
 where external_status in ('pending','expired') and booking_id is not null;
select count(*) from apartcba.channel_reservations cr
  join apartcba.bookings b on b.id = cr.booking_id
 where cr.external_status = 'active' and cr.missing_since is not null
   and b.status in ('cancelada','no_show');

-- (d) de dónde salió cada confirmación de la última semana
select promoted_source, count(*) from apartcba.channel_reservations
 where promoted_at > now() - interval '7 days' group by 1;
```

## Apagarlo

Surte efecto en ≤2 minutos, sin deploy. Las solicitudes que hayan quedado en
vuelo **se drenan solas a reserva** (`promoted_source='gate_off'`) para no dejar
fechas colgadas — pero sólo las que la OTA siga publicando.

```sql
-- un canal
update apartcba.channel_settings
   set config = jsonb_set(config, '{requests,airbnb,enabled}', 'false')
 where organization_id = '55038e44-7bf3-4451-b681-9b4695ec6ae0';

-- una conexión puntual, sin apagar el resto
update apartcba.channel_settings
   set config = jsonb_set(config, '{requests,airbnb,exclude_link_ids}', '["<link_id>"]')
 where organization_id = '55038e44-7bf3-4451-b681-9b4695ec6ae0';
```

`only_link_ids` hace lo inverso: si tiene elementos, la política alcanza **sólo**
a esas conexiones (sirve para volver a un canary).

## Reserva instantánea de Airbnb

Si algún día se activa "Reserva inmediata" en un anuncio, esas reservas nacen
confirmadas pero el feed las publica igual que una solicitud, así que dependen
del mail (o del TTL, hasta 26 h). Si eso pasa, sacá ese anuncio de la política
con `exclude_link_ids`.
