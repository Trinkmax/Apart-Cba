-- 057b_channel_requests_gate_off_source.sql
--
-- Complemento de 057: `gate_off` como origen de promoción.
--
-- Cuando se apaga la política de solicitudes, lo que quedó `pending` se drena a
-- reserva (si no, quedaría colgado hasta 26 h justo cuando alguien apagó el gate
-- porque algo estaba mal). Ese drenaje NO verifica que la solicitud siguiera
-- publicada, así que marcarlo como 'ttl' inflaría la métrica "confirmadas sin
-- mail de la OTA" — que existe para detectar que el pipeline de email está roto.
ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_promoted_source_check;
ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_promoted_source_check
  CHECK (promoted_source IS NULL
         OR promoted_source IN ('email', 'email_backfill', 'manual', 'ttl', 'gate_off'));

COMMENT ON COLUMN apartcba.channel_reservations.promoted_source IS
  'email=llegó la confirmación de la OTA | email_backfill=la confirmación había llegado ANTES que el iCal | manual=alguien apretó "Es una reserva" | ttl=seguía publicada pasado el umbral y nunca llegó el mail | gate_off=se apagó la política y las solicitudes en vuelo se drenaron a reserva';
