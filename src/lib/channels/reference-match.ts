/**
 * A qué reserva le toca el número de un aviso «¡Nueva reserva!» de Booking.
 *
 * El iCal de Booking identifica cada reserva por su UID y nunca trae el número;
 * el aviso por mail trae el número y la fecha de llegada, nunca el UID. Hasta el
 * 19/11/2026 el cruce era «la única reserva sin número que llega ese día», en
 * toda la organización. Con 9 departamentos conectados en Apart CBA, dos
 * reservas con la misma llegada son cosa de todas las semanas, y el número
 * terminaba pegado a una reserva VIEJA de otro departamento:
 *
 *   · 18/11, 00:12 — aviso 5636765091 (llegada 4/12). La reserva nueva era de
 *     VEL727 (su fila nació a las 00:14); el número fue a parar a la de DIVA,
 *     cargada en septiembre. Cuando el huésped de VEL727 canceló, el mail de
 *     cancelación señaló a DIVA y una persona, confiando en el aviso, canceló
 *     una reserva que seguía en pie.
 *   · 12/11 — aviso 5250496143 (llegada 21/11), de ROMA. Fue a una fila de
 *     BRASIL que resultó estar vinculada a una reserva DIRECTA con $300.000
 *     cobrados. Se canceló y el departamento se volvió a vender.
 *
 * Medido sobre 75 días (47 avisos): 11 números quedaron en la reserva
 * equivocada. En cambio, en los 41 avisos que tenían su reserva en el sistema,
 * la fila nació entre 20 segundos ANTES y 5,6 minutos DESPUÉS del mail, y nunca
 * hubo dos candidatas en esa ventana. El aviso sale cuando la reserva se hace,
 * así que la reserva que le corresponde es la que aparece en ese momento, no
 * una que ya estaba.
 *
 * Sin candidata en la ventana el número no se pega en ningún lado. Un número
 * que falta no rompe nada (la cancelación abre un aviso para que la mire una
 * persona); uno mal puesto cancela la reserva de otro.
 */

/** La fila pudo nacer hasta esto ANTES del aviso (un mail reenviado con demora). */
export const ROW_BEFORE_NOTICE_MS = 20 * 60_000;
/** …o hasta esto DESPUÉS (el feed de la OTA tarda en publicarla). */
export const ROW_AFTER_NOTICE_MS = 90 * 60_000;

/** ¿La fila nació cuando llegó el aviso? */
export function bornNearNotice(rowCreatedAt: string, noticeAt: string): boolean {
  const row = Date.parse(rowCreatedAt);
  const notice = Date.parse(noticeAt);
  if (Number.isNaN(row) || Number.isNaN(notice)) return false;
  return row >= notice - ROW_BEFORE_NOTICE_MS && row <= notice + ROW_AFTER_NOTICE_MS;
}

export interface NoticeCandidate {
  id: string;
  check_in: string | null;
  confirmation_code: string | null;
  external_status: string;
  created_at: string;
}

const STAMPABLE = new Set(["active", "pending", "expired"]);

/**
 * La reserva a la que le toca el número de un aviso, entre las que llegan ese
 * día. Con dos candidatas nacidas en la ventana no se elige ninguna, salvo que
 * sólo una siga viva (una solicitud descartada no le saca el número a la otra).
 */
export function pickReservationForNotice<T extends NoticeCandidate>(
  rows: T[],
  notice: { checkIn: string; receivedAt: string },
): T | null {
  const near = rows.filter(
    (r) =>
      r.check_in === notice.checkIn &&
      !r.confirmation_code &&
      STAMPABLE.has(r.external_status) &&
      bornNearNotice(r.created_at, notice.receivedAt),
  );
  if (near.length === 1) return near[0];
  const live = near.filter((r) => r.external_status !== "expired");
  return live.length === 1 ? live[0] : null;
}

export interface StoredNotice {
  code: string;
  receivedAt: string;
}

/**
 * El número que le toca a una reserva, entre los avisos guardados para su
 * fecha de llegada: el único que llegó cuando ella nació y que todavía no está
 * en otra reserva. Con dos, no se adivina.
 */
export function pickNoticeForReservation(
  notices: StoredNotice[],
  row: { created_at: string },
  takenCodes: ReadonlySet<string>,
): string | null {
  const codes = new Set<string>();
  for (const n of notices) {
    if (!n.code || takenCodes.has(n.code)) continue;
    if (bornNearNotice(row.created_at, n.receivedAt)) codes.add(n.code);
  }
  return codes.size === 1 ? [...codes][0] : null;
}
