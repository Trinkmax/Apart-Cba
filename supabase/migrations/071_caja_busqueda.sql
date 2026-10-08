-- ════════════════════════════════════════════════════════════════════════════
-- 071 · Caja: buscar movimientos por depto, persona o importe
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido (02/10/2026): "una lupita en la caja: pongo el nombre del departamento
-- o de la persona que pagó o a la que se le reintegró plata".
--
-- El buscador de Caja sólo miraba `description`, y ahí casi nunca está la
-- persona: un cobro de reserva dice "Cobro de reserva a84a7ab1", un pago de
-- liquidación dice "Pago liquidación Agosto 2026". El nombre vive en otra
-- tabla según de dónde salió el movimiento:
--
--   ref_type booking / payment_schedule → bookings → guests        (huésped)
--   ref_type settlement_payment         → owners vía owner_id      (propietario)
--                                          + los deptos de las líneas de la
--                                          liquidación (el movimiento no tiene
--                                          unit_id: "ARTIGAS" tiene que traer
--                                          también lo que se le pagó al dueño)
--   ref_type rental_*                   → contrato → inquilino      (inquilino)
--   ref_type ticket                     → título del ticket
--
-- Esta vista lo resuelve una sola vez, set-based, y expone:
--   · party_name / party_kind: "quién" para mostrar en cada fila.
--   · place_label: "dónde" (código del depto, los deptos de la liquidación o
--     la dirección de la propiedad en alquiler).
--   · search_text: todo lo anterior + la descripción, en minúsculas y sin
--     tildes (search_fold), para filtrar con ILIKE desde PostgREST.
--   · running_balance: mismo cálculo que v_cash_movements_enriched, así la
--     página de cuenta puede leer de acá sin perder la columna Saldo.
--
-- La ventana se particiona por (organization_id, account_id) — equivalente a
-- account_id solo, porque una cuenta pertenece a una org — para que Postgres
-- empuje adentro de la vista tanto el filtro por cuenta como el filtro por
-- organización (sólo empuja quals sobre columnas de la partición). Los demás
-- filtros (búsqueda, categoría, fechas) quedan afuera de la ventana: el saldo
-- de cada fila sigue siendo el real aunque se filtre.
--
-- Seguridad: security_invoker + sólo service_role. La vieja
-- v_cash_movements_enriched quedó SIN security_invoker y con SELECT para
-- authenticated (corre como postgres y saltea la RLS); esta no repite eso.
-- ════════════════════════════════════════════════════════════════════════════

