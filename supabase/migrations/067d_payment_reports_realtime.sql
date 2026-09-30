-- 067d — Avisos de pago del huésped en vivo para el equipo.
--
-- Contexto: cuando un huésped avisa que transfirió la seña (con comprobante),
-- el aviso tiene que aparecer solo en /dashboard/reservas-pendientes y en la
-- ficha de la reserva, sin F5 (<LiveRefresh tables={[…, "booking_payment_reports"]} />).
-- Postgres Changes decide a quién mandarle cada INSERT/UPDATE evaluando la RLS
-- de SELECT con el JWT del suscriptor, y valida el filtro `organization_id=eq.…`
-- con `has_column_privilege` sobre el rol `authenticated`. La 067c le sacó todo
-- a `authenticated` (con razón: la policy vieja `members_all` era FOR ALL para
-- cualquier miembro), así que hoy la tabla no puede emitir para nadie.
--
-- Esta migración devuelve SÓLO lectura, y sólo a quien ya la ve en el panel:
-- admin y recepción de ESA organización (`payments.view` en
-- DEFAULT_ROLE_PERMISSIONS). Limpieza, mantenimiento, owner_view y los
-- huéspedes (que también son `authenticated`) no ven ninguna fila. Escribir
-- sigue siendo exclusivo del service role (server actions): no hay policies de
-- INSERT/UPDATE/DELETE ni privilegios de escritura para `authenticated`.

-- 1) Lectura por RLS: miembro activo de la org con rol admin o recepción.
--    `current_user_role()` (001) es SECURITY DEFINER: no depende de la RLS de
--    organization_members y devuelve NULL si el usuario no es miembro activo
--    de esa org → `NULL in (…)` no es verdadero → la fila no se ve.
drop policy if exists staff_select on apartcba.booking_payment_reports;
create policy staff_select on apartcba.booking_payment_reports
  for select
  to authenticated
  using (apartcba.current_user_role(organization_id) in ('admin', 'recepcion'));

-- 2) Privilegio de lectura (la RLS de arriba decide qué filas). Nada de
--    escritura: la 067c revocó todo y así queda para INSERT/UPDATE/DELETE.
grant select on table apartcba.booking_payment_reports to authenticated;

-- 3) Publicación de Realtime (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'apartcba'
      AND tablename = 'booking_payment_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.booking_payment_reports;
  END IF;
END $$;

-- ── REPLICA IDENTITY: se queda en DEFAULT, a propósito ─────────────────────
-- Mismo criterio que bookings (ver 055): Realtime NO aplica la RLS ni el
-- filtro a los DELETE, y los manda a TODOS los suscriptores de la tabla, de
-- cualquier organización. Con REPLICA IDENTITY DEFAULT el `old` de un DELETE
-- trae sólo la clave primaria (`id`, un uuid): no viajan montos, notas, rutas
-- de comprobantes ni el organization_id. Con FULL viajaría la fila completa
-- a otras organizaciones. Los avisos no se borran (cambian de estado); sólo
-- desaparecen en cascada si se borra la reserva, y de eso se ocupa el re-sync
-- de la capa en vivo. INSERT y UPDATE sí pasan por la policy de arriba.
--
-- Verificación (después de aplicar):
--   select * from pg_policies
--     where schemaname = 'apartcba' and tablename = 'booking_payment_reports';
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'apartcba' and table_name = 'booking_payment_reports'
--       and grantee in ('anon', 'authenticated');          -- sólo authenticated:SELECT
--   select relreplident from pg_class
--     where oid = 'apartcba.booking_payment_reports'::regclass;  -- 'd'
--   select 1 from pg_publication_tables where pubname = 'supabase_realtime'
--     and schemaname = 'apartcba' and tablename = 'booking_payment_reports';
