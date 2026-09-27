-- 066 — Las unidades mensuales también tienen su precio por mes
--
-- La 063 agregó `monthly_price` sólo para las mixtas. Una unidad de vocación
-- mensual seguía con un único precio rotulado "por noche" (`base_price`), que
-- nadie usa para alquilar por mes: el formulario de reserva arrancaba la renta
-- vacía y la ficha mostraba una tarifa diaria que no describe a la unidad.
--
-- Ahora cada vocación tiene sus precios:
--   temporario → por noche (base_price)
--   mensual    → por mes   (monthly_price)
--   mixto      → los dos
--
-- Sin cambios de esquema: la columna y su CHECK (> 0) ya existen. Sólo cambia
-- qué vocaciones la conservan (createUnit / updateUnit la anulan en temporario)
-- y su documentación. `base_price` de las mensuales no se toca: la web pública
-- sigue calculando su "≈ por mes" desde ahí hasta que se encare esa etapa.
--
-- Sin backfill, por la misma razón que la 063: las rentas cargadas en reservas
-- son ruidosas. El formulario de la unidad sugiere la última renta real y una
-- persona la confirma.

begin;

comment on column apartcba.units.monthly_price is
  'Precio de un mes completo para unidades mensuales y mixtas (default_mode in mensual, mixto), en la misma moneda que base_price. NULL = sin cargar o unidad temporaria. Ver migraciones 063 y 066.';

commit;
