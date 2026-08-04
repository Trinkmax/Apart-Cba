-- ════════════════════════════════════════════════════════════════════════════
-- 048 · El snapshot de deshacer también cubre las marcas de tickets
--
-- Corrige dos agujeros de la 047, encontrados en la revisión adversarial:
--
--   1. `maintenance_tickets.charged_to_settlement_id` es parte del estado del
--      documento. `persistSettlement` marca los tickets al generar y
--      `deleteSettlement` los libera. Restaurar sólo las líneas dejaba tickets
--      marcados como "ya cobrados" sin ninguna línea que los cobrara: no
--      volvían a aparecer en ninguna liquidación futura. Plata perdida en
--      silencio.
--
--   2. `jsonb_typeof(NULL) <> 'array'` NO es TRUE (es NULL), así que un snapshot
--      SIN la clave `lines` pasaba la validación y el DELETE de abajo vaciaba la
--      liquidación sin insertar nada. El coalesce cierra el agujero.
--
-- La restauración de tickets es condicional a que el snapshot traiga la clave:
-- los snapshots escritos antes de esta migración no la tienen y no deben
-- desmarcar nada.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

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

  -- Header editable. Whitelist a propósito: los campos que NO están acá
  -- (status, notes, currency, totales) quedan intactos.
  UPDATE apartcba.owner_settlements SET
    unit_order     = COALESCE(p_snapshot -> 'header' -> 'unit_order',     '[]'::jsonb),
    exchange_rates = COALESCE(p_snapshot -> 'header' -> 'exchange_rates', '{}'::jsonb),
    period_index   = NULLIF(p_snapshot -> 'header' ->> 'period_index', '')::smallint,
    period_cycle   = NULLIF(p_snapshot -> 'header' ->> 'period_cycle', '')::smallint,
    period_note    = NULLIF(p_snapshot -> 'header' ->> 'period_note',  '')
  WHERE id = p_settlement_id;

  IF jsonb_typeof(p_snapshot -> 'tickets') = 'array' THEN
    UPDATE apartcba.maintenance_tickets
       SET charged_to_owner_at = NULL,
           charged_to_settlement_id = NULL
     WHERE charged_to_settlement_id = p_settlement_id;

    UPDATE apartcba.maintenance_tickets t
       SET charged_to_owner_at = s.charged_to_owner_at,
           charged_to_settlement_id = p_settlement_id
      FROM jsonb_to_recordset(p_snapshot -> 'tickets')
           AS s(id uuid, charged_to_owner_at timestamptz)
     WHERE t.id = s.id;
  END IF;

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.settlement_restore_snapshot(uuid, uuid, jsonb) TO service_role;
