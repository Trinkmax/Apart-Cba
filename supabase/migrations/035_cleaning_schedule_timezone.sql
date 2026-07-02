-- ─────────────────────────────────────────────────────────────────────────────
-- 035: Limpiezas con timezone correcta + trigger sin duplicados
--
-- Problema raíz: cleaning_tasks.scheduled_for es timestamptz pero el cron
-- insertaba strings YYYY-MM-DD → quedaban a medianoche UTC, que en Argentina
-- son las 21:00 del día ANTERIOR. El tablero mostraba las limpiezas del 3/07
-- el día 2, y el parte diario (que filtraba por igualdad exacta) sólo veía
-- esas filas de medianoche — las tasks manuales o del trigger eran invisibles.
--
-- Este archivo arregla la capa de datos:
--   1. tg_bookings_sync_unit:
--      a. no duplica la task si el booking ya tiene una (el cron nocturno
--         suele haberla creado antes del check-out),
--      b. la task nueva nace con el checklist estándar,
--      c. si se MUEVE el check-out de la reserva, las tasks pendientes la
--         siguen (antes quedaban clavadas en la fecha vieja),
--      d. si se cancela la reserva sin check-in, la task pendiente se cancela.
--   2. Normaliza las filas históricas insertadas a medianoche UTC exacta →
--      hora de check-out del booking en la tz de la org.
--   3. Índice para lookups por booking_out_id (trigger + idempotencia del cron).
--
-- El código TS (ensureCleaningTasksForCheckouts) ahora inserta timestamps
-- reales (hora de check-out en la tz de la org) y todos los readers filtran
-- por rango de día local [00:00, 24:00) — ver src/lib/dates.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Trigger
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

-- 2) Data fix: filas a medianoche UTC exacta (patrón del cron viejo) → hora
--    de check-out del booking en la tz de la org. Cubre pendientes e
--    históricas para que el archivo semanal y el parte diario lean bien.
UPDATE apartcba.cleaning_tasks ct
SET scheduled_for = (
  (b.check_out_date::text || ' ' || COALESCE(b.check_out_time::text, '11:00:00'))::timestamp
  AT TIME ZONE COALESCE(s.timezone, 'America/Argentina/Cordoba')
)
FROM apartcba.bookings b
LEFT JOIN apartcba.parte_diario_settings s ON s.organization_id = b.organization_id
WHERE b.id = ct.booking_out_id
  AND ct.scheduled_for = date_trunc('day', ct.scheduled_for AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

-- 3) Índice para lookups por booking (dedupe del trigger + idempotencia del cron)
CREATE INDEX IF NOT EXISTS idx_cleaning_booking_out
  ON apartcba.cleaning_tasks (booking_out_id)
  WHERE booking_out_id IS NOT NULL;
