-- 060 — La comisión de administración se calcula sobre el total, salvo que se
--       pida lo contrario
--
-- La migración 058 introdujo `organizations.commission_base` con default
-- 'net_of_channel' (comisión sobre el total MENOS lo que se lleva la
-- plataforma). Fue la elección equivocada por dos motivos:
--
--   1. No es lo que hacía el sistema antes de la 058. Hasta entonces la
--      comisión era siempre `total × %`. Con la comisión de canal en 0 los dos
--      cálculos dan igual, así que nadie lo notó — hasta que la primera
--      organización cargó el % de Booking y su comisión bajó sola.
--   2. No es lo que la gente quiere decir. Cecilia (Habitana, 07/09/2026) lo
--      dijo así: "la comisión de la administración nada que ver, debería ser
--      $27.000, o el 20% de la reserva". Una reserva de $135.000 con Booking al
--      15% le mostraba $30.982,50 en vez de $27.000.
--
-- El default vuelve a ser 'gross'. 'net_of_channel' sigue disponible en
-- Configuración → Comisiones para quien lo prefiera, pero ahora se elige.
--
-- Las filas existentes se pasan a 'gross' porque NINGUNA organización eligió
-- 'net_of_channel': todas quedaron con el default de la 058 (verificado antes
-- de aplicar). Ninguna liquidación ya generada cambia: las líneas guardadas no
-- se recalculan.

begin;

alter table apartcba.organizations
  alter column commission_base set default 'gross';

-- Sólo las que nunca eligieron: hoy son todas.
update apartcba.organizations
   set commission_base = 'gross'
 where commission_base = 'net_of_channel';

comment on column apartcba.organizations.commission_base is
  'Base de la comisión de administración: gross (total del huésped, default) o net_of_channel (total menos comisión de canal). Se elige en Configuración → Comisiones.';

commit;
