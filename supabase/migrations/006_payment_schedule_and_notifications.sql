-- ════════════════════════════════════════════════════════════════════════════
-- 006 — Payment schedule (cuotas mensuales) + notificaciones in-app
--
-- Soporta el flujo de inquilinos mensuales:
--   1. Cada booking mensual tiene N cuotas planificadas (booking_payment_schedule).
--   2. Para lease groups (contratos largos splitteados), las cuotas heredan
--      el sequence_number 1..total dentro del grupo.
--   3. Un cron diario detecta cuotas que vencen en N días hábiles y crea
--      notificaciones en `notifications`.
--   4. La UI puede marcar una cuota como pagada → genera cash_movement y
--      actualiza booking.paid_amount.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. notifications: centro in-app ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'payment_due',
    'payment_overdue',
    'payment_received',
    'lease_ending_soon',
    'lease_split_created',
    'manual',
    'other'
  )),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warning','critical','success')),
  title text NOT NULL,
  body text,
  ref_type text,
  ref_id uuid,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role text CHECK (target_role IN ('admin','recepcion','mantenimiento','limpieza','owner_view')),
  action_url text,
  due_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_active
  ON apartcba.notifications(organization_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON apartcba.notifications(organization_id, read_at, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_due_at
  ON apartcba.notifications(organization_id, due_at)
  WHERE dismissed_at IS NULL AND due_at IS NOT NULL;

-- dedup_key permite que el cron sea idempotente (ej. "payment_due:cuota_id:3d")
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_dedup
  ON apartcba.notifications(organization_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

ALTER TABLE apartcba.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.notifications;
CREATE POLICY members_all ON apartcba.notifications FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

GRANT ALL ON apartcba.notifications TO authenticated, service_role;

COMMENT ON TABLE apartcba.notifications IS
  'Centro de notificaciones in-app. Generadas por cron (cobros, vencimientos) o manualmente.';
COMMENT ON COLUMN apartcba.notifications.dedup_key IS
  'Clave única por org para garantizar idempotencia en jobs (ej. payment_due:<schedule_id>:3d).';
COMMENT ON COLUMN apartcba.notifications.target_user_id IS
  'NULL = visible para todos los miembros con permisos. Si está set, sólo ese usuario.';

-- ─── 2. booking_payment_schedule: cuotas planificadas ───────────────────────
CREATE TABLE IF NOT EXISTS apartcba.booking_payment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  lease_group_id uuid,
  sequence_number smallint NOT NULL CHECK (sequence_number >= 1),
  total_count smallint NOT NULL CHECK (total_count >= 1),
  due_date date NOT NULL,
  expected_amount numeric(14,2) NOT NULL CHECK (expected_amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency text NOT NULL DEFAULT 'ARS',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partial','paid','overdue','cancelled')),
  paid_at timestamptz,
  cash_movement_id uuid REFERENCES apartcba.cash_movements(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_schedule_booking_seq
  ON apartcba.booking_payment_schedule(booking_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_schedule_org_due
  ON apartcba.booking_payment_schedule(organization_id, due_date)
  WHERE status IN ('pending','partial','overdue');

CREATE INDEX IF NOT EXISTS idx_schedule_lease_group
  ON apartcba.booking_payment_schedule(lease_group_id, sequence_number)
  WHERE lease_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_booking
  ON apartcba.booking_payment_schedule(booking_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION apartcba.tg_schedule_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_schedule_touch ON apartcba.booking_payment_schedule;
CREATE TRIGGER trg_schedule_touch BEFORE UPDATE
  ON apartcba.booking_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_schedule_touch_updated_at();

ALTER TABLE apartcba.booking_payment_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.booking_payment_schedule;
CREATE POLICY members_all ON apartcba.booking_payment_schedule FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

GRANT ALL ON apartcba.booking_payment_schedule TO authenticated, service_role;

COMMENT ON TABLE apartcba.booking_payment_schedule IS
  'Cuotas planificadas de bookings mensuales. 1 fila por mes/cuota. Separado de cash_movements (planificación vs. ledger).';
COMMENT ON COLUMN apartcba.booking_payment_schedule.sequence_number IS
  'Posición de la cuota dentro del lease group (o booking individual). 1-based.';
COMMENT ON COLUMN apartcba.booking_payment_schedule.total_count IS
  'Total de cuotas en el contrato. Permite mostrar "1/3", "2/3" en UI sin recontar.';

-- ─── 3. Realtime ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.booking_payment_schedule;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ─── 4. Helper: business_days_before(target, n) ──────────────────────────────
-- Resta N días hábiles (lun-vie) a una fecha. No considera feriados (fuera
-- de scope para PMS local; el usuario puede mover la fecha manualmente).
CREATE OR REPLACE FUNCTION apartcba.business_days_before(target_date date, n integer)
RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d date := target_date;
  remaining integer := n;
BEGIN
  WHILE remaining > 0 LOOP
    d := d - INTERVAL '1 day';
    -- ISO dow: 1=lunes ... 7=domingo. 6=sábado, 7=domingo
    IF EXTRACT(ISODOW FROM d) NOT IN (6, 7) THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN d;
END $$;

COMMENT ON FUNCTION apartcba.business_days_before IS
  'Devuelve la fecha N días hábiles antes de target_date. No considera feriados argentinos.';

-- ─── 5. RPC: generate_payment_schedule_for_booking ───────────────────────────
-- Genera (o regenera) las cuotas para una booking dada.
--
-- Caso A — booking mensual SIN lease group: genera 1 cuota por cada mes
--   completo o fracción del rango, con due_date en el rent_billing_day del
--   mes destino (o el primer día si no hay billing_day).
--
-- Caso B — booking mensual CON lease group: cada booking del grupo genera
--   exactamente 1 cuota (la del mes que cubre), con sequence_number =
--   posición ordinal en el grupo y total_count = cantidad de bookings
--   en el grupo.
--
-- Idempotente: borra cuotas pending/overdue (no las paid/partial) y las
-- regenera. Las paid se preservan para no perder el historial.
CREATE OR REPLACE FUNCTION apartcba.generate_payment_schedule_for_booking(
  p_booking_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  b record;
  v_lease_total integer;
  v_lease_index integer;
  v_due date;
  v_billing_day smallint;
  v_inserted integer := 0;
BEGIN
  SELECT id, organization_id, mode, monthly_rent, monthly_expenses,
         currency, check_in_date, check_out_date, lease_group_id,
         rent_billing_day, total_amount
    INTO b
    FROM apartcba.bookings
   WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found', p_booking_id;
  END IF;

  -- Sólo bookings mensuales generan schedule
  IF b.mode <> 'mensual' THEN
    RETURN 0;
  END IF;

  -- Borrar cuotas no-pagadas existentes (preservamos paid/partial para no
  -- perder historia de cobranza).
  DELETE FROM apartcba.booking_payment_schedule
   WHERE booking_id = p_booking_id
     AND status IN ('pending','overdue','cancelled');

  -- Caso B: lease group → 1 cuota por booking, posición ordinal en el grupo
  IF b.lease_group_id IS NOT NULL THEN
    SELECT COUNT(*),
           (SELECT COUNT(*) FROM apartcba.bookings
             WHERE lease_group_id = b.lease_group_id
               AND check_in_date < b.check_in_date) + 1
      INTO v_lease_total, v_lease_index
      FROM apartcba.bookings
     WHERE lease_group_id = b.lease_group_id;

    v_billing_day := COALESCE(b.rent_billing_day, EXTRACT(DAY FROM b.check_in_date)::smallint);
    -- Due date: día billing_day del mes del check_in (clamped a fin de mes)
    v_due := make_date(
      EXTRACT(YEAR FROM b.check_in_date)::int,
      EXTRACT(MONTH FROM b.check_in_date)::int,
      LEAST(v_billing_day, EXTRACT(DAY FROM (date_trunc('month', b.check_in_date) + INTERVAL '1 month - 1 day'))::int)
    );

    INSERT INTO apartcba.booking_payment_schedule (
      organization_id, booking_id, lease_group_id,
      sequence_number, total_count, due_date,
      expected_amount, currency, status
    ) VALUES (
      b.organization_id, b.id, b.lease_group_id,
      v_lease_index, v_lease_total, v_due,
      COALESCE(b.monthly_rent, 0) + COALESCE(b.monthly_expenses, 0),
      b.currency, 'pending'
    );
    v_inserted := 1;

    -- Recompute total_count y sequence_number para todas las cuotas del grupo
    -- (por si llegó una booking nueva al grupo).
    UPDATE apartcba.booking_payment_schedule s
       SET total_count = v_lease_total,
           sequence_number = (
             SELECT COUNT(*) FROM apartcba.bookings b2
              WHERE b2.lease_group_id = b.lease_group_id
                AND b2.check_in_date < (SELECT check_in_date FROM apartcba.bookings WHERE id = s.booking_id)
           ) + 1
     WHERE s.lease_group_id = b.lease_group_id;

    RETURN v_inserted;
  END IF;

  -- Caso A: booking mensual standalone (no lease group)
  -- Generar 1 cuota por mes calendario que toca la booking.
  v_billing_day := COALESCE(b.rent_billing_day, 1);
  DECLARE
    cursor_date date := date_trunc('month', b.check_in_date)::date;
    end_month date := date_trunc('month', b.check_out_date)::date;
    seq integer := 1;
    total integer;
  BEGIN
    -- Calcular total
    total := (EXTRACT(YEAR FROM end_month)::int - EXTRACT(YEAR FROM cursor_date)::int) * 12
           + (EXTRACT(MONTH FROM end_month)::int - EXTRACT(MONTH FROM cursor_date)::int) + 1;

    WHILE cursor_date <= end_month LOOP
      v_due := make_date(
        EXTRACT(YEAR FROM cursor_date)::int,
        EXTRACT(MONTH FROM cursor_date)::int,
        LEAST(v_billing_day, EXTRACT(DAY FROM (cursor_date + INTERVAL '1 month - 1 day'))::int)
      );
      -- Si la cuota cae fuera del rango de la booking, saltarla
      IF v_due >= b.check_in_date AND v_due < b.check_out_date THEN
        INSERT INTO apartcba.booking_payment_schedule (
          organization_id, booking_id, lease_group_id,
          sequence_number, total_count, due_date,
          expected_amount, currency, status
        ) VALUES (
          b.organization_id, b.id, NULL,
          seq, total, v_due,
          COALESCE(b.monthly_rent, 0) + COALESCE(b.monthly_expenses, 0),
          b.currency, 'pending'
        )
        ON CONFLICT (booking_id, sequence_number) DO NOTHING;
        v_inserted := v_inserted + 1;
        seq := seq + 1;
      END IF;
      cursor_date := (cursor_date + INTERVAL '1 month')::date;
    END LOOP;

    -- Update total_count si hubo skips
    UPDATE apartcba.booking_payment_schedule
       SET total_count = v_inserted
     WHERE booking_id = p_booking_id
       AND status IN ('pending','overdue');
  END;

  RETURN v_inserted;
END $$;

GRANT EXECUTE ON FUNCTION apartcba.generate_payment_schedule_for_booking(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION apartcba.generate_payment_schedule_for_booking IS
  'Genera/regenera las cuotas planificadas de una booking mensual. Idempotente para cuotas pending/overdue.';

-- ─── 6. Auto-marcar cuotas como overdue ──────────────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.mark_schedule_overdue() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE apartcba.booking_payment_schedule
     SET status = 'overdue'
   WHERE status IN ('pending','partial')
     AND due_date < CURRENT_DATE
     AND paid_amount < expected_amount;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION apartcba.mark_schedule_overdue() TO authenticated, service_role;

-- ─── 7. Backfill: generar schedule para bookings mensuales existentes ───────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM apartcba.bookings
     WHERE mode = 'mensual'
       AND status NOT IN ('cancelada','no_show')
       AND id NOT IN (SELECT DISTINCT booking_id FROM apartcba.booking_payment_schedule)
  LOOP
    PERFORM apartcba.generate_payment_schedule_for_booking(r.id);
  END LOOP;
END $$;

-- Mark existing overdue
SELECT apartcba.mark_schedule_overdue();
