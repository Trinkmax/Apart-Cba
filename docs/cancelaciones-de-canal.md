# Cancelaciones de OTA — cómo llegan y por qué a veces no llegaban

Guía del camino que recorre una cancelación desde Airbnb/Booking hasta que la
reserva queda `cancelada` en el PMS.

## Dos caminos, muy distinta velocidad

| Camino | Disparador | Latencia | Alcance |
|---|---|---|---|
| **Email** | La OTA manda "reserva cancelada" a `ota-<token>@<dominio>` | segundos | también cubre estadías ya empezadas |
| **Barrido del feed** | El VEVENT desaparece del iCal | 30 min – 6 h | sólo reservas que todavía no empezaron |

El email es el camino bueno. El barrido es la red de contención para cuando el
email no llega (regla de reenvío rota, casilla mal configurada, la OTA no avisa).

## El bug que hacía que Booking nunca cancelara por email

Booking usa **dos identidades distintas y disjuntas** para la misma reserva:

- el **iCal** la identifica por `UID:<hash>@booking.com` y **nunca** trae el
  número de reserva;
- el **email de cancelación** trae el número (`6492438680`) y **nunca** el uid.

`processCancellation()` resolvía sólo por referencia — `confirmation_code`,
`booking_external_refs`, `bookings.external_id` — así que para **toda** reserva
proyectada desde el iCal (que son todas las de Booking) los tres pasos fallaban.
La cancelación abría una incidencia *"Cancelación de Booking sin reserva local"*
y moría ahí, con la reserva vigente en el calendario. En producción quedaron 6
así entre el 28/07 y el 18/08 de 2026; lo que finalmente las sacaba era el
barrido del feed, horas después.

**El puente existía y lo estábamos tirando a la basura.** El aviso del extranet

```
Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)
```

lleva el número y la fecha de llegada **juntos** — el único lugar donde las dos
identidades se tocan. `classifyIgnorable()` lo descartaba como ruido
(`aviso_reserva_booking`) porque no alcanza para crear una reserva. No alcanza
para crearla; alcanza para numerarla.

## Cómo funciona ahora

1. **Llega el aviso** → el parser produce un evento `reservation_reference`
   (`{número, llegada}`). No crea ni cancela nada.
2. **`processReference()`** busca la reserva vigente **sin número** que llegue
   ese día. Si hay exactamente una, le pone el número, lo registra en
   `booking_external_refs` y lo copia a `bookings.external_id` (el operador ve
   `#5718506503` en el detalle en vez del uid).
3. En la práctica **el email gana la carrera por ~5 minutos**, así que casi
   siempre no hay a quién numerar todavía. No es un error: el evento queda
   guardado y **`applyPendingReference()`** lo levanta cuando el iCal proyecta
   la reserva. El orden de llegada no importa.
4. **Llega la cancelación** → resuelve por número, ahora sí, en segundos.

### El fallback por fecha

Para las reservas que ya existían sin número (o si el aviso nunca llegó),
`processCancellation()` tiene un cuarto paso: buscar por **fecha de llegada**,
que Booking también pone en el subject de la cancelación.

Es determinista, no aproximado: se exige **UNA sola** reserva vigente del canal
que llegue ese día. Con dos candidatas no se cancela ninguna y se abre la
incidencia — cancelar la reserva equivocada es mucho peor que tardar unas horas.

## Reglas que no se tocan

- Una cancelación sobre una estadía **con huésped adentro** (`check_in`) o ya
  terminada (`check_out`) **nunca** se aplica sola: abre una incidencia crítica.
- La cancelación libera las fechas, así que un falso positivo se vende dos
  veces. Toda la resolución es determinista; no hay fuzzy en este camino.
- El barrido del feed sigue existiendo como red de contención — ver
  `docs/bloqueos-de-canal.md`.

## Diagnóstico

```sql
-- Reservas de canal sin número: son las que dependen del fallback por fecha
select u.code, b.check_in_date, b.check_out_date, r.ical_uid
from apartcba.channel_reservations r
join apartcba.bookings b on b.id = r.booking_id
join apartcba.units u on u.id = r.unit_id
where r.organization_id = '<org>' and r.channel = 'booking'
  and r.external_status = 'active' and r.confirmation_code is null;

-- Avisos recibidos que todavía no encontraron reserva
select e.created_at, e.payload->>'confirmation_code' as numero,
       e.payload->>'check_in' as llegada
from apartcba.channel_events e
where e.organization_id = '<org>' and e.event_type = 'reservation_reference'
  and not exists (
    select 1 from apartcba.channel_reservations r
     where r.organization_id = e.organization_id
       and r.confirmation_code = e.payload->>'confirmation_code')
order by e.created_at desc;

-- Cancelaciones que no encontraron a quién cancelar
select i.created_at, i.detail
from apartcba.channel_issues i
where i.organization_id = '<org>' and i.status = 'open'
  and i.issue_type = 'cancellation_review';
```

## Si Booking cambia el formato del subject

El parser (`src/lib/inbound/parsers/booking.ts`) saca número y fecha del
paréntesis. Si Booking cambiara ese formato, el aviso **no** vuelve a
descartarse en silencio: cae como *"Email de OTA no reconocido"* en
`/dashboard/canales`, que es visible y accionable. El fallback por fecha de la
cancelación seguiría funcionando mientras el subject conserve la fecha.

Migraciones: `052_booking_reference_backfill.sql` (tipo de evento nuevo +
recuperación de los avisos ya recibidos).
