-- ════════════════════════════════════════════════════════════════════════════
-- Channel Manager — token público para exportar iCal por unidad
-- ════════════════════════════════════════════════════════════════════════════
-- Cada unidad expone un feed iCal en `/api/ical/[unitId].ics?token=...` que
-- Airbnb/Booking importan para evitar doble-reserva. El token actúa como
-- secret-as-URL: no autentica usuarios, solo evita scraping casual.

ALTER TABLE apartcba.units
  ADD COLUMN IF NOT EXISTS ical_export_token text;

-- Backfill tokens para unidades existentes (32 chars hex, 128 bits de entropía)
UPDATE apartcba.units
   SET ical_export_token = encode(gen_random_bytes(16), 'hex')
 WHERE ical_export_token IS NULL;

ALTER TABLE apartcba.units
  ALTER COLUMN ical_export_token SET NOT NULL,
  ALTER COLUMN ical_export_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS idx_units_ical_export_token
  ON apartcba.units(ical_export_token);
