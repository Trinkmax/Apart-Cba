-- Tabla de historial de corridas de sync
CREATE TABLE apartcba.ical_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL REFERENCES apartcba.ical_feeds(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','ok','error')) DEFAULT 'running',
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  trigger_source text NOT NULL CHECK (trigger_source IN ('cron','manual','create_feed'))
);

CREATE INDEX idx_sync_runs_feed ON apartcba.ical_sync_runs(feed_id, started_at DESC);
CREATE INDEX idx_sync_runs_org ON apartcba.ical_sync_runs(organization_id, started_at DESC);

-- Vista de salud por feed
CREATE OR REPLACE VIEW apartcba.ical_feed_health AS
SELECT
  f.id AS feed_id,
  f.organization_id,
  COUNT(*) FILTER (WHERE r.status = 'error' AND r.started_at > now() - interval '24 hours') AS errors_24h,
  MAX(r.started_at) FILTER (WHERE r.status = 'ok') AS last_ok_at,
  CASE
    WHEN COUNT(*) FILTER (WHERE r.status = 'error' AND r.started_at > now() - interval '6 hours') >= 3 THEN 'broken'
    WHEN COUNT(*) FILTER (WHERE r.status = 'error' AND r.started_at > now() - interval '24 hours') >= 1 THEN 'warning'
    ELSE 'ok'
  END AS health
FROM apartcba.ical_feeds f
LEFT JOIN apartcba.ical_sync_runs r ON r.feed_id = f.id
GROUP BY f.id, f.organization_id;
