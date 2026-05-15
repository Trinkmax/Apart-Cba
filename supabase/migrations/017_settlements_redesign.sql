-- ════════════════════════════════════════════════════════════════════════════
-- Migration 017 — Rediseño de liquidaciones
-- ════════════════════════════════════════════════════════════════════════════
-- Cambios SOLO aditivos e idempotentes:
--   • settlement_lines.is_manual  → distingue ajustes manuales de líneas
--     autogeneradas. generateSettlement borra solo is_manual=false al
--     regenerar, preservando los ajustes cargados a mano.
--   • settlement_lines.meta (jsonb) → snapshot por línea (huésped, noches,
--     fechas, %comisión, fuente, prorrateo) para reconstruir la "planilla por
--     unidad" sin re-derivar de bookings que pueden haber cambiado. Hace el
--     documento reproducible e inmutable una vez enviado/pagado.
--   • owner_settlements.public_token (uuid) → token aleatorio (122 bits) para
--     el link público de solo lectura /liquidacion/[token]. La página lo lee
--     server-side con service_role filtrando por este token y expone solo
--     campos de presentación. La tabla NO se expone al Data API; RLS sin cambios.
--   • owner_settlements.sent_to → email al que se envió (audit trail).
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- ─── settlement_lines ───────────────────────────────────────────────────────
ALTER TABLE apartcba.settlement_lines
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;

ALTER TABLE apartcba.settlement_lines
  ADD COLUMN IF NOT EXISTS meta jsonb;

COMMENT ON COLUMN apartcba.settlement_lines.is_manual IS
  'true = ajuste cargado manualmente; se preserva al regenerar la liquidación.';
COMMENT ON COLUMN apartcba.settlement_lines.meta IS
  'Snapshot de la reserva para la planilla por unidad: guest_name, nights, check_in, check_out, source, mode, commission_pct, prorate_days, prorate_of.';

-- ─── owner_settlements ──────────────────────────────────────────────────────
ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS sent_to text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_settlements_public_token
  ON apartcba.owner_settlements(public_token);

CREATE INDEX IF NOT EXISTS idx_owner_settlements_period
  ON apartcba.owner_settlements(organization_id, period_year, period_month);

COMMENT ON COLUMN apartcba.owner_settlements.public_token IS
  'Token aleatorio para link público de solo lectura. Acceso server-side con service_role; tabla NO expuesta al Data API.';
COMMENT ON COLUMN apartcba.owner_settlements.sent_to IS
  'Email al que se envió la liquidación (audit trail).';
