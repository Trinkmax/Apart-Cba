-- ════════════════════════════════════════════════════════════════════════════
-- 039 — Canales de venta v2: modelo unificado del Channel Manager
-- ════════════════════════════════════════════════════════════════════════════
-- Reemplaza el pipeline dividido (ical_feeds + inbound_email_log escribiendo
-- bookings por caminos independientes) por un modelo canónico:
--
--   channel_settings      → config de canales por organización (email inbound)
--   channel_links         → una conexión unidad↔OTA (feed entrante + export)
--   channel_events        → inbox durable e idempotente (iCal + email)
--   channel_reservations  → representación canónica de la reserva externa
--   booking_external_refs → referencias externas de un booking (uid, código)
--   channel_issues        → incidencias accionables (conflictos, ambigüedades)
--   channel_sync_runs     → auditoría de corridas del dispatcher
--
-- Todo es ADITIVO: las tablas legacy (ical_feeds, ical_sync_runs, ota_listings,
-- inbound_email_log) quedan intactas como rollback pasivo. Los secretos de los
-- feeds entrantes viven en Vault (feed_secret_id / export_secret_id); las tablas
-- solo guardan UUIDs y el hash SHA-256 del token saliente.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ─── channel_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  operating_mode text NOT NULL DEFAULT 'active' CHECK (operating_mode IN ('active', 'paused')),
  email_ingest_enabled boolean NOT NULL DEFAULT true,
  -- primer email recibido OK → el reenvío quedó verificado
  email_verified_at timestamptz,
  last_email_at timestamptz,
  -- configuración NO secreta (preferencias de UI, horizonte de export, etc.)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE apartcba.channel_settings IS
  'Configuración de Canales de venta por organización. El token del alias de email sigue en organizations.inbound_email_token.';

-- ─── channel_links ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('airbnb', 'booking')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'error')),
  label text,
  -- listing externo (Airbnb room id / Booking hotel slug) — mapping determinista
  external_listing_id text,
  external_listing_url text,
  -- feed entrante: la URL es un bearer secret → vive en Vault
  feed_secret_id uuid,
  -- feed saliente: token por conexión; acá solo el hash SHA-256 (hex) para
  -- comparar en el endpoint público sin exponer el secreto; el plaintext (para
  -- volver a mostrar la URL en la UI) vive en Vault
  export_token_hash text,
  export_secret_id uuid,
  -- caching condicional contra el feed de la OTA
  remote_etag text,
  remote_last_modified text,
  -- scheduling del dispatcher
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  -- actividad
  last_reservation_at timestamptz,
  last_export_access_at timestamptz,
  -- metadata de salud (último error redactado, conteo de eventos, horizonte)
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, unit_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_links_org ON apartcba.channel_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_channel_links_unit ON apartcba.channel_links(unit_id);
-- para el claim del dispatcher (FOR UPDATE SKIP LOCKED)
CREATE INDEX IF NOT EXISTS idx_channel_links_due
  ON apartcba.channel_links(next_poll_at) WHERE status = 'active';

COMMENT ON TABLE apartcba.channel_links IS
  'Conexión unidad↔OTA. Feed entrante (Vault) + calendario saliente (hash de token). Health y scheduling del dispatcher.';

-- ─── channel_events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE SET NULL,
  transport text NOT NULL CHECK (transport IN ('ical', 'email')),
  event_type text NOT NULL CHECK (event_type IN (
    'reservation_upsert', 'reservation_cancelled', 'email_unparsed'
  )),
  -- idempotencia dura: mismo evento (contenido) = misma clave = no-op
  dedupe_key text NOT NULL,
  -- ReservationEvent normalizado y minimizado (sin raw body, sin PII extra)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- hash SHA-256 del contenido original (email body / VEVENT) para auditoría
  content_hash text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'processing', 'processed', 'needs_review', 'error'
  )),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_channel_events_org_created
  ON apartcba.channel_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_events_pending
  ON apartcba.channel_events(status, created_at)
  WHERE status IN ('received', 'error', 'needs_review');
CREATE INDEX IF NOT EXISTS idx_channel_events_link
  ON apartcba.channel_events(link_id, created_at DESC);

COMMENT ON TABLE apartcba.channel_events IS
  'Inbox durable de eventos de canales (iCal + email). Idempotente por (org, dedupe_key). No guarda raw bodies.';

