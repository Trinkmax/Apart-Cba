-- 068h — Alquileres: ciclo de vida del depósito en garantía
--
-- Hasta acá nada escribía 'retenido', 'devuelto' ni 'aplicado': el depósito
-- quedaba "A cobrar" para siempre aunque el inquilino lo hubiera pagado, la
-- ficha de un contrato terminado pedía "devolvelo" sin ningún botón para
-- registrarlo y el aviso "Depósito a devolver" del tablero nunca aparecía.
--
-- 1. deposit_status sale de la cuenta del inquilino: cuando los renglones
--    'deposito' vivos están pagos pasa a 'retenido'; si se anula el cobro que
--    los pagó, vuelve a 'pendiente'. Lo hace un trigger sobre
--    rental_charge_items, así ningún camino que mueva paid_amount (cobro,
--    anulación, saldo a favor, anulación de cargos) se lo saltea. Sin renglón
--    de depósito en la cuenta (contratos que ya venían corriendo, depósito en
--    otra moneda) lo marca una persona: rental_mark_deposit_received.
--    Un depósito ya cerrado no se puede "despagar": el trigger frena la
--    anulación del cobro hasta que se deshaga el cierre.
-- 2. 'trasladado': en una renovación el depósito sigue en garantía del
--    contrato nuevo. No es una devolución ni una deuda aplicada.
-- 3. rental_settle_deposit: cierra el depósito de un contrato terminado en UNA
--    transacción — lo aplicado a deudas entra como cobro (con recibo y sin
--    ingreso en Caja: la plata ya está), lo devuelto sale de Caja como egreso
--    'security_deposit' — o lo pasa a la renovación.
-- 4. rental_reopen_deposit: deshace el cierre (anula ese cobro y borra el
--    egreso, igual que anular un cobro). El egreso queda bloqueado en Caja
--    (ref_type 'rental_*'): si no se pudiera deshacer desde acá, un error de
--    cuenta o de importe no tendría arreglo.
--
-- deposit_meta guarda lo necesario para deshacer: {received, settlement, inherited}.
--
-- Esta migración es ADITIVA: amplía un CHECK, agrega una columna con default,
-- funciones nuevas y triggers. El único UPDATE de datos es el recálculo del
-- estado de los depósitos que ya se cobraron por la cuenta.

begin;

-- ─── 1. Estados y registro del depósito ─────────────────────────────────────
alter table apartcba.rental_contracts drop constraint if exists rental_contracts_deposit_status_valid;
alter table apartcba.rental_contracts add constraint rental_contracts_deposit_status_valid
  check (deposit_status in ('pendiente','retenido','devuelto','aplicado','trasladado','no_aplica'));

alter table apartcba.rental_contracts
  add column if not exists deposit_meta jsonb not null default '{}'::jsonb;
comment on column apartcba.rental_contracts.deposit_meta is
  'Registro del depósito (068h): received = marcado cobrado a mano (+ ingreso en Caja opcional); settlement = cómo se cerró (cobro aplicado, egreso de devolución, renovación); inherited = depósito que viene del contrato anterior. Lo leen las funciones para deshacer.';

