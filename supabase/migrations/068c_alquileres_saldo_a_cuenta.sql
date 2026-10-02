-- 068c — Alquileres: rendición con saldo a cuenta + Realtime de rendiciones y gastos
--
-- Contexto: una rendición puede dar neto negativo (un arreglo o expensas
-- extraordinarias a cargo del propietario superan lo cobrado del mes). Con la
-- 068b no había forma de cerrarla: el pago exige neto > 0 y lo que el
-- propietario debe no pasaba a la rendición siguiente.
--
-- Ahora: `rental_close_owner_statement` cierra una rendición con neto <= 0 sin
-- movimiento de Caja, y la próxima rendición del propietario incluye ese saldo
-- como un descuento (renglón 'ajuste' con ref_type 'statement_carry'). El
-- índice único parcial garantiza que un saldo se traslade UNA sola vez.
--
-- Esta migración es ADITIVA.

begin;

alter table apartcba.rental_owner_statement_lines drop constraint if exists rental_owner_statement_lines_ref_valid;
alter table apartcba.rental_owner_statement_lines add constraint rental_owner_statement_lines_ref_valid
  check (ref_type is null or ref_type in ('allocation','expense','contract_commission','statement_carry','manual'));

drop index if exists apartcba.rental_owner_statement_lines_once_key;
create unique index if not exists rental_owner_statement_lines_once_key on apartcba.rental_owner_statement_lines (owner_id, ref_type, ref_id)
  where voided = false and ref_id is not null and ref_type in ('allocation','expense','contract_commission','statement_carry');

create or replace function apartcba.rental_close_owner_statement(
  p_organization_id uuid,
  p_statement_id uuid,
  p_actor uuid
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
  if v_statement.status not in ('borrador','emitida') then
    raise exception 'RENDICION_CERRADA: la rendición está %', v_statement.status;
  end if;
  if v_statement.net_amount > 0 then
    raise exception 'SIN_SALDO: la rendición tiene saldo a favor del propietario; registrá el pago';
  end if;
  update apartcba.rental_owner_statements
     set status = 'pagada', paid_at = now(), paid_movement_ids = '{}'
   where id = p_statement_id;
  return jsonb_build_object('ok', true, 'carry', -v_statement.net_amount);
end $$;

revoke all on function apartcba.rental_close_owner_statement(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function apartcba.rental_close_owner_statement(uuid, uuid, uuid) to service_role;

-- Rendiciones y gastos también se escuchan en vivo (lista de rendiciones, gastos de la ficha).
do $$
declare
  t text;
begin
  foreach t in array array['rental_owner_statements','rental_expenses'] loop
    execute format('drop policy if exists staff_select on apartcba.%I', t);
    execute format(
      'create policy staff_select on apartcba.%I for select to authenticated using (apartcba.current_user_role(organization_id) = any (array[''admin'',''recepcion'']))',
      t
    );
    execute format('grant select on table apartcba.%I to authenticated', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'apartcba' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table apartcba.%I', t);
    end if;
  end loop;
end $$;

-- Sellos Córdoba 2026 (Ley Impositiva, art. 48): tope del alquiler promedio mensual exento.
alter table apartcba.rental_settings alter column stamp_tax_exempt_monthly set default 1230000;
update apartcba.rental_settings set stamp_tax_exempt_monthly = 1230000 where stamp_tax_exempt_monthly is null;

commit;
