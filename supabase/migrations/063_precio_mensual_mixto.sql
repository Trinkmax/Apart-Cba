-- 063 — Una unidad mixta tiene dos precios: por noche y por mes
--
-- Pedido (24/09/2026): "necesito poder poner 2 precios, uno por noche y otro
-- mensual, esto únicamente para deptos mixtos".
--
-- Hasta ahora la unidad tenía un solo precio (`base_price`, por noche). Para
-- una mixta (se alquila por noche Y por mes) el precio del mes no estaba en
-- ningún lado: el formulario de reserva arrancaba la renta vacía y la web, en
-- la pestaña Mensuales, mostraba el precio por noche. Multiplicar por 30 no
-- sirve: medido sobre los alquileres mensuales reales de unidades mixtas, la
-- renta es entre 11 y 21 veces el precio por noche (mediana 14x), o sea que
-- "noche × 30" la duplica.
--
-- `monthly_price` es el precio de un mes completo, en la misma moneda que
-- `base_price`. Sólo lo usan las unidades mixtas: el servidor (createUnit /
-- updateUnit) lo deja en NULL cuando la vocación no es mixto. Por ahora es
-- sólo del panel: la web pública (rentOS) no lo lee todavía. No se ata a
-- `default_mode` con un CHECK a propósito: cambiar la vocación fallaría en
-- cualquier camino que no limpie el precio en el mismo update.
--
-- Sin backfill: las rentas cargadas en reservas son ruidosas (valores de
-- prueba, otras monedas, ajustes por IPC) y ocho mixtas no tienen ningún
-- alquiler mensual. NULL = "sin cargar"; cada operador lo completa.
--
-- Es un dato de la unidad, no del contrato: `bookings.monthly_rent` sigue
-- siendo la foto de lo pactado. Cambiar este precio no toca ninguna reserva.

begin;

alter table apartcba.units
  add column if not exists monthly_price numeric(14,2);

-- Un precio mensual en $0 sería un mes gratis en la web y una renta en cero en
-- el formulario de reserva (lo que prohíbe bookings_mensual_total_no_cero).
alter table apartcba.units
  drop constraint if exists units_monthly_price_positive;
alter table apartcba.units
  add constraint units_monthly_price_positive
  check (monthly_price is null or monthly_price > 0);

comment on column apartcba.units.monthly_price is
  'Precio de un mes completo para unidades mixtas (default_mode = mixto), en la misma moneda que base_price. NULL = sin cargar o unidad no mixta. Ver migración 063.';

comment on column apartcba.units.base_price is
  'Precio por noche. Las reglas de unit_pricing_rules lo ajustan por fecha; no tocan monthly_price.';

commit;
