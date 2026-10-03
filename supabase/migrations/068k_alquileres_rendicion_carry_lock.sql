-- 068k — Alquileres: generar una rendición mientras otra persona anula algo
--        que esa rendición toma (saldo trasladado, cobro o gasto)
--
-- Contexto: computePendingForOwners arma los renglones FUERA de la
-- transacción (cientos de ms antes de llamar a la RPC) y
-- rental_create_owner_statement los insertaba sin volver a mirar nada. Los
-- guardas del otro lado (SALDO_TRASLADADO al anular una rendición, YA_RENDIDO
-- al anular un cobro) corren en READ COMMITTED y no ven un renglón que todavía
-- no se confirmó. Con dos personas trabajando sobre el mismo propietario:
--   · Saldo trasladado: la rendición nueva descontaba "Saldo de la rendición
--     N° X" mientras otra persona anulaba la N° X. La anulación devolvía los
--     gastos y cobros de la N° X a "para rendir" y la siguiente rendición los
--     descontaba otra vez: el propietario pagaba dos veces el mismo saldo.
--   · Cobro anulado: la rendición le acreditaba al propietario un cobro que
--     se estaba anulando (y cuyo ingreso ya no estaba en Caja).
--   · Gasto anulado o editado: la rendición lo volvía a 'aplicado' (aunque
--     estuviera anulado y sin egreso) o descontaba el importe viejo.
--
-- Ahora la rendición nueva, ANTES de numerar o escribir nada, bloquea lo que
-- toma y lo vuelve a mirar con los datos confirmados:
--   1) las rendiciones cuyo saldo traslada (FOR SHARE): tienen que seguir
--      'pagada' con neto negativo, del mismo propietario y moneda, y el
--      renglón tiene que ser exactamente ese saldo;
--   2) los pagos de los cobros que rinde (FOR SHARE): la imputación tiene que
--      seguir existiendo y el pago, sin anular;
--   3) los gastos que descuenta (FOR NO KEY UPDATE: después los marca
--      'aplicado'): sin anular, a cargo del propietario, pagados por la
--      inmobiliaria o pendientes, misma moneda y propiedad, y el mismo importe
--      que leyó la app (ref_amount; si una versión vieja de la app no lo
--      manda, ese control se saltea).
-- Si algo cambió: 'RENDICION_DESACTUALIZADA: …' y no se escribe nada (ni se
-- consume número). La app recalcula todo al volver a generar.
--
-- Por qué las dos puntas quedan en fila y sin deadlock:
--   · rental_void_owner_statement toma primero la rendición (FOR UPDATE),
--     rental_void_payment primero el pago (FOR UPDATE) y rental_void_charges,
--     desde esta migración, los pagos antes de su guarda. Si la anulación llegó
--     antes, la rendición nueva espera, ve la fila ya anulada y frena. Si llegó
--     después, la anulación espera y su guarda ya ve el renglón confirmado.
--   · La rendición nueva toma rendiciones → pagos → gastos (cada grupo por id)
--     antes que cualquier otra cosa, y nunca toma contratos: los renglones no
--     tienen FK a contratos. Ninguna de esas anulaciones puede quedar
--     esperándose en círculo con ella. (rental_apply_credit, si imputa saldo
--     de dos pagos en orden inverso al id justo en ese instante, sí podría:
--     Postgres corta una de las dos con error y no queda nada a medias.)
--
-- Del otro lado cambian dos funciones más (ver abajo):
--   · rental_void_owner_statement bloquea los gastos que va a recalcular
--     antes de recalcularlos;
--   · rental_void_charges (con p_undo_credit) bloquea los pagos antes de
--     mirar si la imputación del saldo a favor ya está en una rendición viva:
--     tenía el mismo hueco que SALDO_TRASLADADO.
--
-- Esta migración es ADITIVA: sólo reemplaza las tres funciones, partiendo de
-- su cuerpo vigente al 03/10/2026 (iguales a 068b, 068e y 068f; verificado por
-- md5 de prosrc).

begin;

