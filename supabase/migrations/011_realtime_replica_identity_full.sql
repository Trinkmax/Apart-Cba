-- Set REPLICA IDENTITY FULL on the three "ticket-like" tables that are
-- subscribed via the supabase_realtime publication. Without this, DELETE events
-- only contain the primary key in their `old` payload, so any postgres_changes
-- subscription that uses a server-side filter such as
-- `organization_id=eq.<org>` would silently drop those events (the filter
-- column isn't present). With FULL, the `old` row carries every column and the
-- filter (and RLS) can be evaluated correctly. WAL volume is irrelevant for
-- these low-write tables.
ALTER TABLE apartcba.maintenance_tickets REPLICA IDENTITY FULL;
ALTER TABLE apartcba.cleaning_tasks REPLICA IDENTITY FULL;
ALTER TABLE apartcba.concierge_requests REPLICA IDENTITY FULL;
