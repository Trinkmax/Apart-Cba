-- ════════════════════════════════════════════════════════════════════════════
-- Migration 007 — Mutaciones transaccionales de cash_movements
-- ════════════════════════════════════════════════════════════════════════════
-- Objetivo: que cualquier edición o eliminación de un movimiento de caja
-- propague de forma atómica a todas las tablas relacionadas
--   • bookings.paid_amount
--   • booking_payment_schedule (paid_amount, status, paid_at, cash_movement_id)
--   • cash_transfers (cuando un leg cambia)
--   • notifications (re-creación / dismissal)
-- y bloquee operaciones que romperían un cierre contable
--   • owner_settlements en estado pagada/enviada/revisada
--
-- Decisión de diseño: una sola TX implícita (PL/pgSQL function) por RPC.
-- Si cualquier paso falla, se revierte todo. NUNCA se actualiza el ledger
-- sin actualizar las denormalizaciones, y viceversa.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- ─── 0. Endurecer FK de owner_settlements.paid_movement_id ──────────────────
-- Antes era REFERENCES cash_movements(id) sin ON DELETE → borrar un movement
-- linkeado tiraba FK violation. Pasamos a SET NULL: si el movement se elimina,
-- la liquidación queda con el campo en NULL y el RPC valida primero que la
-- liquidación NO esté en estado cerrado.
ALTER TABLE apartcba.owner_settlements
  DROP CONSTRAINT IF EXISTS owner_settlements_paid_movement_id_fkey;
