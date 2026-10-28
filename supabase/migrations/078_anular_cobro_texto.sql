-- 078 — «Anular el pago» de un COBRO: el historial dice "el ingreso del cobro".
--
-- «Registrar cobro» (28/10/2026) salda una liquidación con neto negativo —el
-- propietario cobró él y le paga la diferencia a la administración— con un
-- INGRESO en Caja, por el mismo circuito que el pago (ref settlement_payment +
-- paid_movement_id). settlement_undo_payment (069) ya lo deshace bien (borra
-- los movimientos sin mirar el sentido y suma total_in), pero el texto que deja
-- en el historial decía "Se borró de Caja el egreso del pago" también para ese
-- ingreso.
--
-- Se parchea sobre la definición viva (pg_get_functiondef) en vez de
-- recopiarla: cambia sólo esa rama del CASE, y si el texto no está como se
-- espera, frena sin tocar nada.

do $migration$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'apartcba'
     and p.proname = 'settlement_undo_payment';
  if v_def is null then
    raise exception 'settlement_undo_payment no existe (falta la 069)';
  end if;

  if position('el ingreso del cobro' in v_def) > 0 then
    return; -- ya aplicada
  end if;

  v_new := replace(
    v_def,
    $old$      when v_kind = 'pago' then 'el egreso del pago'$old$,
    $new$      when v_kind = 'pago' and v_mov.direction = 'in' then 'el ingreso del cobro'
      when v_kind = 'pago' then 'el egreso del pago'$new$
  );
  if v_new = v_def then
    raise exception 'settlement_undo_payment cambió: no se encontró la rama del CASE a parchear';
  end if;

  execute v_new;
end
$migration$;
