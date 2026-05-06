-- Parte diario: informe operativo diario auto-generado por organización.
-- Patrón: persistimos solo el ciclo de vida (borrador → revisado → enviado) y el
-- audit; el contenido (CH IN, CH OUT, sucios, tareas, arreglos) se computa vivo
-- desde bookings/cleaning_tasks/maintenance_tickets para que reservas que entren
-- entre el draft y el envío no queden afuera. Cuando se envía, snapshoteamos el
-- payload exacto en daily_reports.payload por audit.

-- ─── helper: trigger updated_at (idempotente) ─────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── parte_diario_settings (1 fila por org) ───────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.parte_diario_settings (
  organization_id uuid PRIMARY KEY REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Argentina/Cordoba',
  draft_hour smallint NOT NULL DEFAULT 20 CHECK (draft_hour BETWEEN 0 AND 23),
  reminder_hour smallint CHECK (reminder_hour BETWEEN 0 AND 23),
  channel_id uuid REFERENCES apartcba.crm_channels(id) ON DELETE SET NULL,
  template_name text NOT NULL DEFAULT 'parte_diario_v1',
  template_language text NOT NULL DEFAULT 'es',
  auto_create_cleaning_tasks boolean NOT NULL DEFAULT true,
  auto_assign_cleaning boolean NOT NULL DEFAULT true,
  organization_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parte_diario_settings_enabled
  ON apartcba.parte_diario_settings(enabled, draft_hour) WHERE enabled = true;

ALTER TABLE apartcba.parte_diario_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pds_select ON apartcba.parte_diario_settings;
CREATE POLICY pds_select ON apartcba.parte_diario_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS pds_modify ON apartcba.parte_diario_settings;
CREATE POLICY pds_modify ON apartcba.parte_diario_settings FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS pds_updated_at ON apartcba.parte_diario_settings;
CREATE TRIGGER pds_updated_at BEFORE UPDATE ON apartcba.parte_diario_settings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

-- ─── daily_reports (audit + ciclo de vida) ────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador','revisado','enviado')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id),
  generated_kind text NOT NULL DEFAULT 'auto'
    CHECK (generated_kind IN ('auto','manual')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  sent_at timestamptz,
  sent_by uuid REFERENCES auth.users(id),
  pdf_url text,
  pdf_storage_path text,
  wa_message_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_org_date
  ON apartcba.daily_reports(organization_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_status
  ON apartcba.daily_reports(organization_id, status, report_date DESC);

ALTER TABLE apartcba.daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dr_select ON apartcba.daily_reports;
CREATE POLICY dr_select ON apartcba.daily_reports FOR SELECT USING (true);
DROP POLICY IF EXISTS dr_modify ON apartcba.daily_reports;
CREATE POLICY dr_modify ON apartcba.daily_reports FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS dr_updated_at ON apartcba.daily_reports;
CREATE TRIGGER dr_updated_at BEFORE UPDATE ON apartcba.daily_reports
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

-- ─── parte_diario_recipients (lista de difusión por WhatsApp) ─────────────
CREATE TABLE IF NOT EXISTS apartcba.parte_diario_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES apartcba.crm_contacts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phone text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parte_diario_recipients_unique
  ON apartcba.parte_diario_recipients(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_parte_diario_recipients_active
  ON apartcba.parte_diario_recipients(organization_id, active) WHERE active = true;

ALTER TABLE apartcba.parte_diario_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdr_select ON apartcba.parte_diario_recipients;
CREATE POLICY pdr_select ON apartcba.parte_diario_recipients FOR SELECT USING (true);
DROP POLICY IF EXISTS pdr_modify ON apartcba.parte_diario_recipients;
CREATE POLICY pdr_modify ON apartcba.parte_diario_recipients FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS pdr_updated_at ON apartcba.parte_diario_recipients;
CREATE TRIGGER pdr_updated_at BEFORE UPDATE ON apartcba.parte_diario_recipients
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

-- ─── seed: settings default por organización existente ────────────────────
INSERT INTO apartcba.parte_diario_settings (organization_id, organization_label)
  SELECT id, name FROM apartcba.organizations
  ON CONFLICT (organization_id) DO NOTHING;

-- ─── storage bucket (público — el path uuid actúa como token) ─────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('parte-diario', 'parte-diario', true)
  ON CONFLICT (id) DO NOTHING;