create or replace function apartcba.rental_create_owner_statement(
  p_organization_id uuid,
  p_owner_id uuid,
  p_header jsonb,
  p_lines jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_statement_id uuid;
  v_number integer;
  v_line jsonb;
  v_order smallint := 0;
  v_currency text := p_header->>'currency';
  v_stale_number integer;
  v_stale_text text;
  v_carry_ids uuid[];
  v_alloc_ids uuid[];
  v_expense_ids uuid[];
begin
  perform 1 from apartcba.owners where id = p_owner_id and organization_id = p_organization_id;
  if not found then
    raise exception 'PROPIETARIO_NO_ENCONTRADO: el propietario no existe en esta organización';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'SIN_RENGLONES: no hay nada para rendir';
  end if;

  select coalesce(array_agg(distinct nullif(j.line->>'ref_id', '')::uuid) filter (where j.line->>'ref_type' = 'statement_carry'), '{}'),
         coalesce(array_agg(distinct nullif(j.line->>'ref_id', '')::uuid) filter (where j.line->>'ref_type' = 'allocation'), '{}'),
         coalesce(array_agg(distinct nullif(j.line->>'ref_id', '')::uuid) filter (where j.line->>'ref_type' = 'expense'), '{}')
    into v_carry_ids, v_alloc_ids, v_expense_ids
    from jsonb_array_elements(p_lines) as j(line);

  -- 1) Saldos trasladados. FOR SHARE choca con el FOR UPDATE de la anulación
  --    (y con cualquier UPDATE de esa rendición) pero no con otra rendición
  --    que traslade el mismo saldo: a esa la frena el índice único (YA_RENDIDO).
  perform 1
    from apartcba.rental_owner_statements s
   where s.organization_id = p_organization_id
     and s.id = any (v_carry_ids)
   order by s.id
   for share of s;

  select s.number into v_stale_number
    from jsonb_array_elements(p_lines) as j(line)
    left join apartcba.rental_owner_statements s
      on s.id = nullif(j.line->>'ref_id', '')::uuid
     and s.organization_id = p_organization_id
   where j.line->>'ref_type' = 'statement_carry'
     and not coalesce(
           s.owner_id = p_owner_id
       and s.currency = v_currency
       and s.status = 'pagada'
       and s.net_amount < 0
       and (j.line->>'sign')::smallint = -1
       and (j.line->>'amount')::numeric(14,2) = -s.net_amount,
       false)
   limit 1;
  if found then
    raise exception 'RENDICION_DESACTUALIZADA: la rendición N° % se anuló o cambió mientras generabas esta; volvé a generarla para que el saldo quede bien',
      coalesce(lpad(v_stale_number::text, 4, '0'), '?');
  end if;

  -- 2) Cobros. Se bloquea el PAGO (no la imputación): rental_void_payment
  --    toma el pago primero y recién al final borra las imputaciones.
  perform 1
    from apartcba.rental_payments p
   where p.organization_id = p_organization_id
     and p.id in (
       select a.payment_id
         from apartcba.rental_payment_allocations a
        where a.organization_id = p_organization_id
          and a.id = any (v_alloc_ids))
   order by p.id
   for share of p;

  select j.line->>'description' into v_stale_text
    from jsonb_array_elements(p_lines) as j(line)
   where j.line->>'ref_type' = 'allocation'
     and not exists (
       select 1
         from apartcba.rental_payment_allocations a
         join apartcba.rental_payments p
           on p.id = a.payment_id and p.organization_id = a.organization_id
        where a.id = nullif(j.line->>'ref_id', '')::uuid
          and a.organization_id = p_organization_id
          and a.voided = false
          and p.voided_at is null)
   limit 1;
  if found then
    raise exception 'RENDICION_DESACTUALIZADA: se anuló un cobro mientras generabas la rendición (%); volvé a generarla', v_stale_text;
  end if;

  -- 3) Gastos. El control es sobre los datos que importan para la plata (no
  --    sobre la descripción ni la fecha): un gasto con otra moneda, otra
  --    propiedad, que pagó el propio dueño o con otro importe no se descuenta.
  perform 1
    from apartcba.rental_expenses x
   where x.organization_id = p_organization_id
     and x.id = any (v_expense_ids)
   order by x.id
   for no key update of x;

  select j.line->>'description' into v_stale_text
    from jsonb_array_elements(p_lines) as j(line)
   where j.line->>'ref_type' = 'expense'
     and not exists (
       select 1
         from apartcba.rental_expenses x
        where x.id = nullif(j.line->>'ref_id', '')::uuid
          and x.organization_id = p_organization_id
          and x.status <> 'anulado'
          and x.charged_to = 'propietario'
          and x.paid_by in ('inmobiliaria', 'pendiente')
          and x.currency = v_currency
          and (nullif(j.line->>'property_id', '') is null
               or x.property_id = (j.line->>'property_id')::uuid)
          and (nullif(j.line->>'ref_amount', '') is null
               or x.amount = (j.line->>'ref_amount')::numeric))
   limit 1;
  if found then
    raise exception 'RENDICION_DESACTUALIZADA: el gasto "%" se editó o se anuló mientras generabas la rendición; volvé a generarla',
      regexp_replace(v_stale_text, '^Gasto:\s*', '');
  end if;

  v_number := apartcba.rental_next_number(p_organization_id, 'rendicion');
  insert into apartcba.rental_owner_statements (
    organization_id, owner_id, number, period_year, period_month, cutoff_date, currency,
    status, notes, generated_by
  ) values (
    p_organization_id, p_owner_id, v_number,
    (p_header->>'period_year')::smallint, (p_header->>'period_month')::smallint,
    (p_header->>'cutoff_date')::date, p_header->>'currency', 'borrador',
    nullif(p_header->>'notes', ''), nullif(p_header->>'generated_by', '')::uuid
  ) returning id into v_statement_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    begin
      insert into apartcba.rental_owner_statement_lines (
        organization_id, statement_id, owner_id, line_type, sign, amount, description,
        contract_id, property_id, ref_type, ref_id, share_pct, sort_order
      ) values (
        p_organization_id, v_statement_id, p_owner_id, v_line->>'line_type',
        (v_line->>'sign')::smallint, (v_line->>'amount')::numeric(14,2), v_line->>'description',
        nullif(v_line->>'contract_id', '')::uuid, nullif(v_line->>'property_id', '')::uuid,
        nullif(v_line->>'ref_type', ''), nullif(v_line->>'ref_id', '')::uuid,
        coalesce(nullif(v_line->>'share_pct', '')::numeric(5,2), 100),
        coalesce(nullif(v_line->>'sort_order', '')::smallint, v_order)
      );
    exception when unique_violation then
      raise exception 'YA_RENDIDO: "%" ya figura en otra rendición de este propietario', v_line->>'description';
    end;

    if v_line->>'ref_type' = 'expense' then
      update apartcba.rental_expenses
         set status = 'aplicado', statement_id = v_statement_id
       where id = (v_line->>'ref_id')::uuid and organization_id = p_organization_id;
    end if;
  end loop;

  update apartcba.rental_owner_statements s
     set collected_amount = t.collected, fees_amount = t.fees, vat_amount = t.vat,
         expenses_amount = t.expenses, other_amount = t.other, net_amount = t.net
    from (
      select
        coalesce(sum(case when line_type like 'cobro\_%' then sign * amount end), 0) as collected,
        coalesce(sum(case when line_type = 'honorarios_administracion' then amount end), 0) as fees,
        coalesce(sum(case when line_type = 'iva_honorarios' then amount end), 0) as vat,
        coalesce(sum(case when line_type = 'gasto' then amount end), 0) as expenses,
        coalesce(sum(case when line_type in ('comision_locacion','ajuste') then sign * amount end), 0) as other,
        coalesce(sum(sign * amount), 0) as net
      from apartcba.rental_owner_statement_lines
      where statement_id = v_statement_id
    ) t
   where s.id = v_statement_id;

  return jsonb_build_object('statement_id', v_statement_id, 'number', v_number);
