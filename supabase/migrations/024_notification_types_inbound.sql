-- ════════════════════════════════════════════════════════════════════════════
-- Channel Manager — Extender notification.type con eventos del inbound email
-- ════════════════════════════════════════════════════════════════════════════
-- El handler de inbound email (Resend) genera notificaciones cuando llegan
-- reservas/cancelaciones de OTAs para que el operador las revise. También
-- para feeds iCal en error persistente y para reservas que no pudieron
-- matchearse a una unidad.

ALTER TABLE apartcba.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE apartcba.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'payment_due',
    'payment_overdue',
    'payment_received',
    'lease_ending_soon',
    'lease_split_created',
    'inbound_booking_pending',
    'inbound_booking_cancelled',
    'inbound_booking_unmatched_unit',
    'channel_feed_error',
    'manual',
    'other'
  ));
