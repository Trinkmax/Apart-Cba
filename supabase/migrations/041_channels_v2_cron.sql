-- ════════════════════════════════════════════════════════════════════════════
-- 041 — Canales de venta v2: pg_cron + cutover del pipeline legacy
-- ════════════════════════════════════════════════════════════════════════════
-- APLICAR DESPUÉS del deploy que expone /api/cron/channel-dispatch (el endpoint
-- es fail-closed: sin secret responde 401/503 y no hace nada).
--
--   apartcba_channel_dispatch_v2  → cada minuto; reclama hasta 12 conexiones
--                                   vencidas via channels_claim_due_links()
--   apartcba_channel_reconcile_v2 → diario 06:20 UTC; reconciliación completa
--
-- El secreto NO vive en este archivo: se copia a Vault desde el job existente
-- del CRM (mismo PG_CRON_SECRET server-only de Vercel) y los jobs lo leen de
-- vault.decrypted_secrets en cada ejecución.

-- ─── 1. Secreto compartido en Vault ─────────────────────────────────────────
DO $$
DECLARE
  v_secret text;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'apartcba_pg_cron_secret';
  IF v_existing IS NOT NULL THEN
    RETURN; -- ya está; no rotamos acá
  END IF;

  -- extrae el secreto inline del job CRM ya operativo (evita duplicar fuentes)
  SELECT substring(command FROM '''x-pg-cron-secret'',\s*''([^'']+)''')
    INTO v_secret
    FROM cron.job
   WHERE jobname = 'crm-dispatch-subdaily';

  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION 'No se pudo derivar apartcba_pg_cron_secret del job crm-dispatch-subdaily';
  END IF;

  PERFORM vault.create_secret(v_secret, 'apartcba_pg_cron_secret',
    'Secreto compartido pg_cron -> endpoints /api/cron/* (coincide con PG_CRON_SECRET en Vercel)');
END $$;

-- ─── 2. Jobs únicos por nombre (unschedule + schedule) ──────────────────────
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job
    WHERE jobname IN ('apartcba_channel_dispatch_v2', 'apartcba_channel_reconcile_v2')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'apartcba_channel_dispatch_v2',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://www.apartcba.com/api/cron/channel-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pg-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apartcba_pg_cron_secret')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'job', 'channel_dispatch', 'mode', 'dispatch'),
    timeout_milliseconds := 55000
  );
  $$
);

SELECT cron.schedule(
  'apartcba_channel_reconcile_v2',
  '20 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://www.apartcba.com/api/cron/channel-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pg-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'apartcba_pg_cron_secret')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'job', 'channel_reconcile', 'mode', 'reconcile'),
    timeout_milliseconds := 55000
  );
  $$
);

-- ─── 3. Cutover: apagar el pipeline legacy (rollback = revertir estos UPDATE) ─
-- El código nuevo además "gatea" el sync legacy si existen channel_links
-- activos, así que no hay doble procesamiento aunque este UPDATE se revierta.
UPDATE apartcba.ical_feeds SET active = false WHERE active;
