-- ════════════════════════════════════════════════════════════════════════════
-- Migration 018 — Toggle "mostrar nombre junto al logo" (sidebar)
-- ════════════════════════════════════════════════════════════════════════════
-- Solo aditivo e idempotente. Si brand_show_name = false, el sidebar muestra
-- únicamente el logo (sin el nombre de la organización), y el logo toma más
-- protagonismo. Default true = comportamiento actual.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS brand_show_name boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN apartcba.organizations.brand_show_name IS
  'false = en el sidebar se muestra solo el logo (sin el nombre de la organización).';
