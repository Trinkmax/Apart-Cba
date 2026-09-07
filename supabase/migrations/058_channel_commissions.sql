-- 058 — Comisión de canal (lo que cobra la plataforma) y base de la comisión
--
-- Pedido (Habitana, 02/09/2026): "comisión por canales de venta" y "dónde sale
-- que tengo que pagar a los propietarios, cuánto cobrar yo y qué pagar de
-- comisiones a las plataformas". Hasta acá la única comisión del sistema era la
-- de administración (la que cobra la inmobiliaria al propietario). Lo que se
-- lleva Booking / Airbnb / Expedia por cada reserva no existía en ningún lado,
-- así que el neto al propietario y el resultado del mes salían inflados.
--
-- Modelo.
--   • `organizations.channel_commissions` — % por canal de venta, por
--     organización: {"booking": 15, "airbnb": 3}. Es el DEFAULT que se
--     snapshotea en cada reserva nueva según su `source`; una reserva puede
--     pisarlo a mano.
--   • `bookings.channel_commission_pct` / `channel_commission_amount` — el
--     snapshot. `amount = total_amount × pct / 100`, recalculado en cada camino
--     de escritura (alta, edición, división en tramos, completar precio de una
--     reserva de OTA que entró en $0).
--   • `organizations.commission_base` — sobre qué se calcula la comisión de
--     administración:
--       'gross'          → total_amount × pct (comportamiento histórico)
--       'net_of_channel' → (total_amount − channel_commission_amount) × pct
--     Default 'net_of_channel': con la comisión de canal en 0 (todas las orgs
--     existentes) ambas bases dan exactamente lo mismo, así que ninguna
--     liquidación ya generada cambia de número.
--   • `settlement_lines.line_type` admite 'channel_commission': la comisión de
--     la plataforma se descuenta al propietario en su liquidación, como línea
--     propia (sign '-'), separada de la comisión de administración.

begin;

-- ── 1. Defaults por organización ────────────────────────────────────────────
alter table apartcba.organizations
  add column if not exists channel_commissions jsonb not null default '{}'::jsonb,
  add column if not exists commission_base text not null default 'net_of_channel';

alter table apartcba.organizations
  drop constraint if exists organizations_commission_base_check;
alter table apartcba.organizations
  add constraint organizations_commission_base_check
  check (commission_base in ('gross', 'net_of_channel'));

-- El JSON es un objeto plano {canal: porcentaje}. Se valida acá y no sólo en la
-- action para que ningún camino futuro pueda guardar cualquier cosa.
alter table apartcba.organizations
  drop constraint if exists organizations_channel_commissions_is_object;
alter table apartcba.organizations
  add constraint organizations_channel_commissions_is_object
  check (jsonb_typeof(channel_commissions) = 'object');

comment on column apartcba.organizations.channel_commissions is
  'Comisión de cada canal de venta (% que cobra la plataforma), p. ej. {"booking": 15, "airbnb": 3}. Default que se snapshotea en bookings.channel_commission_pct.';
comment on column apartcba.organizations.commission_base is
  'Base de la comisión de administración: gross (total del huésped) o net_of_channel (total menos comisión de canal).';

-- ── 2. Snapshot por reserva ─────────────────────────────────────────────────
alter table apartcba.bookings
  add column if not exists channel_commission_pct numeric(5, 2),
  add column if not exists channel_commission_amount numeric(14, 2);

alter table apartcba.bookings
  drop constraint if exists bookings_channel_commission_pct_range;
alter table apartcba.bookings
  add constraint bookings_channel_commission_pct_range
  check (channel_commission_pct is null or (channel_commission_pct >= 0 and channel_commission_pct <= 100));

comment on column apartcba.bookings.channel_commission_pct is
  '% que cobra la plataforma (Booking, Airbnb…) por esta reserva. Snapshot del default de la org al crearla; editable.';
comment on column apartcba.bookings.channel_commission_amount is
  'total_amount × channel_commission_pct / 100, recalculado en cada escritura.';

-- ── 3. Nueva línea de liquidación ───────────────────────────────────────────
alter table apartcba.settlement_lines
  drop constraint if exists settlement_lines_line_type_check;
alter table apartcba.settlement_lines
  add constraint settlement_lines_line_type_check
  check (line_type = any (array[
    'booking_revenue',
    'commission',
    'channel_commission',
    'maintenance_charge',
    'cleaning_charge',
    'adjustment',
    'monthly_rent_fraction',
    'expenses_fraction'
  ]));

commit;
