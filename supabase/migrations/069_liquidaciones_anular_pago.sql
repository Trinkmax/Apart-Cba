-- 069 — Liquidaciones: anular el pago (la liquidación vuelve a Revisada)
--
-- Problema: una liquidación que quedó "pagada" sin que el pago se hiciera de
-- verdad (se tocó «Registrar pago» y la transferencia nunca salió, o se
-- devolvió) no tenía vuelta atrás. Caja decía "Anulá la liquidación primero"
-- (cash_movement_settlement_lock protege el egreso mientras la liquidación
-- esté revisada, enviada o pagada) y la liquidación decía "Anulá primero el
-- pago en Caja". Un círculo sin salida.
--
-- settlement_undo_payment es la salida, en una sola transacción:
--   1) bloquea la liquidación (FOR UPDATE) y exige que siga 'pagada': dos
--      pestañas anulando a la vez → la segunda espera y ve que ya no lo está;
--   2) bloquea los movimientos que forman el pago: los egresos con
--      ref_type='settlement_payment' (uno por cuenta si el pago se dividió,
--      migración 043), los asientos 'settlement_adjustment' que postearon las
--      ediciones hechas DESPUÉS de pagar (reconcileAfterEdit) y el movimiento
--      de paid_movement_id (por si es anterior al etiquetado por ref_id);
--   3) si la app manda la lista que le mostró a la persona
--      (p_expected_movement_ids) y no coincide con la de ahora, no toca nada:
--      no se borra plata que nadie vio en la confirmación;
--   4) deja la liquidación en 'revisada' sin paid_at ni paid_movement_id
--      (conserva reviewed_* y sent_*; si nunca se había revisado, queda
--      revisada por quien anula, como al elegir "Revisada" en el menú),
--      borra los movimientos dejando constancia en cash_movement_audit (igual
--      que delete_cash_movement), descarta sus avisos y escribe la entrada
--      'payment_undo' en settlement_audit con el motivo y lo que se borró.
--
-- Qué NO toca, a propósito:
--   · Las líneas ni los tickets: registrar el pago no los modifica (los
--     tickets se marcan como cobrados al GENERAR la liquidación). El
--     documento queda igual, listo para pagarse otra vez por el neto vigente.
--   · La pila de deshacer/rehacer (047): la entrada va sin snapshot, como
--     'payment' y 'status_change'. No es una edición del documento, y la rama
--     de rehacer sigue valiendo (sin pago, rehacer ya no postea ajustes).
--
-- No se desactiva ningún candado de Caja: esta función borra directo porque
-- ES el camino que el candado pide (deshacer el pago entero, no un egreso
-- suelto), y lo que queda vuelve a ser consistente: una liquidación revisada
-- sin movimientos vinculados.
--
-- Un movimiento vinculado que no sea de categoría 'owner_settlement' frena
-- todo (MOVIMIENTO_INESPERADO): ninguno de los caminos de la app lo crea, y
-- borrarlo a ciegas podría arrastrar otra cosa (cash_transfers cae en
-- CASCADE con su movimiento). Mejor un error claro que una anulación a medias.
--
-- Esta migración es ADITIVA: sólo crea la función. La app degrada sola si
-- todavía no se aplicó (avisa que falta y no toca nada).

begin;

create or replace function apartcba.settlement_undo_payment(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_actor uuid,
  p_actor_name text,
  p_reason text,
  p_expected_movement_ids uuid[] default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor_name text := coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), 'Usuario');
  v_s apartcba.owner_settlements%rowtype;
  v_tz text;
  v_mov record;
  v_ids uuid[] := '{}';
  v_expected uuid[];
  v_current uuid[];
  v_movements jsonb := '[]'::jsonb;
  v_effects jsonb := '[]'::jsonb;
  v_total_out numeric := 0;
  v_total_in numeric := 0;
  v_kind text;
  v_label text;
  v_money text;
  v_period text;
  v_deleted integer;
