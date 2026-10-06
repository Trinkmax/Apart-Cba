-- 070 — Alquileres: cobro con reparto (cobra el propietario)
--
-- Pedido (06/10/2026): en un contrato que cobra el propietario
-- (collector = 'propietario') el inquilino hace DOS transferencias: la parte
-- del propietario va directo a la cuenta del propietario y la parte de la
-- inmobiliaria (honorarios de administración + IVA, conceptos propios y lo que
-- recibe para pagarle a terceros) a una cuenta de Caja que se elige al cobrar.
-- Hasta acá esos cobros no pedían cuenta y la comisión no quedaba en ningún lado.
--
-- Qué cambia:
--   · rental_payments suma la cuenta, el importe y el ingreso en Caja de la
--     parte de la inmobiliaria, y una foto del reparto (split, v: 1) con los
--     datos bancarios de cada titular al momento de cobrar.
--   · rental_register_payment: si llega un reparto, exige contrato que cobre
--     el propietario, ninguna cuenta para el total, una cuenta válida (de la
--     org, activa, en la moneda del cobro) si la parte de la inmobiliaria es
--     mayor a cero, e ingresa SÓLO esa parte en Caja: honorarios + IVA y
--     conceptos propios como 'agency_fee'; lo que recibe para pagarle al
--     consorcio o a terceros, aparte, como 'rent_collection'. La parte del
--     propietario no toca Caja (el depósito, si cobra el propietario, va en su
--     parte: es lo que da por hecho rental_deposit_holder).
--   · rental_void_payment: al anular, borra también esos ingresos.
--   · rental_create_owner_statement: un cobro con reparto nunca se rinde (el
--     propietario ya cobró su parte), aunque el contrato pase a cobrarlo la
--     inmobiliaria. La app ya los deja afuera; esto es la red de la base.
--
-- Revisado y sin cambios (cuerpos vivos al 06/10/2026):
--   · rental_reopen_deposit anula el cobro con rental_void_payment (hereda el cambio).
--   · rental_void_charges anula cargos, no cobros, y no toca Caja.
--   · delete_cash_movement / update_cash_movement sólo conocen cuotas de
--     reservas; la app no deja editar ni borrar desde Caja un movimiento con
--     ref_type 'rental_*' (el ingreso nuevo usa ref_type 'rental_payment').
--
-- Cada función parte de su cuerpo VIVO (pg_get_functiondef; idéntico por md5 de
-- prosrc a 068b / 068k) y sólo suma lo marcado con "070". Un bloque por cosa,
-- con sus permisos, para poder aplicarla por partes: EN ORDEN (1 → 4); las
-- funciones leen las columnas del bloque 1. Es ADITIVA: con la app vieja todo
-- sigue igual (sin reparto no cambia nada).

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 1/4 — rental_payments: columnas del reparto
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table apartcba.rental_payments
  add column if not exists agency_account_id uuid,
  add column if not exists agency_amount numeric(14,2),
  add column if not exists agency_movement_id uuid references apartcba.cash_movements(id) on delete set null,
  add column if not exists pass_through_movement_id uuid references apartcba.cash_movements(id) on delete set null,
  add column if not exists split jsonb;

-- Misma FK compuesta que account_id: la cuenta tiene que ser de la misma organización.
alter table apartcba.rental_payments drop constraint if exists rental_payments_agency_account_fk;
alter table apartcba.rental_payments add constraint rental_payments_agency_account_fk
  foreign key (organization_id, agency_account_id)
  references apartcba.cash_accounts (organization_id, id) on delete restrict;

alter table apartcba.rental_payments drop constraint if exists rental_payments_agency_amount_valid;
alter table apartcba.rental_payments add constraint rental_payments_agency_amount_valid
  check (agency_amount is null or (agency_amount >= 0 and agency_amount <= amount));

-- Si a la inmobiliaria le tocó algo, se sabe en qué cuenta entró.
alter table apartcba.rental_payments drop constraint if exists rental_payments_agency_account_needed;
alter table apartcba.rental_payments add constraint rental_payments_agency_account_needed
  check (coalesce(agency_amount, 0) = 0 or agency_account_id is not null);

