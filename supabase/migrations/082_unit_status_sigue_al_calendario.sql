-- 082 — «Ocupado» / «Reservado» salen del calendario, no de la última reserva tocada
--
-- Síntoma (Viaggiato, 17/11/2026): "aparecen como ocupados pero en el
-- calendario no están ocupados". En Unidades, 9 departamentos decían «Ocupado»
-- con el calendario libre hoy (CALAII, GAMA, VELEZ, CALA, CATA, ACBA, VIA, JAC,
-- FRIAS) y BALVA / SALGUERO decían «Reservado» sin nadie que llegue.
--
-- `units.status` se guarda, y dos triggers lo escribían sin volver nunca atrás:
--
--   · `tg_bookings_sync_unit` (BEFORE) pone «ocupado» ante CUALQUIER check-in,
--     aunque la estadía haya terminado hace una semana. Viaggiato se pone al día
--     marcando check-ins viejos (ACBA 05→12, VIA 06→09, CATA 09→11, marcados el
--     17): cada uno dejaba la unidad «ocupada». El check-out de una estadía vieja
--     no toca el estado (061), así que quedaba así.
--   · Una estadía que termina sin que nadie marque la salida (CALAII 12→15, GAMA
--     13→15) no dispara nada: nada pasa a las 00:00 del día de salida.
--   · `tg_bookings_mark_reservado` ponía «reservado» ante cualquier reserva
--     confirmada que empezara antes de hoy+7 (sin cota de abajo: tocar una
--     reserva vieja también) y nunca lo sacaba. Volver un check-in a
--     «confirmada» tampoco.
--
-- Mismo principio que la 079 con sucio/limpio: el estado describe el AHORA y
-- sale de las reservas. Una sola regla (`unit_occupancy_from_stays`):
--
--   · «ocupado»    hay una estadía en curso HOY: check_in_date <= hoy <
--                  check_out_date, no cancelada ni con la salida hecha, y o bien
--                  ya tiene el check-in marcado o bien entró antes de hoy (Apart
--                  CBA y Viaggiato no siempre marcan la entrada: si la estadía
--                  empezó ayer, hay alguien adentro).
--   · «reservado»  llega alguien HOY y todavía no se marcó la entrada.
--   · «disponible» nada de lo anterior.
--
-- Lo que es decisión de una persona sobre la unidad se respeta: «mantenimiento»
-- y «bloqueado» no se tocan nunca, y «limpieza» sólo cede si hay alguien
-- adentro (la 079: con una estadía en curso, el aviso de sucio alcanza y no se
-- tapa la ocupación).
--
-- Cuándo se recalcula:
--   · después de cada alta / cambio / baja de una reserva que mueva estado,
--     fechas, unidad o bloqueo (`trg_bookings_refresh_unit_occupancy`, reemplaza
--     a `trg_bookings_mark_reservado`). Corre DESPUÉS del BEFORE de
--     `tg_bookings_sync_unit`, así que corrige el «ocupado» de un check-in viejo.
--   · a las 00:05 de Córdoba (pg_cron `apartcba_unit_occupancy_nightly`): lo que
--     cambia sólo por el paso del día (terminó la estadía, entró ayer sin marcar).
--
-- El historial (`unit_status_history`) registra cada cambio con el motivo
-- «Auto: según el calendario».

begin;

-- ─── La regla ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.unit_occupancy_from_stays(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_hoy date;
BEGIN
  SELECT (now() AT TIME ZONE COALESCE(o.timezone, 'America/Argentina/Cordoba'))::date
    INTO v_hoy
    FROM apartcba.units u
    JOIN apartcba.organizations o ON o.id = u.organization_id
   WHERE u.id = p_unit_id;
  IF v_hoy IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM apartcba.bookings b
     WHERE b.unit_id = p_unit_id
       AND NOT b.is_block
       AND b.status IN ('pendiente', 'confirmada', 'check_in')
       AND b.check_in_date <= v_hoy
       AND b.check_out_date > v_hoy
       AND (b.status = 'check_in' OR b.check_in_date < v_hoy)
  ) THEN
    RETURN 'ocupado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM apartcba.bookings b
     WHERE b.unit_id = p_unit_id
       AND NOT b.is_block
       AND b.status IN ('pendiente', 'confirmada')
       AND b.check_in_date = v_hoy
       AND b.check_out_date > v_hoy
  ) THEN
    RETURN 'reservado';
  END IF;

  RETURN 'disponible';
