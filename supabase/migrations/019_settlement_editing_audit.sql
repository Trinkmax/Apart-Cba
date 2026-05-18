-- ════════════════════════════════════════════════════════════════════════════
-- Migration 019 — Edición de liquidaciones con impacto en Caja + auditoría
-- ════════════════════════════════════════════════════════════════════════════
-- Cambios aditivos e idempotentes:
--   • settlement_lines.created_by / updated_by / updated_at → autoría por línea
--     ("quedar registrado qué usuario la hizo").
--   • owner_settlements.last_edited_by / last_edited_at → última edición visible
--     en el encabezado del documento.
--   • settlement_audit → historial inmutable de cambios (espejo exacto de
--     cash_movement_audit): quién, qué cambió y qué efectos tuvo en Caja.
--   • cash_movement_settlement_lock se extiende: además de proteger el
--     paid_movement_id de una liquidación cerrada, ahora también protege los
--     movimientos de AJUSTE (ref_type='settlement_adjustment') de esa
--     liquidación. Editar una liquidación pagada NO reescribe el egreso
--     original: postea un asiento de ajuste por la diferencia (decisión de
--     negocio — contablemente correcto, el comprobante previo sigue válido).
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- ─── settlement_lines: autoría ──────────────────────────────────────────────
ALTER TABLE apartcba.settlement_lines
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN apartcba.settlement_lines.created_by IS
  'Usuario que creó la línea (NULL = autogenerada por el sistema).';
COMMENT ON COLUMN apartcba.settlement_lines.updated_by IS
  'Último usuario que editó la línea manualmente.';

-- ─── owner_settlements: última edición ──────────────────────────────────────
ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

COMMENT ON COLUMN apartcba.owner_settlements.last_edited_by IS
  'Último usuario que modificó la liquidación (líneas / importes / estado).';

-- ─── settlement_audit: historial inmutable ──────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.settlement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES apartcba.owner_settlements(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_name text,
  changes jsonb,
  side_effects jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_audit_settlement
  ON apartcba.settlement_audit(settlement_id, occurred_at DESC);

-- Log inmutable: lo escribe/lee SOLO service_role en server actions (nunca el
-- browser client). RLS habilitada SIN policy → deny por defecto a
-- anon/authenticated; service_role tiene BYPASSRLS. Más estricto que el patrón
-- USING(true) del resto del esquema, a propósito (es auditoría).
ALTER TABLE apartcba.settlement_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_audit_all ON apartcba.settlement_audit;

COMMENT ON TABLE apartcba.settlement_audit IS
  'Historial inmutable de cambios de liquidaciones. RLS sin policy: acceso solo vía service_role en server actions; el scoping por org se hace en la capa de acciones.';

-- ─── Lock extendido: ajustes de liquidación cerrada también protegidos ──────
CREATE OR REPLACE FUNCTION apartcba.cash_movement_settlement_lock(p_movement_id uuid)
RETURNS TABLE(
  settlement_id uuid,
  settlement_status text,
  period_year smallint,
  period_month smallint,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'apartcba', 'public'
AS $function$
  SELECT s.id, s.status, s.period_year, s.period_month,
         'paid_movement_id'::text AS reason
  FROM apartcba.owner_settlements s
  WHERE s.paid_movement_id = p_movement_id
    AND s.status IN ('pagada','enviada','revisada')
  UNION ALL
  SELECT s.id, s.status, s.period_year, s.period_month,
         'settlement_adjustment'::text AS reason
  FROM apartcba.cash_movements m
  JOIN apartcba.owner_settlements s ON s.id = m.ref_id
  WHERE m.id = p_movement_id
    AND m.ref_type = 'settlement_adjustment'
    AND s.status IN ('pagada','enviada','revisada')
  LIMIT 1;
$function$;
