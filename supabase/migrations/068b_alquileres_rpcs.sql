-- 068b — Alquileres tradicionales: operaciones atómicas de plata
--
-- supabase-js no tiene transacciones: todo lo que escribe varias filas que
-- tienen que quedar consistentes (cobro + imputaciones + recibo + Caja,
-- rendición + renglones, pago de rendición + egresos) va en plpgsql.
--
-- Convenciones (067c / 047):
--   - Primer paso de cada función: comprobar que lo que se toca es de la org
--     que manda el llamador (no confía en que el server action ya filtró).
--   - Errores en castellano con un prefijo estable (CONTRATO_NO_ENCONTRADO:,
--     YA_RENDIDO:, …) que el server action traduce a un {ok:false, error}.
--   - EXECUTE sólo para service_role.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Numeración correlativa (contrato, recibo, rendición)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function apartcba.rental_next_number(p_organization_id uuid, p_kind text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v integer;
begin
  insert into apartcba.rental_counters (organization_id, kind, last_value)
  values (p_organization_id, p_kind, 1)
  on conflict (organization_id, kind)
    do update set last_value = apartcba.rental_counters.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recalcular subtotal / pagado / estado de una lista de cargos
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function apartcba.rental_recompute_charges(p_charge_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  update apartcba.rental_charges c
     set subtotal = t.subtotal,
         paid_amount = least(t.paid, t.subtotal),
         status = case
           when c.voided_at is not null then 'anulado'
           when t.subtotal <= 0 or t.paid >= t.subtotal - 0.005 then 'pagado'
           when t.paid > 0 then 'parcial'
           else 'pendiente'
         end
    from (
      select ch.id,
             coalesce(sum(i.amount), 0)::numeric(14,2) as subtotal,
             coalesce(sum(i.paid_amount), 0)::numeric(14,2) as paid
        from apartcba.rental_charges ch
        left join apartcba.rental_charge_items i on i.charge_id = ch.id
       where ch.id = any (p_charge_ids)
       group by ch.id
    ) t
   where c.id = t.id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Crear un cargo con sus ítems (idempotente para el mensual de un período)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function apartcba.rental_create_charge(
  p_organization_id uuid,
  p_contract_id uuid,
  p_charge jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_charge_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_kind text := coalesce(p_charge->>'kind', 'mensual');
  v_period smallint := nullif(p_charge->>'period_index', '')::smallint;
begin
  select * into v_contract
    from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;

  if v_kind = 'mensual' then
    select id into v_charge_id
      from apartcba.rental_charges
     where contract_id = p_contract_id and kind = 'mensual'
       and period_index = v_period and voided_at is null;
    if found then
      return jsonb_build_object('charge_id', v_charge_id, 'created', false);
    end if;
  end if;

  insert into apartcba.rental_charges (
    organization_id, contract_id, kind, period_index, period_start, period_end,
    cycle, index_in_cycle, cycle_length, label, issue_date, due_date, currency,
    pending_adjustment_seq, notes, created_by
  ) values (
    p_organization_id, p_contract_id, v_kind, v_period,
    nullif(p_charge->>'period_start', '')::date,
    nullif(p_charge->>'period_end', '')::date,
    nullif(p_charge->>'cycle', '')::smallint,
    nullif(p_charge->>'index_in_cycle', '')::smallint,
    nullif(p_charge->>'cycle_length', '')::smallint,
    p_charge->>'label',
    coalesce(nullif(p_charge->>'issue_date', '')::date, current_date),
    (p_charge->>'due_date')::date,
    coalesce(nullif(p_charge->>'currency', ''), v_contract.currency),
    nullif(p_charge->>'pending_adjustment_seq', '')::smallint,
    nullif(p_charge->>'notes', ''),
    nullif(p_charge->>'created_by', '')::uuid
  ) returning id into v_charge_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into apartcba.rental_charge_items (
      organization_id, charge_id, kind, payee, description, amount, original_amount,
      discount_reason, ref_type, ref_id, meta, sort_order
    ) values (
      p_organization_id, v_charge_id, v_item->>'kind', v_item->>'payee', v_item->>'description',
      (v_item->>'amount')::numeric(14,2),
      nullif(v_item->>'original_amount', '')::numeric(14,2),
      nullif(v_item->>'discount_reason', ''),
      nullif(v_item->>'ref_type', ''),
      nullif(v_item->>'ref_id', '')::uuid,
      coalesce(v_item->'meta', '{}'::jsonb),
      coalesce(nullif(v_item->>'sort_order', '')::smallint, 0)
    ) returning id into v_item_id;

    -- Un gasto a cargo del inquilino queda marcado como cobrado en este cargo.
    if v_item->>'ref_type' = 'rental_expense' then
      update apartcba.rental_expenses
         set status = 'aplicado', charge_item_id = v_item_id
       where id = (v_item->>'ref_id')::uuid
         and organization_id = p_organization_id
         and status = 'pendiente';
    end if;
  end loop;

  perform apartcba.rental_recompute_charges(array[v_charge_id]);
  return jsonb_build_object('charge_id', v_charge_id, 'created', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Registrar un cobro: punitorios nuevos + pago + recibo + imputaciones + Caja
-- ─────────────────────────────────────────────────────────────────────────────
-- p_payment:     {paid_at, amount, currency, method, account_id?, reference?, payer_name?,
--                 notes?, report_id?, created_by?, occurred_at?, movement_description?, owner_id?}
-- p_new_items:   [{charge_id, kind, payee, description, amount, meta?}]  (punitorios del día)
-- p_allocations: [{charge_id, item_id? | new_item_index?, amount}]
create or replace function apartcba.rental_register_payment(
  p_organization_id uuid,
  p_contract_id uuid,
  p_payment jsonb,
  p_new_items jsonb,
  p_allocations jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_amount numeric(14,2) := (p_payment->>'amount')::numeric(14,2);
  v_currency text := coalesce(nullif(p_payment->>'currency', ''), '');
  v_account_id uuid := nullif(p_payment->>'account_id', '')::uuid;
  v_account apartcba.cash_accounts%rowtype;
  v_new_ids uuid[] := '{}';
  v_item jsonb;
  v_alloc jsonb;
  v_item_id uuid;
  v_charge_id uuid;
  v_row apartcba.rental_charge_items%rowtype;
  v_alloc_amount numeric(14,2);
  v_total_alloc numeric(14,2) := 0;
  v_charge_ids uuid[] := '{}';
  v_payment_id uuid;
  v_receipt integer;
  v_movement_id uuid;
  v_idx integer;
begin
  select * into v_contract
    from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'IMPORTE_INVALIDO: el importe tiene que ser mayor a cero';
  end if;
  if v_currency = '' then v_currency := v_contract.currency; end if;
  if v_currency <> v_contract.currency then
    raise exception 'MONEDA_DISTINTA: el contrato es en % y el pago en %', v_contract.currency, v_currency;
  end if;

  if v_account_id is not null then
    select * into v_account
      from apartcba.cash_accounts
     where id = v_account_id and organization_id = p_organization_id;
    if not found or not v_account.active then
      raise exception 'CUENTA_INVALIDA: la cuenta de Caja no existe o está archivada';
    end if;
    if v_account.currency <> v_currency then
      raise exception 'MONEDA_DISTINTA: la cuenta "%" es en % y el contrato en %', v_account.name, v_account.currency, v_currency;
    end if;
  end if;

  -- 1) Punitorios (u otros ítems) que nacen con este cobro
  for v_item in select * from jsonb_array_elements(coalesce(p_new_items, '[]'::jsonb)) loop
    v_charge_id := (v_item->>'charge_id')::uuid;
    perform 1 from apartcba.rental_charges
      where id = v_charge_id and contract_id = p_contract_id
        and organization_id = p_organization_id and voided_at is null;
    if not found then
      raise exception 'CARGO_INVALIDO: el cargo no pertenece a este contrato';
    end if;
    insert into apartcba.rental_charge_items (
      organization_id, charge_id, kind, payee, description, amount, meta, sort_order
    ) values (
      p_organization_id, v_charge_id, coalesce(v_item->>'kind', 'punitorio'),
      coalesce(v_item->>'payee', 'propietario'), v_item->>'description',
      (v_item->>'amount')::numeric(14,2), coalesce(v_item->'meta', '{}'::jsonb), 90
    ) returning id into v_item_id;
    v_new_ids := v_new_ids || v_item_id;
    v_charge_ids := v_charge_ids || v_charge_id;
  end loop;

  -- 2) El pago con su recibo correlativo
  v_receipt := apartcba.rental_next_number(p_organization_id, 'recibo');
  insert into apartcba.rental_payments (
    organization_id, contract_id, paid_at, amount, currency, method, account_id,
    reference, payer_name, receipt_number, unallocated_amount, report_id, notes, created_by
  ) values (
    p_organization_id, p_contract_id, (p_payment->>'paid_at')::date, v_amount, v_currency,
    coalesce(nullif(p_payment->>'method', ''), 'transferencia'), v_account_id,
    nullif(p_payment->>'reference', ''), nullif(p_payment->>'payer_name', ''), v_receipt,
    v_amount, nullif(p_payment->>'report_id', '')::uuid, nullif(p_payment->>'notes', ''),
    nullif(p_payment->>'created_by', '')::uuid
  ) returning id into v_payment_id;

  -- Los punitorios nacidos con este cobro quedan atados a él: si se anula el
  -- cobro y siguen sin pagar, desaparecen (ver rental_void_payment).
  if array_length(v_new_ids, 1) is not null then
    update apartcba.rental_charge_items
       set meta = meta || jsonb_build_object('payment_id', v_payment_id)
     where id = any (v_new_ids);
  end if;

  -- 3) Imputaciones (validadas contra el saldo real de cada ítem)
  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc_amount := (v_alloc->>'amount')::numeric(14,2);
    if v_alloc_amount is null or v_alloc_amount <= 0 then continue; end if;
    if v_alloc ? 'new_item_index' and nullif(v_alloc->>'new_item_index', '') is not null then
      v_idx := (v_alloc->>'new_item_index')::integer + 1;
      if v_idx < 1 or v_idx > coalesce(array_length(v_new_ids, 1), 0) then
        raise exception 'IMPUTACION_INVALIDA: ítem nuevo inexistente';
      end if;
      v_item_id := v_new_ids[v_idx];
    else
      v_item_id := (v_alloc->>'item_id')::uuid;
    end if;

    select i.* into v_row
      from apartcba.rental_charge_items i
      join apartcba.rental_charges c on c.id = i.charge_id
     where i.id = v_item_id and i.organization_id = p_organization_id
       and c.contract_id = p_contract_id and c.voided_at is null
     for update of i;
    if not found then
      raise exception 'IMPUTACION_INVALIDA: el concepto no pertenece a este contrato';
    end if;
    if v_alloc_amount > (v_row.amount - v_row.paid_amount) + 0.005 then
      raise exception 'IMPUTACION_EXCEDIDA: "%" tiene un saldo de % y se quiso imputar %',
        v_row.description, (v_row.amount - v_row.paid_amount), v_alloc_amount;
    end if;

    update apartcba.rental_charge_items
       set paid_amount = least(amount, paid_amount + v_alloc_amount)
     where id = v_item_id;
    insert into apartcba.rental_payment_allocations (organization_id, payment_id, charge_id, charge_item_id, amount)
    values (p_organization_id, v_payment_id, v_row.charge_id, v_item_id, v_alloc_amount);
    v_total_alloc := v_total_alloc + v_alloc_amount;
    v_charge_ids := v_charge_ids || v_row.charge_id;
  end loop;

  if v_total_alloc > v_amount + 0.005 then
    raise exception 'IMPUTACION_EXCEDIDA: se imputó más de lo que se cobró';
  end if;
  update apartcba.rental_payments
     set unallocated_amount = greatest(0, v_amount - v_total_alloc)
   where id = v_payment_id;

  if array_length(v_charge_ids, 1) is not null then
    perform apartcba.rental_recompute_charges(v_charge_ids);
  end if;

  -- 4) Ingreso en Caja (sólo si la plata entra a una cuenta de la inmobiliaria)
  if v_account_id is not null then
    insert into apartcba.cash_movements (
      organization_id, account_id, direction, amount, currency, category,
      ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
    ) values (
      p_organization_id, v_account_id, 'in', v_amount, v_currency, 'rent_collection',
      'rental_payment', v_payment_id, nullif(p_payment->>'owner_id', '')::uuid,
      coalesce(nullif(p_payment->>'movement_description', ''), 'Cobro de alquiler · recibo ' || v_receipt),
      coalesce(nullif(p_payment->>'occurred_at', '')::timestamptz, now()),
      nullif(p_payment->>'created_by', '')::uuid, 'owner'
    ) returning id into v_movement_id;
    update apartcba.rental_payments set cash_movement_id = v_movement_id where id = v_payment_id;
  end if;

  -- 5) Si venía de un aviso del portal, queda registrado
  if nullif(p_payment->>'report_id', '') is not null then
    update apartcba.rental_payment_reports
       set status = 'registrado', payment_id = v_payment_id,
           reviewed_at = now(), reviewed_by = nullif(p_payment->>'created_by', '')::uuid
     where id = (p_payment->>'report_id')::uuid
       and organization_id = p_organization_id and contract_id = p_contract_id
       and status = 'pendiente';
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt,
    'cash_movement_id', v_movement_id,
    'unallocated', greatest(0, v_amount - v_total_alloc)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Imputar saldo a favor de pagos anteriores a cargos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
