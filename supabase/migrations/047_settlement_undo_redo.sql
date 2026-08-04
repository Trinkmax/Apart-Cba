-- ════════════════════════════════════════════════════════════════════════════
-- 047 · Deshacer / Rehacer en liquidaciones
--
-- Modelo: SNAPSHOTS, no operaciones inversas.
--
-- Cada entrada de `settlement_audit` guarda el estado COMPLETO del documento
-- inmediatamente ANTES del cambio que registra (`snapshot`). Deshacer =
-- restaurar ese estado. Antes de restaurar se guarda el estado actual en
-- `redo_snapshot`, que es lo que permite rehacer.
--
-- Por qué snapshots y no inversas: las inversas exigen que cada acción sepa
-- revertirse (y hoy varias — los reordenamientos, por ejemplo — no registran
-- el estado previo), se rompen al encadenarse y no cubren "Regenerar", que
-- reescribe todas las líneas de una. Con ~6 líneas promedio por liquidación
-- (máx. 21 hoy) un snapshot pesa unos pocos KB: el costo es despreciable.
--
--   S0 --e1--> S1 --e2--> S2 --e3--> S3        e3.snapshot = S2
--   deshacer  → e3.redo_snapshot = S3, restaura S2, e3.undone_at = now()
--   rehacer   → restaura e3.redo_snapshot = S3, e3.undone_at = NULL
--
-- Invariante: las entradas deshechas forman siempre un sufijo contiguo de la
-- línea de tiempo. Una edición nueva descarta la pila de rehacer (comportamiento
-- clásico de undo/redo) poniendo `redo_snapshot = NULL`; `undone_at` se conserva
-- porque el historial es inmutable y tiene que seguir mostrando qué pasó.
--
-- Alcance: sólo el DOCUMENTO (líneas + orden + tipos de cambio + período).
-- El estado y el pago NO entran — mover plata registrada se revierte por su
-- propio flujo, no por un Ctrl+Z.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

ALTER TABLE apartcba.settlement_audit
  ADD COLUMN IF NOT EXISTS snapshot      jsonb,
  ADD COLUMN IF NOT EXISTS redo_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS undone_at     timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by     uuid REFERENCES auth.users(id);

COMMENT ON COLUMN apartcba.settlement_audit.snapshot IS
  'Estado del documento (líneas + header editable) ANTES de este cambio. NULL = la entrada no participa de la pila de deshacer (cambios de estado, pagos).';
COMMENT ON COLUMN apartcba.settlement_audit.redo_snapshot IS
  'Estado capturado al deshacer esta entrada, para poder rehacerla. NULL = no hay nada para rehacer (nunca se deshizo, o una edición nueva descartó la pila).';
COMMENT ON COLUMN apartcba.settlement_audit.undone_at IS
  'Cuándo se deshizo esta entrada. NULL = aplicada.';

-- Tope de la pila de deshacer: la entrada aplicada más reciente CON snapshot.
CREATE INDEX IF NOT EXISTS idx_settlement_audit_undo
  ON apartcba.settlement_audit(settlement_id, occurred_at DESC)
  WHERE snapshot IS NOT NULL AND undone_at IS NULL;

-- Próxima a rehacer: la deshecha más antigua que conserve su redo_snapshot.
CREATE INDEX IF NOT EXISTS idx_settlement_audit_redo
  ON apartcba.settlement_audit(settlement_id, occurred_at)
  WHERE redo_snapshot IS NOT NULL AND undone_at IS NOT NULL;

-- ─── Restauración atómica ───────────────────────────────────────────────────
-- supabase-js no tiene transacciones: si el borrado de líneas y la reinserción
-- fueran dos llamadas y la segunda fallara, la liquidación quedaría vacía. Todo
-- el reemplazo va en una función, que corre en una sola transacción.
CREATE OR REPLACE FUNCTION apartcba.settlement_restore_snapshot(
  p_settlement_id   uuid,
  p_organization_id uuid,
  p_snapshot        jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'apartcba', 'public'
AS $$
DECLARE
  v_restored integer;
BEGIN
  -- Scoping multi-tenant dentro de la función: es SECURITY DEFINER, no puede
  -- confiar en que el llamador ya filtró por organización.
  PERFORM 1
  FROM apartcba.owner_settlements
  WHERE id = p_settlement_id
    AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liquidación no encontrada';
  END IF;

  -- OJO con los tres estados de SQL: si falta la clave `lines`,
  -- `jsonb_typeof(NULL)` es NULL y `NULL <> 'array'` NO es TRUE, así que un
  -- `<>` pelado dejaría pasar el snapshot y el DELETE de abajo vaciaría la
  -- liquidación sin insertar nada. El coalesce cierra ese agujero.
  -- Un arreglo vacío SÍ es válido: una liquidación puede no tener líneas.
  IF p_snapshot IS NULL
     OR coalesce(jsonb_typeof(p_snapshot -> 'lines'), 'missing') <> 'array' THEN
    RAISE EXCEPTION 'Snapshot inválido: falta el arreglo de líneas';
  END IF;

  DELETE FROM apartcba.settlement_lines
  WHERE settlement_id = p_settlement_id;

  -- `settlement_id` se fuerza al de destino: un snapshot manipulado no puede
  -- inyectar líneas en otra liquidación.
  INSERT INTO apartcba.settlement_lines (
    id, settlement_id, line_type, ref_type, ref_id, unit_id, description,
    amount, sign, display_order, created_at, is_manual, meta,
    created_by, updated_by, updated_at, currency
  )
  SELECT
    l.id, p_settlement_id, l.line_type, l.ref_type, l.ref_id, l.unit_id,
    l.description, l.amount, l.sign, l.display_order, l.created_at,
    l.is_manual, l.meta, l.created_by, l.updated_by, l.updated_at, l.currency
  FROM jsonb_populate_recordset(
         null::apartcba.settlement_lines,
         p_snapshot -> 'lines'
       ) AS l;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  -- Header editable. Los totales NO se restauran: los recalcula la capa de
  -- acciones a partir de las líneas (única fuente de verdad del neto).
  UPDATE apartcba.owner_settlements SET
    unit_order     = COALESCE(p_snapshot -> 'header' -> 'unit_order',     '[]'::jsonb),
    exchange_rates = COALESCE(p_snapshot -> 'header' -> 'exchange_rates', '{}'::jsonb),
    period_index   = NULLIF(p_snapshot -> 'header' ->> 'period_index', '')::smallint,
    period_cycle   = NULLIF(p_snapshot -> 'header' ->> 'period_cycle', '')::smallint,
    period_note    = NULLIF(p_snapshot -> 'header' ->> 'period_note',  '')
  WHERE id = p_settlement_id;

  RETURN v_restored;
END;
$$;

COMMENT ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) IS
  'Reemplaza atómicamente las líneas y el header editable de una liquidación con los de un snapshot de settlement_audit. Devuelve la cantidad de líneas restauradas.';

REVOKE ALL ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) TO service_role;
