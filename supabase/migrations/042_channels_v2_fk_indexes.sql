-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Canales de venta v2: índices de cobertura para FKs
-- ════════════════════════════════════════════════════════════════════════════
-- El Performance Advisor marcó (INFO) FKs sin índice en las tablas nuevas.
-- Importan para los ON DELETE CASCADE/SET NULL y los lookups de incidencias.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS idx_booking_external_refs_link
  ON apartcba.booking_external_refs(link_id);
CREATE INDEX IF NOT EXISTS idx_channel_issues_booking
  ON apartcba.channel_issues(booking_id);
CREATE INDEX IF NOT EXISTS idx_channel_issues_event
  ON apartcba.channel_issues(event_id);
CREATE INDEX IF NOT EXISTS idx_channel_issues_reservation
  ON apartcba.channel_issues(reservation_id);
CREATE INDEX IF NOT EXISTS idx_channel_issues_resolved_by
  ON apartcba.channel_issues(resolved_by);
CREATE INDEX IF NOT EXISTS idx_channel_res_unit
  ON apartcba.channel_reservations(unit_id);
CREATE INDEX IF NOT EXISTS idx_channel_sync_runs_org
  ON apartcba.channel_sync_runs(organization_id);
