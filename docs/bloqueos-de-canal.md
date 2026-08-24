# Cierres de fechas y reservas de canal

Guía operativa de las barras grises **"Bloqueado"** del calendario del PMS
(`apartcba.bookings.is_block = true`) y de por qué las reservas de Booking ya
**no** aparecen así.

## Qué es un cierre (bloqueo)

Una fila de `bookings` con `is_block = true`: ocupa el calendario (entra en el
constraint `bookings_no_overlap`, así que impide vender esas fechas) pero **no
es una reserva**. Queda fuera de `/dashboard/reservas`, de los reportes, del
parte diario, de las liquidaciones, de los KPIs y de la creación automática de
limpiezas.

## Lo que exporta cada OTA

| OTA | Qué exporta el iCal | Qué hacemos |
|---|---|---|
| Airbnb | `Reserved` para reservas reales (con el código HM… y los últimos 4 del teléfono en la `DESCRIPTION`), `Airbnb (Not available)` para bloqueos | Importamos sólo las reservas. Los bloqueos se descartan en el parser (`ical-adapter.ts`): rotan de UID todos los días y sólo generan ruido. |
| Booking.com | `CLOSED - Not available` **para las dos cosas**, sin `DESCRIPTION` ni ningún otro campo | No hay forma de distinguirlas. Entran como **reserva** (`is_block = false`). |

El VEVENT de Booking es literalmente esto — no hay más datos que mirar:

```
BEGIN:VEVENT
DTSTAMP:20260818T182042Z
DTSTART;VALUE=DATE:20260912
DTEND;VALUE=DATE:20260914
UID:2b76027796821a59a7f6807cca72d1d1@booking.com
SUMMARY:CLOSED - Not available
ORGANIZER:mailto:noreply@booking.com
END:VEVENT
```

## Por qué Booking entra como reserva y no como cierre

Hasta agosto de 2026 entraba como cierre, apostando a que el email de
confirmación de Booking la ascendiera después a reserva real. Ese ascenso
**nunca ocurrió**: en la org real, 9 de 10 filas de Booking quedaron atrapadas
como barra gris y ninguna llegó jamás por email. El operador veía fechas
ocupadas que no podía editar, sin nombre, sin importe y sin aviso.

La ambigüedad del feed no se puede resolver con datos, así que la decisión real
es **cuál de los dos errores preferimos**:

| Si nos equivocamos… | Consecuencia |
|---|---|
| …importando un cierre como reserva | Aparece una reserva de $0 sin huésped. Se ve, está en la lista, y vuelve a ser un cierre en un click. **Error ruidoso.** |
| …importando una reserva como cierre | La reserva es invisible: sin notificación, fuera de `/dashboard/reservas`, sin limpieza automática, fuera del parte diario, de los KPIs y de la liquidación al propietario. Y no se puede editar. **Error mudo.** |

Elegimos el ruidoso. Migración `051_booking_ical_as_reservation.sql`.

Consecuencia práctica: **si cerrás fechas a mano en el extranet de Booking, en
el PMS aparecen como una reserva de $0 sin huésped.** Marcala como cierre desde
el calendario (ver abajo) y queda como corresponde.

## Qué puede hacer el operador

**Sobre una reserva de Booking sin huésped** (barra de color, popover del
calendario):

- **Completar datos del huésped** → el flujo normal: nombre, teléfono, importe.
- **No es una reserva, es un cierre de fechas** → `is_block = true`. Las fechas
  siguen ocupadas pero dejan de contar como reserva, y se cancela la limpieza
  automática que se hubiera creado. El atajo sólo aparece mientras la reserva
  está "cruda" (sin huésped cargado y sin un peso cobrado); con cobros, el
  server lo rechaza para que la plata no desaparezca de Caja y liquidaciones.

**Sobre un cierre** (barra gris, panel `channel-block-panel.tsx`), que ahora
sólo existe si alguien del equipo lo marcó:

- **Es una reserva real** → `is_block = false`. Vuelve a ser una reserva común.
- **Liberar estas fechas** → cancela el cierre y marca la reserva externa como
  `external_status = 'ignored'`. Las fechas quedan disponibles **y no se vuelven
  a importar**, aunque el VEVENT siga vivo en el feed. El toast ofrece
  *Deshacer*; después se puede restaurar desde `/dashboard/reservas/<id>`.

