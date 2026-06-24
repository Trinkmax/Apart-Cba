-- 032_booking_blocks.sql
-- Distingue los "bloqueos" de disponibilidad importados por iCal (eventos
-- "Airbnb (Not available)", "Blocked", etc.) de las reservas reales.
--
-- Un bloqueo SIGUE siendo una fila en apartcba.bookings con status='confirmada'
-- (para que el constraint bookings_no_overlap y la disponibilidad del
-- marketplace lo sigan respetando y no permitan double-booking sobre una fecha
-- bloqueada en el OTA), pero `is_block = true` lo excluye de:
--   - listas de reservas (/dashboard/reservas, dashboard, unit cards)
--   - reportes (parte-diario, liquidaciones, ocupación / KPIs)
--   - auto-creación de tareas de limpieza y eventos CRM de check-in/out
-- y lo hace renderizar como una barra gris "Bloqueado" en el grid del PMS.
--
-- Antes de esto, el sync de iCal (src/lib/ical/sync.ts) insertaba los bloqueos
-- como reservas 'confirmada' con guest_id NULL, por lo que aparecían como
-- "reservas sin huésped" fantasma, generaban limpiezas y contaminaban reportes.

ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS is_block boolean NOT NULL DEFAULT false;

-- Reclasificar los bloqueos históricos. El sync siempre escribió exactamente
-- notes = 'Bloqueo (sin reserva real)' para estos (único productor del marcador).
-- No se borran: los activos deben seguir bloqueando el calendario; solo dejan
-- de comportarse como reservas.
UPDATE apartcba.bookings
  SET is_block = true
  WHERE notes LIKE 'Bloqueo%' AND is_block = false;

-- Índice parcial para los escaneos de disponibilidad y los filtros is_block.
CREATE INDEX IF NOT EXISTS bookings_is_block_idx
  ON apartcba.bookings (unit_id) WHERE is_block;

-- Un bloqueo (status='confirmada', is_block=true) NO debe marcar la unidad como
-- "reservado": no es una reserva.
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_mark_reservado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'apartcba', 'public'
AS $function$
BEGIN
  IF NEW.status = 'confirmada' AND NOT NEW.is_block
     AND NEW.check_in_date <= CURRENT_DATE + interval '7 days' THEN
    UPDATE apartcba.units SET status = 'reservado', status_changed_by = auth.uid()
      WHERE id = NEW.unit_id AND status = 'disponible';
  END IF;
  RETURN NEW;
END $function$;

-- Guarda defensiva: un bloqueo nunca debe generar una tarea de limpieza al
-- transicionar de estado (los bloqueos normalmente van confirmada -> cancelada
-- vía el sync, nunca a check_out, pero lo blindamos igual).
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_sync_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'apartcba', 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'check_in' THEN
      UPDATE apartcba.units SET status = 'ocupado', status_changed_by = auth.uid() WHERE id = NEW.unit_id;
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    ELSIF NEW.status = 'check_out' THEN
      UPDATE apartcba.units SET status = 'limpieza', status_changed_by = auth.uid() WHERE id = NEW.unit_id;
      NEW.checked_out_at := COALESCE(NEW.checked_out_at, now());
      IF NOT NEW.is_block THEN
        INSERT INTO apartcba.cleaning_tasks (organization_id, unit_id, booking_out_id, scheduled_for, status)
        VALUES (NEW.organization_id, NEW.unit_id, NEW.id, now() + interval '30 minutes', 'pendiente');
      END IF;
    ELSIF NEW.status = 'cancelada' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $function$;
