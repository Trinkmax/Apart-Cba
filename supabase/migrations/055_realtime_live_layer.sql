-- 055 — Capa "en vivo": lo que hacía falta en la base para que el PMS se
-- actualice solo, sin que nadie tenga que apretar F5.
--
-- Contexto: el equipo veía disponibilidad en el calendario cuando la reserva ya
-- estaba cargada hacía minutos. Del lado del cliente eso se resuelve con un
-- canal compartido + re-sync (src/lib/realtime/). Del lado de la base faltan
-- dos cosas: publicar la tabla de Caja y poder preguntar barato "¿hay algo más
-- nuevo que lo último que vi?".

-- ── 1) Caja entra a Realtime ────────────────────────────────────────────────
-- Un cobro que carga otra persona tiene que verse en /dashboard/caja sin
-- recargar. bookings, units, cleaning_tasks, maintenance_tickets,
-- concierge_requests, booking_requests, booking_payment_schedule y
-- notifications ya estaban publicadas; cash_movements no.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'apartcba'
      AND tablename = 'cash_movements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.cash_movements;
  END IF;
END $$;

-- ── 2) Índice del watchdog ──────────────────────────────────────────────────
-- El modo de falla peligroso del tiempo real es el silencioso: el canal dice
-- estar vivo y no llega nada (sesión vencida, socket zombi tras suspender la
-- laptop). El cliente lo detecta preguntando cada 90 s por el `updated_at` más
-- nuevo de la organización y comparándolo con el último que vio pasar. Sin
-- índice eso es un scan por organización cada 90 s por pestaña abierta.
CREATE INDEX IF NOT EXISTS idx_bookings_org_updated_at
  ON apartcba.bookings (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_requests_org_updated_at
  ON apartcba.booking_requests (organization_id, updated_at DESC);

-- ── Lo que NO hacemos, a propósito ──────────────────────────────────────────
-- No tocamos REPLICA IDENTITY de bookings / units / booking_payment_schedule,
-- aunque eso signifique que sus eventos DELETE no lleguen (con la identidad
-- por defecto el `old` sólo trae la PK, y el filtro organization_id=eq.<org>
-- no se puede evaluar contra él).
--
-- El motivo es de multi-tenancy, y sale de la propia documentación de Supabase
-- (Realtime → Postgres Changes):
--   · "Delete events are not filterable" — los DELETE ignoran el filtro.
--   · "RLS policies are not applied to DELETE statements, because there is no
--      way for Postgres to verify that a user has access to a deleted record."
--   · "A delete appends the complete old row for REPLICA IDENTITY FULL."
-- Los tres juntos significan que poner FULL mandaría la fila COMPLETA de una
-- reserva borrada —huésped, importes, notas internas— a TODOS los suscriptores
-- de la tabla, incluidos los de otras organizaciones. Es un agujero peor que el
-- problema que resuelve.
--
-- Los borrados reales (mergeLeaseGroup al fusionar tramos de un contrato
-- mensual) los cubre el re-sync con desalojo del cliente, que relee la ventana
-- cargada y saca lo que el server ya no devuelve.
