-- ════════════════════════════════════════════════════════════════════════════
-- 073 · Liquidaciones: armar una desde cero ("en blanco")
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido (09/10/2026): "generar una liquidación desde 0: buscar el propietario
-- o la unidad y cargar yo los datos, que impacte en Caja como todas las otras"
-- (la primera: ALCORTA2).
--
-- Una liquidación en blanco nace vacía y se carga a mano con lo que ya existía
-- en el editor («Agregar reserva», «Agregar cargo»). Lo único nuevo que
-- necesita la base es saber que ES manual: «Regenerar» y «Generar todas»
-- conservan las filas cargadas a mano pero le SUMAN las reservas del sistema
-- (persistSettlement), así que en una manual duplicarían lo que la persona ya
-- tipeó. Con `origin = 'manual'` el servidor se niega a regenerarla.
--
-- Todo lo demás es igual que en cualquier liquidación: estados, envío, PDF,
-- «Registrar pago» → egreso en Caja, «Anular el pago», deshacer/rehacer
-- (settlement_restore_snapshot sólo restaura columnas puntuales del
-- encabezado; esta no la toca).
-- ════════════════════════════════════════════════════════════════════════════

alter table apartcba.owner_settlements
  add column if not exists origin text not null default 'auto';

alter table apartcba.owner_settlements
  drop constraint if exists owner_settlements_origin_check;
alter table apartcba.owner_settlements
  add constraint owner_settlements_origin_check check (origin in ('auto', 'manual'));

comment on column apartcba.owner_settlements.origin is
  'auto = la arma el sistema con las reservas/tickets/gastos del período (Generar, Regenerar, Generar todas). manual = se creó en blanco y se carga a mano: nunca se regenera. Migración 073.';
