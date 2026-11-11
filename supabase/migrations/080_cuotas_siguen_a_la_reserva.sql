-- 080 — Las cuotas siguen a la reserva
--
-- Habitana (10/11/2026): el calendario decía "Cuotas vencidas 1" y, al
-- apretarlo, quedaba vacío ("0 reservas en pantalla · 74 ocultas por
-- filtros"). La cuota era de una reserva mensual CANCELADA el 24/10, en una
-- unidad que después se archivó. Cancelar una reserva no tocaba sus cuotas, y
-- el cron diario (`mark_schedule_overdue`) igual las marcaba vencidas: el
-- contador, el filtro y la campanita ("Cuota vencida") contaban plata que
-- nadie debe.
--
-- En Apart CBA había 27 cuotas colgadas (24 vencidas, 3 pendientes) de 21
-- reservas canceladas, casi todas tramos de alquileres mensuales que se
-- volvieron a partir, más 39 avisos abiertos.
--
-- Regla: una cuota sin cobrar de una reserva cancelada o no-show no se debe.
--
--   1. Al cancelar (o no-show), las cuotas pending/overdue pasan a cancelled y
--      se descartan sus avisos, lo mismo que hace a mano `cancelSchedule`. Las
--      partial/paid quedan como están: es plata que entró.
--   2. Al reactivar una mensual, sus cuotas se regeneran con
--      `generate_payment_schedule_for_booking`, igual que cuando la app edita
--      una mensual: borra las no cobradas, conserva las cobradas y después se
--      remarcan las vencidas. Si la regeneración falla, la reactivación sigue
--      adelante con un WARNING, como en la app, que sólo loguea el error. No
--      puede ser que una cuota impida reactivar una reserva.
--   3. Una cuota que se inserta para una reserva cancelada nace cancelled. La
--      app regenera las cuotas después de varias ediciones, y sin esto podía
--      revivirlas.
--   4. `mark_schedule_overdue` ignora las reservas canceladas: una partial de
--      una cancelada no pasa a vencida.
--   5. Backfill de lo que ya quedó colgado, con sus avisos.

begin;

-- ─── 1 y 2. La reserva cambia de estado ─────────────────────────────────────
create or replace function apartcba.tg_booking_schedule_follow_status()
returns trigger
language plpgsql
security definer
set search_path = apartcba, public
as $$
declare
  v_was_off boolean := old.status in ('cancelada', 'no_show');
  v_is_off boolean := new.status in ('cancelada', 'no_show');
begin
  if v_is_off and not v_was_off then
    with anuladas as (
      update apartcba.booking_payment_schedule
         set status = 'cancelled'
       where booking_id = new.id
         and status in ('pending', 'overdue')
      returning id
    )
    update apartcba.notifications
       set dismissed_at = now()
     where ref_type = 'booking_payment_schedule'
       and ref_id in (select id from anuladas)
       and dismissed_at is null;
  elsif v_was_off and not v_is_off and new.mode = 'mensual' then
    begin
      perform apartcba.generate_payment_schedule_for_booking(new.id);
      update apartcba.booking_payment_schedule
         set status = 'overdue'
       where booking_id = new.id
         and status in ('pending', 'partial')
         and due_date < current_date
         and paid_amount < expected_amount;
    exception when others then
      raise warning 'No se pudieron regenerar las cuotas de la reserva % al reactivarla: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

drop trigger if exists trg_booking_schedule_follow_status on apartcba.bookings;
create trigger trg_booking_schedule_follow_status
  after update of status on apartcba.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function apartcba.tg_booking_schedule_follow_status();

-- ─── 3. Una cuota nueva de una reserva cancelada nace cancelada ─────────────
create or replace function apartcba.tg_schedule_born_cancelled()
returns trigger
language plpgsql
security definer
set search_path = apartcba, public
as $$
begin
  if new.status in ('pending', 'overdue')
     and exists (
       select 1 from apartcba.bookings b
        where b.id = new.booking_id
          and b.status in ('cancelada', 'no_show')
     ) then
    new.status := 'cancelled';
  end if;
  return new;
end $$;

drop trigger if exists trg_schedule_born_cancelled on apartcba.booking_payment_schedule;
create trigger trg_schedule_born_cancelled
  before insert on apartcba.booking_payment_schedule
  for each row
  execute function apartcba.tg_schedule_born_cancelled();

-- ─── 4. El cron no vence cuotas de reservas canceladas ──────────────────────
create or replace function apartcba.mark_schedule_overdue()
returns integer
language plpgsql
security definer
set search_path = apartcba, public
as $$
declare
  v_count integer;
begin
  update apartcba.booking_payment_schedule s
     set status = 'overdue'
   where s.status in ('pending', 'partial')
     and s.due_date < current_date
     and s.paid_amount < s.expected_amount
     and not exists (
       select 1 from apartcba.bookings b
        where b.id = s.booking_id
          and b.status in ('cancelada', 'no_show')
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── 5. Backfill ────────────────────────────────────────────────────────────
with anuladas as (
  update apartcba.booking_payment_schedule s
     set status = 'cancelled'
    from apartcba.bookings b
   where b.id = s.booking_id
     and b.status in ('cancelada', 'no_show')
     and s.status in ('pending', 'overdue')
  returning s.id
)
update apartcba.notifications
   set dismissed_at = now()
 where ref_type = 'booking_payment_schedule'
   and ref_id in (select id from anuladas)
   and dismissed_at is null;

commit;