-- ─── channel_reservations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES apartcba.units(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('airbnb', 'booking')),
  -- proyección local; NULL si hubo conflicto o la unidad es ambigua
  booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  external_status text NOT NULL DEFAULT 'active' CHECK (external_status IN ('active', 'cancelled')),
  check_in date,
  check_out date,
  ical_uid text,
  confirmation_code text,
  -- datos normalizados del huésped que proveyó la OTA (email lowercase, tel E.164)
  guest jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- importes informados por la OTA: METADATA externa, nunca pisa valores financieros
  amounts jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- tracking de desaparición del VEVENT (cancelación defensiva en 3 lecturas)
  missing_since timestamptz,
  missing_runs integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel_res_link_uid
  ON apartcba.channel_reservations(link_id, ical_uid) WHERE ical_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel_res_code
  ON apartcba.channel_reservations(organization_id, channel, confirmation_code)
  WHERE confirmation_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_res_booking ON apartcba.channel_reservations(booking_id);
CREATE INDEX IF NOT EXISTS idx_channel_res_org ON apartcba.channel_reservations(organization_id, external_status);
CREATE INDEX IF NOT EXISTS idx_channel_res_link ON apartcba.channel_reservations(link_id);

COMMENT ON TABLE apartcba.channel_reservations IS
  'Reserva externa canónica. Se conserva aunque exista conflicto local (booking_id NULL + channel_issue).';

-- ─── booking_external_refs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.booking_external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('airbnb', 'booking')),
  -- scope: conexión de la que provino la referencia (NULL = org-wide, ej. email)
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE SET NULL,
  ref_type text NOT NULL CHECK (ref_type IN ('ical_uid', 'confirmation_code', 'reservation_number')),
  ref_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_booking_external_refs
  ON apartcba.booking_external_refs(
    organization_id, channel,
    COALESCE(link_id, '00000000-0000-0000-0000-000000000000'::uuid),
    ref_type, ref_value
  );