-- Un cobro con reparto no entra entero a Caja, y lo de la inmobiliaria sólo
-- existe dentro de un reparto.
alter table apartcba.rental_payments drop constraint if exists rental_payments_split_coherent;
alter table apartcba.rental_payments add constraint rental_payments_split_coherent
  check (
    (split is null and agency_account_id is null and agency_amount is null
       and agency_movement_id is null and pass_through_movement_id is null)
    or (split is not null and jsonb_typeof(split) = 'object' and account_id is null)
  );

comment on column apartcba.rental_payments.agency_account_id is
  'Cobro con reparto (cobra el propietario): cuenta de Caja donde entró la parte de la inmobiliaria. Null si esa parte es 0 o si no hubo reparto. Migración 070.';
comment on column apartcba.rental_payments.agency_amount is
  'Cobro con reparto: lo que le tocó a la inmobiliaria (honorarios + IVA, conceptos propios y lo que recibe para pagarle a terceros). El resto lo recibió el propietario directo y no pasó por Caja. Migración 070.';
comment on column apartcba.rental_payments.agency_movement_id is
  'Cobro con reparto: ingreso en Caja (categoría agency_fee, ref_type rental_payment) por lo que es plata de la inmobiliaria: honorarios + IVA y conceptos propios. Se borra al anular el cobro. Migración 070.';
comment on column apartcba.rental_payments.pass_through_movement_id is
  'Cobro con reparto: ingreso en Caja (categoría rent_collection, ref_type rental_payment) por lo que la inmobiliaria recibe para pagarle al consorcio o a terceros; con agency_movement_id suman agency_amount. Se borra al anular el cobro. Migración 070.';
comment on column apartcba.rental_payments.split is
  'Foto del reparto al registrar el cobro (v: 1): total, parte del propietario por titular con sus datos bancarios de ese momento y parte de la inmobiliaria. No nulo = el propietario cobró su parte directo: las imputaciones de este cobro nunca se le rinden. Migración 070.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 2/4 — rental_register_payment (cuerpo vivo = 068b + "070")
-- ═══════════════════════════════════════════════════════════════════════════
-- p_payment suma (todo opcional; sin "split" el cobro queda como antes):
--   split                        foto del reparto (objeto, v: 1). Su "total" tiene
--                                que ser el importe y su "agency.total", agency_amount.
--   agency_amount                parte de la inmobiliaria (0..importe).
--   agency_account_id            cuenta de Caja de esa parte (obligatoria si es > 0).
--   agency_pass_through          de esa parte, lo que recibe para pagarle al consorcio o a
--                                terceros (0..agency_amount; sin el dato, el de la foto).
--   agency_movement_description  qué es lo que es plata suya ("Honorarios 8 % + IVA"); la
--                                función le agrega " · recibo 000123" (el número sale acá).
--   agency_pass_description      para quién es lo otro ("Expensas para el consorcio").
-- Entra a Caja en dos movimientos: agency_amount − agency_pass_through como
-- honorarios ('agency_fee') y agency_pass_through como cobro ('rent_collection'),
-- así lo que es del consorcio o de terceros no se cuenta como honorarios.
-- Devuelve además agency_movement_id y pass_through_movement_id (siempre, aunque
-- sean null: la app reconoce por esas claves que la base ya tiene la 070).

