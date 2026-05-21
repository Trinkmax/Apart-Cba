-- Hardening: fijar search_path del trigger de updated_at para evitar
-- advisor function_search_path_mutable.
CREATE OR REPLACE FUNCTION apartcba.tg_ota_listings_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