Si Booking sigue publicando esas fechas como cerradas, el panel lo advierte
antes de liberar: liberar ahí deja el PMS y la OTA en desacuerdo, y si era una
reserva real se puede vender dos veces.

Acciones en `src/lib/actions/blocks.ts`.

## Los tres estados de una reserva externa

`channel_reservations.external_status`:

- `active` — vigente en la OTA.
- `cancelled` — **la OTA** la sacó del calendario.
- `ignored` — **el operador** liberó las fechas a mano. No se re-proyecta nunca:
  ni el poll de 5 min, ni el reconciliador diario, ni un "Reintentar" de
  incidencias. La única salida automática es que llegue un **email** de
  confirmación que demuestre que había una reserva real detrás; también está el
  botón de restaurar.

  Ojo con esto último: el discriminante es el **transporte**, no `isBlock`.
  Desde que el iCal de Booking entra como reserva, `isBlock === false` es el
  default del feed y ya no prueba nada — si `ingest.ts` lo mirara, el siguiente
  poll resucitaría cada fecha que el operador liberó.

## Cuándo se saca solo un cierre

Cuando el VEVENT desaparece del feed, `handleDisappearances()` lo cancela con
dos niveles de evidencia:

| Situación | Umbral |
|---|---|
| Dentro del horizonte publicado por el feed | 3 lecturas ausentes **y** 30 min |
| Más allá del horizonte, o feed vacío | 12 lecturas ausentes **y** 6 h |

El segundo caso existe porque el evento **más lejano del feed *es* el
horizonte**: al desaparecer siempre queda "más allá del horizonte". Antes eso lo
excluía del barrido y el bloqueo quedaba pegado para siempre — así se generaron
los bloqueos fantasma de BRASIL (15/08/2027 → 14/02/2028, 183 noches). Lo mismo
con el feed vacío: una conexión cuyo único evento era un bloqueo queda con el
feed vacío justo cuando ese bloqueo se saca.

Los cierres ya empezados (check-in pasado, check-out futuro) también se barren.
Las reservas ya empezadas no: ahí hay un huésped adentro. **Pero una reserva con
check-in HOY sí es candidata** hasta que alguien le marque el check-in en el
PMS — si Booking la saca de su calendario esa mañana, el PMS la cancela sola a
las 6 h. Marcar el check-in la protege (a partir de ahí abre incidencia en vez
de cancelar).

## Diagnóstico rápido

```sql
-- Cierres vigentes y si la OTA todavía los publica
select u.code, b.check_in_date, b.check_out_date,
       (b.check_out_date - b.check_in_date) as noches,
       r.external_status, r.missing_since, r.missing_runs, r.last_seen_at
from apartcba.bookings b
join apartcba.units u on u.id = b.unit_id
left join apartcba.channel_reservations r on r.booking_id = b.id
where b.organization_id = '<org>' and b.is_block and b.status <> 'cancelada'
order by u.code, b.check_in_date;

-- Reservas de Booking esperando datos del huésped
select u.code, b.check_in_date, b.check_out_date, b.total_amount
from apartcba.bookings b
join apartcba.units u on u.id = b.unit_id
where b.organization_id = '<org>' and b.source = 'booking'
  and not b.is_block and b.guest_id is null and b.status <> 'cancelada'
order by b.check_in_date;
```

Para ver el feed crudo de una conexión (la URL vive en Vault):

```sql
select u.code, apartcba.crm_get_secret(l.feed_secret_id)
from apartcba.channel_links l join apartcba.units u on u.id = l.unit_id
where l.id = '<link_id>';
```

Booking y Airbnb responden `no-store` y sin `ETag`, así que cada lectura es
completa — el camino `304 Not Modified` de `syncLink()` no se usa en producción.

## Cancelaciones

El barrido del feed es la **red de contención**, no el camino principal: una
cancelación de la OTA llega por email en segundos. Ver
`docs/cancelaciones-de-canal.md`.

## Trampa conocida (mirada al revés)

Una reserva externa que quedó `cancelled` localmente pero **vuelve a aparecer**
en el feed NO se reactiva sola: abre una incidencia `cancellation_review` y ahí
se queda. Resultado: la OTA muestra las fechas cerradas y el PMS las muestra
libres. Revisá `/dashboard/canales` cuando aparezca esa incidencia — hoy no hay
un botón de "volver a importar" para ese caso.
