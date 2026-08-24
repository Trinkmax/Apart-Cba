-- 053_cancellation_requires_human.sql
--
-- Ninguna reserva se cancela sola. Nunca más.
--
-- Incidente que resuelve (producción, 14/08/2026 — 26 reservas):
-- El barrido de canales (`handleDisappearances` en dispatch.ts) cancelaba una
-- reserva por su cuenta cuando el VEVENT correspondiente dejaba de aparecer en
-- el iCal de la OTA. Se llevó puestas reservas reales:
--
--   · Lourdes Cabral — BRASIL 06→08/09, $160.000, seña de $80.000 YA COBRADA,
--     confirmación ya enviada al huésped por WhatsApp. Cargada a mano por el
--     staff (source 'directo') a las 14:39:48; el ingest la "adoptó" 25 s
--     después por coincidir unidad + fechas con un BLOQUEO MUDO del feed de
--     Booking (is_block=true, sin nombre de huésped); a las 17:40 el barrido la
--     canceló. El 17/08 se revendió la unidad a otra huésped: venta doble.
--   · Hernan Dotti — BRASIL 24→28/08, $340.000. Idéntico.
--   · Marketing Implecor — DIVA 18→21/08, $498.221 cobrados, cancelada el 18/08
--     a las 20:50 CON EL HUÉSPED ADENTRO (el guard sólo protege si alguien hizo
--     click en "check-in" dentro del PMS).
--
-- La desaparición de un VEVENT NO es evidencia de cancelación. Puede ser un
-- feed vacío por error, una lectura parcial, una rotación de UID de la OTA
-- (Booking le cambia el UID al mismo bloqueo todos los días), un recorte de la
-- ventana de calendario, o el eco de nuestro propio export.
--
-- A partir de acá el barrido PROPONE y una persona DECIDE. La cancelación
-- automática deja de existir como camino de código.

-- ─── 1. Propuestas de cancelación pendientes de decisión humana ──────────────

CREATE TABLE IF NOT EXISTS apartcba.channel_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  link_id uuid REFERENCES apartcba.channel_links(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES apartcba.channel_reservations(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  channel text NOT NULL,

  -- Por qué el sistema sospecha que esta reserva se cayó.
  reason_code text NOT NULL
    CHECK (reason_code IN ('missing_from_feed', 'ota_cancellation_email')),
  detail text,

  -- Evidencia cruda para que la decisión sea informada, no a ciegas:
  -- lecturas sin verla, desde cuándo falta, si el feed venía vacío, etc.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Foto de la reserva al momento de proponer (huésped, unidad, fechas,
  -- importes, seña cobrada). Se guarda acá para que el diálogo muestre todo sin
  -- joins y para que la decisión quede auditada contra lo que se vio entonces.
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Cuánto arriesga esta decisión. 'alto' = hay plata cobrada, hay huésped con
  -- confirmación enviada, o la estadía empieza en menos de 7 días.
  risk text NOT NULL DEFAULT 'normal' CHECK (risk IN ('normal', 'alto')),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'kept', 'stale')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE apartcba.channel_cancellation_requests IS
  'Cancelaciones PROPUESTAS por la sincronización con las OTAs. Requieren decisión humana (Cancelar / Mantener). El sistema nunca cancela solo.';
COMMENT ON COLUMN apartcba.channel_cancellation_requests.evidence IS
  'Evidencia cruda de la propuesta: lecturas sin ver el evento, primera ausencia, si el feed vino vacío, horizonte publicado.';
COMMENT ON COLUMN apartcba.channel_cancellation_requests.snapshot IS
  'Foto de la reserva al proponer: huésped, unidad, fechas, total, seña cobrada, origen. La decisión se audita contra esto.';

-- Una sola propuesta abierta por reserva externa, y una sola por reserva del
-- PMS. Evita que el barrido acumule propuestas idénticas cada 5 minutos.
CREATE UNIQUE INDEX IF NOT EXISTS channel_cancellation_requests_pending_reservation
  ON apartcba.channel_cancellation_requests (reservation_id)
  WHERE status = 'pending' AND reservation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS channel_cancellation_requests_pending_booking
  ON apartcba.channel_cancellation_requests (booking_id)
  WHERE status = 'pending' AND booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS channel_cancellation_requests_org_pending
  ON apartcba.channel_cancellation_requests (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS channel_cancellation_requests_booking
  ON apartcba.channel_cancellation_requests (booking_id);

CREATE INDEX IF NOT EXISTS channel_cancellation_requests_link
  ON apartcba.channel_cancellation_requests (link_id);

DROP TRIGGER IF EXISTS set_updated_at ON apartcba.channel_cancellation_requests;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON apartcba.channel_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();

ALTER TABLE apartcba.channel_cancellation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_cancellation_requests_member_read
  ON apartcba.channel_cancellation_requests;
CREATE POLICY channel_cancellation_requests_member_read
  ON apartcba.channel_cancellation_requests FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM apartcba.organization_members
      WHERE user_id = auth.uid() AND active
    )
  );

-- ─── 2. "Mantener" protege la reserva de futuras propuestas ──────────────────
--
-- Si una persona ya miró la evidencia y dijo "esta reserva va", el barrido no
-- puede volver a proponer lo mismo cada 5 minutos. La protección es por
-- desaparición del feed: una cancelación REAL informada por email de la OTA
-- (que trae número de reserva) sigue su camino normal.

ALTER TABLE apartcba.channel_reservations
  ADD COLUMN IF NOT EXISTS cancellation_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN apartcba.channel_reservations.cancellation_locked_at IS
  'Una persona decidió MANTENER esta reserva pese a que desapareció del feed. El barrido no vuelve a proponer cancelarla por ausencia.';

-- ─── 3. Trazabilidad: quién canceló y por qué camino ─────────────────────────
--
-- Hasta ahora `bookings.cancelled_reason` era el único rastro, y no se
-- renderizaba en ninguna pantalla. `cancelled_by` distingue "lo decidió una
-- persona" de "lo hizo un proceso", que es exactamente la pregunta que nadie
-- podía responder cuando la reserva de Lourdes desapareció del calendario.

ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_source text;

COMMENT ON COLUMN apartcba.bookings.cancelled_source IS
  'Cómo se canceló: manual (una persona en el PMS) · channel_decision (una persona aprobó una propuesta de la OTA) · ota_email (cancelación formal recibida de la OTA) · system_legacy (cancelación automática, camino eliminado en la migración 053).';

-- Las 26 cancelaciones automáticas del incidente quedan marcadas como tales,
-- para que se puedan auditar y separar de las decisiones humanas.
UPDATE apartcba.bookings
   SET cancelled_source = 'system_legacy'
 WHERE cancelled_at IS NOT NULL
   AND cancelled_source IS NULL
   AND cancelled_reason ILIKE '%desapareci%';

UPDATE apartcba.bookings
   SET cancelled_source = 'manual'
 WHERE cancelled_at IS NOT NULL
   AND cancelled_source IS NULL;
