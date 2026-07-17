-- ════════════════════════════════════════════════════════════════════════════
-- 040 — Canales de venta v2: backfill idempotente desde las tablas legacy
-- ════════════════════════════════════════════════════════════════════════════
-- Migra automáticamente, sin que el usuario re-ingrese nada:
--   • ical_feeds (activos, airbnb/booking)  → channel_links (+ URL del feed a Vault)
--   • units.ical_export_token               → token saliente por link (hash + Vault)
--   • ota_listings                          → channel_links.external_listing_id
--   • bookings con external_id (airbnb/booking) → booking_external_refs +
--     channel_reservations canónicas
--   • organizations                         → channel_settings
--
-- Re-ejecutable: cada paso hace skip si el destino ya existe. No toca UUIDs,
-- pagos, Caja ni huéspedes. No infiere huéspedes. No borra nada.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─── 1. channel_settings por organización ────────────────────────────────────
INSERT INTO apartcba.channel_settings (organization_id, email_ingest_enabled, email_verified_at, last_email_at)
SELECT
  o.id,
  true,
  (SELECT min(l.received_at) FROM apartcba.inbound_email_log l WHERE l.organization_id = o.id),
  (SELECT max(l.received_at) FROM apartcba.inbound_email_log l WHERE l.organization_id = o.id)
FROM apartcba.organizations o
ON CONFLICT (organization_id) DO NOTHING;

-- ─── 2. ical_feeds → channel_links (feeds entrantes a Vault) ─────────────────
DO $$
DECLARE
  f record;
  v_link_id uuid;
  v_feed_secret_id uuid;
  v_export_secret_id uuid;
  v_export_token text;
  v_listing record;
  v_migrated integer := 0;
BEGIN
  FOR f IN
    SELECT fe.*, u.ical_export_token AS unit_export_token
    FROM apartcba.ical_feeds fe
    JOIN apartcba.units u ON u.id = fe.unit_id
    WHERE fe.source IN ('airbnb', 'booking')
      AND NOT EXISTS (
        SELECT 1 FROM apartcba.channel_links cl
        WHERE cl.organization_id = fe.organization_id
          AND cl.unit_id = fe.unit_id
          AND cl.channel = fe.source
      )
  LOOP
    v_link_id := gen_random_uuid();

    -- feed entrante → Vault (idempotente por nombre)
    SELECT id INTO v_feed_secret_id FROM vault.secrets WHERE name = 'channels_v2_feed_' || f.id;
    IF v_feed_secret_id IS NULL THEN
      v_feed_secret_id := vault.create_secret(f.feed_url, 'channels_v2_feed_' || f.id,
        'URL del feed iCal entrante (channel_links) — migrado de ical_feeds');
    END IF;

    -- token saliente: reusa el token actual de la unidad para que las URLs ya
    -- pegadas en Airbnb/Booking sigan funcionando via el adaptador legacy
    v_export_token := f.unit_export_token;
    SELECT id INTO v_export_secret_id FROM vault.secrets WHERE name = 'channels_v2_export_' || f.id;
    IF v_export_secret_id IS NULL THEN
      v_export_secret_id := vault.create_secret(v_export_token, 'channels_v2_export_' || f.id,
        'Token del calendario saliente (channel_links) — migrado de units.ical_export_token');
    END IF;

    INSERT INTO apartcba.channel_links (
      id, organization_id, unit_id, channel, status, label,
      feed_secret_id, export_token_hash, export_secret_id,
      next_poll_at, last_success_at, consecutive_failures, health
    ) VALUES (
      v_link_id, f.organization_id, f.unit_id, f.source,
      CASE WHEN f.active THEN 'active' ELSE 'paused' END,
      f.label,
      v_feed_secret_id,
      encode(extensions.digest(v_export_token, 'sha256'), 'hex'),
      v_export_secret_id,
      now(),
      CASE WHEN f.last_sync_status = 'ok' THEN f.last_sync_at ELSE NULL END,
      CASE WHEN f.last_sync_status = 'error' THEN 1 ELSE 0 END,
      jsonb_build_object('migrated_from_feed', f.id)
    );
    v_migrated := v_migrated + 1;
  END LOOP;
  RAISE NOTICE 'channel_links migrados: %', v_migrated;
END $$;

-- ─── 3. ota_listings → external_listing_id en channel_links ──────────────────
UPDATE apartcba.channel_links cl
   SET external_listing_id = ol.external_listing_id,
       external_listing_url = COALESCE(cl.external_listing_url, ol.external_listing_url)
  FROM apartcba.ota_listings ol
 WHERE ol.organization_id = cl.organization_id
   AND ol.unit_id = cl.unit_id
   AND ol.provider = cl.channel
   AND ol.active
   AND cl.external_listing_id IS NULL;

-- ─── 4. bookings externos → booking_external_refs ────────────────────────────
INSERT INTO apartcba.booking_external_refs (organization_id, booking_id, channel, link_id, ref_type, ref_value)
SELECT
  b.organization_id,
  b.id,
  b.source,
  cl.id,
  CASE
    WHEN b.source = 'airbnb' AND b.external_id ~ '^HM[A-Z0-9]{6,10}$' THEN 'confirmation_code'
    WHEN b.source = 'booking' AND b.external_id ~ '^[0-9]{8,14}$' THEN 'reservation_number'
    ELSE 'ical_uid'
  END,
  CASE
    WHEN b.source = 'airbnb' AND b.external_id ~ '^HM[A-Z0-9]{6,10}$' THEN upper(b.external_id)
    ELSE b.external_id
  END
FROM apartcba.bookings b
LEFT JOIN apartcba.channel_links cl
  ON cl.organization_id = b.organization_id
 AND cl.unit_id = b.unit_id
 AND cl.channel = b.source
WHERE b.source IN ('airbnb', 'booking')
  AND b.external_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── 5. bookings externos → channel_reservations canónicas ───────────────────
INSERT INTO apartcba.channel_reservations (
  organization_id, link_id, unit_id, channel, booking_id,
  external_status, check_in, check_out, ical_uid, confirmation_code, last_seen_at
)
SELECT
  b.organization_id,
  cl.id,
  b.unit_id,
  b.source,
  b.id,
  CASE WHEN b.status = 'cancelada' THEN 'cancelled' ELSE 'active' END,
  b.check_in_date,
  b.check_out_date,
  CASE
    WHEN NOT (b.source = 'airbnb' AND b.external_id ~ '^HM[A-Z0-9]{6,10}$')
     AND NOT (b.source = 'booking' AND b.external_id ~ '^[0-9]{8,14}$')
    THEN b.external_id
  END,
  CASE
    WHEN b.source = 'airbnb' AND b.external_id ~ '^HM[A-Z0-9]{6,10}$' THEN upper(b.external_id)
    WHEN b.source = 'booking' AND b.external_id ~ '^[0-9]{8,14}$' THEN b.external_id
  END,
  -- las activas cuentan como "observadas" para el tracking de desaparición
  CASE WHEN b.status <> 'cancelada' THEN now() END
FROM apartcba.bookings b
LEFT JOIN apartcba.channel_links cl
  ON cl.organization_id = b.organization_id
 AND cl.unit_id = b.unit_id
 AND cl.channel = b.source
WHERE b.source IN ('airbnb', 'booking')
  AND b.external_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM apartcba.channel_reservations cr WHERE cr.booking_id = b.id
  )
ON CONFLICT DO NOTHING;
