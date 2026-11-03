-- 079 — Marcar el check-out no puede contradecir lo que ya se sabe de la limpieza.
--
-- Apart CBA (31/10/2026): "nos quedó un depto sucio y no nos dimos cuenta". Ahora
-- el calendario avisa desde el día anterior y tiene un botón sucio/limpio
-- (src/lib/cleaning/cleanliness.ts); el equipo marca los check-out tarde y en
-- lote, así que el check-out no puede pisar lo que ya decidieron:
--
-- 1. Una RENOVACIÓN no es una salida. Si el mismo huésped (o el mismo contrato)
--    sigue en la unidad ese día, no hay ticket ni estado 'limpieza'. En 60 días de
--    Apart CBA fueron 34 de 224 salidas, y esos tickets falsos eran los que se
--    cancelaban a mano. Sólo si se marca en la fecha o después: marcar ANTES es
--    que el huésped se fue antes de tiempo, aunque queden tramos sin cancelar.
--
-- 2. Si ya lo dejaron LIMPIO después de la salida, queda 'disponible'. Antes pasaba
--    a 'limpieza' sin ticket que cerrar: quedaba rayado hasta moverlo a mano. Una
--    limpieza cerrada ANTES de la hora de salida sigue sin contar (regla de la 075).
--    Cuenta también la tarea sin reserva que crea el botón "Sucio".
--
-- 3. Una tarea abierta marcada a mano SE USA en vez de crear otra: el botón "Sucio"
--    y el check-out de la misma unidad terminaban en dos tickets.
--
-- 4. Cerrar una estadía VIEJA no crea un ticket. El 061 ya no tocaba el estado de
--    la unidad en ese caso, pero la tarea se creaba igual, "para dentro de 30
--    minutos", hasta 10 días tarde: con el aviso nuevo pintaría de sucio una unidad
--    que ya tiene otro huésped. La salida ya tuvo su tarea (la crea el cron el día
--    anterior); si no está, es porque alguien la borró.

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
  v_continua boolean := false;
  v_ya_limpia boolean := false;
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

      -- ¿Sigue el mismo huésped en la unidad? Espejo de isStayContinuation().
      IF NOT NEW.is_block AND NEW.check_out_date <= v_hoy THEN
        SELECT EXISTS (
          SELECT 1 FROM apartcba.bookings n
           WHERE n.unit_id = NEW.unit_id
             AND n.id <> NEW.id
             AND NOT n.is_block
             AND n.check_in_date = NEW.check_out_date
             AND n.status IN ('pendiente', 'confirmada', 'check_in', 'check_out')
             AND (
               (NEW.lease_group_id IS NOT NULL AND n.lease_group_id = NEW.lease_group_id)
               OR (NEW.guest_id IS NOT NULL AND n.guest_id = NEW.guest_id)
             )
        ) INTO v_continua;
      END IF;

      IF NOT NEW.is_block AND NOT v_continua THEN
        -- Salida anticipada: la limpieza abierta agendada para más adelante
        -- pasa a ahora.
        UPDATE apartcba.cleaning_tasks
          SET scheduled_for = now() + interval '30 minutes'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso')
            AND scheduled_for > now() + interval '30 minutes'
            AND NEW.check_out_date >= v_hoy;

        -- La tarea abierta marcada a mano pasa a ser la de esta salida.
        UPDATE apartcba.cleaning_tasks
          SET booking_out_id = NEW.id
          WHERE id = (
            SELECT c.id FROM apartcba.cleaning_tasks c
             WHERE c.unit_id = NEW.unit_id
               AND c.booking_out_id IS NULL
               AND c.status IN ('pendiente', 'en_progreso')
               AND (c.scheduled_for AT TIME ZONE v_tz)::date <= v_hoy
             ORDER BY c.scheduled_for DESC
             LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM apartcba.cleaning_tasks o
             WHERE o.booking_out_id = NEW.id
               AND o.status IN ('pendiente', 'en_progreso')
          );

        -- ¿Ya la dejaron limpia para esta salida?
        v_ya_limpia :=
          NOT EXISTS (
            SELECT 1 FROM apartcba.cleaning_tasks o
             WHERE o.booking_out_id = NEW.id
               AND o.status IN ('pendiente', 'en_progreso')
          )
          AND EXISTS (
            SELECT 1 FROM apartcba.cleaning_tasks c
             WHERE c.unit_id = NEW.unit_id
               AND c.status IN ('completada', 'verificada')
               AND (
                 (
                   c.booking_out_id = NEW.id
                   AND (c.scheduled_for AT TIME ZONE v_tz)::date >= NEW.check_out_date
                   AND (
                     c.completed_at IS NOT NULL
                     OR COALESCE(c.verified_at, c.updated_at) >= v_salida_prevista
                   )
                 )
                 OR (
                   c.booking_out_id IS NULL
                   AND COALESCE(c.completed_at, c.verified_at, c.updated_at) >= v_salida_prevista
                 )
               )
          );

        -- Una limpieza cerrada cuenta como la de ESTA salida sólo si alguien
        -- limpió de verdad (completed_at) o si se cerró después de la hora
        -- prevista de salida. Cerrada antes de que el huésped se fuera = no
        -- puede ser la limpieza de esta salida (Habitana 16/10/2026).
        IF NOT v_ya_limpia
           AND NEW.check_out_date >= v_hoy - 1
           AND NOT EXISTS (
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

      IF v_hay_huesped THEN
        UPDATE apartcba.units
          SET status = 'ocupado', status_changed_by = auth.uid()
          WHERE id = NEW.unit_id;
      ELSIF NEW.check_out_date >= v_hoy - 1 THEN
        IF v_continua THEN
          UPDATE apartcba.units
            SET status = 'ocupado', status_changed_by = auth.uid()
            WHERE id = NEW.unit_id;
        ELSIF v_ya_limpia THEN
          UPDATE apartcba.units
            SET status = 'disponible', status_changed_by = auth.uid()
            WHERE id = NEW.unit_id
              AND status IN ('ocupado', 'limpieza');
        ELSE
          UPDATE apartcba.units
            SET status = 'limpieza', status_changed_by = auth.uid()
            WHERE id = NEW.unit_id;
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