begin
  if v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: contá por qué se anula el pago';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'MOTIVO_LARGO: el motivo no puede pasar de 300 caracteres';
  end if;

  select * into v_s
    from apartcba.owner_settlements
   where id = p_settlement_id
     and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'LIQUIDACION_NO_ENCONTRADA: la liquidación no existe en esta organización';
  end if;
  if v_s.status <> 'pagada' then
    raise exception 'NO_PAGADA: la liquidación está en estado %', v_s.status;
  end if;

  -- La zona horaria sólo fecha las líneas del historial: una inválida no
  -- puede frenar la anulación.
  select o.timezone into v_tz
    from apartcba.organizations o
   where o.id = p_organization_id;
  if v_tz is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_tz) then
    v_tz := 'America/Argentina/Cordoba';
  end if;

  v_period := lpad(v_s.period_month::text, 2, '0') || '/' || v_s.period_year::text;

  -- Primero se junta y se valida todo; recién después se escribe.
  for v_mov in
    select m.id, m.account_id, m.direction, m.amount, m.currency, m.category,
           m.ref_type, m.description, m.occurred_at,
           coalesce(a.name, 'Cuenta sin nombre') as account_name
      from apartcba.cash_movements m
      left join apartcba.cash_accounts a on a.id = m.account_id
     where m.organization_id = p_organization_id
       and ((m.ref_id = p_settlement_id
             and m.ref_type in ('settlement_payment', 'settlement_adjustment'))
            or m.id = v_s.paid_movement_id)
     order by m.occurred_at, m.id
     for update of m
  loop
    if v_mov.category is distinct from 'owner_settlement' then
      raise exception 'MOVIMIENTO_INESPERADO: el movimiento % está vinculado al pago pero no es un pago de liquidación; revisalo en Caja', v_mov.id;
    end if;

    v_kind := case
      when v_mov.ref_type = 'settlement_adjustment'
       and v_mov.id is distinct from v_s.paid_movement_id then 'ajuste'
      else 'pago'
    end;
    v_ids := v_ids || v_mov.id;
    if v_mov.direction = 'out' then
      v_total_out := v_total_out + v_mov.amount;
    else
      v_total_in := v_total_in + v_mov.amount;
    end if;

    v_movements := v_movements || jsonb_build_object(
      'id', v_mov.id,
      'kind', v_kind,
      'account_id', v_mov.account_id,
      'account_name', v_mov.account_name,
      'direction', v_mov.direction,
      'amount', v_mov.amount,
      'currency', v_mov.currency,
      'occurred_at', v_mov.occurred_at,
      'description', v_mov.description,
      'ref_type', v_mov.ref_type
    );

    -- "$ 150.000,00" como en la app (to_char con ',' y '.' fijos, después
    -- se intercambian). Otras monedas llevan el código: "USD 1.200,00".
    v_money := case when v_mov.currency = 'ARS' then '$ ' else v_mov.currency || ' ' end
      || translate(to_char(v_mov.amount, 'FM999,999,999,999,990.00'), ',.', '.,');
    v_label := case
      when v_kind = 'pago' then 'el egreso del pago'
      when v_mov.direction = 'out' then 'el egreso de ajuste'
      else 'el ingreso de ajuste'
    end;
    v_effects := v_effects || to_jsonb(format(
      'Se borró de Caja %s: %s · %s · %s',
      v_label,
      v_money,
      v_mov.account_name,
      to_char(v_mov.occurred_at at time zone v_tz, 'DD/MM/YYYY')
    ));
  end loop;

  -- Lo que la persona vio al confirmar tiene que ser exactamente lo que se
  -- borra. Si en el medio alguien editó la liquidación pagada (nuevo ajuste),
  -- se frena y la app vuelve a mostrar la lista.
  if p_expected_movement_ids is not null then
    select coalesce(array_agg(distinct e order by e), '{}') into v_expected
      from unnest(p_expected_movement_ids) as e;
    select coalesce(array_agg(i order by i), '{}') into v_current
      from unnest(v_ids) as i;
    if v_expected is distinct from v_current then
      raise exception 'PAGO_CAMBIO: los movimientos del pago cambiaron mientras confirmabas';
    end if;
  end if;

  update apartcba.owner_settlements
     set status = 'revisada',
         paid_at = null,
         paid_movement_id = null,
         reviewed_at = coalesce(reviewed_at, now()),
         reviewed_by = coalesce(reviewed_by, p_actor),
         last_edited_by = p_actor,
         last_edited_at = now(),
         updated_at = now()
   where id = p_settlement_id
     and organization_id = p_organization_id;

  if cardinality(v_ids) > 0 then
    -- Misma constancia que deja delete_cash_movement al borrar desde Caja.
    insert into apartcba.cash_movement_audit
      (organization_id, movement_id, action, actor_user_id, actor_name, changes, side_effects)
    select p_organization_id,
           (x->>'id')::uuid,
           'delete',
           p_actor,
           v_actor_name,
           jsonb_build_object(
             'snapshot', jsonb_build_object(
               'account_id', x->'account_id',
               'direction', x->'direction',
               'amount', x->'amount',
               'currency', x->'currency',
               'category', 'owner_settlement',
               'description', x->'description',
               'occurred_at', x->'occurred_at',
               'ref_type', x->'ref_type',
               'ref_id', p_settlement_id
             ),
             'motivo', v_reason,
             'settlement_id', p_settlement_id
           ),
           jsonb_build_array(format('Pago anulado desde la liquidación %s: %s', v_period, v_reason))
      from jsonb_array_elements(v_movements) as x;

    update apartcba.notifications
       set dismissed_at = now()
     where organization_id = p_organization_id
       and ref_type = 'cash_movement'
       and ref_id = any (v_ids)
       and dismissed_at is null;

    delete from apartcba.cash_movements
     where organization_id = p_organization_id
       and id = any (v_ids);
    get diagnostics v_deleted = row_count;
    -- Imposible con las filas bloqueadas; si pasa, que no quede nada a medias.
    if v_deleted <> cardinality(v_ids) then
      raise exception 'PAGO_CAMBIO: los movimientos del pago cambiaron mientras confirmabas';
    end if;
  else
    v_effects := jsonb_build_array('No había movimientos del pago en Caja: sólo cambió el estado');
  end if;

  insert into apartcba.settlement_audit
    (organization_id, settlement_id, action, actor_user_id, actor_name, changes, side_effects)
  values (
    p_organization_id,
    p_settlement_id,
    'payment_undo',
    p_actor,
    v_actor_name,
    jsonb_build_object(
      'status', jsonb_build_object('from', 'pagada', 'to', 'revisada'),
      'motivo', v_reason,
      'movimientos', cardinality(v_ids)
    ),
    v_effects
  );

  return jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'status', 'revisada',
    'previous_paid_at', v_s.paid_at,
    'movements', v_movements,
    'total_out', v_total_out,
    'total_in', v_total_in
  );
end;
$$;

revoke all on function apartcba.settlement_undo_payment(uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
grant execute on function apartcba.settlement_undo_payment(uuid, uuid, uuid, text, text, uuid[]) to service_role;

commit;
