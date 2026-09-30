-- 067c — Cerrar por RLS/privilegios las tablas nuevas de la web y el limitador.
--
-- Revisión adversarial (29/09/2026):
--   * org_web_settings tenía `members_all` FOR ALL: cualquier miembro activo de
--     la organización —limpieza, mantenimiento, owner_view— podía, con su JWT y
--     la anon key, CAMBIAR el alias/CBU al que los huéspedes transfieren la seña
--     (PostgREST directo, sin pasar por la action que exige admin).
--   * booking_payment_reports, igual: montos, notas y rutas de comprobantes de
--     todos los huéspedes, legibles y editables por roles sin permiso de pagos.
--   * auth_rate_limits no tenía RLS y `authenticated` tenía SELECT/UPDATE/DELETE;
--     el checkout guarda ahí claves con email/teléfono → PII legible por
--     cualquier sesión de huésped. Y `anon` podía ejecutar hit_auth_rate_limit.
--
-- Las tres se usan SÓLO desde el servidor con service role (server actions,
-- web-settings-server, notificaciones): se les quita todo acceso a anon y
-- authenticated. El service role bypassea RLS y conserva sus privilegios.

-- 1) Configuración de la web y del cobro: sólo service role.
drop policy if exists members_all on apartcba.org_web_settings;
revoke all on table apartcba.org_web_settings from anon, authenticated;
grant all on table apartcba.org_web_settings to service_role;

-- 2) Avisos de pago del huésped: sólo service role.
drop policy if exists members_all on apartcba.booking_payment_reports;
revoke all on table apartcba.booking_payment_reports from anon, authenticated;
grant all on table apartcba.booking_payment_reports to service_role;

-- 3) Limitador de intentos: RLS sin policies + sin privilegios para anon/auth.
alter table apartcba.auth_rate_limits enable row level security;
revoke all on table apartcba.auth_rate_limits from anon, authenticated;
grant all on table apartcba.auth_rate_limits to service_role;

revoke execute on function apartcba.hit_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function apartcba.hit_auth_rate_limit(text, integer, integer) to service_role;
