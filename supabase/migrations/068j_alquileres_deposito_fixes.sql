-- 068j — Alquileres: depósito en garantía, arreglos sobre la 068h
--
-- 1. Dónde está la plata del depósito (rental_deposit_holder). La 068h cerraba
--    según contract.deposit_holder. Pero si el depósito se cobró por la cuenta
--    del inquilino con el renglón «para el propietario», ese cobro se le rinde
--    al propietario (y si los cobros los recibe él, lo cobró él): la plata la
--    tiene él aunque el contrato diga inmobiliaria. Cerrar con «inmobiliaria»
--    imputaba lo aplicado a deudas (se le volvía a rendir: cobraba el depósito
--    y otra vez las deudas que cubría) y devolvía desde Caja una plata que la
--    inmobiliaria ya no tenía. Ahora rental_settle_deposit decide con dónde
--    está la plata: renglones de depósito vivos → su destinatario; depósito
--    heredado de la renovación → dónde estaba (inherited.held_by, que se guarda
--    al pasarlo); si no, lo que dice el contrato. Con que una parte haya ido al
--    propietario se toma como suyo: es lo que nunca saca de Caja ni le vuelve a
--    rendir plata que la inmobiliaria no tiene. El servidor manda lo que calculó
--    (p_settlement.holder) y acá se verifica con el contrato bloqueado. Lo
--    mismo con cuánto: con renglones en la cuenta, el cierre parte de lo cobrado
--    de ellos (cuotas de depósito anuladas al rescindir no se devuelven); sin
--    renglones, de lo que pasó de la renovación anterior (una diferencia que la
--    renovación nunca cobró tampoco se devuelve).
-- 2. Anular (o desanular) un cargo con renglones de depósito vuelve a calcular
--    el estado. Los triggers de la 068h están sobre rental_charge_items y anular
--    es un UPDATE del cargo: un depósito pago con un renglón extra anulado
--    quedaba «A cobrar» para siempre. El trigger sobre voided_at cubre todos los
--    caminos (rental_void_charges, la anulación en lote al terminar, el TS).
--    Y sin renglones vivos, un depósito que pasó de la renovación anterior ya
--    está cubierto: anular o bonificar el renglón de depósito que la renovación
--    cobraba de más lo deja 'retenido' (antes quedaba «A cobrar»); deshacer ese
--    traspaso lo vuelve a 'pendiente'.
-- 3. Marca manual vs. renglón en la cuenta. Con el depósito marcado cobrado a
--    mano, un renglón de depósito nuevo lo contaba dos veces y el ingreso de la
--    marca quedaba bloqueado en Caja (Desmarcar lo rechazaba por el renglón; y
--    volver a marcar pisaba movement_id y lo dejaba huérfano). Ahora: el trigger
--    frena el renglón mientras haya marca manual; marcar dos veces se rechaza; y
--    desmarcar funciona aunque ya exista un renglón (datos de antes de este
--    freno), y el estado vuelve a salir de los renglones.
--
-- Aditiva: funciones nuevas o reemplazadas (desde el cuerpo vivo de la 068h) y
-- un trigger nuevo. El único UPDATE de datos es volver a calcular el estado de
-- los depósitos abiertos (idempotente; el 03/10/2026 no había ningún renglón de
-- depósito en producción, así que hoy no cambia nada).

begin;

-- ─── 1. Dónde está la plata del depósito ────────────────────────────────────
-- Espejo de depositPlace (src/lib/rentals/deposit.ts): si cambia una, cambia la otra.
create or replace function apartcba.rental_deposit_holder(
  p_organization_id uuid,
  p_contract_id uuid
) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_contract apartcba.rental_contracts%rowtype;
  v_items integer;
  v_to_owner boolean;
  v_via_account text;
  v_inherited text;
begin
  select * into v_contract from apartcba.rental_contracts
   where id = p_contract_id and organization_id = p_organization_id;
  if not found then
    return null;
  end if;
  -- Renglones de depósito vivos (un renglón bonificado entero no movió plata).
  select count(*), coalesce(bool_or(i.payee = 'propietario'), false)
    into v_items, v_to_owner
    from apartcba.rental_charge_items i
    join apartcba.rental_charges c on c.id = i.charge_id
   where c.contract_id = p_contract_id
     and c.organization_id = p_organization_id
     and c.voided_at is null
     and i.kind = 'deposito'
     and i.amount > 0;
  if v_items > 0 then
    -- «Para el propietario» se le rinde con los cobros; si los cobros los
    -- recibe él (collector), lo cobró él directamente.
    v_via_account := case when v_to_owner or v_contract.collector = 'propietario' then 'propietario' else 'inmobiliaria' end;
  end if;
  v_inherited := v_contract.deposit_meta #>> '{inherited,held_by}';
  if v_inherited is not null and v_inherited not in ('propietario','inmobiliaria') then
    v_inherited := null;
  end if;
  if v_via_account = 'propietario' or v_inherited = 'propietario' then
    return 'propietario';
  end if;
  return coalesce(v_via_account, v_inherited, v_contract.deposit_holder);
