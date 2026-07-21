-- ════════════════════════════════════════════════════════════════════════════
-- 043 — Caja: cuenta de gastos corrientes, cobro extra de reservas y pago de
--        liquidación dividido en varias cuentas.
--
-- 1) cash_accounts.is_expense_default → marca la cuenta que usa el botón rápido
--    "Registrar gasto" del inicio (gastos corrientes). Una sola por org.
-- 2) Nueva categoría 'extra_charge' → cobros extra vinculados a una reserva
--    (cochera, late check-out, daños) que NO tocan el total de la reserva.
-- 3) Lock de liquidación cerrada extendido → protege también los egresos de un
--    pago de liquidación dividido en varias cuentas (ref_type='settlement_payment').
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Cuenta de gastos corrientes (default para "Registrar gasto") ─────────
ALTER TABLE apartcba.cash_accounts
  ADD COLUMN IF NOT EXISTS is_expense_default boolean NOT NULL DEFAULT false;

-- Solo una cuenta de gastos corrientes por organización.
CREATE UNIQUE INDEX IF NOT EXISTS cash_accounts_one_expense_default_per_org
  ON apartcba.cash_accounts (organization_id)
  WHERE is_expense_default;

COMMENT ON COLUMN apartcba.cash_accounts.is_expense_default IS
  'Cuenta por defecto del botón rápido "Registrar gasto" (gastos corrientes). Máx. una por org (índice parcial único).';

-- ─── 2. Categoría 'extra_charge' para cobros extra de reservas ───────────────
ALTER TABLE apartcba.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_category_check;
ALTER TABLE apartcba.cash_movements
  ADD CONSTRAINT cash_movements_category_check
  CHECK (category = ANY (ARRAY[
    'booking_payment'::text, 'maintenance'::text, 'cleaning'::text,
    'owner_settlement'::text, 'transfer'::text, 'adjustment'::text,
    'salary'::text, 'utilities'::text, 'tax'::text, 'supplies'::text,
    'commission'::text, 'refund'::text, 'other'::text, 'extra_charge'::text
  ]));

-- ─── 3. Lock extendido: pagos de liquidación divididos también protegidos ────
-- Antes solo se protegía el movimiento principal (paid_movement_id) y los
-- ajustes (ref_type='settlement_adjustment'). Con el pago dividido en varias
-- cuentas, cada egreso lleva ref_type='settlement_payment' + ref_id=settlement;
-- todos deben quedar bloqueados mientras la liquidación esté cerrada, para que
-- nadie borre "media transferencia" y desincronice el neto pagado.
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
  UNION ALL
  SELECT s.id, s.status, s.period_year, s.period_month,
         'settlement_payment'::text AS reason
  FROM apartcba.cash_movements m
  JOIN apartcba.owner_settlements s ON s.id = m.ref_id
  WHERE m.id = p_movement_id
    AND m.ref_type = 'settlement_payment'
    AND s.status IN ('pagada','enviada','revisada')
  LIMIT 1;
$function$;
