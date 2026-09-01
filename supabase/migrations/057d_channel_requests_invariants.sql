-- 057d_channel_requests_invariants.sql
--
-- 1. Una solicitud (`pending`) o una descartada (`expired`) NUNCA puede tener
--    booking. Es el invariante entero de la 057, y sin el CHECK depende de que
--    ningún camino nuevo se olvide del gate. `expired` + booking_id además es
--    un estado sin salida: no lo mira el barrido, ni el TTL, ni la UI.
--
-- 2. `projection_attempted_at` reemplaza el uso de `updated_at` como marca de
--    "ya intenté proyectar esto y falló". `updated_at` lo pisa un trigger en
--    cada UPDATE (incluido el refresco horario de `last_seen_at`), así que
--    servía de throttle sólo por accidente y podía tanto retrasar el TTL una
--    hora como dejar una fila sin reintentar.
ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS projection_attempted_at timestamptz;

COMMENT ON COLUMN apartcba.channel_reservations.projection_attempted_at IS
  'Último intento fallido de proyectar la solicitud a bookings (conflicto, unidad sin resolver). Acota el reintento a uno por hora en vez de uno cada 2 minutos.';

ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_request_no_booking;
ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_request_no_booking
  CHECK (external_status NOT IN ('pending', 'expired') OR booking_id IS NULL);