END $$;

-- La regla aplicada sobre lo que la unidad tiene guardado.
CREATE OR REPLACE FUNCTION apartcba.unit_occupancy_status(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_status text;
  v_stays text;
BEGIN
  SELECT u.status INTO v_status FROM apartcba.units u WHERE u.id = p_unit_id;
  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_status IN ('mantenimiento', 'bloqueado') THEN
    RETURN v_status;
  END IF;

  v_stays := apartcba.unit_occupancy_from_stays(p_unit_id);
  IF v_stays = 'ocupado' THEN
    RETURN 'ocupado';
  END IF;
  IF v_status = 'limpieza' THEN
    RETURN 'limpieza';
  END IF;
  RETURN v_stays;
END $$;

-- Escribe la regla. Devuelve el estado nuevo si cambió, NULL si no.
CREATE OR REPLACE FUNCTION apartcba.refresh_unit_occupancy(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF p_unit_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT u.status INTO v_old FROM apartcba.units u WHERE u.id = p_unit_id FOR UPDATE;
  IF v_old IS NULL THEN
    RETURN NULL;
  END IF;

  v_new := apartcba.unit_occupancy_status(p_unit_id);
  IF v_new IS NULL OR v_new = v_old THEN
    RETURN NULL;
  END IF;

  UPDATE apartcba.units
     SET status = v_new, status_changed_by = auth.uid()
   WHERE id = p_unit_id;

  -- tg_units_status_history acaba de insertar la fila (con reason NULL).
  UPDATE apartcba.unit_status_history h
     SET reason = 'Auto: según el calendario'
   WHERE h.unit_id = p_unit_id
     AND h.from_status = v_old
     AND h.to_status = v_new
     AND h.reason IS NULL
     AND h.created_at = now();

  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION apartcba.refresh_all_units_occupancy()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT u.id FROM apartcba.units u WHERE u.active ORDER BY u.id LOOP
    IF apartcba.refresh_unit_occupancy(r.id) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Nada de esto es para el navegador: sólo service_role (server actions, crons)
-- y los triggers (que corren como el dueño).
REVOKE ALL ON FUNCTION apartcba.unit_occupancy_from_stays(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apartcba.unit_occupancy_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apartcba.refresh_unit_occupancy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apartcba.refresh_all_units_occupancy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.unit_occupancy_from_stays(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION apartcba.unit_occupancy_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION apartcba.refresh_unit_occupancy(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION apartcba.refresh_all_units_occupancy() TO service_role;

-- ─── Cuando cambia una reserva ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_refresh_unit_occupancy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.check_in_date IS NOT DISTINCT FROM NEW.check_in_date
     AND OLD.check_out_date IS NOT DISTINCT FROM NEW.check_out_date
     AND OLD.unit_id IS NOT DISTINCT FROM NEW.unit_id
     AND OLD.is_block IS NOT DISTINCT FROM NEW.is_block THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM apartcba.refresh_unit_occupancy(NEW.unit_id);
  END IF;
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD.unit_id IS DISTINCT FROM NEW.unit_id) THEN
    PERFORM apartcba.refresh_unit_occupancy(OLD.unit_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_mark_reservado ON apartcba.bookings;
DROP FUNCTION IF EXISTS apartcba.tg_bookings_mark_reservado();

DROP TRIGGER IF EXISTS trg_bookings_refresh_unit_occupancy ON apartcba.bookings;
CREATE TRIGGER trg_bookings_refresh_unit_occupancy
  AFTER INSERT OR UPDATE OR DELETE ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_bookings_refresh_unit_occupancy();

commit;

-- ─── El paso del día (aplicar a mano en el SQL editor, como los de la 010) ──
-- 03:05 UTC = 00:05 en Córdoba.
-- Aplicado en prod el 18/11/2026 (cron job 9); el refresh de una vez corrigió
-- 28 unidades.
--
-- SELECT cron.schedule(
--   'apartcba_unit_occupancy_nightly',
--   '5 3 * * *',
--   $$SELECT apartcba.refresh_all_units_occupancy()$$
-- );
--
-- Y una vez, para corregir lo que ya estaba mal:
-- SELECT apartcba.refresh_all_units_occupancy();
