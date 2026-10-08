-- ════════════════════════════════════════════════════════════════════════════
-- 072 · Caja: v_cash_movements_enriched deja de saltear la RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- La vista (migración 007) es de `postgres`, no tenía security_invoker y tenía
-- SELECT (y el resto de los privilegios por default) para `authenticated`.
-- Una vista sin security_invoker corre con los permisos de su dueña: la RLS
-- de cash_movements no aplicaba. Como el esquema `apartcba` está expuesto por
-- PostgREST, cualquier usuario logueado — incluido un huésped del marketplace
-- — podía leer los movimientos de Caja de TODAS las organizaciones con la
-- anon key pública + su JWT. Verificado el 08/10/2026: un usuario sin ninguna
-- membresía veía 0 filas en cash_movements y 2.070 (4 orgs) en la vista.
--
-- Sólo la lee el servidor (src/lib/actions/cash.ts: getAccountStats y
-- exportMovements, con service_role), y no hay funciones ni vistas que
-- dependan de ella: se le quita el acceso a anon/authenticated y además se
-- la pasa a security_invoker, para que un grant futuro no reabra el agujero
-- (con invoker, quien la lea sólo ve lo que la RLS de cash_movements le deja).
-- Mismo criterio que v_cash_movements_search (071).
-- ════════════════════════════════════════════════════════════════════════════

alter view apartcba.v_cash_movements_enriched set (security_invoker = on);

revoke all on apartcba.v_cash_movements_enriched from public, anon, authenticated;
grant select on apartcba.v_cash_movements_enriched to service_role;
