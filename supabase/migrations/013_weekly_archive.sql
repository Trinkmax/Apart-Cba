-- ════════════════════════════════════════════════════════════════════════════
-- 013 — Reset semanal con historial: archived_at en cleaning/mantenimiento/tareas
--
-- Permite que el tablero activo de Limpieza, Mantenimiento y Tareas se "resetee"
-- semanalmente sin perder los registros: el cron de lunes 00:00 ART setea
-- archived_at = now() sobre las tareas finalizadas (terminales) y los tableros
-- filtran archived_at IS NULL. Las archivadas siguen consultables vía toggle
-- "Ver historial" en cada vista.
--
-- Estados terminales:
--   cleaning_tasks       → completada, verificada, cancelada
--   maintenance_tickets  → resuelto, cerrado
--   concierge_requests   → completada, rechazada, cancelada
--
-- Las tareas pendientes/en_progreso NUNCA se archivan automáticamente —
-- siempre arrastran al lunes siguiente para evitar perder trabajo abierto.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.cleaning_tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE apartcba.maintenance_tickets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE apartcba.concierge_requests
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── Índices parciales para el tablero "activo" (consulta más caliente) ─────
CREATE INDEX IF NOT EXISTS idx_cleaning_active
  ON apartcba.cleaning_tasks(organization_id, scheduled_for)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_active
  ON apartcba.maintenance_tickets(organization_id, opened_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_concierge_active
  ON apartcba.concierge_requests(organization_id, scheduled_for)
  WHERE archived_at IS NULL;

-- ── Índices para el "historial" (paginación por fecha de archivo desc) ─────
CREATE INDEX IF NOT EXISTS idx_cleaning_archived
  ON apartcba.cleaning_tasks(organization_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_archived
  ON apartcba.maintenance_tickets(organization_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concierge_archived
  ON apartcba.concierge_requests(organization_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;