begin;

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
  -- 070: cobro con reparto
  v_split jsonb := case when jsonb_typeof(p_payment->'split') = 'object' then p_payment->'split' end;
  v_agency_amount numeric(14,2) := coalesce(nullif(p_payment->>'agency_amount', '')::numeric(14,2), 0);
  v_agency_pass numeric(14,2) := coalesce(nullif(p_payment->>'agency_pass_through', '')::numeric(14,2), 0);
  v_agency_fee_part numeric(14,2);
  v_agency_account_id uuid := nullif(p_payment->>'agency_account_id', '')::uuid;
  v_agency_account apartcba.cash_accounts%rowtype;
  v_agency_movement_id uuid;
  v_pass_movement_id uuid;
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

  -- 070: cobro con reparto (cobra el propietario). El inquilino le transfiere
  -- su parte directo al propietario (no entra a Caja) y la de la inmobiliaria
  -- a una cuenta de Caja: sólo esa parte es un ingreso.
  -- Lo que recibe para pagarle a otro: si la app no lo manda, sale de la foto.
  if nullif(p_payment->>'agency_pass_through', '') is null and v_split is not null then
    v_agency_pass := coalesce(nullif(v_split->'agency'->>'pass_through', '')::numeric(14,2), 0);
  end if;
  if v_split is not null or v_agency_amount <> 0 or v_agency_pass <> 0 or v_agency_account_id is not null then
    if v_contract.collector <> 'propietario' then
      raise exception 'REPARTO_INVALIDO: este contrato lo cobra la inmobiliaria: el cobro entra entero a Caja y no se reparte';
    end if;
    if v_account_id is not null then
      raise exception 'REPARTO_INVALIDO: en un cobro con reparto sólo entra a Caja la parte de la inmobiliaria';
    end if;
    if v_split is null then
      raise exception 'REPARTO_INVALIDO: falta el detalle del reparto; volvé a abrir el cobro';
    end if;
    if v_agency_amount < 0 or v_agency_amount > v_amount then
      raise exception 'REPARTO_INVALIDO: la parte de la inmobiliaria no puede ser mayor que lo cobrado';
    end if;
    if v_agency_pass < 0 or v_agency_pass > v_agency_amount then
      raise exception 'REPARTO_INVALIDO: lo que la inmobiliaria recibe para pagarle a terceros no puede ser mayor que su parte';
    end if;
    if (v_split->>'total')::numeric(14,2) is distinct from v_amount
       or coalesce((v_split->'agency'->>'total')::numeric(14,2), 0) <> v_agency_amount
       or coalesce((v_split->'agency'->>'pass_through')::numeric(14,2), 0) <> v_agency_pass
       or (v_split->'owner'->>'total')::numeric(14,2) + v_agency_amount is distinct from v_amount then
      raise exception 'REPARTO_INVALIDO: el reparto no coincide con lo cobrado; volvé a abrir el cobro';
    end if;
    if v_agency_amount > 0 then
      if v_agency_account_id is null then
        raise exception 'CUENTA_INVALIDA: elegí la cuenta de Caja donde entra la parte de la inmobiliaria';
      end if;
      select * into v_agency_account
        from apartcba.cash_accounts
       where id = v_agency_account_id and organization_id = p_organization_id;
      if not found or not v_agency_account.active then
        raise exception 'CUENTA_INVALIDA: la cuenta de Caja no existe o está archivada';
      end if;
      if v_agency_account.currency <> v_currency then
        raise exception 'CUENTA_INVALIDA: la cuenta "%" es en % y el cobro en %', v_agency_account.name, v_agency_account.currency, v_currency;
      end if;
    else
      v_agency_account_id := null;
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

  -- 4b) 070: cobro con reparto. La parte del propietario no pasa por Caja; la
  --     de la inmobiliaria entra en la cuenta elegida, en dos movimientos para
  --     que Caja no cuente como honorarios plata que no es de la inmobiliaria:
  --       · honorarios + IVA + conceptos propios → 'agency_fee' (es su plata);
  --       · lo que recibe para pagarle al consorcio o a terceros → 'rent_collection',
  --         como esa misma plata en un contrato que cobra la inmobiliaria.
  --     Las dos son plata en manos de la inmobiliaria (billable_to 'apartcba'),
  --     no del propietario: él ya cobró su parte directo.
  if v_split is not null then
    v_agency_fee_part := v_agency_amount - v_agency_pass;
    if v_agency_fee_part > 0 then
      insert into apartcba.cash_movements (
        organization_id, account_id, direction, amount, currency, category,
        ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
      ) values (
        p_organization_id, v_agency_account_id, 'in', v_agency_fee_part, v_currency, 'agency_fee',
        'rental_payment', v_payment_id, nullif(p_payment->>'owner_id', '')::uuid,
        left(coalesce(nullif(p_payment->>'agency_movement_description', ''), 'Honorarios de administración'), 160)
          || ' · recibo ' || lpad(v_receipt::text, 6, '0'),
        coalesce(nullif(p_payment->>'occurred_at', '')::timestamptz, now()),
        nullif(p_payment->>'created_by', '')::uuid, 'apartcba'
      ) returning id into v_agency_movement_id;
    end if;
    if v_agency_pass > 0 then
      insert into apartcba.cash_movements (
        organization_id, account_id, direction, amount, currency, category,
        ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
      ) values (
        p_organization_id, v_agency_account_id, 'in', v_agency_pass, v_currency, 'rent_collection',
        'rental_payment', v_payment_id, nullif(p_payment->>'owner_id', '')::uuid,
        left(coalesce(nullif(p_payment->>'agency_pass_description', ''), 'Para pagarle a terceros'), 160)
          || ' · recibo ' || lpad(v_receipt::text, 6, '0'),
        coalesce(nullif(p_payment->>'occurred_at', '')::timestamptz, now()),
        nullif(p_payment->>'created_by', '')::uuid, 'apartcba'
      ) returning id into v_pass_movement_id;
    end if;
    update apartcba.rental_payments
       set split = v_split,
           agency_amount = v_agency_amount,
           agency_account_id = v_agency_account_id,
           agency_movement_id = v_agency_movement_id,
           pass_through_movement_id = v_pass_movement_id
     where id = v_payment_id;
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
    'agency_movement_id', v_agency_movement_id,
    'pass_through_movement_id', v_pass_movement_id,
    'unallocated', greatest(0, v_amount - v_total_alloc)
  );
