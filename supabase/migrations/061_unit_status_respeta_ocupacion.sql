-- 061 — Cerrar una estadía vieja no puede ensuciar una unidad que está ocupada
--
-- Síntoma (Habitana, 07/09/2026): "entre Fiama y Ojeda se limpió el
-- departamento, pero sigue con rayas, ¿qué hice mal?". Nada. Habitana Firpo
-- quedó pintada de "Limpieza" (las rayas celestes que cubren toda la fila del
-- calendario) mientras Javier Ojeda estaba adentro.
--
-- Qué pasó: Cecilia se puso al día con reservas viejas y marcó el check-out de
-- Fiama (31/08 → 04/09) el día 7. El trigger `tg_bookings_sync_unit` ponía la
-- unidad en 'limpieza' ante CUALQUIER check-out, sin mirar el presente. Pero en
-- esa unidad ya había otro huésped alojado desde el 04/09.
--
-- El estado de la unidad describe el AHORA, no la última fila que se tocó. Por
-- eso el check-out ahora recalcula contra la realidad:
--
--   · hay otra reserva con huésped adentro (`check_in`) → 'ocupado'
--   · el check-out es de una estadía que terminó hace más de un día → no se
--     toca el estado (cerrar un registro viejo es trabajo administrativo, no
--     un departamento que acaba de quedar sucio)
--   · en cualquier otro caso → 'limpieza', como siempre
--
-- La creación de la tarea de limpieza NO cambia: si el check-out corresponde a
-- una estadía real, la limpieza se agenda igual.

begin;

CREATE OR REPLACE FUNCTION apartcba.tg_bookings_sync_unit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_tz text;
  v_hay_huesped boolean;
  v_hoy date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'check_in' THEN
      UPDATE apartcba.units
        SET status = 'ocupado', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    ELSIF NEW.status = 'check_out' THEN
      NEW.checked_out_at := COALESCE(NEW.checked_out_at, now());

      SELECT COALESCE(
        (SELECT s.timezone FROM apartcba.parte_diario_settings s
          WHERE s.organization_id = NEW.organization_id),
        'America/Argentina/Cordoba'
      ) INTO v_tz;
      v_hoy := (now() AT TIME ZONE v_tz)::date;

      -- ¿Queda alguien adentro? Otra reserva de la misma unidad en check_in.
      SELECT EXISTS (
        SELECT 1 FROM apartcba.bookings b
         WHERE b.unit_id = NEW.unit_id
           AND b.id <> NEW.id
           AND b.status = 'check_in'
           AND NOT b.is_block
      ) INTO v_hay_huesped;

      IF v_hay_huesped THEN
        -- El departamento está habitado: el check-out que se acaba de cerrar
        -- es de una estadía anterior.
        UPDATE apartcba.units
          SET status = 'ocupado', status_changed_by = auth.uid()
          WHERE id = NEW.unit_id;
      ELSIF NEW.check_out_date >= v_hoy - 1 THEN
        -- Salida de hoy (o de ayer, por la carga tardía): hay que limpiar.
        UPDATE apartcba.units
          SET status = 'limpieza', status_changed_by = auth.uid()
          WHERE id = NEW.unit_id;
      END IF;
      -- Estadía vieja y unidad libre: se cierra el registro y el estado queda
      -- como esté. No inventamos una limpieza de hace dos semanas.

      -- Crear la task sólo si el booking no tiene ya una (cualquier estado):
      -- el cron nocturno normalmente la creó, y si el staff la canceló a mano
      -- no la resucitamos. Antes esto duplicaba limpiezas en el tablero.
      IF NOT NEW.is_block AND NOT EXISTS (
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
    ELSIF NEW.status = 'cancelada' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      -- Reserva cancelada sin que el huésped haya entrado → la limpieza
      -- automática pendiente no corresponde; la cancelamos para que no
      -- aparezca un departamento que no hay que limpiar.
      IF OLD.status IN ('pendiente', 'confirmada') THEN
        UPDATE apartcba.cleaning_tasks
          SET status = 'cancelada'
          WHERE booking_out_id = NEW.id
            AND status IN ('pendiente', 'en_progreso');
      END IF;
    END IF;
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

commit;
