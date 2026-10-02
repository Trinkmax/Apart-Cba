-- 068e — Alquileres: anular la rendición de un dueño sin destrabar un gasto
--        que la rendición de otro dueño sigue descontando
--
-- Contexto: con varios dueños, un mismo gasto "a cargo del propietario" se
-- descuenta en la rendición de cada uno (un renglón 'expense' por propietario;
-- el índice único de la 068c es por propietario). rental_expenses.statement_id
-- guarda sólo la ÚLTIMA rendición que lo descontó.
--
-- Hueco de la 068b/068d: anular una rendición devolvía el gasto a 'pendiente'
-- (o sea, editable y anulable) si statement_id apuntaba a ella, aunque la
-- rendición del otro dueño lo siguiera descontando. Al editar el importe o
-- anular el gasto (que borra su egreso de Caja), ese otro dueño quedaba pagando
-- un gasto que ya no existe, o con otro importe, sin que nada lo marcara.
--
-- Ahora el estado del gasto se recalcula con los renglones que siguen vivos:
-- queda 'aplicado' (y bloqueado) mientras alguna rendición no anulada lo
-- descuente, apuntando a la más reciente; vuelve a 'pendiente' sólo cuando ya
-- ninguna lo descuenta. Un gasto anulado no se toca.
--
-- rental_create_owner_statement queda como está: que statement_id apunte a la
-- última rendición está bien ahora que anular lo recalcula.
--
-- Todo lo demás de la 068d queda igual (bloqueo si el saldo ya se trasladó,
-- p_delete_payments sólo si hay egresos de Caja). Sin reparación de datos: al
-- 02/10/2026 no hay gastos 'pendiente' con un renglón vivo.
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

revoke all on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function apartcba.rental_void_owner_statement(uuid, uuid, text, boolean) to service_role;

commit;
