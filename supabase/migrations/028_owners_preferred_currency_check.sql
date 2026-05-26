-- ════════════════════════════════════════════════════════════════════════════
-- Migration 028 — owners.preferred_currency: FK → CHECK
-- ════════════════════════════════════════════════════════════════════════════
-- El campo `owners.preferred_currency` no es una moneda estricta sino una
-- preferencia de cobro del propietario (puede mezclar moneda + método). El
-- código (src/lib/format.ts, owner-form-dialog, propietarios/[id]) ya asume
-- valores como 'ARS_EFECTIVO' / 'ARS_TRANSFERENCIA' que no existen en
-- apartcba.currencies — la FK rechazaba todo INSERT/UPDATE nuevo.
--
-- Drop de la FK y CHECK con el vocabulario que el front realmente usa.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

ALTER TABLE apartcba.owners
  DROP CONSTRAINT IF EXISTS owners_preferred_currency_fkey;

ALTER TABLE apartcba.owners
  DROP CONSTRAINT IF EXISTS owners_preferred_currency_check;

ALTER TABLE apartcba.owners
  ADD CONSTRAINT owners_preferred_currency_check
  CHECK (
    preferred_currency IS NULL
    OR preferred_currency IN (
      'ARS',
      'ARS_EFECTIVO',
      'ARS_TRANSFERENCIA',
      'USD',
      'EUR',
      'USDT'
    )
  );

COMMENT ON COLUMN apartcba.owners.preferred_currency IS
  'Preferencia de cobro del propietario. NO es un código de moneda estricto: combina moneda + método de pago (ej. ARS_EFECTIVO vs ARS_TRANSFERENCIA). Valores válidos enumerados en owners_preferred_currency_check.';
