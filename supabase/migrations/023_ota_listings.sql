-- ════════════════════════════════════════════════════════════════════════════
-- Channel Manager — Mapping determinístico unit ↔ listing externo por OTA
-- ════════════════════════════════════════════════════════════════════════════
-- Reemplaza el matching fuzzy de listing_hint (en src/lib/inbound/matcher.ts)
-- por una asociación explícita configurada por el operador. Una unidad puede
-- tener múltiples listings (varias cuentas, varios canales). El handler de
-- inbound email usa este mapping antes de caer al fuzzy fallback.

CREATE TABLE IF NOT EXISTS apartcba.ota_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('airbnb','booking','expedia','vrbo','otro')),
  external_listing_id text NOT NULL,
  external_listing_url text,
  external_account_email text,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, external_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_ota_listings_unit
  ON apartcba.ota_listings(unit_id);
CREATE INDEX IF NOT EXISTS idx_ota_listings_lookup
  ON apartcba.ota_listings(organization_id, provider, external_listing_id)
  WHERE active;

COMMENT ON TABLE apartcba.ota_listings IS
  'Mapping unit ↔ listing externo en una OTA. Permite resolver reservas entrantes (email/iCal) a la unidad correcta sin depender de matching por nombre.';
COMMENT ON COLUMN apartcba.ota_listings.external_listing_id IS
  'ID del listing en la OTA. Airbnb: número de listing (URL .../rooms/<id>). Booking: hotel_id o hotel_id-room_id. Lo único que necesitamos es que sea consistente con lo que la OTA pone en los emails.';
COMMENT ON COLUMN apartcba.ota_listings.external_account_email IS
  'Email del host en la OTA (opcional). Útil si la org tiene múltiples cuentas en la misma OTA.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — mismo patrón que el resto de las tablas tenant-scoped
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE apartcba.ota_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_all ON apartcba.ota_listings;
CREATE POLICY members_all ON apartcba.ota_listings FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION apartcba.tg_ota_listings_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ota_listings_touch ON apartcba.ota_listings;
CREATE TRIGGER ota_listings_touch
  BEFORE UPDATE ON apartcba.ota_listings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_ota_listings_touch();
