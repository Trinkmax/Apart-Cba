-- ─────────────────────────────────────────────────────────────────────────────
-- 051: la ocupación importada del iCal de Booking pasa a ser RESERVA
--
-- Reportado en producción: barras grises "Bloqueado" sobre fechas que eran
-- reservas reales de Booking. El operador no podía cargarles el huésped, no le
-- llegaba notificación, no aparecían en /dashboard/reservas ni en el parte
-- diario, no generaban limpieza y no se liquidaban al propietario.
--
-- Causa: Booking.com exporta TODO su calendario como
--   BEGIN:VEVENT … SUMMARY:CLOSED - Not available … END:VEVENT
-- sin DESCRIPTION ni ningún otro campo (verificado contra los feeds de
-- producción el 18/08/2026). Una reserva real y un cierre manual del extranet
-- son literalmente el mismo VEVENT. Hasta la 050 elegimos importarlas como
-- bloqueo (`is_block = true`) y confiar en que el email de confirmación las
-- ascendiera a reserva. Ese ascenso nunca ocurrió: de 10 filas de Booking en la
-- org real, 9 quedaron atrapadas como bloqueo y CERO llegaron por email.
--
-- La ambigüedad no se puede resolver con datos, así que la decisión es cuál de
-- los dos errores preferimos:
--
--   bloqueo por defecto → una reserva real queda INVISIBLE (sin aviso, sin
--                         limpieza, sin cobrar, sin liquidar). Error mudo.
--   reserva por defecto → un cierre manual aparece como una reserva de $0 sin
--                         huésped: visible, listada, y a un click de volver a
--                         ser un cierre. Error ruidoso.
--
-- Elegimos el ruidoso. `ical-adapter.ts` ahora marca isBlock=false para todo
-- VEVENT de Booking, y el operador tiene el camino de vuelta desde el popover
-- del calendario ("No es una reserva, es un cierre de fechas" →
-- markChannelBookingAsBlock en src/lib/actions/blocks.ts).
--
-- Esta migración sólo migra los datos que ya estaban atrapados. No toca:
--   · los bloqueos manuales del PMS (source = 'directo'),
--   · los liberados a mano por el operador (external_status = 'ignored'),
--   · los que la OTA ya sacó de su calendario (external_status = 'cancelled').
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Reservas externas: dejan de ser "ocupación" ──────────────────────────
UPDATE apartcba.channel_reservations
   SET is_block = false
 WHERE channel = 'booking'
   AND is_block
   AND external_status = 'active';

-- ─── 2. Proyección local: la barra gris pasa a ser una reserva de Booking ────
-- El texto de la nota sólo se reescribe si sigue siendo el que generó el
-- importador; una nota escrita por el equipo se respeta.
UPDATE apartcba.bookings b
   SET is_block = false,
       notes = CASE
                 WHEN b.notes = 'Ocupación importada de Booking (sin datos de reserva)'
                   THEN 'Importada de Booking (calendario)'
                 ELSE b.notes
               END
  FROM apartcba.channel_reservations r
 WHERE r.booking_id = b.id
   AND r.channel = 'booking'
   AND r.external_status = 'active'
   AND b.is_block
   AND b.status <> 'cancelada';

COMMENT ON COLUMN apartcba.channel_reservations.is_block IS
  'true = cierre de fechas, no una reserva. Lo pone el operador desde el PMS: el iCal de Booking no distingue reserva de cierre, así que ya no se infiere del feed.';

COMMENT ON COLUMN apartcba.bookings.is_block IS
  'true = cierre de calendario. Ocupa fechas (entra en bookings_no_overlap) pero no es una reserva: fuera de listas, reportes, KPIs, parte diario, liquidaciones, limpieza automática y eventos CRM.';
