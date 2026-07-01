-- 033_marketplace_availability_hardening.sql
-- Cierra los agujeros de disponibilidad del marketplace público:
--   1) 'pendiente' ahora bloquea solapamientos en `bookings`. Las retenciones que
--      hace recepción (status='pendiente') dejaban de aparecer como ocupadas en la
--      web y tampoco las frenaba la exclusion constraint -> se podían revender.
--      Verificado antes de aplicar: 0 solapamientos existentes bajo la nueva regla.
--   2) `booking_requests` gana su propia exclusión de solapamiento: evita que dos
--      solicitudes para las mismas fechas queden ambas "pendiente" (overselling).
--   3) `bookings.marketplace_user_id` vincula la reserva al huésped AUTENTICADO del
--      marketplace (auth.users). "Mis reservas" dejaba de depender de un match por
--      email — inseguro, porque la operación usa emails placeholder compartidos por
--      varios huéspedes distintos.

-- 1) Incluir 'pendiente' en la exclusión de overlap de bookings.
alter table apartcba.bookings drop constraint if exists bookings_no_overlap;
alter table apartcba.bookings
  add constraint bookings_no_overlap
  exclude using gist (unit_id with =, stay_range with &&)
  where (status in ('pendiente', 'confirmada', 'check_in'));

-- 2) Exclusión de overlap para solicitudes de reserva pendientes.
alter table apartcba.booking_requests drop constraint if exists booking_requests_no_overlap;
alter table apartcba.booking_requests
  add constraint booking_requests_no_overlap
  exclude using gist (
    unit_id with =,
    (daterange(check_in_date, check_out_date, '[)')) with &&
  ) where (status = 'pendiente');

-- 3) Vincular bookings del marketplace al usuario huésped autenticado.
alter table apartcba.bookings
  add column if not exists marketplace_user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_bookings_marketplace_user
  on apartcba.bookings (marketplace_user_id)
  where marketplace_user_id is not null;
