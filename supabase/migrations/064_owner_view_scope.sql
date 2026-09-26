-- 064 — Rol "Propietario" (owner_view) acotado a SUS unidades.
--
-- Hasta acá no existía ningún vínculo entre la membresía de un usuario con rol
-- owner_view y la ficha del propietario (`owners`): el rol decía "Solo lectura
-- de sus unidades" pero veía TODA la organización — todas las unidades, todas
-- las reservas y las liquidaciones de los demás propietarios (Habitana,
-- 24/09/2026: el propietario de CC1D veía los 9 departamentos).
--
-- • organization_members.owner_id: a qué propietario representa el usuario.
--   Varios usuarios pueden apuntar al mismo propietario (una pareja con dos
--   logins). Sólo tiene sentido con role = 'owner_view'.
-- • El código FALLA CERRADO: owner_view sin owner_id no ve ninguna unidad.
-- • get_session_context: a un owner_view sólo le llegan las notificaciones
--   dirigidas a él (target_user_id); las de la org son operación interna.

alter table apartcba.organization_members
  add column if not exists owner_id uuid null
    references apartcba.owners(id) on delete set null;

create index if not exists organization_members_owner_id_idx
  on apartcba.organization_members (owner_id)
  where owner_id is not null;

-- Backfill: mismo email (sin distinguir mayúsculas) dentro de la misma org.
-- Si hay más de un propietario con ese email en la org, no se adivina.
update apartcba.organization_members m
set owner_id = o.id
from auth.users u, apartcba.owners o
where m.role = 'owner_view'
  and m.owner_id is null
  and u.id = m.user_id
  and o.organization_id = m.organization_id
  and o.email is not null
  and lower(trim(o.email)) = lower(trim(u.email))
  and (
    select count(*) from apartcba.owners o2
    where o2.organization_id = m.organization_id
      and lower(trim(o2.email)) = lower(trim(u.email))
  ) = 1;

CREATE OR REPLACE FUNCTION apartcba.get_session_context(p_user_id uuid, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
is_owner as (
  select exists (
    select 1 from apartcba.organization_members m, resolved r
    where m.user_id = p_user_id and m.active and m.organization_id = r.org_id
      and m.role = 'owner_view'
  ) as v
),
notifs as (
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) as notifications
  from (
    select n.* from apartcba.notifications n, resolved r, is_owner io
    where n.organization_id = r.org_id and n.dismissed_at is null
      and (not io.v or n.target_user_id = p_user_id)
    order by n.created_at desc
    limit 30
  ) s
),
unread as (
  select count(*)::int as unread_count
  from apartcba.notifications n, resolved r, is_owner io
  where n.organization_id = r.org_id and n.read_at is null and n.dismissed_at is null
    and (not io.v or n.target_user_id = p_user_id)
)
select jsonb_build_object(
  'profile',        (select profile from prof),
  'memberships',    (select memberships from mems),
  'current_org_id', (select org_id from resolved),
  'notifications',  (select notifications from notifs),
  'unread_count',   (select unread_count from unread)
);
$function$;
