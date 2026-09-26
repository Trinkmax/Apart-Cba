-- 065 — El check-out mira quién está adentro HOY, no cualquier check_in viejo.
--
-- Habitana (25/09/2026): "no pone el depa en limpiar cuando hago el checkout, y
-- me dice que tengo 6 depas ocupados cuando tengo solo 3".
--
-- Tres causas en tg_bookings_sync_unit (061/062):
--
-- 1. "¿Queda otro huésped?" contaba CUALQUIER reserva de la unidad en
--    status='check_in', sin mirar fechas. Habitana no marca todas las salidas:
--    AT4A tenía a Pablo Maumary 04→12/09 todavía en check_in, así que al hacer
--    el check-out de su segunda estadía (13→25/09) la unidad volvió a
--    'ocupado' en vez de 'limpieza'. Ahora sólo cuenta una estadía que cubre
--    hoy (check_in_date <= hoy < check_out_date).
--
-- 2. La tarea de limpieza sólo se creaba si la reserva no tenía NINGUNA. Una
--    reserva extendida arrastraba la limpieza ya hecha de su fecha original
--    (AT4A: verificada el 21/09, salida real el 25/09) y el check-out no
--    generaba nada. Ahora cuenta sólo una tarea abierta o agendada para el día
--    de salida o después.
--    Además, si el huésped se va antes de lo previsto, la tarea abierta que
--    estaba agendada para más adelante se adelanta a ahora.
--
-- 3. Mover una reserva en check_in a otra unidad dejaba la unidad de origen
--    'ocupado' para siempre (AT4B, Marcela Salas pasó a AT7B). Ahora la
--    unidad nueva queda ocupada y la vieja, si no le queda nadie adentro,
--    vuelve a 'disponible'.

CREATE OR REPLACE FUNCTION apartcba.tg_bookings_sync_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'apartcba', 'public'
AS $function$
DECLARE
  v_tz text;
  v_hay_huesped boolean;
  v_hoy date;
BEGIN
  SELECT COALESCE(
    (SELECT s.timezone FROM apartcba.parte_diario_settings s
      WHERE s.organization_id = NEW.organization_id),
    'America/Argentina/Cordoba'
  ) INTO v_tz;
  v_hoy := (now() AT TIME ZONE v_tz)::date;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'check_in' THEN
      UPDATE apartcba.units
        SET status = 'ocupado', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    ELSIF NEW.status = 'check_out' THEN
      NEW.checked_out_at := COALESCE(NEW.checked_out_at, now());

      SELECT EXISTS (
        SELECT 1 FROM apartcba.bookings b
         WHERE b.unit_id = NEW.unit_id
           AND b.id <> NEW.id
           AND b.status = 'check_in'
           AND NOT b.is_block
           AND b.check_in_date <= v_hoy
           AND b.check_out_date > v_hoy
      ) INTO v_hay_huesped;

      IF v_hay_huesped THEN
        UPDATE apartcba.units
          SET status = 'ocupado', status_changed_by = auth.uid()
          WHERE id = NEW.unit_id;
      ELSIF NEW.check_out_date >= v_hoy - 1 THEN
        UPDATE apartcba.units
          SET status = 'limpieza', status_changed_by = auth.uid()
          WHERE id = NEW.unit_id;
      END IF;

      IF NOT NEW.is_block THEN
        -- Salida anticipada: la limpieza abierta agendada para más adelante
        -- pasa a ahora.
        UPDATE apartcba.cleaning_tasks
          SET scheduled_for = now() + interval '30 minutes'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso')
            AND scheduled_for > now() + interval '30 minutes'
            AND NEW.check_out_date >= v_hoy;

        IF NOT EXISTS (
          SELECT 1 FROM apartcba.cleaning_tasks c
           WHERE c.booking_out_id = NEW.id
             AND (
               c.status IN ('pendiente', 'en_progreso')
               OR (c.scheduled_for AT TIME ZONE v_tz)::date >= NEW.check_out_date
             )
        ) THEN
          INSERT INTO apartcba.cleaning_tasks
            (organization_id, unit_id, booking_out_id, scheduled_for, status, checklist)
          VALUES (
            NEW.organization_id, NEW.unit_id, NEW.id,
            now() + interval '30 minutes', 'pendiente',
            apartcba.cleaning_checklist_for_org(NEW.organization_id)
          );
        END IF;
      END IF;
    ELSIF NEW.status = 'cancelada' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      IF OLD.status IN ('pendiente', 'confirmada') THEN
        UPDATE apartcba.cleaning_tasks
          SET status = 'cancelada'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso');
      END IF;
    END IF;
  END IF;

  -- Reserva en curso movida de unidad.
  IF TG_OP = 'UPDATE'
     AND NOT NEW.is_block
     AND NEW.status = 'check_in'
     AND OLD.status = 'check_in'
     AND OLD.unit_id IS DISTINCT FROM NEW.unit_id THEN
    UPDATE apartcba.units
      SET status = 'ocupado', status_changed_by = auth.uid()
      WHERE id = NEW.unit_id;

    UPDATE apartcba.units u
      SET status = 'disponible', status_changed_by = auth.uid()
      WHERE u.id = OLD.unit_id
        AND u.status = 'ocupado'
        AND NOT EXISTS (
          SELECT 1 FROM apartcba.bookings b
           WHERE b.unit_id = OLD.unit_id
             AND b.id <> NEW.id
             AND b.status = 'check_in'
             AND NOT b.is_block
             AND b.check_in_date <= v_hoy
             AND b.check_out_date > v_hoy
        );

    UPDATE apartcba.cleaning_tasks
      SET unit_id = NEW.unit_id
      WHERE booking_out_id = NEW.id
        AND status IN ('pendiente', 'en_progreso');
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT NEW.is_block
     AND NEW.status NOT IN ('cancelada', 'no_show')
     AND (OLD.check_out_date IS DISTINCT FROM NEW.check_out_date
          OR OLD.check_out_time IS DISTINCT FROM NEW.check_out_time) THEN
    UPDATE apartcba.cleaning_tasks
      SET scheduled_for = (
        (NEW.check_out_date::text || ' ' || COALESCE(NEW.check_out_time::text, '11:00:00'))::timestamp
        AT TIME ZONE v_tz
      )
      WHERE booking_out_id = NEW.id
        AND status IN ('pendiente', 'en_progreso');
  END IF;

  RETURN NEW;
END $function$;
