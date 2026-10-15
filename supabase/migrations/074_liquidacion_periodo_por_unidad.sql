-- ════════════════════════════════════════════════════════════════════════════
-- 074 · Liquidaciones: período del ciclo de ajuste POR DEPARTAMENTO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido (13/10/2026, audio del equipo de Apart): un propietario con varios
-- departamentos (Nancy Anton: tres deptos y un local; Alejandro Peiro y Carla
-- Del Vecchio: dos cada uno) tiene cada contrato en un punto distinto del ciclo
-- de ajuste por IPC. La 046 guarda UN período por liquidación ("Período 1/3"),
-- así que lo venían escribiendo a mano en la aclaración: "1/3 pbc-1/3 2A- 1/3
-- PH", "LIMA 1/3 3/3 24 de SEP" (las 10 aclaraciones cargadas hasta hoy son
-- eso). El propietario necesita leer, en lo que se le manda, qué período es de
-- cada departamento.
--
-- `unit_periods` guarda un período por unidad del documento:
--
--   { "<unit_id>": { "index": 2, "cycle": 3 }, … }   →   "DF-1 · Período 2/3"
--
-- Mismo patrón que `unit_order` / `exchange_rates`: metadata del documento en
-- el encabezado, sin tabla aparte, y entera dentro del snapshot de deshacer.
-- Una unidad del documento sin entrada = "no aplica" ese mes (p. ej. un depto
-- que se alquiló por noche). Es rotulado, no plata: no recalcula totales ni
-- toca Caja.
--
-- Los dos modos se excluyen: o hay un período para todo el documento
-- (`period_index`, 046) o hay uno por unidad. Con los dos a la vez nadie sabría
-- cuál vale, así que la base no lo admite.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- Una entrada: clave = id de la unidad (minúsculas, como lo devuelve la base),
-- valor = { index 1..36, cycle 1..36 | null } con index <= cycle.
-- CASE y no OR: Postgres no garantiza el orden de evaluación de un OR, y el
-- cast ::int de un texto que no es número abortaría el INSERT con un error
-- críptico en vez de devolver "inválido".
CREATE OR REPLACE FUNCTION apartcba.settlement_unit_period_valid(p_key text, p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    WHEN jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN false
    -- Sólo "index" y "cycle": nada de texto libre colado en el documento.
    WHEN EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_value) AS k(name)
      WHERE k.name NOT IN ('index', 'cycle')
    ) THEN false
    WHEN jsonb_typeof(p_value -> 'index') IS DISTINCT FROM 'number' THEN false
    WHEN (p_value ->> 'index') !~ '^[0-9]{1,2}$' THEN false
    WHEN (p_value ->> 'index')::int NOT BETWEEN 1 AND 36 THEN false
    -- Sin ciclo → "Período N" sin denominador (como period_cycle NULL en la 046).
    WHEN coalesce(jsonb_typeof(p_value -> 'cycle'), 'null') = 'null' THEN true
    WHEN jsonb_typeof(p_value -> 'cycle') <> 'number' THEN false
    WHEN (p_value ->> 'cycle') !~ '^[0-9]{1,2}$' THEN false
    WHEN (p_value ->> 'cycle')::int NOT BETWEEN 1 AND 36 THEN false
    -- No existe un "Período 4/3".
    ELSE (p_value ->> 'index')::int <= (p_value ->> 'cycle')::int
  END;
$$;

CREATE OR REPLACE FUNCTION apartcba.settlement_unit_periods_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p IS NULL THEN false
    WHEN jsonb_typeof(p) <> 'object' THEN false
    ELSE (
      SELECT (count(*) <= 200)
         AND coalesce(bool_and(apartcba.settlement_unit_period_valid(e.key, e.value)), true)
      FROM jsonb_each(p) AS e
    )
  END;
$$;

ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS unit_periods jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE apartcba.owner_settlements
  DROP CONSTRAINT IF EXISTS owner_settlements_unit_periods_valid;
ALTER TABLE apartcba.owner_settlements
  ADD CONSTRAINT owner_settlements_unit_periods_valid
  CHECK (apartcba.settlement_unit_periods_valid(unit_periods));

ALTER TABLE apartcba.owner_settlements
  DROP CONSTRAINT IF EXISTS owner_settlements_period_one_mode;
ALTER TABLE apartcba.owner_settlements
  ADD CONSTRAINT owner_settlements_period_one_mode
  CHECK (period_index IS NULL OR unit_periods = '{}'::jsonb);

COMMENT ON COLUMN apartcba.owner_settlements.unit_periods IS
  'Período del ciclo de ajuste por unidad: {"<unit_id>": {"index": 2, "cycle": 3}}. Vacío = un período para todo el documento (period_index) o ninguno. Excluye a period_index. Migración 074.';

-- ── Deshacer / rehacer: el snapshot también cubre `unit_periods` ──────────────
-- Misma función que la 048 con una línea más en el UPDATE del encabezado. Los
-- snapshots anteriores a esta migración no traen la clave: se restauran con
-- '{}', que es exactamente lo que había entonces (nadie podía cargarla).

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
    period_note    = NULLIF(p_snapshot -> 'header' ->> 'period_note',  ''),
    -- 074. jsonb_typeof y no COALESCE: un `null` JSON no es NULL de SQL y
    -- pasaría de largo hasta chocar con el CHECK.
    unit_periods   = CASE
                       WHEN jsonb_typeof(p_snapshot -> 'header' -> 'unit_periods') = 'object'
                         THEN p_snapshot -> 'header' -> 'unit_periods'
                       ELSE '{}'::jsonb
                     END
  WHERE id = p_settlement_id;

  -- Marcas de tickets de mantenimiento cobrados a esta liquidación.
  -- `charged_to_settlement_id` es parte del estado del documento: generar marca
  -- los tickets y borrar la liquidación los libera, así que restaurar líneas sin
  -- restaurar las marcas dejaría tickets "ya cobrados" sin línea que los cobre.
  -- Sólo actúa si el snapshot trae la clave: los snapshots previos a la 048 no
  -- la tienen y no deben desmarcar nada.
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
