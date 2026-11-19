-- 083 — Qué leyó cada OTA de nuestro calendario, y cuándo
--
-- Síntoma (Apart CBA, 19/11/2026): «Salguero 648 me lo muestra disponible en
-- Airbnb pero en realidad no está. Entré a Canales de venta y me figura como
-- sincronizado».
--
-- Habían cargado un cierre del 22 al 24/11 a las 11:15. Airbnb había leído el
-- calendario a las 08:52 y volvió a las 11:52 (lee cada 3 horas): durante 37
-- minutos lo mostró disponible, que es lo esperable con iCal. Lo que estaba mal
-- era la pantalla: decía «Conectada · la OTA lo consultó hace 20 min», y esa
-- lectura era de BOOKING. La dirección vieja del calendario (`/api/ical/<unidad>`)
-- es una sola por departamento, así que cada lectura le sellaba la hora a todas
-- las conexiones de la unidad. Con eso tampoco se podía ver que una OTA había
-- DEJADO de leer: en Viaggiato, Airbnb no lee JARDINES desde el 06/11 y nunca
-- leyó CARLUCCI ni FRIAS, y las tres figuraban sanas.
--
-- Qué agrega:
--   · `channel_export_reads` — una fila por lectura, atribuida a la conexión
--     que leyó (por cómo se identifica quien lee, o por descarte: una conexión
--     que lee por su dirección propia no es la que lee la vieja). De ahí sale
--     cada cuánto lee cada OTA.
--   · `channel_links.export_served` — lo que se le sirvió la última vez (las
--     estadías que bloqueaba). Comparado con el calendario de hoy dice qué
--     cambios todavía no vio.
--   · `channel_links.export_via` y `export_interval_min` — por qué dirección
--     lee y cada cuántos minutos.
--
-- Sólo agrega: el código anterior sigue funcionando igual con la migración
-- aplicada. Aplicar ANTES de desplegar el código que la usa.

ALTER TABLE apartcba.channel_links
  ADD COLUMN IF NOT EXISTS export_via text,
  ADD COLUMN IF NOT EXISTS export_interval_min integer,
  ADD COLUMN IF NOT EXISTS export_served jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'channel_links_export_via_check'
      AND conrelid = 'apartcba.channel_links'::regclass
  ) THEN
    ALTER TABLE apartcba.channel_links
      ADD CONSTRAINT channel_links_export_via_check
      CHECK (export_via IS NULL OR export_via IN ('link', 'unit'));
  END IF;
END $$;

COMMENT ON COLUMN apartcba.channel_links.export_via IS
  'Por qué dirección lee la OTA el calendario saliente: link = /api/channels/ical/<conexión>, unit = /api/ical/<unidad> (la vieja, compartida).';
COMMENT ON COLUMN apartcba.channel_links.export_interval_min IS
  'Cada cuántos minutos lee la OTA (mediana de sus últimas lecturas). NULL hasta juntar tres.';
COMMENT ON COLUMN apartcba.channel_links.export_served IS
  'Lo que se le sirvió en la última lectura: { at, etag, stays: [[entrada, salida], …] } de hoy en adelante.';

CREATE TABLE IF NOT EXISTS apartcba.channel_export_reads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  -- NULL = lectura de la dirección vieja de una unidad sin conexiones
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE CASCADE,
  reader text NOT NULL DEFAULT 'unknown' CHECK (reader IN ('airbnb', 'booking', 'unknown')),
  via text NOT NULL CHECK (via IN ('link', 'unit')),
  http_status smallint NOT NULL,
  etag text,
  -- cómo se presenta quien lee: para aprender a reconocerlo. Nunca el token.
  user_agent text,
  read_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_export_reads_link
  ON apartcba.channel_export_reads (link_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_export_reads_read_at
  ON apartcba.channel_export_reads (read_at);

COMMENT ON TABLE apartcba.channel_export_reads IS
  'Cada vez que una OTA leyó el calendario saliente de una unidad. Auditoría técnica: la app la lee con service_role; se purga a los 30 días (reconcile).';

-- Igual que channel_sync_runs: es un registro técnico multi-org, nadie lo lee
-- con su sesión.
ALTER TABLE apartcba.channel_export_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS superadmin_only ON apartcba.channel_export_reads;
CREATE POLICY superadmin_only ON apartcba.channel_export_reads FOR ALL
  USING (apartcba.is_superadmin())
  WITH CHECK (apartcba.is_superadmin());

-- Los privilegios por defecto del esquema le dan la tabla a `authenticated`.
-- Nadie la lee con su sesión: queda sólo para service_role.
REVOKE ALL ON apartcba.channel_export_reads FROM anon, authenticated;