end $$;

-- ─── 3. Renglón de depósito con el depósito ya marcado cobrado a mano ───────
-- Reemplaza la función de los triggers de la 068h (mismo cuerpo + el freno).
create or replace function apartcba.rental_deposit_status_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_charge_id uuid;
  v_contract_id uuid;
  v_received boolean;
begin
  if tg_op = 'DELETE' then
    v_charge_id := old.charge_id;
  else
    v_charge_id := new.charge_id;
  end if;
  select contract_id into v_contract_id from apartcba.rental_charges where id = v_charge_id;
  if v_contract_id is not null then
    -- Un renglón de depósito nuevo (o que pasa a serlo) con el depósito marcado
    -- cobrado a mano se contaría dos veces. FOR UPDATE: rental_mark_deposit_received
    -- bloquea el contrato antes de contar los renglones, así que una marca y un
    -- renglón al mismo tiempo no pasan los dos.
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.kind = 'deposito' and old.kind is distinct from 'deposito') then
      select deposit_meta ? 'received' into v_received
        from apartcba.rental_contracts
       where id = v_contract_id
       for update;
      if v_received then
        raise exception 'DEPOSITO: el depósito de este contrato ya se marcó como cobrado a mano, así que no se cobra también por la cuenta del inquilino. Si se marcó por error, desmarcalo desde la ficha del contrato («Más» → Desmarcar depósito cobrado) y volvé a cargarlo';
      end if;
    end if;
    perform apartcba.rental_sync_deposit_status(v_contract_id);
  end if;
  return null;
end $$;

-- ─── 2. Anular un cargo con renglones de depósito ───────────────────────────
create or replace function apartcba.rental_deposit_charge_void_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- rental_sync_deposit_status ya ignora los cargos anulados: sólo hay que llamarla.
  if exists (select 1 from apartcba.rental_charge_items i where i.charge_id = new.id and i.kind = 'deposito') then
    perform apartcba.rental_sync_deposit_status(new.contract_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_rental_deposit_status_void on apartcba.rental_charges;
create trigger trg_rental_deposit_status_void
  after update of voided_at on apartcba.rental_charges
  for each row when (old.voided_at is distinct from new.voided_at)
  execute function apartcba.rental_deposit_charge_void_trg();

-- ─── 3b. Marcar / desmarcar el depósito cobrado a mano ──────────────────────
-- Cuerpo vivo de la 068h con dos cambios: no se marca dos veces, y desmarcar
-- funciona aunque ya haya un renglón de depósito en la cuenta.
-- p_input: {received, received_on, account_id?, occurred_at?, description?, actor}
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
  v_currency := coalesce(nullif(v_contract.deposit_currency, ''), v_contract.currency);

  if v_received then
    if v_items > 0 then
      raise exception 'DEPOSITO: el depósito está en la cuenta del inquilino: queda cobrado solo cuando registrás ese cobro';
    end if;
    -- 068j: marcarlo otra vez pisaba movement_id y el primer ingreso quedaba
    -- huérfano en Caja (bloqueado allá, sin nada acá que lo pueda deshacer).
    if v_contract.deposit_meta ? 'received' then
      raise exception 'DEPOSITO: el depósito ya figura cobrado a mano: si hay que corregir la fecha o la cuenta, desmarcalo primero y volvé a marcarlo';
    end if;
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
    -- 068j: se puede desmarcar aunque después haya entrado un renglón de depósito
    -- en la cuenta (datos de antes del freno del trigger): borrar el ingreso de la
    -- marca es lo que deja el depósito contado una sola vez.
    if not (v_contract.deposit_meta ? 'received') or v_contract.deposit_status not in ('pendiente','retenido') then
      raise exception 'DEPOSITO: el depósito no figura marcado como cobrado a mano (o ya se cerró)';
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
    -- Con renglones de depósito en la cuenta, el estado vuelve a salir de ellos.
    if v_items > 0 then
      perform apartcba.rental_sync_deposit_status(p_contract_id);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'movement_id', v_movement_id);
end $$;