-- p_allocations: [{payment_id, item_id, amount}]
create or replace function apartcba.rental_apply_credit(
  p_organization_id uuid,
  p_contract_id uuid,
  p_allocations jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_alloc jsonb;
  v_payment apartcba.rental_payments%rowtype;
  v_row apartcba.rental_charge_items%rowtype;
  v_amount numeric(14,2);
  v_charge_ids uuid[] := '{}';
  v_applied numeric(14,2) := 0;
begin
  perform 1 from apartcba.rental_contracts
    where id = p_contract_id and organization_id = p_organization_id
    for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amount := (v_alloc->>'amount')::numeric(14,2);
    if v_amount is null or v_amount <= 0 then continue; end if;

    select * into v_payment from apartcba.rental_payments
     where id = (v_alloc->>'payment_id')::uuid and contract_id = p_contract_id
       and organization_id = p_organization_id and voided_at is null
     for update;
    if not found or v_payment.unallocated_amount < v_amount - 0.005 then
      raise exception 'SALDO_INSUFICIENTE: el pago no tiene saldo a favor suficiente';
    end if;

    select i.* into v_row
      from apartcba.rental_charge_items i
      join apartcba.rental_charges c on c.id = i.charge_id
     where i.id = (v_alloc->>'item_id')::uuid and i.organization_id = p_organization_id
       and c.contract_id = p_contract_id and c.voided_at is null
     for update of i;
    if not found or v_amount > (v_row.amount - v_row.paid_amount) + 0.005 then
      raise exception 'IMPUTACION_INVALIDA: el concepto no existe o ya está pagado';
    end if;

    update apartcba.rental_charge_items set paid_amount = least(amount, paid_amount + v_amount) where id = v_row.id;
    update apartcba.rental_payments set unallocated_amount = greatest(0, unallocated_amount - v_amount) where id = v_payment.id;
    insert into apartcba.rental_payment_allocations (organization_id, payment_id, charge_id, charge_item_id, amount)
    values (p_organization_id, v_payment.id, v_row.charge_id, v_row.id, v_amount);
    v_charge_ids := v_charge_ids || v_row.charge_id;
    v_applied := v_applied + v_amount;
  end loop;

  if array_length(v_charge_ids, 1) is not null then
    perform apartcba.rental_recompute_charges(v_charge_ids);
  end if;
  return jsonb_build_object('applied', v_applied);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Anular un cobro (revierte imputaciones, borra el ingreso de Caja)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function apartcba.rental_void_payment(
  p_organization_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_actor uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payment apartcba.rental_payments%rowtype;
  v_alloc record;
  v_charge_ids uuid[] := '{}';
  v_statement integer;
begin
  select * into v_payment from apartcba.rental_payments
   where id = p_payment_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'COBRO_NO_ENCONTRADO: el cobro no existe en esta organización';
  end if;
  if v_payment.voided_at is not null then
    raise exception 'COBRO_ANULADO: el cobro ya estaba anulado';
  end if;
  perform 1 from apartcba.rental_contracts where id = v_payment.contract_id for update;

  -- Lo que ya se le rindió al propietario no se puede deshacer desde acá.
  select s.number into v_statement
    from apartcba.rental_payment_allocations a
    join apartcba.rental_owner_statement_lines l
      on l.ref_type = 'allocation' and l.ref_id = a.id and l.voided = false
    join apartcba.rental_owner_statements s on s.id = l.statement_id
   where a.payment_id = p_payment_id
   limit 1;
  if v_statement is not null then
    raise exception 'YA_RENDIDO: este cobro ya está en la rendición N° %; anulá la rendición primero', v_statement;
  end if;

  for v_alloc in
    select a.id, a.charge_id, a.charge_item_id, a.amount
      from apartcba.rental_payment_allocations a
     where a.payment_id = p_payment_id
  loop
    update apartcba.rental_charge_items
       set paid_amount = greatest(0, paid_amount - v_alloc.amount)
     where id = v_alloc.charge_item_id;
    v_charge_ids := v_charge_ids || v_alloc.charge_id;
  end loop;
  delete from apartcba.rental_payment_allocations where payment_id = p_payment_id;

  -- Los punitorios que nacieron con este cobro y quedaron sin pagar desaparecen.
  delete from apartcba.rental_charge_items i
   where i.organization_id = p_organization_id
     and i.kind = 'punitorio'
     and i.meta->>'payment_id' = p_payment_id::text
     and i.paid_amount = 0
     and not exists (select 1 from apartcba.rental_payment_allocations a where a.charge_item_id = i.id);

  if array_length(v_charge_ids, 1) is not null then
    perform apartcba.rental_recompute_charges(v_charge_ids);
  end if;

  if v_payment.cash_movement_id is not null then
    delete from apartcba.cash_movements
     where id = v_payment.cash_movement_id and organization_id = p_organization_id;
  end if;

  update apartcba.rental_payments
     set voided_at = now(), void_reason = nullif(p_reason, ''), voided_by = p_actor,
         unallocated_amount = 0, cash_movement_id = null
   where id = p_payment_id;

  update apartcba.rental_payment_reports
     set status = 'pendiente', payment_id = null, reviewed_at = null, reviewed_by = null
   where payment_id = p_payment_id and organization_id = p_organization_id;

  return jsonb_build_object('ok', true, 'charge_ids', to_jsonb(v_charge_ids));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Crear una rendición al propietario (cabecera + renglones, totales recalculados)
-- ─────────────────────────────────────────────────────────────────────────────
-- p_header: {period_year, period_month, cutoff_date, currency, notes?, generated_by?}
-- p_lines:  [{line_type, sign, amount, description, contract_id?, property_id?, ref_type?, ref_id?, share_pct?, sort_order?}]
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
begin
  perform 1 from apartcba.owners where id = p_owner_id and organization_id = p_organization_id;
  if not found then
    raise exception 'PROPIETARIO_NO_ENCONTRADO: el propietario no existe en esta organización';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'SIN_RENGLONES: no hay nada para rendir';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Pagar una rendición (un egreso de Caja por cuenta, cierre con estado)
-- ─────────────────────────────────────────────────────────────────────────────
-- p_splits: [{account_id, amount}]
create or replace function apartcba.rental_pay_owner_statement(
  p_organization_id uuid,
  p_statement_id uuid,
  p_splits jsonb,
  p_paid_at timestamptz,
  p_actor uuid,
  p_description text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_statement apartcba.rental_owner_statements%rowtype;
  v_split jsonb;
  v_account apartcba.cash_accounts%rowtype;
  v_amount numeric(14,2);
  v_total numeric(14,2) := 0;
  v_ids uuid[] := '{}';
  v_movement_id uuid;
begin
  select * into v_statement from apartcba.rental_owner_statements
   where id = p_statement_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'RENDICION_NO_ENCONTRADA: la rendición no existe en esta organización';
  end if;
  if v_statement.status not in ('borrador','emitida') then
    raise exception 'RENDICION_CERRADA: la rendición está %', v_statement.status;
  end if;
  if v_statement.net_amount <= 0 then
    raise exception 'SIN_SALDO: el neto de la rendición no es positivo; no hay nada para pagarle al propietario';
  end if;

  for v_split in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    v_amount := (v_split->>'amount')::numeric(14,2);
    if v_amount is null or v_amount <= 0 then continue; end if;
    select * into v_account from apartcba.cash_accounts
     where id = (v_split->>'account_id')::uuid and organization_id = p_organization_id;
    if not found or not v_account.active then
      raise exception 'CUENTA_INVALIDA: una de las cuentas no existe o está archivada';
    end if;
    if v_account.currency <> v_statement.currency then
      raise exception 'MONEDA_DISTINTA: la cuenta "%" es en % y la rendición en %', v_account.name, v_account.currency, v_statement.currency;
    end if;
    insert into apartcba.cash_movements (
      organization_id, account_id, direction, amount, currency, category,
      ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
    ) values (
      p_organization_id, v_account.id, 'out', v_amount, v_statement.currency, 'rent_owner_payout',
      'rental_statement_payment', p_statement_id, v_statement.owner_id,
      coalesce(nullif(p_description, ''), 'Rendición N° ' || v_statement.number),
      coalesce(p_paid_at, now()), p_actor, 'owner'
    ) returning id into v_movement_id;
    v_ids := v_ids || v_movement_id;
    v_total := v_total + v_amount;
  end loop;

  if abs(v_total - v_statement.net_amount) > 0.01 then
    raise exception 'SUMA_DISTINTA: los pagos suman % y el neto de la rendición es %', v_total, v_statement.net_amount;
  end if;

  update apartcba.rental_owner_statements
     set status = 'pagada', paid_at = coalesce(p_paid_at, now()), paid_movement_ids = v_ids
   where id = p_statement_id;

  return jsonb_build_object('ok', true, 'movement_ids', to_jsonb(v_ids));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Anular una rendición (libera sus renglones para volver a rendirlos)
-- ─────────────────────────────────────────────────────────────────────────────
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
  if v_statement.status = 'pagada' then
    if not coalesce(p_delete_payments, false) then
      raise exception 'RENDICION_PAGADA: la rendición ya se pagó; para anularla hay que borrar también los egresos de Caja';
    end if;
    delete from apartcba.cash_movements
     where id = any (v_statement.paid_movement_ids) and organization_id = p_organization_id;
  end if;

  update apartcba.rental_owner_statement_lines set voided = true where statement_id = p_statement_id;
  update apartcba.rental_expenses
     set status = 'pendiente', statement_id = null
   where statement_id = p_statement_id and organization_id = p_organization_id;
  update apartcba.rental_owner_statements
     set status = 'anulada', voided_at = now(), void_reason = nullif(p_reason, ''), paid_movement_ids = '{}'
   where id = p_statement_id;
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos: sólo el service role (server actions / cron)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function apartcba.rental_next_number(uuid, text) from public, anon, authenticated;
revoke all on function apartcba.rental_recompute_charges(uuid[]) from public, anon, authenticated;
revoke all on function apartcba.rental_create_charge(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function apartcba.rental_register_payment(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function apartcba.rental_apply_credit(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function apartcba.rental_void_payment(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function apartcba.rental_pay_owner_statement(uuid, uuid, jsonb, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) from public, anon, authenticated;

grant execute on function apartcba.rental_next_number(uuid, text) to service_role;
grant execute on function apartcba.rental_recompute_charges(uuid[]) to service_role;
grant execute on function apartcba.rental_create_charge(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function apartcba.rental_register_payment(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function apartcba.rental_apply_credit(uuid, uuid, jsonb) to service_role;
grant execute on function apartcba.rental_void_payment(uuid, uuid, text, uuid) to service_role;
grant execute on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function apartcba.rental_pay_owner_statement(uuid, uuid, jsonb, timestamptz, uuid, text) to service_role;
grant execute on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) to service_role;

commit;
