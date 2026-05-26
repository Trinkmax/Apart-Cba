-- ════════════════════════════════════════════════════════════════════════════
-- Migration 026 — Orden personalizado de unidades en la liquidación
-- ════════════════════════════════════════════════════════════════════════════
-- Cambio aditivo e idempotente:
--   • owner_settlements.unit_order → jsonb (array de unit_ids) con el orden
--     elegido por el usuario para mostrar las unidades en el documento.
--     Default '[]' = sin override → la UI cae al orden alfabético por code.
--
-- Las reservas dentro de cada unidad y los "otros cargos" se reordenan
-- mutando settlement_lines.display_order — esa columna ya existe (smallint,
-- creada en 001), así que no requiere migración.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS unit_order jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN apartcba.owner_settlements.unit_order IS
  'Array jsonb de unit_ids con el orden personalizado de bloques de unidad en el documento. [] = sin override (la UI ordena alfabéticamente por unit.code).';
