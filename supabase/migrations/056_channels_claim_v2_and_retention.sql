-- ════════════════════════════════════════════════════════════════════════════
-- 056 — Canales de venta: claim v2 (feed_url en el mismo RPC) + retención de
--       channel_sync_runs
-- ════════════════════════════════════════════════════════════════════════════
-- APLICAR ANTES del deploy del dispatcher nuevo (src/lib/channels/dispatch.ts).
-- El código hace fallback al RPC viejo si éste no existe (PGRST202), así que
-- el orden inverso no rompe nada — sólo no ahorra.
--
-- Por qué: el dispatcher paga ~220 ms de red por CADA request a Supabase
-- (Vercel gru1/pdx1 ↔ Supabase us-west-2), y Vercel Fluid cobra wall-clock.
-- Hoy cada conexión cuesta 3 requests por lectura (crm_get_secret + GET
-- channel_reservations + PATCH channel_links) ≈ 50k requests/día y 2-3 h/día
-- de función. Con este RPC el secreto viaja junto con el claim: un request
-- menos por conexión (~16k/día).
--
-- La función vieja (channels_claim_due_links) queda INTACTA como fallback.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─── 1. Claim v2: devuelve la fila + feed_url desencriptada ─────────────────
-- SETOF jsonb (y no SETOF channel_links + columna): así no hay que enumerar las
-- columnas de channel_links y la función no se desactualiza cuando la tabla
-- cambie. PostgREST entrega cada jsonb tal cual → array de objetos.
CREATE OR REPLACE FUNCTION apartcba.channels_claim_due_links_v2(
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = apartcba, public
AS $$
BEGIN
  -- clamps defensivos: esta función corre con privilegios elevados
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    p_limit := 20;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    p_lease_seconds := 120;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT cl.id
    FROM apartcba.channel_links cl
    WHERE cl.status = 'active'
      AND cl.next_poll_at <= now()
      AND (cl.claimed_until IS NULL OR cl.claimed_until < now())
    ORDER BY cl.next_poll_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE apartcba.channel_links l
       SET claimed_until = now() + make_interval(secs => p_lease_seconds),
           last_attempt_at = now()
      FROM due
     WHERE l.id = due.id
    RETURNING l.*
  )
  SELECT to_jsonb(u) || jsonb_build_object('feed_url', s.decrypted_secret)
    FROM upd u
    LEFT JOIN vault.decrypted_secrets s ON s.id = u.feed_secret_id;
END $$;

-- Devuelve URLs de feed con token: SOLO service_role. `apartcba` está en
-- pgrst.db_schemas, así que anon llega a la ruta REST y lo único que lo frena
-- es este grant (verificado: el RPC viejo responde 42501 a anon).
REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links_v2(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links_v2(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION apartcba.channels_claim_due_links_v2(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION apartcba.channels_claim_due_links_v2(integer, integer) TO service_role;

COMMENT ON FUNCTION apartcba.channels_claim_due_links_v2(integer, integer) IS
  'Dispatcher de Canales: reclama conexiones vencidas (FOR UPDATE SKIP LOCKED) y devuelve cada fila de channel_links como jsonb con feed_url desencriptada. Sólo service_role.';

-- ─── 2. Purga inicial de channel_sync_runs (> 14 días) ──────────────────────
-- ~63k filas (1/minuto desde el 17/07, nunca se purgó, 31 MB). Nadie la lee
-- desde la UI. En lotes de 5.000 para no tener un DELETE gigante en un solo
-- statement; corre como postgres (sin el statement_timeout de 8 s de PostgREST).
DO $$
DECLARE
  v_deleted bigint;
  v_total bigint := 0;
BEGIN
  LOOP
    DELETE FROM apartcba.channel_sync_runs
     WHERE id IN (
       SELECT id FROM apartcba.channel_sync_runs
        WHERE started_at < now() - interval '14 days'
        ORDER BY started_at
        LIMIT 5000
     );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total := v_total + v_deleted;
    EXIT WHEN v_deleted = 0;
  END LOOP;
  RAISE NOTICE 'channel_sync_runs: % filas purgadas (> 14 días)', v_total;
END $$;

-- ─── 3. Retención diaria desde adentro de la base (pg_cron) ─────────────────
-- Complementa la purga del reconcile diario de la app: si el reconcile falla o
-- no corre, la tabla igual no vuelve a crecer sin límite.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'apartcba_purge_channel_sync_runs'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'apartcba_purge_channel_sync_runs',
  '15 3 * * *',
  $$DELETE FROM apartcba.channel_sync_runs WHERE started_at < now() - interval '14 days'$$
);

-- ─── 4. Verificación ────────────────────────────────────────────────────────
-- Ambas deben dar false / true respectivamente:
--   SELECT has_function_privilege('anon', 'apartcba.channels_claim_due_links_v2(integer,integer)', 'EXECUTE');
--   SELECT has_function_privilege('service_role', 'apartcba.channels_claim_due_links_v2(integer,integer)', 'EXECUTE');
-- Y el conteo de la tabla:
--   SELECT count(*), min(started_at) FROM apartcba.channel_sync_runs;

-- ════════════════════════════════════════════════════════════════════════════
-- MANUAL, ejecutar DESPUÉS del deploy del dispatcher nuevo
-- ════════════════════════════════════════════════════════════════════════════
-- Recién cuando se vean corridas con claimed_count > 12 y finished_at seteado
-- (SELECT claimed_count, duration_ms, finished_at, results FROM
--  apartcba.channel_sync_runs ORDER BY started_at DESC LIMIT 20), pasar el
-- dispatcher a cada 2 minutos. Con el CÓDIGO VIEJO (un batch de 12 por
-- corrida) esto dejaría 6 links/min de capacidad → ~12 min por conexión y
-- todas las conexiones "degradadas". Por eso va después, nunca antes.
--
-- SELECT cron.alter_job(
--   job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'apartcba_channel_dispatch_v2'),
--   schedule := '*/2 * * * *'
-- );
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'apartcba_channel_dispatch_v2';
--
-- Rollback: SELECT cron.alter_job(job_id := <jobid>, schedule := '* * * * *');
--
-- Opcional, fuera de transacción (VACUUM no corre dentro de una), para devolver
-- el espacio de la purga inicial:
-- VACUUM (ANALYZE) apartcba.channel_sync_runs;
