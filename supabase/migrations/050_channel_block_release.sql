-- 050_channel_block_release.sql
--
-- "Liberar" un bloqueo importado de una OTA.
--
-- Problema que resuelve (reportado en producción, unidades DIVA y BRASIL):
-- Booking.com exporta TODO como `SUMMARY:CLOSED - Not available` — no distingue
-- una reserva real de un cierre manual del anfitrión. Por eso `ical-adapter.ts`
-- las importa a `bookings` con `is_block = true`, y la UI del PMS las dibuja
-- como una barra gris "Bloqueado" sin ninguna acción disponible
-- (`canEditThis = canEditBookings && !isBlock`). Resultado: el operador ve
-- fechas ocupadas que no puede liberar por ningún camino visible.
--
-- Esta migración agrega las dos piezas de estado que faltaban:
--
--   1. `external_status = 'ignored'` — el operador decidió que ese bloqueo NO
--      va en su calendario. Se distingue de 'cancelled' (que significa "la OTA
--      lo sacó"): un 'ignored' NO se vuelve a proyectar aunque el VEVENT siga
--      vivo en el feed, y NO abre la incidencia de "reserva cancelada que
--      reapareció". Es una decisión humana, no un hecho de la OTA.
--
--   2. `is_block` en la reserva externa — hasta ahora la "block-ness" vivía
--      SOLO en `bookings.is_block`, así que `reprojectReservation()` (el
--      reconciliador diario) tenía que hardcodear `isBlock: false` y un bloqueo
--      re-proyectado renacía disfrazado de reserva real, con notificación
--      "Nueva reserva de Booking" incluida.

-- ─── 1. external_status: nuevo estado 'ignored' ──────────────────────────────
ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_external_status_check;

ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_external_status_check
  CHECK (external_status IN ('active', 'cancelled', 'ignored'));

ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS ignored_at timestamptz,
  ADD COLUMN IF NOT EXISTS ignored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ignored_reason text;

COMMENT ON COLUMN apartcba.channel_reservations.external_status IS
  'active = vigente en la OTA · cancelled = la OTA la sacó · ignored = el operador la liberó a mano (no se re-proyecta).';

-- ─── 2. is_block viaja con la reserva externa ────────────────────────────────
ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS is_block boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN apartcba.channel_reservations.is_block IS
  'true = ocupación sin datos de reserva (Booking.com no distingue reserva de cierre). Un email posterior la asciende a reserva real.';

-- Backfill desde la proyección local, que hasta ahora era la única fuente.
UPDATE apartcba.channel_reservations r
   SET is_block = b.is_block
  FROM apartcba.bookings b
 WHERE r.booking_id = b.id
   AND b.is_block IS DISTINCT FROM r.is_block;

-- Las de Booking sin proyección local también son bloqueos: el adapter marca
-- isBlock=true para TODO VEVENT de Booking (ical-adapter.ts).
UPDATE apartcba.channel_reservations
   SET is_block = true
 WHERE booking_id IS NULL
   AND channel = 'booking'
   AND confirmation_code IS NULL
   AND is_block = false;

-- Los bloqueos vigentes se consultan por unidad desde el popover del PMS.
CREATE INDEX IF NOT EXISTS idx_channel_res_block_lookup
  ON apartcba.channel_reservations(booking_id)
  WHERE is_block;