-- ─── 1b. Cerrar el depósito de un contrato terminado ────────────────────────
-- Cuerpo vivo de la 068h; cambia qué decide imputar lo aplicado y sacar de Caja
-- lo devuelto: dónde está la plata (v_holder), no contract.deposit_holder; y el
-- monto de referencia: lo que está en garantía (v_basis), no deposit_amount.
-- p_settlement: {outcome: 'cerrar'|'renovacion', applied, returned, allocate,
--   settled_on, account_id?, occurred_at?, description?, note?, actor, payment?,
--   holder?, basis? (068j: lo que calculó el servidor; si no coincide, frena)}
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
  v_holder text;
  v_expected text := nullif(p_settlement->>'holder', '');
  v_live integer;
  v_paid_items numeric(14,2);
  v_basis numeric(14,2);
  v_expected_basis numeric := nullif(p_settlement->>'basis', '')::numeric;
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

  -- 068j: dónde está la plata de verdad, no sólo lo que dice el contrato. El
  -- servidor manda lo que calculó al armar el cierre: si no coincide, entró o se
  -- anuló un renglón de depósito en el medio y lo que vio la persona ya no vale.
  v_holder := apartcba.rental_deposit_holder(p_organization_id, p_contract_id);
  if v_expected is not null and v_expected is distinct from v_holder then
    raise exception 'DEPOSITO: cambió dónde está el depósito mientras lo cerrabas (se cobró o se anuló un renglón de depósito): volvé a abrir el diálogo';
  end if;
  -- 068j: y cuánto. Con renglones de depósito en la cuenta, lo cobrado de ellos
  -- (más lo que pasó de la renovación anterior); si no, el monto del contrato.
  -- Con cuotas de depósito anuladas al rescindir, cerrar con el monto del
  -- contrato devolvía desde Caja lo que nunca entró. Espejo de depositHeldAmount.
  select count(*), coalesce(sum(least(i.paid_amount, i.amount)), 0)
    into v_live, v_paid_items
    from apartcba.rental_charge_items i
    join apartcba.rental_charges c on c.id = i.charge_id
   where c.contract_id = p_contract_id
     and c.organization_id = p_organization_id
     and c.voided_at is null
     and i.kind = 'deposito'
     and i.amount > 0;
  -- Sin renglones y con un depósito que pasó de la renovación anterior (sin marca
  -- manual), lo que pasó: si la renovación pide más y la diferencia nunca se
  -- cobró, el contrato dice más de lo que hay y devolverlo sacaría de Caja plata
  -- que no entró. Devolver de más sigue pudiendo hacerse, con nota.
  v_basis := case
    when v_live > 0 then round(v_paid_items + coalesce(nullif(v_contract.deposit_meta #>> '{inherited,amount}', '')::numeric, 0), 2)
    when v_contract.deposit_meta ? 'inherited' and not (v_contract.deposit_meta ? 'received')
      then round(coalesce(nullif(v_contract.deposit_meta #>> '{inherited,amount}', '')::numeric, v_contract.deposit_amount), 2)
    else v_contract.deposit_amount
  end;
  if v_expected_basis is not null and abs(v_expected_basis - v_basis) > 0.005 then
    raise exception 'DEPOSITO: cambió lo cobrado del depósito mientras lo cerrabas: volvé a abrir el diálogo';
  end if;

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
             'amount', v_basis, 'currency', v_currency, 'on', v_on, 'marked', v_marked,
             -- La renovación hereda dónde está la plata (rental_deposit_holder lo lee).
             'held_by', v_holder))
     where id = v_new.id;
    update apartcba.rental_contracts
       set deposit_status = 'trasladado', deposit_returned_amount = null, deposit_returned_at = v_on,
           deposit_meta = deposit_meta || jsonb_build_object('settlement', jsonb_build_object(
             'outcome', 'renovacion', 'renewal_id', v_new.id, 'renewal_number', v_new.number,
             'renewal_marked', v_marked, 'holder', v_holder, 'basis', v_basis, 'settled_on', v_on, 'note', v_note, 'by', v_actor, 'at', now()))
     where id = p_contract_id;
    return jsonb_build_object('ok', true, 'status', 'trasladado', 'renewal_id', v_new.id, 'renewal_number', v_new.number, 'holder', v_holder);
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
  if v_applied > v_basis + 0.005 then
    raise exception 'DEPOSITO: no se puede aplicar más que el depósito (% %)', v_currency, v_basis;
  end if;
  if abs(v_applied + v_returned - v_basis) > 0.01 and v_note is null then
    raise exception 'DEPOSITO: lo aplicado más lo devuelto no da el depósito: contá por qué en la nota (queda en el historial)';
  end if;

  -- Lo aplicado a deudas entra como cobro, con recibo y SIN ingreso en Caja: la
  -- plata del depósito ya está donde entran los cobros de este contrato.
  if v_applied > 0 and coalesce((p_settlement->>'allocate')::boolean, false) then
    if v_currency <> v_contract.currency then
      raise exception 'DEPOSITO: el depósito es en % y la cuenta del inquilino en %: no se puede imputar solo', v_currency, v_contract.currency;
    end if;
    -- 068j: con v_holder, no con el contrato. Un depósito cobrado «para el
    -- propietario» ya se le rindió: imputarlo se lo rendiría otra vez.
    if v_holder <> v_contract.collector then
      raise exception 'DEPOSITO: el depósito no está donde entran los cobros de este contrato (lo tiene %): no se puede imputar solo',
        case when v_holder = 'propietario' then 'el propietario' else 'la inmobiliaria' end;
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

  -- Lo devuelto: si la plata está en la inmobiliaria, sale de su Caja. Si la
  -- tiene el propietario (aunque el contrato diga inmobiliaria: se cobró para él
  -- y se le rindió), lo devuelve él y acá sólo queda anotado.
  if v_returned > 0 and v_holder = 'inmobiliaria' then
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
           'holder', v_holder, 'basis', v_basis,
           'settled_on', v_on, 'note', v_note, 'by', v_actor, 'at', now()))
   where id = p_contract_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'payment_id', v_payment_id,
    'receipt_number', v_receipt, 'movement_id', v_movement_id, 'holder', v_holder);
end $$;

-- ─── 2b. Sin renglones vivos, el depósito heredado ya está cubierto ─────────
-- Cuerpo vivo de la 068h con un cambio: ver el comentario «068j».
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
  -- 068j: salvo el depósito que pasó de la renovación anterior. Sin renglones
  -- (se anuló el cargo o se bonificó la diferencia que se cobraba de más) ya
  -- queda cubierto, igual que cuando se pasa sin renglones (rental_settle_deposit
  -- lo deja 'retenido'). Si no, quedaba «A cobrar» y sólo se salía marcándolo a
  -- mano, con riesgo de anotar en Caja un ingreso que nunca entró.
  if v_total <= 0 then
    update apartcba.rental_contracts
       set deposit_status = 'retenido'
     where id = p_contract_id
       and deposit_amount > 0
       and deposit_status = 'pendiente'
       and deposit_meta ? 'inherited';
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

-- ─── 2c. Deshacer el cierre (cuerpo vivo de la 068h) ────────────────────────
-- Un solo cambio, el espejo de 2b: al deshacer un traspaso, la renovación sin
-- renglones ni marca manual vuelve a 'pendiente' aunque al pasarlo tuviera renglones.
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
        -- 068j: sin renglones ni marca manual, lo único que la tenía 'retenido'
        -- era el traspaso (al pasarlo o, desde la 068j, al anularse sus renglones),
        -- así que vuelve a 'pendiente' aunque al pasarlo tuviera renglones.
        update apartcba.rental_contracts
           set deposit_status = case
                 when v_items <= 0 and deposit_status = 'retenido' and not (deposit_meta ? 'received') then 'pendiente'
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

-- ─── Recalcular los depósitos abiertos ──────────────────────────────────────
-- Un cargo con renglón de depósito anulado entre la 068h y esta migración pudo
-- dejar el estado viejo. Es idempotente: sin renglones no toca nada, y sólo mira
-- depósitos abiertos (no puede chocar con el freno de un depósito cerrado).
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

-- ─── Permisos: sólo el servidor (service role) ──────────────────────────────
revoke all on function apartcba.rental_deposit_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_deposit_holder(uuid, uuid) to service_role;
revoke all on function apartcba.rental_deposit_status_trg() from public, anon, authenticated;
grant execute on function apartcba.rental_deposit_status_trg() to service_role;
revoke all on function apartcba.rental_deposit_charge_void_trg() from public, anon, authenticated;
grant execute on function apartcba.rental_deposit_charge_void_trg() to service_role;
revoke all on function apartcba.rental_sync_deposit_status(uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_sync_deposit_status(uuid) to service_role;
revoke all on function apartcba.rental_reopen_deposit(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_reopen_deposit(uuid, uuid, text, uuid) to service_role;
revoke all on function apartcba.rental_mark_deposit_received(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_mark_deposit_received(uuid, uuid, jsonb) to service_role;
revoke all on function apartcba.rental_settle_deposit(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function apartcba.rental_settle_deposit(uuid, uuid, jsonb, jsonb, jsonb) to service_role;

commit;
