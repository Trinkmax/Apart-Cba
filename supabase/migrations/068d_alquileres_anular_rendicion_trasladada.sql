-- 068d — Alquileres: anular una rendición cerrada con saldo a cuenta
--
-- Contexto (068c): una rendición con neto <= 0 se cierra sin movimiento de Caja
-- (status 'pagada', paid_movement_ids vacío) y su saldo entra como descuento en
-- la rendición siguiente (renglón 'ajuste' con ref_type 'statement_carry').
--
-- Dos huecos de la 068b al anular:
--   1. Exigía p_delete_payments para toda rendición 'pagada', aunque una cerrada
--      con saldo a cuenta no tiene egresos de Caja que borrar.
--   2. Si el saldo ya se había descontado en otra rendición viva, anular la de
--      origen devolvía sus cobros y gastos a "para rendir" y la próxima
--      rendición los volvía a descontar: el propietario pagaba dos veces el
--      mismo gasto. Ahora se bloquea: hay que anular primero la que lo descontó.
--
-- Esta migración es ADITIVA (sólo reemplaza la función).

begin;

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

  if v_statement.status = 'pagada' and coalesce(array_length(v_statement.paid_movement_ids, 1), 0) > 0 then
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

revoke all on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) to service_role;

commit;
