-- ─────────────────────────────────────────────────────────────────────────────
-- 036: Refinamientos al trigger de limpiezas (hallazgos de la revisión de 035)
--
--   1. Check-out anticipado: si el huésped se va antes de lo previsto y ya
--      existe la task del cron agendada para más adelante, se ADELANTA a
--      now()+30min en vez de quedar clavada en el día del checkout original
--      (la unidad quedaba en 'limpieza' sin limpieza visible ese día).
--   2. Room-swap: si la reserva se mueve de unidad, la task pendiente sigue
--      a la unidad nueva (antes quedaba apuntando a la unidad vieja y el cron
--      no podía crear otra porque el booking ya tenía task).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apartcba.tg_bookings_sync_unit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_tz text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'check_in' THEN
      UPDATE apartcba.units
        SET status = 'ocupado', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    ELSIF NEW.status = 'check_out' THEN
      UPDATE apartcba.units
        SET status = 'limpieza', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_out_at := COALESCE(NEW.checked_out_at, now());
      IF NOT NEW.is_block THEN
        -- Check-out anticipado: la task pendiente agendada para más adelante
        -- se adelanta — el depto ya quedó libre.
        UPDATE apartcba.cleaning_tasks
          SET scheduled_for = now() + interval '30 minutes'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso')
            AND scheduled_for > now() + interval '30 minutes';
        -- Crear la task sólo si el booking no tiene ya una (cualquier estado):
        -- el cron nocturno normalmente la creó, y si el staff la canceló a
        -- mano no la resucitamos.
        IF NOT EXISTS (
          SELECT 1 FROM apartcba.cleaning_tasks c WHERE c.booking_out_id = NEW.id
        ) THEN
          INSERT INTO apartcba.cleaning_tasks
            (organization_id, unit_id, booking_out_id, scheduled_for, status, checklist)
          VALUES (
            NEW.organization_id, NEW.unit_id, NEW.id,
            now() + interval '30 minutes', 'pendiente',
            -- Mantener en sync con DEFAULT_CHECKLIST en src/lib/actions/cleaning.ts
            '[
              {"item": "Cocina (vajilla, electrodomésticos)", "done": false},
              {"item": "Baño (sanitarios, ducha, espejos)", "done": false},
              {"item": "Dormitorios (cambio de sábanas)", "done": false},
              {"item": "Living / comedor", "done": false},
              {"item": "Pisos (aspirar / trapear)", "done": false},
              {"item": "Toallas y blanquería", "done": false},
              {"item": "Reposición amenities (papel, jabón, café)", "done": false},
              {"item": "Ventilación / olores", "done": false},
              {"item": "Verificación de inventario", "done": false}
            ]'::jsonb
          );
        END IF;
      END IF;
    ELSIF NEW.status = 'cancelada' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      -- Reserva cancelada sin que el huésped haya entrado → la limpieza
      -- automática pendiente no corresponde.
      IF OLD.status IN ('pendiente', 'confirmada') THEN
        UPDATE apartcba.cleaning_tasks
          SET status = 'cancelada'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso');
      END IF;
    END IF;
  END IF;

  -- Room-swap: la task pendiente sigue a la unidad nueva. Sólo unit_id — no
  -- recomputamos scheduled_for acá para no pisar un adelanto por check-out
  -- anticipado ni un reagendado manual.
  IF TG_OP = 'UPDATE' AND NOT NEW.is_block
     AND OLD.unit_id IS DISTINCT FROM NEW.unit_id THEN
    UPDATE apartcba.cleaning_tasks
      SET unit_id = NEW.unit_id
      WHERE booking_out_id = NEW.id
        AND status IN ('pendiente', 'en_progreso');
  END IF;

  -- Si se mueve el check-out (drag en calendario, edición, resync iCal),
  -- las limpiezas pendientes siguen a la reserva.
  IF TG_OP = 'UPDATE'
     AND NOT NEW.is_block
     AND NEW.status NOT IN ('cancelada', 'no_show')
     AND (OLD.check_out_date IS DISTINCT FROM NEW.check_out_date
          OR OLD.check_out_time IS DISTINCT FROM NEW.check_out_time) THEN
    SELECT COALESCE(
      (SELECT s.timezone FROM apartcba.parte_diario_settings s
        WHERE s.organization_id = NEW.organization_id),
      'America/Argentina/Cordoba'
    ) INTO v_tz;
    UPDATE apartcba.cleaning_tasks
      SET scheduled_for = (
        (NEW.check_out_date::text || ' ' || COALESCE(NEW.check_out_time::text, '11:00:00'))::timestamp
        AT TIME ZONE v_tz
      )
      WHERE booking_out_id = NEW.id
        AND status IN ('pendiente', 'en_progreso');
  END IF;

  RETURN NEW;
END $$;
