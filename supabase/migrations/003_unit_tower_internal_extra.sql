-- Add tower and internal extra/differential fields to units
ALTER TABLE apartcba.units
  ADD COLUMN IF NOT EXISTS tower text,
  ADD COLUMN IF NOT EXISTS internal_extra text;
