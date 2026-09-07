-- 059 — Tu comisión de administración también puede depender del canal de venta
--
-- Pedido (Habitana, 07/09/2026): "si la reserva es directa, MI comisión sube al
-- 27,5 — ¿eso lo tengo que aclarar en cada reserva?". Hasta acá la respuesta era
-- que sí y encima no servía: la reserva guarda un `commission_pct` que el
-- formulario no muestra y que la liquidación ignora (recalcula siempre desde la
-- unidad y el propietario). Así que una comisión distinta por canal sólo se
-- podía arreglar a mano, fila por fila, en cada liquidación.
--
-- La migración 058 agregó la comisión que cobra la PLATAFORMA por canal
-- (`channel_commissions`). Esta agrega la simétrica: la que cobra la
-- ADMINISTRACIÓN por canal.
--
--   `organizations.commission_by_source` — {"directo": 27.5, "booking": 20}
--
-- Orden de resolución (implementado en src/lib/finance/booking-economics.ts,
-- una sola función que usan la liquidación, Resultados y el alta de reservas):
--
--   1. `unit_owners.commission_pct_override` — lo negociado con ESE propietario
--      en ESA unidad. Es un acuerdo con una persona: una política general no lo
--      pisa en silencio.
--   2. `organizations.commission_by_source[source]` — la política por canal.
--   3. `units.default_commission_pct` — lo que ya se usaba.
--   4. `organizations.default_commission_pct`
--   5. 20
--
-- Con la columna vacía (todas las organizaciones hoy) el paso 2 no existe y el
-- resultado es exactamente el de siempre: ninguna liquidación ya generada
-- cambia de número.

begin;

alter table apartcba.organizations
  add column if not exists commission_by_source jsonb not null default '{}'::jsonb;

-- Objeto plano {canal: porcentaje}. Se valida acá y no sólo en la action para
-- que ningún camino futuro pueda guardar otra forma.
alter table apartcba.organizations
  drop constraint if exists organizations_commission_by_source_is_object;
alter table apartcba.organizations
  add constraint organizations_commission_by_source_is_object
  check (jsonb_typeof(commission_by_source) = 'object');

comment on column apartcba.organizations.commission_by_source is
  'Comisión de administración por canal de venta (% que cobra la inmobiliaria), p. ej. {"directo": 27.5}. Gana sobre el % de la unidad, pero NO sobre el acuerdo con el propietario (unit_owners.commission_pct_override). Vacío = se usa el de la unidad.';

commit;
