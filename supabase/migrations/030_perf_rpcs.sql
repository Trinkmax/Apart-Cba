-- ════════════════════════════════════════════════════════════════════════════
-- 030 — Performance (auditoría 2026-06-09)
--
-- 1) get_account_balances: saldos de caja calculados en Postgres. Reemplaza el
--    patrón de traer cash_movements COMPLETO a JS y sumar allá, que además de
--    pesado calcularía saldos silenciosamente MAL al cruzar el cap default de
--    1.000 filas de PostgREST (~4-6 meses al ritmo actual de movimientos).
--    LEFT JOIN deliberado: cuentas sin movimientos conservan su opening_balance.
--
-- 2) get_session_context: profile + membresías (con org embebida) + org activa
--    + notificaciones + unread_count en UN solo round trip. Antes: 5 llamadas
--    HTTP en 3 olas seriales por cada render del dashboard. El fallback de org
--    replica getCurrentOrg(): cookie inválida/null → primera membresía activa
--    por joined_at. unread_count se computa ANTES del LIMIT 30 (contar sobre el
--    array truncado subcontaría el badge).
--
-- 3) purge_cron_history: cron.job_run_details acumula ~900 filas/día sin tope
--    (17 MB = 40% de la base al momento de la auditoría). Retención: 7 días.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function apartcba.get_account_balances(p_org_id uuid)
returns table (account_id uuid, balance numeric)
language sql
stable
set search_path = ''
as $$
  select a.id,
         a.opening_balance
           + coalesce(sum(case when m.direction = 'in' then m.amount else -m.amount end), 0)
  from apartcba.cash_accounts a
  left join apartcba.cash_movements m on m.account_id = a.id
  where a.organization_id = p_org_id
  group by a.id, a.opening_balance;
$$;

create or replace function apartcba.get_session_context(p_user_id uuid, p_org_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
with prof as (
  select to_jsonb(p) as profile
  from apartcba.user_profiles p
  where p.user_id = p_user_id
),
mems as (
  select coalesce(
    jsonb_agg(to_jsonb(m) || jsonb_build_object('organization', to_jsonb(o)) order by m.joined_at),
    '[]'::jsonb
  ) as memberships
  from apartcba.organization_members m
  join apartcba.organizations o on o.id = m.organization_id
  where m.user_id = p_user_id and m.active
),
resolved as (
  select coalesce(
    (select m.organization_id from apartcba.organization_members m
       where m.user_id = p_user_id and m.active and m.organization_id = p_org_id limit 1),
    (select m.organization_id from apartcba.organization_members m
       where m.user_id = p_user_id and m.active order by m.joined_at limit 1)
  ) as org_id
),
notifs as (
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) as notifications
  from (
    select n.* from apartcba.notifications n, resolved r
    where n.organization_id = r.org_id and n.dismissed_at is null
    order by n.created_at desc
    limit 30
  ) s
),
unread as (
  select count(*)::int as unread_count
  from apartcba.notifications n, resolved r
  where n.organization_id = r.org_id and n.read_at is null and n.dismissed_at is null
)
select jsonb_build_object(
  'profile',        (select profile from prof),
  'memberships',    (select memberships from mems),
  'current_org_id', (select org_id from resolved),
  'notifications',  (select notifications from notifs),
  'unread_count',   (select unread_count from unread)
);
$$;

-- Purga diaria del historial de pg_cron (cron.schedule con el mismo nombre es
-- upsert: re-aplicable sin efecto secundario).
select cron.schedule(
  'purge_cron_history',
  '0 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
