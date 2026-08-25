-- 054 — Una reserva mensual con renta cargada nunca puede quedar en $0
--
-- Síntoma reportado (25/08/2026): el alquiler de Matías Juan Verón en
-- BUENOS AIRES 570 figuraba con la renta cargada en $1.100.000 y el importe de
-- la reserva en $0, en los cuatro períodos del contrato.
--
-- Causa. En modo mensual el importe de cada período se guardaba prorrateando un
-- "total del contrato" entre los tramos. Cuando ese total llegaba vacío, cada
-- tramo se guardaba en $0 — y al extender el contrato, los tramos nuevos
-- heredaban el cero del tramo del que salían. El precio real (la renta) estaba
-- bien cargado todo el tiempo, pero nunca se derivaba de él.
--
-- Arreglo. El importe de un tramo mensual es la renta prorrateada por sus días
-- (renta ÷ 30 × noches) — la misma fórmula que muestra el formulario y la que
-- tienen todos los períodos bien cargados. El servidor la aplica ahora en los
-- cuatro caminos de escritura (alta simple, alta con división en períodos,
-- edición y extensión de contrato), y este CHECK lo vuelve imposible de violar
-- desde cualquier otro camino, presente o futuro.

begin;

-- ── 1. Reparación de las filas existentes ────────────────────────────────────
-- Sólo toca filas en modo mensual, con renta cargada, e importe en cero. No
-- inventa nada: el valor sale de la renta que ya estaba en la reserva.
update apartcba.bookings b
   set total_amount = round((b.monthly_rent / 30.0) * (b.check_out_date - b.check_in_date), 2),
       commission_amount = case
         when coalesce(b.commission_pct, 0) > 0
           then round(round((b.monthly_rent / 30.0) * (b.check_out_date - b.check_in_date), 2)
                      * b.commission_pct / 100.0, 2)
         else b.commission_amount
       end
 where b.mode = 'mensual'
   and coalesce(b.monthly_rent, 0) > 0
   and coalesce(b.total_amount, 0) = 0
   and b.check_out_date > b.check_in_date;

-- ── 2. Invariante ────────────────────────────────────────────────────────────
alter table apartcba.bookings
  add constraint bookings_mensual_total_no_cero
  check (
    mode <> 'mensual'
    or coalesce(monthly_rent, 0) = 0
    or coalesce(total_amount, 0) > 0
  );

comment on constraint bookings_mensual_total_no_cero on apartcba.bookings is
  'Un alquiler mensual con renta cargada tiene que tener importe. Ver migración 054.';

commit;
