-- 075 — Una limpieza cerrada ANTES de que el huésped se fuera no es la limpieza
-- de esa salida.
--
-- Habitana (16/10/2026): "tengo cuatro departamentos para limpiar pero me
-- figuran dos; el calendario marca los cuatro". A las 07:07 se cerraron como
-- "verificada" (directo desde pendiente, sin empezar ni completar) las
-- limpiezas de AT7B y COF II, cuatro horas antes de que salieran los huéspedes
-- (11:17 y 11:19). Al marcar esos check-out, la regla de la 065 ("hay una tarea
-- agendada para el día de salida o después → ya está") las dio por cubiertas:
-- no se creó tarea, pero la unidad pasó a 'limpieza'. Calendario con 4,
-- Limpieza y dashboard con 2.
--
-- Ahora una tarea cerrada cubre la salida sólo si alguien limpió de verdad
-- (completed_at — el flujo de la persona de limpieza) o si se cerró después de
-- la hora prevista de salida (cerrar en un paso cuando el check-out se marca
-- tarde sigue valiendo). Si no, el check-out crea una tarea nueva: el falso
-- positivo posible (salida anticipada + cierre en un paso antes de hora) es
-- una tarea de más a la vista, nunca un departamento sucio que no figura.

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
  v_salida_prevista timestamptz;
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
      v_salida_prevista :=
        (NEW.check_out_date::text || ' ' || COALESCE(NEW.check_out_time::text, '11:00:00'))::timestamp
        AT TIME ZONE v_tz;

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

        -- Una limpieza cerrada cuenta como la de ESTA salida sólo si alguien
        -- limpió de verdad (completed_at) o si se cerró después de la hora
        -- prevista de salida. Cerrada antes de que el huésped se fuera = no
        -- puede ser la limpieza de esta salida (Habitana 16/10/2026).
        IF NOT EXISTS (
          SELECT 1 FROM apartcba.cleaning_tasks c
           WHERE c.booking_out_id = NEW.id
             AND (
               c.status IN ('pendiente', 'en_progreso')
               OR (
                 (c.scheduled_for AT TIME ZONE v_tz)::date >= NEW.check_out_date
                 AND (
                   c.status = 'cancelada'
                   OR c.completed_at IS NOT NULL
                   OR COALESCE(c.verified_at, c.updated_at) >= v_salida_prevista
                 )
               )
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
