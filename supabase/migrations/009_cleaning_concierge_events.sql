-- Historial inmutable para tareas de limpieza y conserjería.
-- Mismo patrón que ticket_events (008): registra crear/actualizar/cambiar estado
-- con actor + timestamp + metadata. La seguridad efectiva vive en server actions.

-- ─── cleaning_events ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.cleaning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_task_id uuid NOT NULL REFERENCES apartcba.cleaning_tasks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL
    CHECK (event_type IN ('created','status_changed','updated','assigned','checklist_updated','cost_updated')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_events_task_created
  ON apartcba.cleaning_events(cleaning_task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_org_created
  ON apartcba.cleaning_events(organization_id, created_at DESC);

ALTER TABLE apartcba.cleaning_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cleaning_events_select ON apartcba.cleaning_events;
CREATE POLICY cleaning_events_select ON apartcba.cleaning_events FOR SELECT USING (true);
DROP POLICY IF EXISTS cleaning_events_insert ON apartcba.cleaning_events;
CREATE POLICY cleaning_events_insert ON apartcba.cleaning_events FOR INSERT WITH CHECK (true);

-- ─── concierge_events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.concierge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concierge_request_id uuid NOT NULL REFERENCES apartcba.concierge_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL
    CHECK (event_type IN ('created','status_changed','updated','assigned','cost_updated','alert_updated')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concierge_events_req_created
  ON apartcba.concierge_events(concierge_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concierge_events_org_created
  ON apartcba.concierge_events(organization_id, created_at DESC);

ALTER TABLE apartcba.concierge_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS concierge_events_select ON apartcba.concierge_events;
CREATE POLICY concierge_events_select ON apartcba.concierge_events FOR SELECT USING (true);
DROP POLICY IF EXISTS concierge_events_insert ON apartcba.concierge_events;
CREATE POLICY concierge_events_insert ON apartcba.concierge_events FOR INSERT WITH CHECK (true);
