-- ─────────────────────────────────────────────────────────────────────────────
-- 052: recuperar el número de reserva de Booking desde los avisos ya recibidos
--
-- Reportado en producción: "cuando se cancela una reserva de Booking, la
-- reserva queda activa en el sistema".
--
-- Causa: dos identidades que nunca se cruzaban.
--   · el iCal de Booking identifica cada reserva por `ical_uid` y NUNCA trae el
--     número de reserva;
--   · el email de cancelación trae el número y NUNCA el uid.
-- `processCancellation` resolvía sólo por referencia (confirmation_code /
-- booking_external_refs / bookings.external_id), así que para toda reserva
-- proyectada desde el iCal el match fallaba siempre: la cancelación abría una
-- incidencia "Cancelación de Booking sin reserva local" y la reserva seguía
-- vigente. En esta org quedaron 6 así entre el 28/07 y el 18/08/2026.
--
-- El puente existía y lo estábamos tirando: el aviso "¡Nueva reserva!" del
-- extranet lleva número y fecha de llegada juntos en el subject
--   "Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)"
-- y `classifyIgnorable()` lo descartaba como ruido (`aviso_reserva_booking`)
-- porque no alcanza para crear una reserva. Alcanza para numerarla.
--
-- Esta migración hace, sobre lo ya guardado, lo mismo que hará el código de acá
-- en más:
--   1. reescribe esos avisos como eventos `reservation_reference`;
--   2. le pone el número a la reserva que corresponde, sólo cuando hay UNA
--      sola candidata vigente con esa llegada (nunca por aproximación).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 0. El nuevo tipo de evento ──────────────────────────────────────────────
-- `reservation_reference` no crea ni cancela nada: sólo aporta el número de
-- reserva de la OTA para una llegada conocida.
ALTER TABLE apartcba.channel_events
  DROP CONSTRAINT IF EXISTS channel_events_event_type_check;

ALTER TABLE apartcba.channel_events
  ADD CONSTRAINT channel_events_event_type_check
  CHECK (event_type IN ('reservation_upsert', 'reservation_cancelled',
                        'reservation_reference', 'email_unparsed'));

-- Lo consulta applyPendingReference() al proyectar una reserva nueva del iCal:
-- "¿ya llegó el aviso con el número para esta llegada?".
CREATE INDEX IF NOT EXISTS idx_channel_events_reference
  ON apartcba.channel_events (organization_id, (payload->>'check_in'))
  WHERE event_type = 'reservation_reference';

-- ─── 1. Los avisos guardados pasan a ser eventos de referencia ───────────────
WITH meses(nom, num) AS (VALUES
  ('enero','01'),('febrero','02'),('marzo','03'),('abril','04'),('mayo','05'),
  ('junio','06'),('julio','07'),('agosto','08'),('septiembre','09'),
  ('setiembre','09'),('octubre','10'),('noviembre','11'),('diciembre','12')),
avisos AS (
  SELECT e.id,
         (regexp_match(e.payload->>'subject', '\((\d{8,14}),'))[1] AS code,
         (regexp_match(e.payload->>'subject', '(\d{1,2}) de ([a-zá-ú]+) de (\d{4})')) AS fecha
    FROM apartcba.channel_events e
   WHERE e.payload->>'ignored' = 'aviso_reserva_booking'
),
parsed AS (
  SELECT a.id, a.code,
         (a.fecha[3] || '-' || m.num || '-' || lpad(a.fecha[1], 2, '0'))::date AS check_in
    FROM avisos a
    JOIN meses m ON m.nom = a.fecha[2]
   WHERE a.code IS NOT NULL
)
UPDATE apartcba.channel_events e
   SET event_type = 'reservation_reference',
       payload = jsonb_build_object(
         'transport', 'email',
         'channel', 'booking',
         'event_type', 'reservation_reference',
         'confirmation_code', p.code,
         'check_in', p.check_in::text,
         'subject', e.payload->>'subject'
       ),
       status = 'processed'
  FROM parsed p
 WHERE e.id = p.id;

-- ─── 2. Numerar las reservas que ya existen ──────────────────────────────────
-- Determinista: una sola reserva vigente sin número que llegue ese día, y un
-- número que todavía no esté usado. Cualquier ambigüedad se deja sin tocar.
WITH refs AS (
  SELECT e.organization_id,
         e.payload->>'confirmation_code' AS code,
         (e.payload->>'check_in')::date  AS check_in
    FROM apartcba.channel_events e
   WHERE e.event_type = 'reservation_reference'
     AND e.payload->>'channel' = 'booking'
),
unicos AS (
  -- un solo número por (org, llegada): dos avisos para el mismo día es ambiguo
  SELECT organization_id, check_in, min(code) AS code
    FROM refs
   GROUP BY organization_id, check_in
  HAVING count(DISTINCT code) = 1
),
candidatas AS (
  SELECT r.organization_id, r.check_in, (array_agg(r.id))[1] AS reservation_id
    FROM apartcba.channel_reservations r
   WHERE r.channel = 'booking'
     AND r.external_status = 'active'
     AND r.confirmation_code IS NULL
   GROUP BY r.organization_id, r.check_in
  HAVING count(*) = 1
)
UPDATE apartcba.channel_reservations r
   SET confirmation_code = u.code
  FROM unicos u
  JOIN candidatas c
    ON c.organization_id = u.organization_id AND c.check_in = u.check_in
 WHERE r.id = c.reservation_id
   AND r.confirmation_code IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM apartcba.channel_reservations x
      WHERE x.organization_id = u.organization_id
        AND x.channel = 'booking'
        AND x.confirmation_code = u.code
   );

-- ─── 3. Referencia buscable + external_id del booking ────────────────────────
INSERT INTO apartcba.booking_external_refs
  (organization_id, booking_id, channel, link_id, ref_type, ref_value)
SELECT r.organization_id, r.booking_id, 'booking', r.link_id,
       'reservation_number', r.confirmation_code
  FROM apartcba.channel_reservations r
 WHERE r.channel = 'booking'
   AND r.confirmation_code IS NOT NULL
   AND r.booking_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- `external_id` se había llenado con el uid del iCal por no haber nada mejor;
-- el número de reserva es el que el operador puede buscar en el extranet.
UPDATE apartcba.bookings b
   SET external_id = r.confirmation_code
  FROM apartcba.channel_reservations r
 WHERE r.booking_id = b.id
   AND r.channel = 'booking'
   AND r.confirmation_code IS NOT NULL
   AND (b.external_id IS NULL OR b.external_id = r.ical_uid);

-- ─── 4. Cerrar las incidencias que este arreglo deja sin objeto ──────────────
UPDATE apartcba.channel_issues i
   SET status = 'resolved',
       resolution = 'La reserva ya tiene su número de Booking: la cancelación se resuelve por referencia (migración 052).',
       resolved_at = now(),
       updated_at = now()
 WHERE i.status = 'open'
   AND i.issue_type = 'cancellation_review'
   AND i.title LIKE 'Cancelación de Booking sin reserva local%'
   AND EXISTS (
     SELECT 1 FROM apartcba.channel_reservations r
      WHERE r.organization_id = i.organization_id
        AND r.channel = 'booking'
        AND i.detail LIKE '%' || r.confirmation_code || '%'
   );
