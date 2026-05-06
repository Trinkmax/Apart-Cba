-- Spec 2 — perfil + branding + seguridad de credenciales + Resend
-- Ver docs/superpowers/specs/2026-05-06-spec-2-perfil-branding-seguridad-resend.md
-- Idempotente: usar IF NOT EXISTS / DO blocks para repetibilidad.

SET search_path TO apartcba, public;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas en organizations (logo_url ya existe)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS email_domain text,
  ADD COLUMN IF NOT EXISTS email_sender_name text,
  ADD COLUMN IF NOT EXISTS email_sender_local_part text,
  ADD COLUMN IF NOT EXISTS email_domain_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_domain_dns_records jsonb;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Tabla user_2fa_recovery_codes
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.user_2fa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_active
  ON apartcba.user_2fa_recovery_codes(user_id) WHERE used_at IS NULL;

ALTER TABLE apartcba.user_2fa_recovery_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recovery_codes_all ON apartcba.user_2fa_recovery_codes;
CREATE POLICY recovery_codes_all ON apartcba.user_2fa_recovery_codes
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE apartcba.user_2fa_recovery_codes IS
  'Códigos de recuperación 2FA hasheados con bcrypt. Single-use (used_at se setea al consumir).';

-- ════════════════════════════════════════════════════════════════════════
-- 3. Tabla email_change_requests
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_email text NOT NULL,
  new_email text NOT NULL,
  confirm_token_hash text NOT NULL,
  cancel_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  notified_old_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_change_user_open
  ON apartcba.email_change_requests(user_id)
  WHERE confirmed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE apartcba.email_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_change_requests_all ON apartcba.email_change_requests;
CREATE POLICY email_change_requests_all ON apartcba.email_change_requests
  FOR ALL USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- 4. Tabla org_message_templates
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.org_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject text,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_org_templates_lookup
  ON apartcba.org_message_templates(organization_id, event_type, channel);

ALTER TABLE apartcba.org_message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_message_templates_all ON apartcba.org_message_templates;
CREATE POLICY org_message_templates_all ON apartcba.org_message_templates
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON COLUMN apartcba.org_message_templates.is_default IS
  'true cuando es el contenido seedeado original; el código setea false al primer UPDATE del admin.';

-- ════════════════════════════════════════════════════════════════════════
-- 5. Enum + tabla security_audit_log
-- ════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE apartcba.security_event_type AS ENUM (
    'password_changed',
    'email_change_requested',
    'email_change_confirmed',
    'email_change_cancelled',
    '2fa_enabled',
    '2fa_disabled',
    '2fa_recovery_codes_regenerated',
    'login_with_recovery_code'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS apartcba.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type apartcba.security_event_type NOT NULL,
  metadata jsonb,
  ip inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_user_time
  ON apartcba.security_audit_log(user_id, occurred_at DESC);

ALTER TABLE apartcba.security_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_audit_log_all ON apartcba.security_audit_log;
CREATE POLICY security_audit_log_all ON apartcba.security_audit_log
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE apartcba.security_audit_log IS
  'Audit log inmutable de eventos de seguridad por usuario (cambios password, email, 2FA).';

-- ════════════════════════════════════════════════════════════════════════
-- 6. Columna nueva en bookings
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;

-- ════════════════════════════════════════════════════════════════════════
-- 7. Seeding inicial de templates default para todas las orgs existentes
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
SELECT
  o.id,
  'booking_confirmed',
  'email',
  'Tu reserva en {{org.name}} está confirmada — {{booking.check_in_date}}',
  E'Hola {{guest.first_name}},\n\nTe confirmamos la reserva en {{unit.name}} ({{org.name}}).\n\nDetalles:\n- Check-in: {{booking.check_in_date}}\n- Check-out: {{booking.check_out_date}}\n- Noches: {{booking.nights}}\n- Huéspedes: {{booking.guests_count}}\n- Total: {{booking.total_amount}}\n\nCualquier consulta, escribinos a {{org.contact_email}} o llamanos al {{org.contact_phone}}.\n\n¡Te esperamos!\n{{org.name}}',
  true
FROM apartcba.organizations o
ON CONFLICT (organization_id, event_type, channel) DO NOTHING;

INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
SELECT
  o.id,
  'booking_confirmed',
  'whatsapp',
  NULL,
  'Hola {{guest.first_name}}! Te confirmamos la reserva en {{unit.name}} del {{booking.check_in_date}} al {{booking.check_out_date}} ({{booking.nights}} noches). Total: {{booking.total_amount}}. Consultas: {{org.contact_email}}.',
  true
FROM apartcba.organizations o
ON CONFLICT (organization_id, event_type, channel) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 8. Trigger para seedear templates al crear org nueva
-- ════════════════════════════════════════════════════════════════════════

-- NOTA: el contenido del template default está duplicado entre el seed inicial
-- (sección 7) y este trigger (sección 8) para auto-seedear orgs futuras.
-- Si actualizás el copy del template, hacelo en los DOS lugares para mantener
-- consistencia. (Las orgs existentes no se actualizan automáticamente; usar
-- UPDATE manual o una migration follow-up si querés re-sembrar.)
CREATE OR REPLACE FUNCTION apartcba.seed_default_templates_for_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = apartcba, public
AS $$
BEGIN
  INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
  VALUES
    (NEW.id, 'booking_confirmed', 'email',
     'Tu reserva en {{org.name}} está confirmada — {{booking.check_in_date}}',
     E'Hola {{guest.first_name}},\n\nTe confirmamos la reserva en {{unit.name}} ({{org.name}}).\n\nDetalles:\n- Check-in: {{booking.check_in_date}}\n- Check-out: {{booking.check_out_date}}\n- Noches: {{booking.nights}}\n- Huéspedes: {{booking.guests_count}}\n- Total: {{booking.total_amount}}\n\nCualquier consulta, escribinos a {{org.contact_email}} o llamanos al {{org.contact_phone}}.\n\n¡Te esperamos!\n{{org.name}}',
     true),
    (NEW.id, 'booking_confirmed', 'whatsapp', NULL,
     'Hola {{guest.first_name}}! Te confirmamos la reserva en {{unit.name}} del {{booking.check_in_date}} al {{booking.check_out_date}} ({{booking.nights}} noches). Total: {{booking.total_amount}}. Consultas: {{org.contact_email}}.',
     true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_templates_for_new_org ON apartcba.organizations;
DROP TRIGGER IF EXISTS trg_messaging_seed_on_org_create ON apartcba.organizations;
CREATE TRIGGER trg_messaging_seed_on_org_create
  AFTER INSERT ON apartcba.organizations
  FOR EACH ROW EXECUTE FUNCTION apartcba.seed_default_templates_for_org();

-- ════════════════════════════════════════════════════════════════════════
-- 9. Trigger para actualizar updated_at en org_message_templates
-- ════════════════════════════════════════════════════════════════════════
-- Reusamos apartcba.tg_set_updated_at() definida en migration 001.

DROP TRIGGER IF EXISTS trg_touch_template_updated_at ON apartcba.org_message_templates;
CREATE TRIGGER trg_touch_template_updated_at
  BEFORE UPDATE ON apartcba.org_message_templates
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- Final: comentarios sobre RLS de Storage (se aplica en Task 2)
-- ════════════════════════════════════════════════════════════════════════
-- Los buckets `avatars` y `org-logos` se crean en Task 2 vía Supabase
-- API/CLI (no son objetos SQL). Las RLS de storage también se aplican ahí.