end $$;

-- Anular: igual que la 068e, más el bloqueo de los gastos ANTES de recalcular
-- su estado. Sin él, si la rendición de OTRO dueño que descuenta el mismo
-- gasto se confirmaba mientras tanto, el UPDATE … FROM esperaba la fila del
-- gasto y la escribía con el resultado viejo de la subconsulta (Postgres
-- re-chequea la fila, no recalcula el FROM): el gasto volvía a 'pendiente'
-- —editable y anulable— aunque esa rendición lo siguiera descontando. Con el
-- bloqueo primero, el recálculo arranca después y ve lo confirmado. Va antes
-- de tocar Caja o los renglones, en el mismo orden que la rendición nueva
-- (rendición → gastos por id): mientras espera sólo tiene esta rendición.
create or replace function apartcba.rental_void_owner_statement(
  p_organization_id uuid,
  p_statement_id uuid,
  p_reason text,
  p_delete_payments boolean
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_statement apartcba.rental_owner_statements%rowtype;
  v_carried_in integer;
begin
  select * into v_statement from apartcba.rental_owner_statements
   where id = p_statement_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'RENDICION_NO_ENCONTRADA: la rendición no existe en esta organización';
  end if;
  if v_statement.status = 'anulada' then
    raise exception 'RENDICION_CERRADA: la rendición ya estaba anulada';
  end if;

  select s.number into v_carried_in
    from apartcba.rental_owner_statement_lines l
    join apartcba.rental_owner_statements s
      on s.id = l.statement_id and s.organization_id = l.organization_id
   where l.organization_id = p_organization_id
     and l.ref_type = 'statement_carry'
     and l.ref_id = p_statement_id
     and l.voided = false
     and s.status <> 'anulada'
   limit 1;
  if found then
    raise exception 'SALDO_TRASLADADO: el saldo de esta rendición ya se descontó en la rendición N° %; anulá esa primero', lpad(v_carried_in::text, 4, '0');
  end if;

  perform 1
    from apartcba.rental_expenses x
   where x.organization_id = p_organization_id
     and x.id in (
       select l.ref_id
         from apartcba.rental_owner_statement_lines l
        where l.statement_id = p_statement_id
          and l.organization_id = p_organization_id
          and l.ref_type = 'expense'
          and l.ref_id is not null
       union
       select e.id
         from apartcba.rental_expenses e
        where e.statement_id = p_statement_id
          and e.organization_id = p_organization_id)
   order by x.id
   for no key update of x;

  if v_statement.status = 'pagada' and coalesce(array_length(v_statement.paid_movement_ids, 1), 0) > 0 then
    if not coalesce(p_delete_payments, false) then
      raise exception 'RENDICION_PAGADA: la rendición ya se pagó; para anularla hay que borrar también los egresos de Caja';
    end if;
    delete from apartcba.cash_movements
     where id = any (v_statement.paid_movement_ids) and organization_id = p_organization_id;
  end if;

  update apartcba.rental_owner_statement_lines set voided = true where statement_id = p_statement_id;

  -- Los gastos de esta rendición se recalculan con los renglones que siguen
  -- vivos (los de la rendición de otro dueño). Se toman los renglones de esta
  -- rendición y, por las dudas, los gastos que apuntaban a ella.
  update apartcba.rental_expenses x
     set statement_id = live.statement_id,
         status = case when live.statement_id is null then 'pendiente' else 'aplicado' end
    from (
      select t.expense_id,
             (select l2.statement_id
                from apartcba.rental_owner_statement_lines l2
                join apartcba.rental_owner_statements s2
                  on s2.id = l2.statement_id and s2.organization_id = l2.organization_id
               where l2.organization_id = p_organization_id
                 and l2.ref_type = 'expense'
                 and l2.ref_id = t.expense_id
                 and l2.voided = false
                 and s2.status <> 'anulada'
               order by s2.number desc
               limit 1) as statement_id
        from (
          select l.ref_id as expense_id
            from apartcba.rental_owner_statement_lines l
           where l.statement_id = p_statement_id
             and l.organization_id = p_organization_id
             and l.ref_type = 'expense'
             and l.ref_id is not null
          union
          select e.id
            from apartcba.rental_expenses e
           where e.statement_id = p_statement_id
             and e.organization_id = p_organization_id
        ) t
    ) live
   where x.id = live.expense_id
     and x.organization_id = p_organization_id
     and x.status <> 'anulado';

  update apartcba.rental_owner_statements
     set status = 'anulada', voided_at = now(), void_reason = nullif(p_reason, ''), paid_movement_ids = '{}'
   where id = p_statement_id;
  return jsonb_build_object('ok', true);
end $$;

-- Anular cargos en lote: igual que la 068f, más el bloqueo de los pagos antes
-- de la guarda del saldo a favor.
create or replace function apartcba.rental_void_charges(
  p_organization_id uuid,
  p_contract_id uuid,
  p_charge_ids uuid[],
  p_reason text,
  p_undo_credit boolean default false
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_alloc record;
  v_charge record;
  v_touched uuid[] := '{}';
  v_voided uuid[] := '{}';
  v_kept uuid[] := '{}';
  v_restored numeric(14,2) := 0;
  v_released integer := 0;
begin
  perform 1 from apartcba.rental_contracts
    where id = p_contract_id and organization_id = p_organization_id
    for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;
  if coalesce(array_length(p_charge_ids, 1), 0) = 0 then
    return jsonb_build_object('voided', '[]'::jsonb, 'kept', '[]'::jsonb, 'credit_restored', 0, 'expenses_released', 0);
  end if;

  -- 1) Saldo a favor imputado a estos cargos: vuelve a su pago. Lo que ya está
  --    en una rendición viva se le pagó al propietario: eso no se toca.
  if p_undo_credit then
    -- 068k: los pagos se bloquean ANTES de mirar si la imputación ya está en
    -- una rendición viva. rental_create_owner_statement los toma en modo
    -- compartido mientras rinde esos cobros: o esta guarda ve su renglón ya
    -- confirmado (y no le devuelve al pago un saldo que ya se le acreditó al
    -- propietario), o la rendición espera y ve la imputación deshecha. Mismo
    -- orden que antes (contrato → pagos), sólo que antes de la guarda.
    perform 1
      from apartcba.rental_payments p
     where p.organization_id = p_organization_id
       and p.id in (
         select a.payment_id
           from apartcba.rental_payment_allocations a
           join apartcba.rental_charges c on c.id = a.charge_id
          where a.organization_id = p_organization_id
            and c.organization_id = p_organization_id
            and c.contract_id = p_contract_id
            and c.id = any (p_charge_ids)
            and a.source = 'credit')
     order by p.id
     for no key update of p;

    for v_alloc in
      select a.id, a.payment_id, a.charge_id, a.charge_item_id, a.amount
        from apartcba.rental_payment_allocations a
        join apartcba.rental_charges c on c.id = a.charge_id
       where a.organization_id = p_organization_id
         and c.organization_id = p_organization_id
         and c.contract_id = p_contract_id
         and c.id = any (p_charge_ids)
         and c.voided_at is null
         and a.source = 'credit'
         and a.voided = false
         and not exists (
           select 1 from apartcba.rental_owner_statement_lines l
            where l.ref_type = 'allocation' and l.ref_id = a.id and l.voided = false
         )
       for update of a
    loop
      update apartcba.rental_charge_items
         set paid_amount = greatest(0, paid_amount - v_alloc.amount)
       where id = v_alloc.charge_item_id;
      update apartcba.rental_payments
         set unallocated_amount = least(amount, unallocated_amount + v_alloc.amount)
       where id = v_alloc.payment_id and voided_at is null;
      delete from apartcba.rental_payment_allocations where id = v_alloc.id;
      v_touched := v_touched || v_alloc.charge_id;
      v_restored := v_restored + v_alloc.amount;
    end loop;
    if array_length(v_touched, 1) is not null then
      perform apartcba.rental_recompute_charges(v_touched);
    end if;
  end if;

  -- 2) Se anulan los que quedaron sin ningún cobro; el resto vuelve en 'kept'.
  for v_charge in
    select c.id, c.paid_amount
      from apartcba.rental_charges c
     where c.organization_id = p_organization_id
       and c.contract_id = p_contract_id
       and c.id = any (p_charge_ids)
       and c.voided_at is null
     for update
  loop
    if v_charge.paid_amount > 0
       or exists (select 1 from apartcba.rental_payment_allocations a where a.charge_id = v_charge.id) then
      v_kept := v_kept || v_charge.id;
      continue;
    end if;
    update apartcba.rental_charges
       set voided_at = now(),
           void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Anulado'), 300),
           status = 'anulado'
     where id = v_charge.id;
    v_voided := v_voided || v_charge.id;
  end loop;

  -- 3) Los gastos que se le trasladaban al inquilino en esos cargos vuelven a
  --    quedar pendientes (se cobran en el próximo cargo o en el de salida).
  if array_length(v_voided, 1) is not null then
    update apartcba.rental_expenses e
       set status = 'pendiente', charge_item_id = null
     where e.organization_id = p_organization_id
       and e.status = 'aplicado'
       and e.charge_item_id in (
         select i.id from apartcba.rental_charge_items i
          where i.organization_id = p_organization_id and i.charge_id = any (v_voided)
       );
    get diagnostics v_released = row_count;
  end if;

  return jsonb_build_object(
    'voided', to_jsonb(v_voided),
    'kept', to_jsonb(v_kept),
    'credit_restored', v_restored,
    'expenses_released', v_released
  );
end $$;

revoke all on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) to service_role;
revoke all on function apartcba.rental_void_charges(uuid, uuid, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function apartcba.rental_void_charges(uuid, uuid, uuid[], text, boolean) to service_role;

commit;
