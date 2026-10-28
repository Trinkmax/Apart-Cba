-- 077 — Liquidaciones: tipo de línea "Cobrado por el propietario".
--
-- Habitana (28/10/2026): sus propietarios cobran ellos a los huéspedes y ella
-- lo descontaba como "Ajuste −". Funcionaba para el neto, pero el resumen lo
-- sumaba a "Gastos": el propietario veía gastos enormes (lo que cobró + la
-- limpieza + los insumos) y en ningún lado cuánto ganó en el mes.
--
-- `owner_collected` es plata que el propietario YA tiene en la mano: siempre
-- resta del neto (el server fuerza el signo), pero el resumen la muestra
-- aparte — Ganancia del propietario − Ya cobrado por él = Neto por pagar.
-- El cálculo del neto no cambia (va por signo), así que no hace falta tocar
-- datos ni funciones. Aditiva: sólo amplía el CHECK.

alter table apartcba.settlement_lines
  drop constraint settlement_lines_line_type_check;

alter table apartcba.settlement_lines
  add constraint settlement_lines_line_type_check
  check (line_type = any (array[
    'booking_revenue'::text,
    'commission'::text,
    'channel_commission'::text,
    'maintenance_charge'::text,
    'cleaning_charge'::text,
    'adjustment'::text,
    'monthly_rent_fraction'::text,
    'expenses_fraction'::text,
    'owner_collected'::text
  ]));