CREATE INDEX IF NOT EXISTS idx_booking_external_refs_booking
  ON apartcba.booking_external_refs(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_external_refs_lookup
  ON apartcba.booking_external_refs(organization_id, channel, ref_type, ref_value);

COMMENT ON TABLE apartcba.booking_external_refs IS
  'Referencias externas conocidas de un booking (UID iCal, código de confirmación). Las cancelaciones/merges resuelven por acá, nunca por guest_id IS NULL.';

-- ─── channel_issues ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE SET NULL,
  event_id uuid REFERENCES apartcba.channel_events(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES apartcba.channel_reservations(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  issue_type text NOT NULL CHECK (issue_type IN (
    'conflict',            -- reserva externa solapa con una reserva local
    'unmapped_unit',       -- no se pudo determinar la unidad
    'ambiguous_unit',      -- múltiples candidatos (sugerencias en detail)
    'feed_error',          -- el feed entrante falla en forma persistente
    'parse_error',         -- email/ICS ilegible
    'cancellation_review', -- VEVENT desapareció; esperando confirmación
    'email_error',         -- problema del pipeline de email
    'stale_link'           -- la conexión no se pudo revisar hace demasiado
  )),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  title text NOT NULL,
  -- detalle SEGURO Y REDACTADO: sin URLs con token, sin PII innecesaria
  detail text,
  -- candidatos/sugerencias para resolución manual (ej. unidades posibles)
  suggested jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  resolution text,
  resolved_by uuid REFERENCES apartcba.user_profiles(user_id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- una sola incidencia ABIERTA por dedupe_key (reabre creando una nueva si reaparece)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel_issues_open_dedupe
  ON apartcba.channel_issues(organization_id, dedupe_key)
  WHERE status = 'open' AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_issues_org_open
  ON apartcba.channel_issues(organization_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_issues_link ON apartcba.channel_issues(link_id);

-- ─── channel_sync_runs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.channel_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('dispatch', 'reconcile', 'manual', 'backfill')),
  -- NULL = corrida global multi-org del dispatcher
  organization_id uuid REFERENCES apartcba.organizations(id) ON DELETE SET NULL,
  claimed_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS idx_channel_sync_runs_started
  ON apartcba.channel_sync_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_sync_runs_type
  ON apartcba.channel_sync_runs(run_type, started_at DESC);

-- ─── updated_at triggers (reusa apartcba.tg_set_updated_at) ──────────────────
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.channel_settings;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.channel_settings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.channel_links;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.channel_links
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.channel_events;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.channel_events
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.channel_reservations;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.channel_reservations
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.channel_issues;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.channel_issues
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

-- ─── RLS — mismo patrón members_all que el resto del schema ──────────────────
ALTER TABLE apartcba.channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.channel_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.channel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.channel_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.booking_external_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.channel_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.channel_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_all ON apartcba.channel_settings;
CREATE POLICY members_all ON apartcba.channel_settings FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS members_all ON apartcba.channel_links;
CREATE POLICY members_all ON apartcba.channel_links FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS members_all ON apartcba.channel_events;
CREATE POLICY members_all ON apartcba.channel_events FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS members_all ON apartcba.channel_reservations;
CREATE POLICY members_all ON apartcba.channel_reservations FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS members_all ON apartcba.booking_external_refs;
CREATE POLICY members_all ON apartcba.booking_external_refs FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS members_all ON apartcba.channel_issues;
CREATE POLICY members_all ON apartcba.channel_issues FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

-- runs son globales (multi-org): solo superadmin las lee directo; la app llega
-- via service_role y muestra únicamente derivados org-scoped
DROP POLICY IF EXISTS superadmin_only ON apartcba.channel_sync_runs;
CREATE POLICY superadmin_only ON apartcba.channel_sync_runs FOR ALL
  USING (apartcba.is_superadmin())
  WITH CHECK (apartcba.is_superadmin());

-- ─── Claim transaccional del dispatcher (FOR UPDATE SKIP LOCKED) ─────────────
CREATE OR REPLACE FUNCTION apartcba.channels_claim_due_links(
  p_limit integer DEFAULT 12,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF apartcba.channel_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
BEGIN
  -- clamps defensivos: esta función corre con privilegios elevados
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    p_limit := 12;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    p_lease_seconds := 120;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT cl.id
    FROM apartcba.channel_links cl
    WHERE cl.status = 'active'
      AND cl.next_poll_at <= now()
      AND (cl.claimed_until IS NULL OR cl.claimed_until < now())
    ORDER BY cl.next_poll_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE apartcba.channel_links l
     SET claimed_until = now() + make_interval(secs => p_lease_seconds),
         last_attempt_at = now()
    FROM due
   WHERE l.id = due.id
  RETURNING l.*;
END $$;

REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION apartcba.channels_claim_due_links(integer, integer) TO service_role;

-- ─── Guest stats también en UPDATE de guest_id ───────────────────────────────
-- El pipeline canónico crea el booking primero y asigna/enriquece el huésped
-- después (UPDATE). El trigger original solo contaba INSERT, dejando las
-- estadísticas desactualizadas para reservas enriquecidas por email.
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_update_guest_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'apartcba', 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.guest_id IS NOT NULL THEN
      UPDATE apartcba.guests
         SET total_bookings = total_bookings + 1,
             last_stay_at = NEW.check_in_date::timestamptz
       WHERE id = NEW.guest_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.guest_id IS DISTINCT FROM OLD.guest_id THEN
    IF OLD.guest_id IS NOT NULL THEN
      UPDATE apartcba.guests
         SET total_bookings = GREATEST(total_bookings - 1, 0)
       WHERE id = OLD.guest_id;
    END IF;
    IF NEW.guest_id IS NOT NULL THEN
      UPDATE apartcba.guests
         SET total_bookings = total_bookings + 1,
             last_stay_at = GREATEST(COALESCE(last_stay_at, NEW.check_in_date::timestamptz), NEW.check_in_date::timestamptz)
       WHERE id = NEW.guest_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_bookings_guest_stats ON apartcba.bookings;
CREATE TRIGGER trg_bookings_guest_stats
  AFTER INSERT OR UPDATE OF guest_id ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_bookings_update_guest_stats();

-- ─── Grants (consistentes con el resto del schema apartcba) ──────────────────
GRANT SELECT ON apartcba.channel_settings, apartcba.channel_links,
  apartcba.channel_events, apartcba.channel_reservations,
  apartcba.booking_external_refs, apartcba.channel_issues,
  apartcba.channel_sync_runs TO authenticated;
GRANT ALL ON apartcba.channel_settings, apartcba.channel_links,
  apartcba.channel_events, apartcba.channel_reservations,
  apartcba.booking_external_refs, apartcba.channel_issues,
  apartcba.channel_sync_runs TO service_role;
