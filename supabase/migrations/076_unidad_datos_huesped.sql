-- 076 — Datos de cada depto para el instructivo del huésped.
--
-- Habitana (21/10/2026): "me gustaría sumar un instructivo que yo les mando,
-- que tiene el link de Google Maps y otros datos de los departamentos y el
-- reglamento".
--
-- El instructivo es una plantilla de la org (org_message_templates,
-- event_type 'booking_instructions', canal 'whatsapp') que se copia desde la
-- ficha de la reserva. Lo que cambia de un depto a otro entra por dos
-- variables que salen de acá: {{unit.maps_url}} y {{unit.instructions}}.
--
-- Sólo columnas nuevas y nullable: el código anterior no las lee. Las
-- plantillas no se siembran — una org sin fila usa el texto de arranque del
-- código (src/lib/email/templates/guest-defaults.ts).

ALTER TABLE apartcba.units
  ADD COLUMN IF NOT EXISTS guest_maps_url text,
  ADD COLUMN IF NOT EXISTS guest_instructions text;

COMMENT ON COLUMN apartcba.units.guest_maps_url IS
  'Link de Google Maps que se le pasa al huésped ({{unit.maps_url}} en los mensajes).';
COMMENT ON COLUMN apartcba.units.guest_instructions IS
  'Instructivo propio del depto para el huésped: cómo entrar, piso, wifi… ({{unit.instructions}}).';
