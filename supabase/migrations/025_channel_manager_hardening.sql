-- ════════════════════════════════════════════════════════════════════════════
-- 025 — Channel Manager: hardening para producción
-- ════════════════════════════════════════════════════════════════════════════
-- • RLS en ical_sync_runs — 020 creó la tabla sin RLS; quedaba expuesta a la
--   anon key. Mismo patrón members_all que el resto de las tablas tenant-scoped.
-- • Contadores conflict_count / updated_count en ical_sync_runs para que el
--   historial de sync refleje conflictos de fecha y reservas actualizadas.
-- • raw_body en inbound_email_log — guarda el cuerpo del email entrante para
--   poder depurar parsers que fallan (antes no quedaba traza del contenido).
-- • notification.type 'inbound_booking_conflict' — conflicto de fechas al
--   importar una reserva de OTA (por email o por iCal).

-- ─── RLS en ical_sync_runs ───────────────────────────────────────────────────
ALTER TABLE apartcba.ical_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_all ON apartcba.ical_sync_runs;
CREATE POLICY members_all ON apartcba.ical_sync_runs FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

-- ─── Contadores extra en ical_sync_runs ──────────────────────────────────────
ALTER TABLE apartcba.ical_sync_runs
  ADD COLUMN IF NOT EXISTS conflict_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_count  integer NOT NULL DEFAULT 0;

-- ─── raw_body en inbound_email_log ───────────────────────────────────────────
ALTER TABLE apartcba.inbound_email_log
  ADD COLUMN IF NOT EXISTS raw_body text;

-- ─── notification.type: agregar inbound_booking_conflict ─────────────────────
ALTER TABLE apartcba.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE apartcba.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'payment_due',
    'payment_overdue',
    'payment_received',
    'lease_ending_soon',
    'lease_split_created',
    'task_reminder',
    'inbound_booking_pending',
    'inbound_booking_cancelled',
    'inbound_booking_unmatched_unit',
    'inbound_booking_conflict',
    'channel_feed_error',
    'manual',
    'other'
  ));