-- ─── 2. Estado derivado de la cuenta del inquilino ──────────────────────────
create or replace function apartcba.rental_sync_deposit_status(p_contract_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_status text;
  v_current text;
begin
  select coalesce(sum(i.amount), 0), coalesce(sum(least(i.paid_amount, i.amount)), 0)
    into v_total, v_paid
    from apartcba.rental_charge_items i
    join apartcba.rental_charges c on c.id = i.charge_id
   where c.contract_id = p_contract_id
     and c.voided_at is null
     and i.kind = 'deposito';
  -- Sin renglón de depósito en la cuenta: el estado lo maneja una persona.
  if v_total <= 0 then
    return null;
  end if;
  v_status := case when v_paid >= v_total - 0.005 then 'retenido' else 'pendiente' end;

  select deposit_status into v_current
    from apartcba.rental_contracts
   where id = p_contract_id;
  if v_status = 'pendiente' and v_current in ('devuelto','aplicado','trasladado') then
    raise exception 'DEPOSITO: el depósito de este contrato ya se cerró (devuelto, aplicado a deudas o pasado a la renovación); para tocar lo que se cobró de depósito, deshacé primero ese cierre desde la ficha del contrato';
  end if;

  update apartcba.rental_contracts
     set deposit_status = v_status
   where id = p_contract_id
     and deposit_amount > 0
     and deposit_status in ('pendiente','retenido')
     and deposit_status <> v_status;
  return v_status;
end $$;

create or replace function apartcba.rental_deposit_status_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_charge_id uuid;
  v_contract_id uuid;
begin
  if tg_op = 'DELETE' then
    v_charge_id := old.charge_id;
  else
    v_charge_id := new.charge_id;
  end if;
  select contract_id into v_contract_id from apartcba.rental_charges where id = v_charge_id;
  if v_contract_id is not null then
    perform apartcba.rental_sync_deposit_status(v_contract_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_rental_deposit_status_ins on apartcba.rental_charge_items;
create trigger trg_rental_deposit_status_ins
  after insert on apartcba.rental_charge_items
  for each row when (new.kind = 'deposito')
  execute function apartcba.rental_deposit_status_trg();

drop trigger if exists trg_rental_deposit_status_upd on apartcba.rental_charge_items;
create trigger trg_rental_deposit_status_upd
  after update of paid_amount, amount, kind on apartcba.rental_charge_items
  for each row when (new.kind = 'deposito' or old.kind = 'deposito')
  execute function apartcba.rental_deposit_status_trg();

drop trigger if exists trg_rental_deposit_status_del on apartcba.rental_charge_items;
create trigger trg_rental_deposit_status_del
  after delete on apartcba.rental_charge_items
  for each row when (old.kind = 'deposito')
  execute function apartcba.rental_deposit_status_trg();

-- Los depósitos que ya se cobraron por la cuenta pasan a 'retenido'.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from apartcba.rental_contracts
     where deposit_amount > 0 and deposit_status in ('pendiente','retenido')
  loop
    perform apartcba.rental_sync_deposit_status(v_id);
  end loop;
end $$;

-- Titular "principal" de la propiedad (owner_id de los movimientos de Caja, como los cobros).
create or replace function apartcba.rental_primary_owner(p_property_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select owner_id from apartcba.rental_property_owners
   where property_id = p_property_id
   order by is_primary desc, ownership_pct desc
   limit 1
$$;

-- ─── 3. Marcar el depósito como cobrado (o deshacer la marca) ───────────────
-- Sólo sin renglón de depósito en la cuenta: si lo hay, el estado sale del
-- cobro. p_input: {received, received_on, account_id?, occurred_at?, description?, actor}
create or replace function apartcba.rental_mark_deposit_received(
  p_organization_id uuid,
  p_contract_id uuid,
  p_input jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_received boolean := coalesce((p_input->>'received')::boolean, true);
  v_on date := coalesce(nullif(p_input->>'received_on', '')::date, current_date);
  v_account_id uuid := nullif(p_input->>'account_id', '')::uuid;
  v_actor uuid := nullif(p_input->>'actor', '')::uuid;
  v_account apartcba.cash_accounts%rowtype;
  v_currency text;
  v_items numeric(14,2);
  v_movement_id uuid;
begin
  select * into v_contract from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;
  if v_contract.deposit_amount <= 0 then
    raise exception 'DEPOSITO: el contrato no tiene depósito';
  end if;
  if v_contract.status = 'borrador' then
    raise exception 'DEPOSITO: activá el contrato antes de marcar el depósito';
  end if;
  select coalesce(sum(i.amount), 0) into v_items
    from apartcba.rental_charge_items i
    join apartcba.rental_charges c on c.id = i.charge_id
   where c.contract_id = p_contract_id and c.voided_at is null and i.kind = 'deposito';
  if v_items > 0 then
    raise exception 'DEPOSITO: el depósito está en la cuenta del inquilino: queda cobrado solo cuando registrás ese cobro';
  end if;
  v_currency := coalesce(nullif(v_contract.deposit_currency, ''), v_contract.currency);

  if v_received then
    if v_contract.deposit_status <> 'pendiente' then
      raise exception 'DEPOSITO: el depósito ya no figura a cobrar';
    end if;
    if v_account_id is not null then
      if v_contract.deposit_holder <> 'inmobiliaria' then
        raise exception 'DEPOSITO: el depósito lo guarda el propietario: no entra a la Caja de la inmobiliaria';
      end if;
      select * into v_account from apartcba.cash_accounts
       where id = v_account_id and organization_id = p_organization_id;
      if not found or not v_account.active then
        raise exception 'CUENTA_INVALIDA: la cuenta de Caja no existe o está archivada';
      end if;
      if v_account.currency <> v_currency then
        raise exception 'MONEDA_DISTINTA: la cuenta "%" es en % y el depósito en %', v_account.name, v_account.currency, v_currency;
      end if;
      insert into apartcba.cash_movements (
        organization_id, account_id, direction, amount, currency, category,
        ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
      ) values (
        p_organization_id, v_account.id, 'in', v_contract.deposit_amount, v_currency, 'security_deposit',
        'rental_deposit_received', p_contract_id, apartcba.rental_primary_owner(v_contract.property_id),
        coalesce(nullif(p_input->>'description', ''), 'Depósito en garantía · contrato C-' || lpad(v_contract.number::text, 4, '0')),
        coalesce(nullif(p_input->>'occurred_at', '')::timestamptz, now()), v_actor, 'guest'
      ) returning id into v_movement_id;
    end if;
    update apartcba.rental_contracts
       set deposit_status = 'retenido',
           deposit_meta = deposit_meta || jsonb_build_object('received', jsonb_build_object(
             'on', v_on, 'movement_id', v_movement_id, 'by', v_actor, 'at', now()))
     where id = p_contract_id;
  else
    if v_contract.deposit_status <> 'retenido' then
      raise exception 'DEPOSITO: el depósito no figura cobrado (o ya se cerró)';
    end if;
    if v_contract.deposit_meta ? 'inherited' then
      raise exception 'DEPOSITO: este depósito viene del contrato anterior: deshacé el traspaso desde la ficha de ese contrato';
    end if;
    v_movement_id := nullif(v_contract.deposit_meta #>> '{received,movement_id}', '')::uuid;
    if v_movement_id is not null then
      delete from apartcba.cash_movements
       where id = v_movement_id and organization_id = p_organization_id;
    end if;
    update apartcba.rental_contracts
       set deposit_status = 'pendiente', deposit_meta = deposit_meta - 'received'
     where id = p_contract_id;
  end if;
  return jsonb_build_object('ok', true, 'movement_id', v_movement_id);
end $$;

-- ─── 4. Cerrar el depósito de un contrato terminado ─────────────────────────
-- p_settlement: {outcome: 'cerrar'|'renovacion', applied, returned, allocate,
--   settled_on, account_id?, occurred_at?, description?, note?, actor, payment?}
-- p_new_items / p_allocations: la imputación de lo aplicado (las mismas de
-- rental_register_payment), calculada en el servidor con datos frescos.
create or replace function apartcba.rental_settle_deposit(
  p_organization_id uuid,
  p_contract_id uuid,
  p_settlement jsonb,
  p_new_items jsonb,
  p_allocations jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_new apartcba.rental_contracts%rowtype;
  v_outcome text := coalesce(nullif(p_settlement->>'outcome', ''), 'cerrar');
  v_applied numeric(14,2) := round(coalesce(nullif(p_settlement->>'applied', '')::numeric, 0), 2);
  v_returned numeric(14,2) := round(coalesce(nullif(p_settlement->>'returned', '')::numeric, 0), 2);
  v_on date := coalesce(nullif(p_settlement->>'settled_on', '')::date, current_date);
  v_account_id uuid := nullif(p_settlement->>'account_id', '')::uuid;
  v_actor uuid := nullif(p_settlement->>'actor', '')::uuid;
  v_note text := nullif(btrim(coalesce(p_settlement->>'note', '')), '');
  v_account apartcba.cash_accounts%rowtype;
  v_currency text;
  v_alloc_sum numeric(14,2);
  v_pay jsonb;
  v_payment_id uuid;
  v_receipt integer;
  v_movement_id uuid;
  v_items numeric(14,2);
  v_marked boolean := false;
  v_status text;
begin
  select * into v_contract from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;
  if v_contract.status not in ('finalizado','rescindido') then
    raise exception 'DEPOSITO: el contrato sigue vigente: el depósito se cierra cuando termina';
  end if;
  if v_contract.deposit_amount <= 0 then
    raise exception 'DEPOSITO: el contrato no tiene depósito';
  end if;
  if v_contract.deposit_status = 'pendiente' then
    raise exception 'DEPOSITO: el depósito no figura cobrado: marcalo como cobrado antes de cerrarlo';
  end if;
  if v_contract.deposit_status <> 'retenido' then
    raise exception 'DEPOSITO: el depósito ya está cerrado';
  end if;
  v_currency := coalesce(nullif(v_contract.deposit_currency, ''), v_contract.currency);

  if v_outcome = 'renovacion' then
    select * into v_new from apartcba.rental_contracts
     where organization_id = p_organization_id and renewed_from_id = p_contract_id and status <> 'borrador'
     order by created_at desc
     limit 1
     for update;
    if not found then
      raise exception 'DEPOSITO: este contrato no tiene una renovación activa: activala antes de pasarle el depósito';
    end if;
    if v_new.deposit_amount <= 0 then
      raise exception 'DEPOSITO: la renovación (C-%) no tiene depósito cargado: editala y poné el monto antes de pasárselo', lpad(v_new.number::text, 4, '0');
    end if;
    if v_new.deposit_status not in ('pendiente','retenido') then
      raise exception 'DEPOSITO: la renovación (C-%) ya tiene el depósito cerrado', lpad(v_new.number::text, 4, '0');
    end if;
    if coalesce(nullif(v_new.deposit_currency, ''), v_new.currency) <> v_currency then
      raise exception 'DEPOSITO: el depósito de este contrato es en % y el de la renovación en %: devolvé uno y cobrá el otro',
        v_currency, coalesce(nullif(v_new.deposit_currency, ''), v_new.currency);
    end if;
    select coalesce(sum(i.amount), 0) into v_items
      from apartcba.rental_charge_items i
      join apartcba.rental_charges c on c.id = i.charge_id
     where c.contract_id = v_new.id and c.voided_at is null and i.kind = 'deposito';
    -- Si la renovación cobra una diferencia por la cuenta, su estado lo sigue
    -- llevando ese cobro; si no, el depósito que pasa ya la deja cubierta.
    v_marked := v_items <= 0 and v_new.deposit_status = 'pendiente';
    update apartcba.rental_contracts
       set deposit_status = case when v_marked then 'retenido' else deposit_status end,
           deposit_meta = deposit_meta || jsonb_build_object('inherited', jsonb_build_object(
             'from_contract_id', p_contract_id, 'from_number', v_contract.number,
             'amount', v_contract.deposit_amount, 'currency', v_currency, 'on', v_on, 'marked', v_marked))
     where id = v_new.id;
    update apartcba.rental_contracts
       set deposit_status = 'trasladado', deposit_returned_amount = null, deposit_returned_at = v_on,
           deposit_meta = deposit_meta || jsonb_build_object('settlement', jsonb_build_object(
             'outcome', 'renovacion', 'renewal_id', v_new.id, 'renewal_number', v_new.number,
             'renewal_marked', v_marked, 'settled_on', v_on, 'note', v_note, 'by', v_actor, 'at', now()))
     where id = p_contract_id;
    return jsonb_build_object('ok', true, 'status', 'trasladado', 'renewal_id', v_new.id, 'renewal_number', v_new.number);
  end if;

  if v_outcome <> 'cerrar' then
    raise exception 'DEPOSITO: no reconocemos cómo se cierra el depósito';
  end if;
  if v_applied < 0 or v_returned < 0 then
    raise exception 'IMPORTE_INVALIDO: los importes no pueden ser negativos';
  end if;
  if v_applied + v_returned <= 0 then
    raise exception 'DEPOSITO: ingresá cuánto se aplicó a deudas o cuánto se devolvió';
  end if;
  if v_applied > v_contract.deposit_amount + 0.005 then
    raise exception 'DEPOSITO: no se puede aplicar más que el depósito (% %)', v_currency, v_contract.deposit_amount;
  end if;
  if abs(v_applied + v_returned - v_contract.deposit_amount) > 0.01 and v_note is null then
    raise exception 'DEPOSITO: lo aplicado más lo devuelto no da el depósito: contá por qué en la nota (queda en el historial)';
  end if;

  -- Lo aplicado a deudas entra como cobro, con recibo y SIN ingreso en Caja: la
  -- plata del depósito ya está donde entran los cobros de este contrato.
  if v_applied > 0 and coalesce((p_settlement->>'allocate')::boolean, false) then
    if v_currency <> v_contract.currency then
      raise exception 'DEPOSITO: el depósito es en % y la cuenta del inquilino en %: no se puede imputar solo', v_currency, v_contract.currency;
    end if;
    if v_contract.deposit_holder <> v_contract.collector then
      raise exception 'DEPOSITO: el depósito no está donde entran los cobros de este contrato: no se puede imputar solo';
    end if;
    select coalesce(sum((a->>'amount')::numeric), 0) into v_alloc_sum
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
    if abs(v_alloc_sum - v_applied) > 0.005 then
      raise exception 'DEPOSITO: la deuda del inquilino cambió mientras cerrabas el depósito: volvé a abrir el diálogo';
    end if;
    v_pay := apartcba.rental_register_payment(
      p_organization_id,
      p_contract_id,
      coalesce(p_settlement->'payment', '{}'::jsonb) || jsonb_build_object(
        'amount', v_applied, 'currency', v_contract.currency, 'account_id', null, 'report_id', null,
        'paid_at', v_on, 'created_by', v_actor),
      p_new_items,
      p_allocations
    );
    v_payment_id := (v_pay->>'payment_id')::uuid;
    v_receipt := (v_pay->>'receipt_number')::integer;
  end if;

  -- Lo devuelto: si lo guarda la inmobiliaria, sale de su Caja. Si lo guarda el
  -- propietario, lo devuelve él y acá sólo queda anotado.
  if v_returned > 0 and v_contract.deposit_holder = 'inmobiliaria' then
    if v_account_id is null then
      raise exception 'DEPOSITO: elegí la cuenta de Caja de la que sale la devolución';
    end if;
    select * into v_account from apartcba.cash_accounts
     where id = v_account_id and organization_id = p_organization_id;
    if not found or not v_account.active then
      raise exception 'CUENTA_INVALIDA: la cuenta de Caja no existe o está archivada';
    end if;
    if v_account.currency <> v_currency then
      raise exception 'MONEDA_DISTINTA: la cuenta "%" es en % y el depósito en %', v_account.name, v_account.currency, v_currency;
    end if;
    insert into apartcba.cash_movements (
      organization_id, account_id, direction, amount, currency, category,
      ref_type, ref_id, owner_id, description, occurred_at, created_by, billable_to
    ) values (
      p_organization_id, v_account.id, 'out', v_returned, v_currency, 'security_deposit',
      'rental_deposit_return', p_contract_id, apartcba.rental_primary_owner(v_contract.property_id),
      coalesce(nullif(p_settlement->>'description', ''), 'Devolución del depósito · contrato C-' || lpad(v_contract.number::text, 4, '0')),
      coalesce(nullif(p_settlement->>'occurred_at', '')::timestamptz, now()), v_actor, 'guest'
    ) returning id into v_movement_id;
  end if;

  v_status := case when v_returned > 0 then 'devuelto' else 'aplicado' end;
  update apartcba.rental_contracts
     set deposit_status = v_status, deposit_returned_amount = v_returned, deposit_returned_at = v_on,
         deposit_meta = deposit_meta || jsonb_build_object('settlement', jsonb_build_object(
           'outcome', 'cerrar', 'applied', v_applied, 'returned', v_returned,
           'allocated', v_payment_id is not null, 'payment_id', v_payment_id, 'receipt_number', v_receipt,
           'movement_id', v_movement_id, 'account_id', case when v_movement_id is null then null else v_account_id end,
           'settled_on', v_on, 'note', v_note, 'by', v_actor, 'at', now()))
   where id = p_contract_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'payment_id', v_payment_id,
    'receipt_number', v_receipt, 'movement_id', v_movement_id);
end $$;

-- ─── 5. Deshacer el cierre ──────────────────────────────────────────────────
-- Anula el cobro con que se aplicó (rental_void_payment: frena si ya se le
-- rindió al propietario), borra el egreso de la devolución y, si había pasado a
-- la renovación, se lo saca. El depósito vuelve a 'retenido'.
create or replace function apartcba.rental_reopen_deposit(
  p_organization_id uuid,
  p_contract_id uuid,
  p_reason text,
  p_actor uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_new apartcba.rental_contracts%rowtype;
  v_set jsonb;
  v_payment_id uuid;
  v_movement_id uuid;
  v_new_id uuid;
  v_items numeric(14,2);
  v_voided boolean := false;
begin
  select * into v_contract from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CONTRATO_NO_ENCONTRADO: el contrato no existe en esta organización';
  end if;
  if v_contract.deposit_status not in ('devuelto','aplicado','trasladado') then
    raise exception 'DEPOSITO: el depósito no está cerrado';
  end if;
  v_set := coalesce(v_contract.deposit_meta->'settlement', '{}'::jsonb);

  if v_contract.deposit_status = 'trasladado' then
    v_new_id := nullif(v_set->>'renewal_id', '')::uuid;
    if v_new_id is not null then
      select * into v_new from apartcba.rental_contracts
       where id = v_new_id and organization_id = p_organization_id
       for update;
      if found then
        if v_new.deposit_status in ('devuelto','aplicado','trasladado') then
          raise exception 'DEPOSITO: la renovación (C-%) ya cerró ese depósito: deshacé primero ese cierre', lpad(v_new.number::text, 4, '0');
        end if;
        select coalesce(sum(i.amount), 0) into v_items
          from apartcba.rental_charge_items i
          join apartcba.rental_charges c on c.id = i.charge_id
         where c.contract_id = v_new.id and c.voided_at is null and i.kind = 'deposito';
        update apartcba.rental_contracts
           set deposit_status = case
                 when coalesce((v_set->>'renewal_marked')::boolean, false) and v_items <= 0
                      and deposit_status = 'retenido' and not (deposit_meta ? 'received') then 'pendiente'
                 else deposit_status end,
               deposit_meta = deposit_meta - 'inherited'
         where id = v_new.id;
      end if;
    end if;
  else
    v_payment_id := nullif(v_set->>'payment_id', '')::uuid;
    if v_payment_id is not null then
      perform 1 from apartcba.rental_payments
        where id = v_payment_id and organization_id = p_organization_id and voided_at is null;
      if found then
        perform apartcba.rental_void_payment(
          p_organization_id, v_payment_id,
          coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Se deshizo el cierre del depósito'), p_actor);
        v_voided := true;
      end if;
    end if;
    v_movement_id := nullif(v_set->>'movement_id', '')::uuid;
    if v_movement_id is not null then
      delete from apartcba.cash_movements
       where id = v_movement_id and organization_id = p_organization_id;
    end if;
  end if;

  update apartcba.rental_contracts
     set deposit_status = 'retenido', deposit_returned_amount = null, deposit_returned_at = null,
         deposit_meta = deposit_meta - 'settlement'
   where id = p_contract_id;
  return jsonb_build_object('ok', true,
    'voided_payment_id', case when v_voided then v_payment_id end,
    'deleted_movement_id', v_movement_id,
    'renewal_id', v_new_id);
end $$;

-- ─── Permisos: sólo el servidor (service role) ──────────────────────────────
revoke all on function apartcba.rental_sync_deposit_status(uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_sync_deposit_status(uuid) to service_role;
revoke all on function apartcba.rental_deposit_status_trg() from public, anon, authenticated;
grant execute on function apartcba.rental_deposit_status_trg() to service_role;
revoke all on function apartcba.rental_primary_owner(uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_primary_owner(uuid) to service_role;
revoke all on function apartcba.rental_mark_deposit_received(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_mark_deposit_received(uuid, uuid, jsonb) to service_role;
revoke all on function apartcba.rental_settle_deposit(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_settle_deposit(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke all on function apartcba.rental_reopen_deposit(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_reopen_deposit(uuid, uuid, text, uuid) to service_role;

commit;
