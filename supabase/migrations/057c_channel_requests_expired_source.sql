-- 057c_channel_requests_expired_source.sql
--
-- Distinguir un descarte AUTOMÁTICO de una decisión del operador.
--
-- Sin esto, "Se cayó" y "el VEVENT desapareció del feed" escriben el mismo
-- estado, así que la revitalización automática (el VEVENT volvió al feed)
-- deshace la decisión humana en ≤2 minutos. Con Booking sería sistemático: sus
-- marcadores de ventana de disponibilidad quedan publicados indefinidamente,
-- de modo que cada descarte manual volvería solo, una y otra vez.
--
-- Mismo principio que `ignored`: una decisión de una persona no la revierte un
-- proceso automático.
ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS expired_source text,
  ADD COLUMN IF NOT EXISTS expired_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_expired_source_check;
ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_expired_source_check
  CHECK (expired_source IS NULL OR expired_source IN ('feed', 'manual'));

COMMENT ON COLUMN apartcba.channel_reservations.expired_source IS
  'feed=la OTA dejó de publicar el evento (descarte automático; si vuelve a aparecer, la solicitud revive) | manual=una persona apretó "Se cayó" (no revive sola, sólo con una confirmación de la OTA o con "Volver a activar")';
