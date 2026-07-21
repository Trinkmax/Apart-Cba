-- ════════════════════════════════════════════════════════════════════════════
-- 045 — Pago real de tickets de mantenimiento en Caja.
--
-- El ticket ya carga el `actual_cost` al propietario en la liquidación (vía el
-- scan de maintenance_tickets). Lo que faltaba: registrar el EGRESO real (pago
-- al técnico/materiales) en Caja y vincularlo al ticket para no pagarlo dos
-- veces. `paid_movement_id` → el egreso; `on delete set null` para que borrar el
-- egreso en Caja "despague" el ticket automáticamente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.maintenance_tickets
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_movement_id uuid
    REFERENCES apartcba.cash_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS maintenance_tickets_paid_movement_id_idx
  ON apartcba.maintenance_tickets(paid_movement_id)
  WHERE paid_movement_id IS NOT NULL;

COMMENT ON COLUMN apartcba.maintenance_tickets.paid_movement_id IS
  'Egreso en Caja que pagó el costo real del ticket (pago al técnico). Se linkea con registerTicketPayment; ON DELETE SET NULL lo despaga si se borra el movimiento.';
