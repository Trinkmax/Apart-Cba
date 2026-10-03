import { addDays } from "./ymd";

/**
 * Salida de un contrato vigente: hasta cuándo ocupa la propiedad, cómo se
 * corta cuando lo sigue una renovación y qué queda sin cobrar si venció.
 * Puro: lo usan el servidor, la agenda y los diálogos.
 */

export interface OccupancyInput {
  start_date: string;
  end_date: string;
  terminated_at?: string | null;
  continuation_billing?: boolean | null;
}

/**
 * Último día en que el contrato ocupa la propiedad (null = sin fin). Es la
 * misma cuenta que hace la base para que dos contratos vigentes no se pisen
 * (rental_contracts_no_overlap, 068i):
 *   - con la salida registrada (rescisión notificada, entrega programada o el
 *     corte por una renovación), hasta ese día, antes o después del fin;
 *   - vencido y cobrando la continuación (art. 1218), sin fin: sigue adentro
 *     hasta que alguien registre la salida;
 *   - si no, hasta la fecha de fin.
 */
export function occupancyEnd(c: OccupancyInput): string | null {
  if (c.terminated_at) return c.terminated_at < c.start_date ? c.start_date : c.terminated_at;
  if (c.continuation_billing) return null;
  return c.end_date;
}

/** Dos rangos de días con los extremos incluidos (null = sin fin) comparten al menos un día. */
export function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  return (bEnd === null || aStart <= bEnd) && (aEnd === null || bStart <= aEnd);
}

/** Primer contrato de la lista (otro que `selfId`) que ocupa algún día de [start, end]. */
export function findOccupancyConflict<T extends OccupancyInput & { id: string }>(
  others: T[],
  range: { selfId?: string | null; start: string; end: string | null },
): T | null {
  for (const o of others) {
    if (o.id === range.selfId) continue;
    if (rangesOverlap(range.start, range.end, o.start_date, occupancyEnd(o))) return o;
  }
  return null;
}

// ─── Renovación ─────────────────────────────────────────────────────────────

/**
 * La renovación arranca, a más tardar, el día siguiente a la salida: el
 * inquilino no se va, sigue con el contrato nuevo. Esa salida no lleva lo de
 * una mudanza (cargo de gastos pendientes, depósito "a devolver").
 */
export function isRenewalHandover(exitDate: string, renewalStart: string): boolean {
  return renewalStart <= addDays(exitDate, 1);
}

export type RenewalCut =
  /** El anterior ya termina antes de que empiece la renovación: no se toca. */
  | { kind: "none" }
  /** Se le registra la salida el día anterior al inicio de la renovación. */
  | { kind: "cut"; cutDate: string }
  /** Ya tiene otra salida registrada que pisa la renovación: la decide una persona. */
  | { kind: "exit_after_start"; exitDate: string; rescission: boolean }
  /** La renovación empieza antes que el contrato anterior. */
  | { kind: "starts_before" };

/**
 * Qué hacer con el contrato anterior al activar su renovación: dos contratos
 * vigentes no pueden ocupar el mismo día, y los meses desde que rige la
 * renovación los cobra ella (no los dos).
 */
export function planRenewalCut(
  previous: OccupancyInput & { status: string; termination_notice_date?: string | null },
  renewalStart: string,
): RenewalCut {
  if (previous.status !== "vigente") return { kind: "none" };
  const cutDate = addDays(renewalStart, -1);
  if (cutDate < previous.start_date) return { kind: "starts_before" };
  if (previous.terminated_at) {
    if (previous.terminated_at <= cutDate) return { kind: "none" };
    return { kind: "exit_after_start", exitDate: previous.terminated_at, rescission: Boolean(previous.termination_notice_date) };
  }
  const end = occupancyEnd(previous);
  if (end !== null && end <= cutDate) return { kind: "none" };
  return { kind: "cut", cutDate };
}

// ─── Continuación y salida ──────────────────────────────────────────────────

/**
 * Vencido, sin cobrar la continuación y con la salida después del fin: los
 * meses desde el vencimiento hasta la salida no se están facturando.
 */
export function continuationGap(
  c: { status: string; end_date: string; continuation_billing?: boolean | null },
  exitDate: string | null,
  today: string,
): boolean {
  if (c.status !== "vigente" || c.continuation_billing || c.end_date >= today) return false;
  return exitDate === null || exitDate > c.end_date;
}

/** Un ajuste que rige después de la salida registrada no se aplica ni se avisa: el inquilino ya no está. */
export function takesEffectAfterExit(effectiveDate: string, terminatedAt: string | null | undefined): boolean {
  return Boolean(terminatedAt) && effectiveDate > (terminatedAt as string);
}

/** La salida registrada ya pasó y el contrato sigue abierto (falló el cierre automático o nadie lo cerró). */
export function exitOverdue(c: { status: string; terminated_at?: string | null }, today: string): boolean {
  return c.status === "vigente" && Boolean(c.terminated_at) && (c.terminated_at as string) < today;
}
