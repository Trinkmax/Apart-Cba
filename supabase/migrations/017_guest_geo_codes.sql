-- 017_guest_geo_codes.sql
-- Adds ISO-coded geographic columns + E.164 phone to apartcba.guests so the
-- new "Nuevo huésped" form (built on country-state-city + react-phone-number-input)
-- can persist structured data instead of free-text country/state/city.
--
-- Legacy columns (country, state_or_province, city, phone) are kept for
-- backwards compatibility with existing display code; the new form writes
-- both sets in sync from now on.

-- 1) New columns ------------------------------------------------------------
ALTER TABLE apartcba.guests
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS state_code   text,
  ADD COLUMN IF NOT EXISTS city_name    text,
  ADD COLUMN IF NOT EXISTS phone_e164   text;

COMMENT ON COLUMN apartcba.guests.country_code IS 'ISO-3166-1 alpha-2 (ej. "AR"). Fuente de verdad para país.';
COMMENT ON COLUMN apartcba.guests.state_code   IS 'Código de estado/provincia según country-state-city (ej. "X" para Córdoba). NULL si el país no tiene estados o el usuario no lo eligió.';
COMMENT ON COLUMN apartcba.guests.city_name    IS 'Nombre de ciudad tal como provee country-state-city, o entrada libre del usuario.';
COMMENT ON COLUMN apartcba.guests.phone_e164   IS 'Teléfono en formato E.164 (ej. "+5493534567890"). Validado con isValidPhoneNumber en el cliente.';

-- 2) Backfill desde columnas legacy ----------------------------------------
-- Mapeo Spanish-name -> ISO para los valores que existen actualmente en producción.
-- (Si más adelante aparece un valor nuevo, queda NULL y el form lo forzará en el próximo edit.)
DO $$
BEGIN
  -- 2a. country -> country_code (donde country_code está vacío)
  UPDATE apartcba.guests
  SET country_code = CASE
    WHEN country IS NULL OR btrim(country) = '' THEN NULL
    -- Ya es código ISO (2 letras mayúsculas)
    WHEN country ~ '^[A-Z]{2}$' THEN country
    -- Nombres en español comunes
    WHEN lower(btrim(country)) IN ('argentina')      THEN 'AR'
    WHEN lower(btrim(country)) IN ('uruguay')        THEN 'UY'
    WHEN lower(btrim(country)) IN ('chile')          THEN 'CL'
    WHEN lower(btrim(country)) IN ('brasil','brazil')THEN 'BR'
    WHEN lower(btrim(country)) IN ('paraguay')       THEN 'PY'
    WHEN lower(btrim(country)) IN ('bolivia')        THEN 'BO'
    WHEN lower(btrim(country)) IN ('peru','perú')    THEN 'PE'
    WHEN lower(btrim(country)) IN ('colombia')       THEN 'CO'
    WHEN lower(btrim(country)) IN ('ecuador')        THEN 'EC'
    WHEN lower(btrim(country)) IN ('venezuela')      THEN 'VE'
    WHEN lower(btrim(country)) IN ('mexico','méxico')THEN 'MX'
    WHEN lower(btrim(country)) IN ('estados unidos','eeuu','ee.uu.','ee uu','usa','estados unidos de américa','estados unidos de america') THEN 'US'
    WHEN lower(btrim(country)) IN ('canada','canadá')THEN 'CA'
    WHEN lower(btrim(country)) IN ('españa','espana','spain') THEN 'ES'
    WHEN lower(btrim(country)) IN ('francia','france') THEN 'FR'
    WHEN lower(btrim(country)) IN ('italia','italy')   THEN 'IT'
    WHEN lower(btrim(country)) IN ('alemania','germany')THEN 'DE'
    WHEN lower(btrim(country)) IN ('reino unido','inglaterra','uk','united kingdom') THEN 'GB'
    WHEN lower(btrim(country)) IN ('rusia','russia') THEN 'RU'
    WHEN lower(btrim(country)) IN ('china')          THEN 'CN'
    WHEN lower(btrim(country)) IN ('japon','japón','japan') THEN 'JP'
    WHEN lower(btrim(country)) IN ('portugal')       THEN 'PT'
    WHEN lower(btrim(country)) IN ('holanda','países bajos','paises bajos','netherlands') THEN 'NL'
    WHEN lower(btrim(country)) IN ('suiza','switzerland') THEN 'CH'
    WHEN lower(btrim(country)) IN ('australia')      THEN 'AU'
    ELSE NULL
  END
  WHERE country_code IS NULL;

  -- 2b. city -> city_name (recortando whitespace, descartando strings vacíos)
  UPDATE apartcba.guests
  SET city_name = btrim(city)
  WHERE city_name IS NULL
    AND city IS NOT NULL
    AND btrim(city) <> '';

  -- 2c. phone -> phone_e164 best-effort: si arranca con + lo copiamos tal cual,
  -- si no, lo dejamos NULL para que el usuario lo formatee correctamente al editar.
  UPDATE apartcba.guests
  SET phone_e164 = btrim(phone)
  WHERE phone_e164 IS NULL
    AND phone IS NOT NULL
    AND btrim(phone) LIKE '+%';
END $$;

-- 3) Normalizar columna legacy `country` a ISO (para que get/set quede consistente
--    en consumidores que siguen leyendo guest.country como antes).
UPDATE apartcba.guests
SET country = country_code
WHERE country_code IS NOT NULL
  AND country <> country_code;

-- 4) Índices auxiliares -----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_guests_country_code
  ON apartcba.guests(organization_id, country_code)
  WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guests_phone_e164
  ON apartcba.guests(organization_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;
