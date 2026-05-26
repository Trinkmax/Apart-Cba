-- ════════════════════════════════════════════════════════════════════════════
-- Migration 027 — Liquidaciones multi-moneda con tipo de cambio por documento
-- ════════════════════════════════════════════════════════════════════════════
-- Cambios aditivos e idempotentes:
--   • settlement_lines.currency → moneda de cada línea individual (default ARS).
--     Antes la moneda era implícita: todas las líneas del settlement compartían
--     `owner_settlements.currency`. Ahora cada línea persiste su moneda, así un
--     único documento puede mezclar ARS + USD + EUR.
--   • owner_settlements.exchange_rates → jsonb { "USD": 1300, "EUR": 1450, ... }
--     mapea cada moneda EXTRA a su tasa contra la moneda base (la que vive en
--     `owner_settlements.currency`, default ARS). El usuario lo edita en el
--     detalle; el recálculo de totales lo aplica al convertir.
--
-- Compatibilidad: la constraint UNIQUE existente (org,owner,año,mes,currency)
-- queda intacta. El flujo nuevo crea/regenera con currency='ARS' como moneda
-- base; las "hermanas" mono-moneda viejas se anulan y mergean al regenerar,
-- preservando integridad referencial (paid_movement_id, settlement_audit, etc.).
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- ─── settlement_lines: moneda por línea ─────────────────────────────────────
ALTER TABLE apartcba.settlement_lines
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ARS';

-- FK a currencies. Si la columna ya existe (idempotente), evita duplicar la FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settlement_lines_currency_fkey'
      AND conrelid = 'apartcba.settlement_lines'::regclass
  ) THEN
    ALTER TABLE apartcba.settlement_lines
      ADD CONSTRAINT settlement_lines_currency_fkey
      FOREIGN KEY (currency) REFERENCES apartcba.currencies(code);
  END IF;
END $$;

-- Backfill: hereda la moneda del settlement padre. El DEFAULT 'ARS' solo cubre
-- líneas nuevas; las viejas necesitan este update para reflejar lo que era
-- implícito hasta hoy.
UPDATE apartcba.settlement_lines sl
SET currency = s.currency
FROM apartcba.owner_settlements s
WHERE sl.settlement_id = s.id
  AND sl.currency = 'ARS'
  AND s.currency <> 'ARS';

COMMENT ON COLUMN apartcba.settlement_lines.currency IS
  'Moneda de esta línea. Si difiere de owner_settlements.currency (base), se convierte usando owner_settlements.exchange_rates al recalcular totales.';

-- ─── owner_settlements.exchange_rates ───────────────────────────────────────
ALTER TABLE apartcba.owner_settlements
  ADD COLUMN IF NOT EXISTS exchange_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN apartcba.owner_settlements.exchange_rates IS
  'Tasas de cambio contra la moneda base (currency). Formato: { "USD": 1300, "EUR": 1450 }. Editable por el usuario en el detalle; persistido por liquidación para que los totales no bailen entre vistas.';

-- ─── Index opcional para queries futuras por moneda en líneas ───────────────
CREATE INDEX IF NOT EXISTS idx_settlement_lines_currency
  ON apartcba.settlement_lines (settlement_id, currency);
