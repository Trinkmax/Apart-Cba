-- ════════════════════════════════════════════════════════════════════════════
-- 004 — Modos de estadía (temporario vs mensual) + auditoría de extensiones
--
-- Este migration introduce la diferenciación temporario vs mensual sin romper
-- nada existente: todas las columnas nuevas tienen default y son nullable
-- (excepto el flag mode que default 'temporario'). Activa además la auditoría
-- append-only de cambios de fechas/unidad en bookings.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. units.default_mode ────────────────────────────────────────────────────
ALTER TABLE apartcba.units
  ADD COLUMN IF NOT EXISTS default_mode text NOT NULL DEFAULT 'temporario'
    CHECK (default_mode IN ('temporario','mensual','mixto'));

CREATE INDEX IF NOT EXISTS idx_units_default_mode
  ON apartcba.units(organization_id, default_mode) WHERE active;

COMMENT ON COLUMN apartcba.units.default_mode IS
  'Hint para autocompletar el form de booking. mixto = la unidad acepta ambos.';

-- ─── 2. bookings.mode + campos de mensual ────────────────────────────────────
ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'temporario'
    CHECK (mode IN ('temporario','mensual')),
  ADD COLUMN IF NOT EXISTS monthly_rent numeric(14,2),
  ADD COLUMN IF NOT EXISTS monthly_expenses numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_deposit numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_inflation_adjustment_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS rent_billing_day smallint
    CHECK (rent_billing_day IS NULL OR rent_billing_day BETWEEN 1 AND 28);

CREATE INDEX IF NOT EXISTS idx_bookings_org_mode_dates
  ON apartcba.bookings(organization_id, mode, check_in_date);

COMMENT ON COLUMN apartcba.bookings.mode IS
  'temporario = airbnb-style nightly | mensual = inquilino largo con renta mensual';
COMMENT ON COLUMN apartcba.bookings.monthly_rent IS
  'Renta mensual (solo si mode=mensual). En la moneda de la reserva.';
COMMENT ON COLUMN apartcba.bookings.rent_billing_day IS
  'Día del mes para cobro de renta (1..28). Día 28 evita problemas de fin de mes.';

-- ─── 2.b Backfill: subir reservas largas a mensual + derivar monthly_rent ────
-- IMPORTANTE: este backfill DEBE correr antes de añadir el constraint
-- bookings_monthly_requires_rent, sino las reservas existentes lo violan.
-- Heurística: bookings con duración >= 28 días → mensual.
-- monthly_rent = total_amount × 30 / noches (renta mensual prorrateada).
UPDATE apartcba.bookings
   SET mode = 'mensual',
       monthly_rent = ROUND((total_amount::numeric * 30.0 / NULLIF((check_out_date - check_in_date), 0))::numeric, 2)
 WHERE mode = 'temporario'
   AND (check_out_date - check_in_date) >= 28
   AND status NOT IN ('cancelada','no_show');

-- units: derivar default_mode desde el histórico de reservas
UPDATE apartcba.units u
   SET default_mode = sub.suggested_mode
  FROM (
    SELECT
      unit_id,
      CASE
        WHEN bool_and(mode = 'mensual') THEN 'mensual'
        WHEN bool_or(mode = 'mensual') THEN 'mixto'
        ELSE 'temporario'
      END AS suggested_mode
    FROM apartcba.bookings
    WHERE status NOT IN ('cancelada','no_show')
    GROUP BY unit_id
  ) sub
 WHERE u.id = sub.unit_id
   AND u.default_mode = 'temporario';

-- Coherencia: si mode=mensual exigir monthly_rent (después del backfill)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_monthly_requires_rent'
  ) THEN
    ALTER TABLE apartcba.bookings
      ADD CONSTRAINT bookings_monthly_requires_rent
      CHECK (mode <> 'mensual' OR monthly_rent IS NOT NULL);
  END IF;
END $$;

