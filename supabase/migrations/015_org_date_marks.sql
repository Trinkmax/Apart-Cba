-- ════════════════════════════════════════════════════════════════════════
-- Migration 015 — org_date_marks
-- Marcas de color por fecha (feriados, puentes, eventos) visibles en
-- el PMS Grid + calendario mensual. Org-wide, editable por admin/recepción.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.org_date_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  label text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_date_marks_unique_per_org UNIQUE (organization_id, date)
);

CREATE INDEX IF NOT EXISTS idx_org_date_marks_org_date
  ON apartcba.org_date_marks(organization_id, date);

DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.org_date_marks;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON apartcba.org_date_marks
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

ALTER TABLE apartcba.org_date_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_date_marks_all ON apartcba.org_date_marks;
CREATE POLICY org_date_marks_all ON apartcba.org_date_marks
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE apartcba.org_date_marks IS
  'Marcas de color por fecha (feriados, puentes, eventos). Aplicada en headers del PMS Grid y calendario mensual.';
