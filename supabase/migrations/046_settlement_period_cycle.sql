-- ════════════════════════════════════════════════════════════════════════════
-- 046 · Período del ciclo de ajuste en la liquidación
--
-- Contexto de negocio (AR): los alquileres se ajustan por IPC cada N meses
-- (típicamente 3). Cada mes dentro de ese ciclo es un "período": 1/3, 2/3, 3/3.
-- Al liquidar al propietario hay que dejar explícito QUÉ período se está
-- pagando, porque después del último (3/3) el precio se actualiza.
--
-- `period_year` / `period_month` siguen siendo el mes calendario liquidado
-- (no cambian). Estas columnas sólo agregan la posición dentro del ciclo:
--
--   period_index = 1, period_cycle = 3   →  "Período 1/3"
--   period_index = 2, period_cycle = NULL →  "Período 2"
--   ambas NULL                            →  no se muestra nada (default)
--
-- `period_note` es una aclaración corta opcional que viaja en el documento
-- (pantalla, PDF, Excel, link público y email al propietario).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS period_index smallint,
  ADD COLUMN IF NOT EXISTS period_cycle smallint,
  ADD COLUMN IF NOT EXISTS period_note  text;

-- Invariantes:
--   • no puede haber ciclo sin índice ("… /3" solo no significa nada)
--   • el índice nunca puede exceder el largo del ciclo (no existe "4/3")
--   • 36 = tope defensivo generoso (ciclos anuales/trienales incluidos)
ALTER TABLE apartcba.owner_settlements
  DROP CONSTRAINT IF EXISTS owner_settlements_period_cycle_valid;
ALTER TABLE apartcba.owner_settlements
  ADD CONSTRAINT owner_settlements_period_cycle_valid CHECK (
    (period_index IS NULL AND period_cycle IS NULL)
    OR (
      period_index BETWEEN 1 AND 36
      AND (
        period_cycle IS NULL
        OR (period_cycle BETWEEN 1 AND 36 AND period_index <= period_cycle)
      )
    )
  );

-- La nota se imprime en una sola línea del PDF/Excel: la acotamos en la BD
-- para que no rompa el layout del documento.
ALTER TABLE apartcba.owner_settlements
  DROP CONSTRAINT IF EXISTS owner_settlements_period_note_len;
ALTER TABLE apartcba.owner_settlements
  ADD CONSTRAINT owner_settlements_period_note_len CHECK (
    period_note IS NULL OR char_length(period_note) <= 160
  );

COMMENT ON COLUMN apartcba.owner_settlements.period_index IS
  'Posición del mes liquidado dentro del ciclo de ajuste por IPC (1-based). NULL = sin período cargado.';
COMMENT ON COLUMN apartcba.owner_settlements.period_cycle IS
  'Cantidad de meses del ciclo de ajuste (3 = ajuste trimestral). NULL = se muestra "Período N" sin denominador.';
COMMENT ON COLUMN apartcba.owner_settlements.period_note IS
  'Aclaración corta opcional del período, impresa en el documento (máx. 160 caracteres).';
