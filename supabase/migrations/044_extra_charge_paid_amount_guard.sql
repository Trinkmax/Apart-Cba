-- ════════════════════════════════════════════════════════════════════════════
-- 044 — Los cobros extra (category='extra_charge') NO deben mover paid_amount.
--
-- addBookingExtraCharge inserta el cobro extra como un movimiento
-- ref_type='booking' (para que aparezca en el historial de pagos de la reserva)
-- pero con category='extra_charge'. La inserción NO toca paid_amount — correcto.
-- El problema: update_cash_movement / delete_cash_movement sincronizan
-- bookings.paid_amount para CUALQUIER movimiento ref_type='booking', sin mirar
-- la categoría. Entonces editar/eliminar un cobro extra desde Caja desincroniza
-- el paid_amount de la reserva (saldo fantasma / sobrepago fantasma).
--
-- Fix quirúrgico: excluir category='extra_charge' del sync de paid_amount en
-- ambas RPCs. 'refund' y 'booking_payment' (ref_type='booking') siguen
-- sincronizando como antes. Se hace por reemplazo de string sobre la definición
-- viva (robusto ante el drift de los archivos 007/019 vs. prod).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  def text;
  needle text := 'ELSIF v_mov.ref_type = ''booking'' THEN';
  repl  text := 'ELSIF v_mov.ref_type = ''booking'' AND v_mov.category <> ''extra_charge'' THEN';
BEGIN
  -- update_cash_movement
  SELECT pg_get_functiondef(oid) INTO def
  FROM pg_proc
  WHERE proname = 'update_cash_movement'
    AND pronamespace = 'apartcba'::regnamespace;
  IF def IS NULL THEN
    RAISE EXCEPTION 'update_cash_movement no encontrada';
  END IF;
  IF position(needle IN def) = 0 THEN
    RAISE EXCEPTION 'patrón ref_type=booking no encontrado en update_cash_movement (ya parcheado?)';
  END IF;
  EXECUTE replace(def, needle, repl);

  -- delete_cash_movement
  SELECT pg_get_functiondef(oid) INTO def
  FROM pg_proc
  WHERE proname = 'delete_cash_movement'
    AND pronamespace = 'apartcba'::regnamespace;
  IF def IS NULL THEN
    RAISE EXCEPTION 'delete_cash_movement no encontrada';
  END IF;
  IF position(needle IN def) = 0 THEN
    RAISE EXCEPTION 'patrón ref_type=booking no encontrado en delete_cash_movement (ya parcheado?)';
  END IF;
  EXECUTE replace(def, needle, repl);
END $$;