-- Minúsculas y sin tildes. La misma normalización corre en el cliente
-- (src/lib/cash/search.ts::foldSearch) antes de armar el patrón.
create or replace function apartcba.search_fold(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(translate(
    coalesce(t, ''),
    'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'
  ))
$$;

comment on function apartcba.search_fold(text) is
  'Normaliza texto para búsqueda: minúsculas y sin tildes/diéresis/ñ/ç. Espejo de foldSearch() en src/lib/cash/search.ts. Migración 071.';

create or replace view apartcba.v_cash_movements_search
with (security_invoker = on)
as
select
  m.id,
  m.organization_id,
  m.account_id,
  m.direction,
  m.amount,
  m.currency,
  m.category,
  m.ref_type,
  m.ref_id,
  m.unit_id,
  m.owner_id,
  m.description,
  m.occurred_at,
  m.created_at,
  m.created_by,
  m.billable_to,
  a.name  as account_name,
  a.color as account_color,
  a.type  as account_type,
  a.opening_balance + sum(case when m.direction = 'in' then m.amount else -m.amount end)
    over (
      partition by m.organization_id, m.account_id
      order by m.occurred_at, m.id
      rows between unbounded preceding and current row
    ) as running_balance,
  u.code as unit_code,
  u.name as unit_name,
  ow.full_name as owner_name,
  case
    when g.full_name is not null then 'huesped'
    when rt.tenant_name is not null then 'inquilino'
    when ow.full_name is not null then 'propietario'
  end as party_kind,
  coalesce(g.full_name, rt.tenant_name, ow.full_name) as party_name,
  coalesce(u.code, sp.unit_codes, rt.property_label) as place_label,
  apartcba.search_fold(concat_ws(' ',
    m.description,
    u.code, u.name,
    ow.full_name,
    g.full_name,
    sp.unit_labels,
    rt.tenant_name, rt.payer_name, rt.property_label, rt.property_code,
    tk.title
  )) as search_text
from apartcba.cash_movements m
join apartcba.cash_accounts a on a.id = m.account_id
left join apartcba.units u on u.id = m.unit_id
left join apartcba.owners ow on ow.id = m.owner_id
-- Huésped: directo por la reserva o a través de la cuota del plan de pagos.
left join apartcba.booking_payment_schedule ps
  on m.ref_type = 'payment_schedule' and ps.id = m.ref_id
left join apartcba.bookings b
  on b.id = case m.ref_type
              when 'booking' then m.ref_id
              when 'payment_schedule' then ps.booking_id
            end
 and b.organization_id = m.organization_id
left join apartcba.guests g on g.id = b.guest_id
-- Pago de liquidación: los deptos que liquida (vía sus líneas).
left join lateral (
  select
    string_agg(distinct lu.code, ', ') as unit_codes,
    string_agg(distinct concat_ws(' ', lu.code, lu.name), ' ') as unit_labels
  from apartcba.settlement_lines sl
  join apartcba.units lu on lu.id = sl.unit_id
  where m.ref_type = 'settlement_payment'
    and sl.settlement_id = m.ref_id
) sp on true
-- Alquileres tradicionales: el contrato sale del cobro, del gasto o, en el
-- depósito, del propio ref_id (068h).
left join apartcba.rental_payments rp
  on m.ref_type = 'rental_payment' and rp.id = m.ref_id
left join apartcba.rental_expenses re
  on m.ref_type = 'rental_expense' and re.id = m.ref_id
left join lateral (
  select
    coalesce(nullif(btrim(rp.payer_name), ''), tenant.full_name) as tenant_name,
    nullif(btrim(rp.payer_name), '') as payer_name,
    nullif(concat_ws(' ', pr.street, pr.street_number,
      nullif(concat_ws('', case when pr.floor is not null and pr.floor <> '' then pr.floor || '°' end, pr.apartment), '')
    ), '') as property_label,
    pr.code as property_code
  from apartcba.rental_contracts c
  join apartcba.rental_properties pr on pr.id = c.property_id
  left join lateral (
    select p.full_name
    from apartcba.rental_contract_parties cp
    join apartcba.rental_people p on p.id = cp.person_id
    where cp.contract_id = c.id
      and cp.role = 'inquilino'
    order by cp.is_primary desc, cp.sort_order
    limit 1
  ) tenant on true
  where m.ref_type like 'rental\_%'
    and c.organization_id = m.organization_id
    and c.id = case
                 when m.ref_type = 'rental_payment' then rp.contract_id
                 when m.ref_type in ('rental_deposit_return', 'rental_deposit_received') then m.ref_id
                 when m.ref_type = 'rental_expense' then re.contract_id
               end
  limit 1
) rt on true
left join apartcba.maintenance_tickets tk
  on m.ref_type = 'ticket' and tk.id = m.ref_id;

comment on view apartcba.v_cash_movements_search is
  'Movimientos de Caja con quién (party_*), dónde (place_label), saldo corrido y search_text normalizado para el buscador de Caja. Sólo service_role. Migración 071.';

revoke all on apartcba.v_cash_movements_search from public, anon, authenticated;
grant select on apartcba.v_cash_movements_search to service_role;

revoke all on function apartcba.search_fold(text) from public, anon, authenticated;
grant execute on function apartcba.search_fold(text) to service_role;