ALTER TABLE apartcba.owner_settlements
  ADD CONSTRAINT owner_settlements_paid_movement_id_fkey
  FOREIGN KEY (paid_movement_id) REFERENCES apartcba.cash_movements(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_settlements_paid_movement
  ON apartcba.owner_settlements(paid_movement_id)
  WHERE paid_movement_id IS NOT NULL;


-- ─── 1. Vista enriquecida con running balance ───────────────────────────────
-- Devuelve cada movimiento con el saldo acumulado de su cuenta hasta ese punto
-- (incluyendo opening_balance). El orden es (occurred_at, id) para ser estable
-- entre movimientos del mismo timestamp.
CREATE OR REPLACE VIEW apartcba.v_cash_movements_enriched AS
SELECT
  m.*,
  a.name        AS account_name,
  a.color       AS account_color,
  a.type        AS account_type,
  a.opening_balance AS account_opening_balance,
  a.opening_balance + SUM(
    CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END
  ) OVER (
    PARTITION BY m.account_id
    ORDER BY m.occurred_at, m.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM apartcba.cash_movements m
JOIN apartcba.cash_accounts a ON a.id = m.account_id;

GRANT SELECT ON apartcba.v_cash_movements_enriched TO authenticated, service_role;

COMMENT ON VIEW apartcba.v_cash_movements_enriched IS
  'cash_movements + running balance acumulado por cuenta. La UI lo usa en /dashboard/caja/[accountId].';


-- ─── 2. Helper: bloqueo por liquidaciones cerradas ──────────────────────────
-- Devuelve la liquidación que bloquea (si la hay), o NULL si la operación es libre.
-- Una liquidación bloquea cuando:
--   a) movement.id está referenciado en owner_settlements.paid_movement_id de
--      una liquidación con status ∈ (pagada, enviada, revisada)
--   b) movement.category = 'owner_settlement' y existe alguna liquidación con
--      ref_id = movement.id en estado cerrado (defensa adicional)
CREATE OR REPLACE FUNCTION apartcba.cash_movement_settlement_lock(
  p_movement_id uuid
) RETURNS TABLE (
  settlement_id uuid,
  settlement_status text,
  period_year smallint,
  period_month smallint,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
  SELECT s.id, s.status, s.period_year, s.period_month,
         'paid_movement_id'::text AS reason
  FROM apartcba.owner_settlements s
  WHERE s.paid_movement_id = p_movement_id
    AND s.status IN ('pagada','enviada','revisada')
  LIMIT 1;
$$;


-- ─── 3. RPC: preview_cash_movement_change ───────────────────────────────────
-- Calcula los efectos secundarios de un update SIN aplicarlos. Lo consume la
-- UI para mostrar al usuario qué va a cambiar antes de confirmar.
-- Devuelve jsonb con shape:
--   { ok: true|false,
--     blockers: [string],     -- razones por las que la operación NO se puede aplicar
--     side_effects: [string]  -- consecuencias en otras entidades, en español
--   }
CREATE OR REPLACE FUNCTION apartcba.preview_cash_movement_change(
  p_movement_id uuid,
  p_account_id uuid,
  p_direction text,
  p_amount numeric,
  p_category text,
  p_occurred_at timestamptz,
  p_delete boolean DEFAULT false,
  p_force_transfer boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
DECLARE
  v_mov apartcba.cash_movements%ROWTYPE;
  v_old_signed numeric;
  v_new_signed numeric;
  v_delta numeric;
  v_new_acc apartcba.cash_accounts%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_effects text[] := ARRAY[]::text[];
  v_lock record;
  v_schedule apartcba.booking_payment_schedule%ROWTYPE;
  v_booking apartcba.bookings%ROWTYPE;
  v_new_paid numeric;
  v_new_status text;
  v_transfer_pair apartcba.cash_transfers%ROWTYPE;
  v_sibling apartcba.cash_movements%ROWTYPE;
  v_settlement apartcba.owner_settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_mov FROM apartcba.cash_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'blockers', jsonb_build_array('Movimiento no encontrado'),
      'side_effects', '[]'::jsonb
    );
  END IF;

  -- Bloqueo por liquidación cerrada (siempre, edit o delete)
  SELECT * INTO v_lock FROM apartcba.cash_movement_settlement_lock(p_movement_id) LIMIT 1;
  IF v_lock.settlement_id IS NOT NULL THEN
    v_blockers := array_append(v_blockers,
      format('La liquidación %s/%s está en estado "%s". Anulala primero para editar este movimiento.',
        lpad(v_lock.period_month::text, 2, '0'),
        v_lock.period_year::text,
        v_lock.settlement_status));
  END IF;

  -- Validar nueva cuenta (si cambió)
  IF NOT p_delete AND p_account_id IS NOT NULL AND p_account_id <> v_mov.account_id THEN
    SELECT * INTO v_new_acc FROM apartcba.cash_accounts WHERE id = p_account_id;
    IF NOT FOUND THEN
      v_blockers := array_append(v_blockers, 'Cuenta destino no encontrada');
    ELSIF NOT v_new_acc.active THEN
      v_blockers := array_append(v_blockers, 'La cuenta destino está inactiva');
    ELSIF v_new_acc.currency <> v_mov.currency THEN
      v_blockers := array_append(v_blockers,
        format('La cuenta destino es %s pero el movimiento es en %s', v_new_acc.currency, v_mov.currency));
    ELSE
      v_effects := array_append(v_effects,
        format('Saldo de "%s" se ajusta por reasignación de cuenta', v_new_acc.name));
    END IF;
  END IF;

  -- Si es transferencia: requerir confirmación explícita y avisar del par
  IF v_mov.category = 'transfer' THEN
    SELECT * INTO v_transfer_pair FROM apartcba.cash_transfers
      WHERE from_movement_id = p_movement_id OR to_movement_id = p_movement_id;
    IF FOUND THEN
      IF p_delete AND NOT p_force_transfer THEN
        v_blockers := array_append(v_blockers, 'TRANSFER_REQUIRES_CONFIRM');
      END IF;
      -- Buscar el otro leg
      IF v_transfer_pair.from_movement_id = p_movement_id THEN
        SELECT * INTO v_sibling FROM apartcba.cash_movements WHERE id = v_transfer_pair.to_movement_id;
      ELSE
        SELECT * INTO v_sibling FROM apartcba.cash_movements WHERE id = v_transfer_pair.from_movement_id;
      END IF;
      IF FOUND THEN
        IF p_delete THEN
          v_effects := array_append(v_effects,
            format('Se eliminará también el movimiento contrario en "%s"',
              (SELECT name FROM apartcba.cash_accounts WHERE id = v_sibling.account_id)));
        END IF;
      END IF;
    END IF;

    -- En transfer no se puede cambiar category
    IF NOT p_delete AND p_category IS NOT NULL AND p_category <> 'transfer' THEN
      v_blockers := array_append(v_blockers, 'No se puede cambiar la categoría de un movimiento de transferencia');
    END IF;
  END IF;

  -- Cálculo de delta firmado (sólo si hay update)
  IF NOT p_delete THEN
    v_old_signed := CASE WHEN v_mov.direction = 'in' THEN v_mov.amount ELSE -v_mov.amount END;
    v_new_signed := CASE WHEN COALESCE(p_direction, v_mov.direction) = 'in'
                         THEN COALESCE(p_amount, v_mov.amount)
                         ELSE -COALESCE(p_amount, v_mov.amount) END;
    v_delta := v_new_signed - v_old_signed;
  ELSE
    v_old_signed := CASE WHEN v_mov.direction = 'in' THEN v_mov.amount ELSE -v_mov.amount END;
    v_delta := -v_old_signed;
  END IF;

  -- Efectos sobre payment_schedule
  IF v_mov.ref_type = 'payment_schedule' AND v_mov.ref_id IS NOT NULL THEN
    SELECT * INTO v_schedule FROM apartcba.booking_payment_schedule WHERE id = v_mov.ref_id;
    IF FOUND THEN
      IF p_delete THEN
        v_new_paid := GREATEST(0, COALESCE(v_schedule.paid_amount, 0) - v_mov.amount);
      ELSE
        -- Sólo afecta si direction sigue siendo 'in' (cuotas son cobros entrantes)
        IF COALESCE(p_direction, v_mov.direction) = 'in' THEN
          v_new_paid := GREATEST(0, COALESCE(v_schedule.paid_amount, 0) - v_mov.amount + COALESCE(p_amount, v_mov.amount));
        ELSE
          v_blockers := array_append(v_blockers, 'Una cuota es cobro entrante: no se puede cambiar a egreso');
          v_new_paid := v_schedule.paid_amount;
        END IF;
      END IF;

      v_new_status := CASE
        WHEN v_new_paid <= 0.001 THEN
          CASE WHEN v_schedule.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END
        WHEN v_new_paid >= v_schedule.expected_amount - 0.01 THEN 'paid'
        ELSE 'partial'
      END;

      v_effects := array_append(v_effects,
        format('Cuota %s/%s pasa de "%s" a "%s" (cobrado %s → %s)',
          v_schedule.sequence_number,
          v_schedule.total_count,
          v_schedule.status,
          v_new_status,
          to_char(v_schedule.paid_amount, 'FM999999990.00'),
          to_char(v_new_paid, 'FM999999990.00')));
    END IF;
  END IF;

  -- Efectos sobre booking (delta de paid_amount)
  IF (v_mov.ref_type IN ('booking','payment_schedule')) AND v_delta <> 0 THEN
    DECLARE
      v_booking_id uuid;
    BEGIN
      IF v_mov.ref_type = 'booking' THEN
        v_booking_id := v_mov.ref_id;
      ELSE
        v_booking_id := v_schedule.booking_id;
      END IF;
      IF v_booking_id IS NOT NULL THEN
        SELECT * INTO v_booking FROM apartcba.bookings WHERE id = v_booking_id;
        IF FOUND THEN
          v_effects := array_append(v_effects,
            format('Reserva %s ajusta paid_amount: %s → %s',
              substr(v_booking.id::text, 1, 8),
              to_char(v_booking.paid_amount, 'FM999999990.00'),
              to_char(GREATEST(0, v_booking.paid_amount + v_delta), 'FM999999990.00')));
        END IF;
      END IF;
    END;
  END IF;

  -- Efectos sobre owner_settlement (informativo cuando NO está cerrada)
  IF v_mov.category = 'owner_settlement' THEN
    SELECT * INTO v_settlement FROM apartcba.owner_settlements WHERE paid_movement_id = p_movement_id;
    IF FOUND AND v_settlement.status NOT IN ('pagada','enviada','revisada') THEN
      v_effects := array_append(v_effects,
        format('Liquidación %s/%s queda sin movimiento de pago vinculado', v_settlement.period_month, v_settlement.period_year));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'side_effects', to_jsonb(v_effects)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apartcba.preview_cash_movement_change(uuid, uuid, text, numeric, text, timestamptz, boolean, boolean) TO authenticated, service_role;


-- ─── 4. RPC: update_cash_movement ───────────────────────────────────────────
-- Aplica los cambios atómicamente. Devuelve jsonb con side_effects y los IDs
-- afectados, para que la UI sepa qué refrescar.
CREATE OR REPLACE FUNCTION apartcba.update_cash_movement(
  p_movement_id uuid,
  p_account_id uuid,
  p_direction text,
  p_amount numeric,
  p_category text,
  p_unit_id uuid,
  p_owner_id uuid,
  p_description text,
  p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
DECLARE
  v_mov apartcba.cash_movements%ROWTYPE;
  v_new_amount numeric;
  v_new_direction text;
  v_old_signed numeric;
  v_new_signed numeric;
  v_delta numeric;
  v_lock record;
  v_acc apartcba.cash_accounts%ROWTYPE;
  v_schedule apartcba.booking_payment_schedule%ROWTYPE;
  v_booking_id uuid;
  v_new_paid numeric;
  v_new_status text;
  v_effects text[] := ARRAY[]::text[];
  v_affected jsonb := jsonb_build_object();
BEGIN
  -- Lock fila del movement (FOR UPDATE) para prevenir races con sibling de transfer
  SELECT * INTO v_mov FROM apartcba.cash_movements
    WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Bloqueo por settlement cerrada
  SELECT * INTO v_lock FROM apartcba.cash_movement_settlement_lock(p_movement_id) LIMIT 1;
  IF v_lock.settlement_id IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_LOCKED: liquidación %/% en estado %',
      v_lock.period_month, v_lock.period_year, v_lock.settlement_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validar cuenta destino si cambió
  IF p_account_id <> v_mov.account_id THEN
    SELECT * INTO v_acc FROM apartcba.cash_accounts
      WHERE id = p_account_id AND organization_id = v_mov.organization_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuenta destino no encontrada' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NOT v_acc.active THEN
      RAISE EXCEPTION 'La cuenta destino está inactiva' USING ERRCODE = 'check_violation';
    END IF;
    IF v_acc.currency <> v_mov.currency THEN
      RAISE EXCEPTION 'Currency mismatch: cuenta % vs movimiento %', v_acc.currency, v_mov.currency
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Restricciones por categoría/ref_type
  IF v_mov.category = 'transfer' AND p_category <> 'transfer' THEN
    RAISE EXCEPTION 'No se puede cambiar la categoría de una transferencia' USING ERRCODE = 'check_violation';
  END IF;
  IF v_mov.ref_type = 'payment_schedule' AND p_direction <> 'in' THEN
    RAISE EXCEPTION 'Una cuota debe permanecer como cobro entrante (direction=in)' USING ERRCODE = 'check_violation';
  END IF;

  v_new_amount := COALESCE(p_amount, v_mov.amount);
  v_new_direction := COALESCE(p_direction, v_mov.direction);
  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'El importe debe ser mayor a 0' USING ERRCODE = 'check_violation';
  END IF;

  v_old_signed := CASE WHEN v_mov.direction = 'in' THEN v_mov.amount ELSE -v_mov.amount END;
  v_new_signed := CASE WHEN v_new_direction = 'in' THEN v_new_amount ELSE -v_new_amount END;
  v_delta := v_new_signed - v_old_signed;

  -- ── 1. Update del movimiento ────────────────────────────────────────────
  UPDATE apartcba.cash_movements SET
    account_id = p_account_id,
    direction = v_new_direction,
    amount = v_new_amount,
    category = COALESCE(p_category, v_mov.category),
    unit_id = p_unit_id,
    owner_id = p_owner_id,
    description = p_description,
    occurred_at = COALESCE(p_occurred_at, v_mov.occurred_at)
  WHERE id = p_movement_id;
  v_effects := array_append(v_effects, 'Movimiento actualizado');

  -- ── 2. Si es payment_schedule: recalcular cuota + booking.paid_amount ──
  IF v_mov.ref_type = 'payment_schedule' AND v_mov.ref_id IS NOT NULL THEN
    SELECT * INTO v_schedule FROM apartcba.booking_payment_schedule
      WHERE id = v_mov.ref_id FOR UPDATE;
    IF FOUND THEN
      v_new_paid := GREATEST(0, COALESCE(v_schedule.paid_amount, 0) - v_mov.amount + v_new_amount);
      v_new_status := CASE
        WHEN v_new_paid <= 0.001 THEN
          CASE WHEN v_schedule.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END
        WHEN v_new_paid >= v_schedule.expected_amount - 0.01 THEN 'paid'
        ELSE 'partial'
      END;
      UPDATE apartcba.booking_payment_schedule SET
        paid_amount = v_new_paid,
        status = v_new_status,
        paid_at = CASE WHEN v_new_status = 'paid' THEN COALESCE(v_schedule.paid_at, NOW()) ELSE NULL END,
        cash_movement_id = p_movement_id
      WHERE id = v_schedule.id;

      v_effects := array_append(v_effects,
        format('Cuota %s/%s recalculada (status: %s, cobrado: %s)',
          v_schedule.sequence_number, v_schedule.total_count,
          v_new_status, to_char(v_new_paid, 'FM999999990.00')));

      v_booking_id := v_schedule.booking_id;
      v_affected := v_affected || jsonb_build_object('schedule_id', v_schedule.id);
    END IF;
  ELSIF v_mov.ref_type = 'booking' THEN
    v_booking_id := v_mov.ref_id;
  END IF;

  -- ── 3. Ajustar bookings.paid_amount ─────────────────────────────────────
  IF v_booking_id IS NOT NULL AND v_delta <> 0 THEN
    UPDATE apartcba.bookings
      SET paid_amount = GREATEST(0, paid_amount + v_delta)
      WHERE id = v_booking_id;
    v_effects := array_append(v_effects,
      format('Reserva %s: paid_amount ajustado en %s',
        substr(v_booking_id::text, 1, 8), to_char(v_delta, 'FM999999990.00')));
    v_affected := v_affected || jsonb_build_object('booking_id', v_booking_id);
  END IF;

  -- ── 4. Devolver resultado ───────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', p_movement_id,
    'side_effects', to_jsonb(v_effects),
    'affected', v_affected
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apartcba.update_cash_movement(uuid, uuid, text, numeric, text, uuid, uuid, text, timestamptz) TO authenticated, service_role;


-- ─── 5. RPC: delete_cash_movement ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.delete_cash_movement(
  p_movement_id uuid,
  p_force_transfer boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
DECLARE
  v_mov apartcba.cash_movements%ROWTYPE;
  v_sibling apartcba.cash_movements%ROWTYPE;
  v_transfer_pair apartcba.cash_transfers%ROWTYPE;
  v_signed numeric;
  v_lock record;
  v_schedule apartcba.booking_payment_schedule%ROWTYPE;
  v_booking_id uuid;
  v_new_paid numeric;
  v_new_status text;
  v_effects text[] := ARRAY[]::text[];
  v_affected jsonb := jsonb_build_object();
  v_sibling_signed numeric;
BEGIN
  SELECT * INTO v_mov FROM apartcba.cash_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  -- Bloqueo por settlement cerrada
  SELECT * INTO v_lock FROM apartcba.cash_movement_settlement_lock(p_movement_id) LIMIT 1;
  IF v_lock.settlement_id IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_LOCKED: liquidación %/% en estado %',
      v_lock.period_month, v_lock.period_year, v_lock.settlement_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_signed := CASE WHEN v_mov.direction = 'in' THEN v_mov.amount ELSE -v_mov.amount END;

  -- ── Transfer: requiere confirmación explícita y borra ambos legs ────────
  IF v_mov.category = 'transfer' THEN
    SELECT * INTO v_transfer_pair FROM apartcba.cash_transfers
      WHERE from_movement_id = p_movement_id OR to_movement_id = p_movement_id
      FOR UPDATE;

    IF FOUND THEN
      IF NOT p_force_transfer THEN
        RAISE EXCEPTION 'TRANSFER_REQUIRES_CONFIRM' USING ERRCODE = 'check_violation';
      END IF;

      IF v_transfer_pair.from_movement_id = p_movement_id THEN
        SELECT * INTO v_sibling FROM apartcba.cash_movements
          WHERE id = v_transfer_pair.to_movement_id FOR UPDATE;
      ELSE
        SELECT * INTO v_sibling FROM apartcba.cash_movements
          WHERE id = v_transfer_pair.from_movement_id FOR UPDATE;
      END IF;

      -- cash_transfers tiene ON DELETE CASCADE en ambos legs → al borrar el
      -- movement principal cae el row de cash_transfers; pero no el sibling
      -- (esa cascade no va de transfer→movement, va de movement→transfer).
      -- Hay que borrar el sibling explícitamente.
      IF FOUND THEN
        DELETE FROM apartcba.cash_movements WHERE id = v_sibling.id;
        v_sibling_signed := CASE WHEN v_sibling.direction = 'in' THEN v_sibling.amount ELSE -v_sibling.amount END;
        v_effects := array_append(v_effects,
          format('Eliminado movimiento contrario en cuenta %s (%s %s)',
            (SELECT name FROM apartcba.cash_accounts WHERE id = v_sibling.account_id),
            v_sibling.direction,
            to_char(v_sibling.amount, 'FM999999990.00')));
      END IF;
    END IF;
  END IF;

  -- ── payment_schedule: revertir cuota ────────────────────────────────────
  IF v_mov.ref_type = 'payment_schedule' AND v_mov.ref_id IS NOT NULL THEN
    SELECT * INTO v_schedule FROM apartcba.booking_payment_schedule
      WHERE id = v_mov.ref_id FOR UPDATE;
    IF FOUND THEN
      v_new_paid := GREATEST(0, COALESCE(v_schedule.paid_amount, 0) - v_mov.amount);
      v_new_status := CASE
        WHEN v_new_paid <= 0.001 THEN
          CASE WHEN v_schedule.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END
        WHEN v_new_paid >= v_schedule.expected_amount - 0.01 THEN 'paid'
        ELSE 'partial'
      END;
      -- cash_movement_id ya tiene ON DELETE SET NULL → al borrar el movement,
      -- el campo queda NULL automáticamente. Igual lo seteamos NULL acá para
      -- que quede explícito en la misma tx (y en caso de race con otro update).
      UPDATE apartcba.booking_payment_schedule SET
        paid_amount = v_new_paid,
        status = v_new_status,
        paid_at = CASE WHEN v_new_status = 'paid' THEN v_schedule.paid_at ELSE NULL END,
        cash_movement_id = NULL
      WHERE id = v_schedule.id;
      v_effects := array_append(v_effects,
        format('Cuota %s/%s vuelve a "%s"', v_schedule.sequence_number, v_schedule.total_count, v_new_status));
      v_booking_id := v_schedule.booking_id;
      v_affected := v_affected || jsonb_build_object('schedule_id', v_schedule.id);
    END IF;
  ELSIF v_mov.ref_type = 'booking' THEN
    v_booking_id := v_mov.ref_id;
  END IF;

  -- ── Ajustar bookings.paid_amount ────────────────────────────────────────
  IF v_booking_id IS NOT NULL AND v_signed <> 0 THEN
    UPDATE apartcba.bookings
      SET paid_amount = GREATEST(0, paid_amount - v_signed)
      WHERE id = v_booking_id;
    v_effects := array_append(v_effects,
      format('Reserva %s: paid_amount ajustado en %s',
        substr(v_booking_id::text, 1, 8), to_char(-v_signed, 'FM999999990.00')));
    v_affected := v_affected || jsonb_build_object('booking_id', v_booking_id);
  END IF;

  -- ── Borrar el movement principal ────────────────────────────────────────
  DELETE FROM apartcba.cash_movements WHERE id = p_movement_id;
  v_effects := array_append(v_effects, 'Movimiento eliminado');

  -- ── Notifications: dismissear todas las que apunten al movement / schedule
  UPDATE apartcba.notifications
    SET dismissed_at = NOW()
    WHERE organization_id = v_mov.organization_id
      AND ((ref_type = 'cash_movement' AND ref_id = p_movement_id)
        OR (ref_type = 'booking_payment_schedule' AND v_schedule.id IS NOT NULL AND ref_id = v_schedule.id))
      AND dismissed_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'side_effects', to_jsonb(v_effects),
    'affected', v_affected
  );
END;
$$;

GRANT EXECUTE ON FUNCTION apartcba.delete_cash_movement(uuid, boolean) TO authenticated, service_role;


-- ─── 6. Comentarios para docs ───────────────────────────────────────────────
COMMENT ON FUNCTION apartcba.update_cash_movement IS
  'Actualiza un cash_movement de forma transaccional, propagando cambios a booking_payment_schedule, bookings.paid_amount y validando bloqueos por liquidación cerrada.';
COMMENT ON FUNCTION apartcba.delete_cash_movement IS
  'Elimina un cash_movement y revierte las denormalizaciones. Para transfer requiere p_force_transfer=true (borra ambos legs).';
COMMENT ON FUNCTION apartcba.preview_cash_movement_change IS
  'Calcula efectos secundarios de una mutación sin aplicarla. Devuelve {ok, blockers, side_effects} para preview en UI.';
