-- 068f — Alquileres: ciclo de vida del contrato
--
-- 1. rental_contracts.continuation_billing: cobrar los meses posteriores al
--    vencimiento (el contrato sigue en las mismas condiciones, art. 1218 CCyC)
--    es una decisión EXPLÍCITA. Sin el flag no se genera nada después del fin:
--    un inquilino que se fue sin que nadie cerrara el contrato no acumula
--    deuda fantasma.
--
-- 2. rental_payment_allocations.source: 'payment' (se imputó al registrar el
--    cobro) o 'credit' (saldo a favor aplicado después por rental_apply_credit).
--    Sólo una imputación de saldo a favor se puede deshacer sin tocar Caja: al
--    terminar un contrato, el saldo que se había imputado a meses que ya no se
--    van a cobrar vuelve al inquilino (y queda para la indemnización, otra
--    deuda o la devolución) en lugar de aparecer como alquiler de un mes en el
--    que ya no vive.
--    Backfill exacto: rental_register_payment inserta el pago y sus
--    imputaciones en la MISMA transacción (now() es la hora de la transacción,
--    created_at idéntico); rental_apply_credit corre siempre en otra posterior.
--
-- 3. rental_void_charges: anula en lote los cargos sin cobros de un contrato y,
--    en la misma transacción, devuelve a "pendiente" los gastos que se le
--    trasladaban al inquilino en esos cargos (antes quedaban 'aplicado' para
--    siempre, sin cobrarse ni poder editarse). Con p_undo_credit, primero
--    deshace las imputaciones de saldo a favor que todavía no se le rindieron
--    al propietario. Los cargos que siguen teniendo cobros no se anulan: se
--    devuelven en 'kept' para que una persona decida.
--
-- Esta migración es ADITIVA: dos columnas con default, un CHECK, el reemplazo
-- de rental_apply_credit (idéntica salvo `source`) y una función nueva.

begin;

-- ─── 1. Cobro de la continuación ────────────────────────────────────────────
alter table apartcba.rental_contracts
  add column if not exists continuation_billing boolean not null default false;

-- ─── 2. Origen de cada imputación ───────────────────────────────────────────
alter table apartcba.rental_payment_allocations
  add column if not exists source text not null default 'payment';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'rental_payment_allocations_source_valid'
       and conrelid = 'apartcba.rental_payment_allocations'::regclass
  ) then
    alter table apartcba.rental_payment_allocations
      add constraint rental_payment_allocations_source_valid check (source in ('payment', 'credit'));
  end if;
end $$;

update apartcba.rental_payment_allocations a
   set source = 'credit'
  from apartcba.rental_payments p
 where p.id = a.payment_id
   and a.source = 'payment'
   and a.created_at > p.created_at;

-- rental_apply_credit: igual que en la 068b, pero marca la imputación como 'credit'.
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
    insert into apartcba.rental_payment_allocations (organization_id, payment_id, charge_id, charge_item_id, amount, source)
    values (p_organization_id, v_payment.id, v_row.charge_id, v_row.id, v_amount, 'credit');
    v_charge_ids := v_charge_ids || v_row.charge_id;
    v_applied := v_applied + v_amount;
  end loop;

  if array_length(v_charge_ids, 1) is not null then
    perform apartcba.rental_recompute_charges(v_charge_ids);
  end if;
  return jsonb_build_object('applied', v_applied);
end $$;

-- ─── 3. Anular cargos en lote ───────────────────────────────────────────────
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

revoke all on function apartcba.rental_apply_credit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_apply_credit(uuid, uuid, jsonb) to service_role;
revoke all on function apartcba.rental_void_charges(uuid, uuid, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function apartcba.rental_void_charges(uuid, uuid, uuid[], text, boolean) to service_role;

commit;
