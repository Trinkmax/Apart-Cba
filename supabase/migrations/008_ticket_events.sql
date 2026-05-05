-- Historial inmutable de cambios sobre maintenance_tickets.
-- Registra create/update/status-change con quién, cuándo y qué cambió.
CREATE TABLE IF NOT EXISTS apartcba.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES apartcba.maintenance_tickets(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL
    CHECK (event_type IN ('created','status_changed','updated','cost_updated','assigned','note_added')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_created
  ON apartcba.ticket_events(ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_events_org_created
  ON apartcba.ticket_events(organization_id, created_at DESC);

ALTER TABLE apartcba.ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ticket_events_select ON apartcba.ticket_events;
CREATE POLICY ticket_events_select ON apartcba.ticket_events
  FOR SELECT USING (true);

DROP POLICY IF EXISTS ticket_events_insert ON apartcba.ticket_events;
CREATE POLICY ticket_events_insert ON apartcba.ticket_events
  FOR INSERT WITH CHECK (true);
