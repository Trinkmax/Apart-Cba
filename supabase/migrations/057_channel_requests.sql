-- 057_channel_requests.sql
--
-- SOLICITUDES DE CANAL — que el calendario se cierre al confirmarse, no al pedirse.
--
-- El problema (incidente 2026-09-01): los anuncios de Airbnb no tienen reserva
-- instantánea, así que cada reserva empieza como SOLICITUD que el anfitrión
-- acepta o rechaza. Airbnb publica esa solicitud pendiente en el feed iCal con
-- un VEVENT idéntico al de una reserva confirmada (SUMMARY:Reserved + código HM
-- en la DESCRIPTION), así que el pipeline la proyectaba como reserva y bloqueaba
-- el calendario. Cuando el anfitrión la rechazaba, el VEVENT desaparecía pero la
-- reserva local quedaba ocupando fechas hasta que una persona la cancelaba a
-- mano. 5 de 7 reservas de Airbnb creadas entre el 30/08 y el 01/09 eran así.
--
-- La solución: `external_status='pending'` — la fila queda registrada, visible y
-- con last_seen_at al día, pero NO se escribe en `bookings`. Se promueve a
-- reserva real sólo con evidencia POSITIVA de confirmación (email de la OTA,
-- botón del staff, o el TTL como red de seguridad) y se descarta sola cuando el
-- VEVENT desaparece del feed.
--
-- Idempotente. No modifica filas existentes salvo el saneamiento explícito de §7.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. external_status: 'pending' (solicitud) y 'expired' (solicitud caída)
--    'expired' ≠ 'cancelled': "nunca llegó a ser reserva" vs "la OTA la sacó".
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_external_status_check;
ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_external_status_check
  CHECK (external_status IN ('active', 'pending', 'cancelled', 'ignored', 'expired'));

COMMENT ON COLUMN apartcba.channel_reservations.external_status IS
  'active=vigente y proyectada a bookings | pending=SOLICITUD sin confirmar (no crea booking) | cancelled=la OTA la sacó | ignored=el operador liberó las fechas a mano | expired=solicitud que desapareció del feed sin confirmarse (descarte automático, reversible)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trazabilidad: por qué dejó de ser solicitud
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS promoted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_source text,
  ADD COLUMN IF NOT EXISTS promoted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expired_at      timestamptz;

ALTER TABLE apartcba.channel_reservations
  DROP CONSTRAINT IF EXISTS channel_reservations_promoted_source_check;
ALTER TABLE apartcba.channel_reservations
  ADD CONSTRAINT channel_reservations_promoted_source_check
  CHECK (promoted_source IS NULL
         OR promoted_source IN ('email', 'email_backfill', 'manual', 'ttl'));

COMMENT ON COLUMN apartcba.channel_reservations.promoted_source IS
  'email=llegó la confirmación de la OTA | email_backfill=la confirmación había llegado ANTES que el iCal | manual=alguien apretó "Es una reserva" | ttl=seguía publicada pasado el umbral y nunca llegó el mail';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índices
-- ─────────────────────────────────────────────────────────────────────────────
-- bandeja de solicitudes + capa de la grilla (por org y fecha de llegada)
CREATE INDEX IF NOT EXISTS idx_channel_res_pending
  ON apartcba.channel_reservations (organization_id, check_in)
  WHERE external_status = 'pending';

-- watchdog de la capa en vivo (max(updated_at) por org)
CREATE INDEX IF NOT EXISTS idx_channel_res_org_updated
  ON apartcba.channel_reservations (organization_id, updated_at DESC);

-- espejo de la confirmación: buscar el email que llegó ANTES que el iCal.
-- Medido en producción: la confirmación de Airbnb gana la carrera por 3-5 min
-- (HMBWFPRPB5 el 01/09: email 16:40:35, iCal 16:44:07).
CREATE INDEX IF NOT EXISTS idx_channel_events_email_code
  ON apartcba.channel_events (organization_id, (payload ->> 'confirmation_code'))
  WHERE transport = 'email' AND event_type = 'reservation_upsert';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. notifications_type_check — deuda pre-existente + tipos nuevos.
