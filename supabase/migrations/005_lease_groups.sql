-- ════════════════════════════════════════════════════════════════════════════
-- 005 — Lease groups: agrupa reservas mensuales consecutivas del mismo
-- contrato (split automático cuando duración > 30 noches).
--
-- Cuando se carga una reserva mensual de varios meses (ej. 90 noches), el
-- backend la divide en N reservas consecutivas que comparten lease_group_id,
-- así cada mes puede facturarse, cobrarse y liquidarse de forma independiente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS lease_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_bookings_lease_group
  ON apartcba.bookings(lease_group_id, check_in_date)
  WHERE lease_group_id IS NOT NULL;

COMMENT ON COLUMN apartcba.bookings.lease_group_id IS
  'Agrupa reservas mensuales consecutivas del mismo contrato (split automático cuando duración > 30 noches).';