end $$;

revoke all on function apartcba.rental_register_payment(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_register_payment(uuid, uuid, jsonb, jsonb, jsonb) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 3/4 — rental_void_payment (cuerpo vivo = 068b + "070")
-- ═══════════════════════════════════════════════════════════════════════════
-- Al anular un cobro con reparto se borran también los ingresos de la parte de
-- la inmobiliaria (agency_movement_id y pass_through_movement_id quedan en
-- null, igual que cash_movement_id). La foto del reparto, la cuenta y el
-- importe quedan como historia.
-- rental_reopen_deposit anula con esta función: hereda el cambio.

begin;

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
  -- 070: la parte de la inmobiliaria de un cobro con reparto (honorarios y lo
  -- que recibió para pagarle a otro).
  if v_payment.agency_movement_id is not null then
    delete from apartcba.cash_movements
     where id = v_payment.agency_movement_id and organization_id = p_organization_id;
  end if;
  if v_payment.pass_through_movement_id is not null then
    delete from apartcba.cash_movements
     where id = v_payment.pass_through_movement_id and organization_id = p_organization_id;
  end if;

  update apartcba.rental_payments
     set voided_at = now(), void_reason = nullif(p_reason, ''), voided_by = p_actor,
         unallocated_amount = 0, cash_movement_id = null, agency_movement_id = null,
         pass_through_movement_id = null
   where id = p_payment_id;

  update apartcba.rental_payment_reports
     set status = 'pendiente', payment_id = null, reviewed_at = null, reviewed_by = null
   where payment_id = p_payment_id and organization_id = p_organization_id;

  return jsonb_build_object('ok', true, 'charge_ids', to_jsonb(v_charge_ids));
end $$;

revoke all on function apartcba.rental_void_payment(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_void_payment(uuid, uuid, text, uuid) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOQUE 4/4 — rental_create_owner_statement (cuerpo vivo = 068k + "070")
-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que el inquilino le pagó directo al propietario (cobro con reparto) ya lo
-- tiene él: si el contrato pasa a cobrarlo la inmobiliaria, la próxima rendición
-- no puede volver a acreditárselo. La app ya lo deja afuera (statements.ts);
-- esto frena cualquier otro camino. Corre después de bloquear los pagos
-- (paso 2), así que no suma bloqueos nuevos.

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

  -- 070: un cobro con reparto nunca se rinde (el propietario ya cobró su parte).
  select j.line->>'description' into v_stale_text
    from jsonb_array_elements(p_lines) as j(line)
    join apartcba.rental_payment_allocations a
      on a.id = nullif(j.line->>'ref_id', '')::uuid
     and a.organization_id = p_organization_id
    join apartcba.rental_payments p
      on p.id = a.payment_id and p.organization_id = a.organization_id
   where j.line->>'ref_type' = 'allocation'
     and p.split is not null
   limit 1;
  if found then
    raise exception 'COBRO_DIRECTO: "%" lo cobró el propietario directo del inquilino: ya tiene esa plata y no se le rinde; volvé a generar la rendición', v_stale_text;
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

revoke all on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_create_owner_statement(uuid, uuid, jsonb, jsonb) to service_role;

commit;

-- Fin de la 070.