--    `channel_cancellation_pending` se venía insertando desde la migración 053
--    sin estar en el CHECK: el insert fallaba con 23514 y el código no leía el
--    error, así que todas las propuestas de cancelación nacían sin aviso.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE apartcba.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE apartcba.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'payment_due', 'payment_overdue', 'payment_received',
  'lease_ending_soon', 'lease_split_created', 'task_reminder',
  'inbound_booking_pending', 'inbound_booking_cancelled',
  'inbound_booking_unmatched_unit', 'inbound_booking_conflict',
  'channel_feed_error', 'manual', 'other',
  'channel_cancellation_pending',   -- deuda: nunca pudo insertarse
  'channel_request_pending',        -- solicitud con llegada cercana sin confirmar
  'channel_request_auto_confirmed'  -- promovida por TTL, sin aviso de la OTA
));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Política por organización y por canal. Default APAGADO: el fallo seguro es
--    el comportamiento de hoy. Se enciende con un UPDATE, sin deploy.
--
--    hold_availability = mientras la solicitud está pendiente, ¿bloqueamos la
--    venta en la WEB PROPIA (date-picker y checkout del marketplace)?
--    OJO: NO gobierna el iCal saliente hacia las otras OTAs. Eso se exporta
--    siempre que la política esté encendida — "no cierro mi calendario" no
--    puede significar "dejo de bloquear a Booking.com", que termina en venta
--    doble (hay 9 unidades con conexión activa de los dos canales a la vez).
--      · airbnb → false: la solicitud todavía no es una venta; el dueño pidió
--        explícitamente que el calendario no se cierre hasta que se acepte.
--      · booking → true: Booking.com no tiene solicitudes, sus reservas son
--        instantáneas. Un VEVENT sin confirmar es o basura (marcadores de
--        ventana) o una reserva YA VENDIDA cuya confirmación todavía no cruzamos.
--        Retener es estrictamente mejor que el comportamiento actual (que crea
--        la reserva directamente).
--
--    ttl_hours = red de seguridad. Medido sobre 40 días de producción: de 22
--    reservas de Airbnb reales, 4 nunca recibieron email de confirmación. Sin
--    TTL esas 4 quedarían invisibles hasta que alguien las confirmara a mano.
--    Airbnb resuelve en 24 h y lo rechazado DESAPARECE del feed, así que lo que
--    sigue publicado a las 26 h está aceptado.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE apartcba.channel_settings
   SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{requests}',
         '{
            "airbnb":  {"enabled": false, "hold_availability": false,
                        "ttl_hours": 26, "ttl_hours_urgent": 3, "urgent_days": 2,
                        "only_link_ids": [], "exclude_link_ids": []},
            "booking": {"enabled": false, "hold_availability": true,
                        "ttl_hours": 26, "ttl_hours_urgent": 3, "urgent_days": 2,
                        "only_link_ids": [], "exclude_link_ids": []}
          }'::jsonb,
         true)
 WHERE config -> 'requests' IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Realtime — la grilla del PMS pinta las solicitudes en vivo.
--    REPLICA IDENTITY DEFAULT a propósito: la fila lleva `guest` y `amounts`
--    jsonb, y Realtime NO aplica filtros ni RLS a los DELETE (mismo razonamiento
--    que 055_realtime_live_layer.sql para bookings).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE apartcba.channel_reservations REPLICA IDENTITY DEFAULT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'apartcba'
       AND tablename = 'channel_reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.channel_reservations;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SANEAMIENTO — único punto que toca datos existentes.
--
-- Fantasmas en bucle infinito: filas 'active' cuyo VEVENT desapareció (missing_since
-- puesto) pero cuyo booking ya fue cancelado a mano. openCancellationRequest
-- devuelve false porque el booking no está vivo, pero el contador de ausencias
-- se incrementa igual: missing_runs sube cada 2 minutos, para siempre, sin
-- estado terminal posible. Se cierran como 'cancelled' — que es lo que son.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE apartcba.channel_reservations cr
   SET external_status = 'cancelled', missing_since = NULL, missing_runs = 0
  FROM apartcba.bookings b
 WHERE b.id = cr.booking_id
   AND cr.external_status = 'active'
   AND cr.missing_since IS NOT NULL
   AND b.status IN ('cancelada', 'no_show');

UPDATE apartcba.channel_issues i
   SET status = 'resolved',
       resolution = 'La reserva local ya estaba cancelada (saneamiento 057).',
       resolved_at = now()
 WHERE i.status = 'open'
   AND i.dedupe_key LIKE 'missing:%'
   AND EXISTS (
     SELECT 1 FROM apartcba.channel_reservations cr
      WHERE cr.id = i.reservation_id AND cr.external_status = 'cancelled'
   );
