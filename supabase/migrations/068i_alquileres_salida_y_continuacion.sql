-- 068i — Alquileres: dos contratos vigentes no se pisan según la SALIDA REAL
--
-- rental_contracts_no_overlap (068) comparaba [inicio, fin] de los contratos
-- vigentes. Desde que una salida futura deja el contrato vigente hasta que el
-- inquilino desocupa (rescisión notificada o entrega programada, art. 1221),
-- eso trababa al inquilino siguiente: con la salida el 15/12 y el contrato
-- original hasta 03/2027, el contrato nuevo desde el 16/12 no se podía activar
-- hasta que el cron cerrara el anterior (sin cargo de ingreso, link ni primer
-- alquiler al firmar). Y al revés no cuidaba nada: un contrato vencido que
-- sigue cobrando la continuación (art. 1218) ocupa la propiedad después de su
-- fin, y se podía activar otro encima — dos inquilinos facturados por los
-- mismos meses.
--
-- La regla nueva mide la ocupación real (misma cuenta que occupancyEnd en
-- src/lib/rentals/exit.ts):
--   - con salida registrada (terminated_at), hasta ese día, antes o después
--     del fin (greatest() evita un rango invertido si quedó mal cargada);
--   - sin salida y cobrando la continuación, sin fin (null = abierto) hasta que
--     alguien registre la salida;
--   - si no, hasta la fecha de fin, como antes.
--
-- Mismo nombre de constraint: el mensaje en castellano de la app
-- (CONSTRAINT_MESSAGES en access.ts) sigue aplicando. Sin funciones nuevas.
-- La app ya chequea esto antes de escribir (con un mensaje que nombra el otro
-- contrato y su salida) y, sin esta migración, cae en la regla vieja con un
-- aviso claro.
--
-- Atómica: si algún par de contratos vigentes ya se pisara con la regla nueva,
-- se frena antes de tocar nada; el drop y el add van en una sola sentencia.

begin;

do $$
declare
  v_pair text;
begin
  select format('N° %s y N° %s', a.number, b.number)
    into v_pair
    from apartcba.rental_contracts a
    join apartcba.rental_contracts b
      on b.organization_id = a.organization_id
     and b.property_id = a.property_id
     and b.id > a.id
   where a.status = 'vigente'
     and b.status = 'vigente'
     and daterange(
           a.start_date,
           case
             when a.terminated_at is not null then greatest(a.start_date, a.terminated_at)
             when a.continuation_billing then null
             else a.end_date
           end,
           '[]')
      && daterange(
           b.start_date,
           case
             when b.terminated_at is not null then greatest(b.start_date, b.terminated_at)
             when b.continuation_billing then null
             else b.end_date
           end,
           '[]')
   limit 1;
  if v_pair is not null then
    raise exception 'SOLAPAMIENTO: los contratos vigentes % ocupan la misma propiedad en los mismos días. Registrá la salida de uno de los dos y volvé a aplicar la 068i.', v_pair;
  end if;
end;
$$;

alter table apartcba.rental_contracts
  drop constraint if exists rental_contracts_no_overlap,
  add constraint rental_contracts_no_overlap
    exclude using gist (
      property_id with =,
      daterange(
        start_date,
        case
          when terminated_at is not null then greatest(start_date, terminated_at)
          when continuation_billing then null
          else end_date
        end,
        '[]') with &&
    )
    where (status = 'vigente');

comment on constraint rental_contracts_no_overlap on apartcba.rental_contracts is
  'Dos contratos vigentes no ocupan la misma propiedad el mismo día. Ocupación real: hasta la salida registrada (terminated_at); sin salida y cobrando la continuación (art. 1218), sin fin; si no, hasta end_date. Migración 068i.';

commit;
