-- 067b — "Reserva asegurada" una sola vez.
--
-- Cuando lo cobrado en Caja cubre la seña de una reserva que vino de la web,
-- se le avisa al huésped que su reserva quedó asegurada. Ese aviso puede
-- dispararse desde dos lugares (registrar el cobro en Caja, o marcar como
-- registrado su "Ya transferí"), así que se reclama con un update condicional
-- sobre esta marca: el primero que la pone manda el mail, el resto no.
-- Aditiva: el código que corre hoy la ignora.

alter table apartcba.booking_requests
  add column if not exists deposit_secured_at timestamptz;

comment on column apartcba.booking_requests.deposit_secured_at is
  'Cuándo se le avisó al huésped que la seña quedó cubierta (reserva asegurada). Se reclama una sola vez con update condicional.';