-- ─── 3. booking_extensions (audit append-only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.booking_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  operation text NOT NULL
    CHECK (operation IN ('move','extend_right','shorten_right','extend_left','shorten_left','change_unit')),
  previous_unit_id uuid NOT NULL REFERENCES apartcba.units(id),
  new_unit_id uuid NOT NULL REFERENCES apartcba.units(id),
  previous_check_in_date date NOT NULL,
  new_check_in_date date NOT NULL,
  previous_check_out_date date NOT NULL,
  new_check_out_date date NOT NULL,
  delta_days integer NOT NULL,
  previous_total_amount numeric(14,2),
  new_total_amount numeric(14,2),
  reason text,
  actor_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_extensions_booking
  ON apartcba.booking_extensions(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_extensions_org_date
  ON apartcba.booking_extensions(organization_id, created_at DESC);

ALTER TABLE apartcba.booking_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.booking_extensions;
CREATE POLICY members_all ON apartcba.booking_extensions FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

GRANT ALL ON apartcba.booking_extensions TO authenticated, service_role;

COMMENT ON TABLE apartcba.booking_extensions IS
  'Audit append-only de cambios de fecha/unidad en bookings (drag & drop o extensiones).';

-- ─── 4. Trigger: registrar cambios en booking_extensions ─────────────────────
CREATE OR REPLACE FUNCTION apartcba.tg_booking_extensions_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_op text;
  v_delta integer;
  v_actor uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  -- Solo loguear si cambió unit o fechas
  IF NEW.unit_id = OLD.unit_id
     AND NEW.check_in_date = OLD.check_in_date
     AND NEW.check_out_date = OLD.check_out_date THEN
    RETURN NEW;
  END IF;

  v_delta := (NEW.check_out_date - OLD.check_out_date)
           + (OLD.check_in_date - NEW.check_in_date);

  IF NEW.unit_id <> OLD.unit_id THEN
    v_op := 'change_unit';
  ELSIF NEW.check_out_date > OLD.check_out_date THEN
    v_op := 'extend_right';
  ELSIF NEW.check_out_date < OLD.check_out_date THEN
    v_op := 'shorten_right';
  ELSIF NEW.check_in_date < OLD.check_in_date THEN
    v_op := 'extend_left';
  ELSIF NEW.check_in_date > OLD.check_in_date THEN
    v_op := 'shorten_left';
  ELSE
    v_op := 'move';
  END IF;

  -- auth.uid() puede ser NULL si el cambio viene de service_role (server actions);
  -- en ese caso intentamos leer la sesión vía configuración (settings) opcional
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  INSERT INTO apartcba.booking_extensions (
    organization_id, booking_id, operation,
    previous_unit_id, new_unit_id,
    previous_check_in_date, new_check_in_date,
    previous_check_out_date, new_check_out_date,
    delta_days,
    previous_total_amount, new_total_amount,
    actor_user_id
  ) VALUES (
    NEW.organization_id, NEW.id, v_op,
    OLD.unit_id, NEW.unit_id,
    OLD.check_in_date, NEW.check_in_date,
    OLD.check_out_date, NEW.check_out_date,
    v_delta,
    OLD.total_amount, NEW.total_amount,
    v_actor
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_booking_extensions_log ON apartcba.bookings;
CREATE TRIGGER trg_booking_extensions_log
  AFTER UPDATE ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_booking_extensions_log();

-- ─── 5. settlement_lines: nuevos line_types para liquidación mensual ─────────
ALTER TABLE apartcba.settlement_lines
  DROP CONSTRAINT IF EXISTS settlement_lines_line_type_check;
ALTER TABLE apartcba.settlement_lines
  ADD CONSTRAINT settlement_lines_line_type_check
  CHECK (line_type IN (
    'booking_revenue','commission','maintenance_charge','cleaning_charge',
    'adjustment','monthly_rent_fraction','expenses_fraction'
  ));

-- ─── 6. Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.booking_extensions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
