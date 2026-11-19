/**
 * Lo que contradice una propuesta de cancelación, dicho antes de que alguien
 * apriete «Cancelar la reserva».
 *
 * La propuesta la decide una persona, pero la persona le cree al aviso. Las dos
 * veces que se canceló una reserva que seguía en pie (BRASIL el 14/11/2026,
 * DIVA el 19/11/2026) el sistema tenía a la vista el dato que lo desmentía y
 * no lo mostró:
 *
 *  · DIVA — el mail de cancelación era de otra reserva, y Booking seguía
 *    publicando la de DIVA en su calendario 20 horas después. Una reserva que
 *    de verdad se canceló sale del calendario en minutos.
 *  · BRASIL — la reserva era DIRECTA, cargada a mano. Booking sólo tenía
 *    cerradas esas fechas; que dejara de mostrarlas no decía nada del huésped.
 *
 * Puro: quien lista las propuestas junta los hechos y esto arma las frases.
 */

/** Cuánto después del aviso tiene que seguir publicada para que contradiga. */
export const STILL_PUBLISHED_AFTER_MS = 20 * 60_000;

export interface DoubtFacts {
  channel: string;
  reasonCode: "missing_from_feed" | "ota_cancellation_email";
  /** Cuándo se abrió la propuesta. */
  requestedAt: string;
  /** Origen de la reserva local (`directo`, `airbnb`, `booking`…). */
  bookingSource?: string | null;
  /** La reserva local la cargó una persona. */
  handLoaded?: boolean;
  /** La fila de canal a la que apunta, si existe. */
  reservation?: {
    last_seen_at: string | null;
    missing_since: string | null;
  } | null;
}

export function cancellationDoubts(facts: DoubtFacts, now: Date = new Date()): string[] {
  const canal = channelName(facts.channel);
  const doubts: string[] = [];

  const r = facts.reservation;
  if (r && !r.missing_since && r.last_seen_at) {
    const seen = Date.parse(r.last_seen_at);
    const asked = Date.parse(facts.requestedAt);
    if (!Number.isNaN(seen) && !Number.isNaN(asked) && seen - asked >= STILL_PUBLISHED_AFTER_MS) {
      doubts.push(
        facts.reasonCode === "ota_cancellation_email"
          ? `${canal} la sigue mostrando en su calendario (${ago(seen, now)}). Una reserva cancelada sale del calendario en minutos: puede que el mail sea de otra reserva.`
          : `Volvió a aparecer en el calendario de ${canal} (${ago(seen, now)}).`,
      );
    }
  }

  if (facts.handLoaded && facts.bookingSource && facts.bookingSource !== facts.channel) {
    const origen =
      facts.bookingSource === "directo"
        ? "como directa"
        : `con origen ${channelName(facts.bookingSource)}`;
    doubts.push(
      `Esta reserva la cargaron ustedes ${origen}: no entró por ${canal}. El aviso puede ser de otra reserva.`,
    );
  }

  return doubts;
}

function channelName(c: string): string {
  return c === "airbnb" ? "Airbnb" : c === "booking" ? "Booking" : c;
}

function ago(at: number, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at) / 60_000));
  if (min < 2) return "recién";
  if (min < 90) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 36 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}
