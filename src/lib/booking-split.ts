// Single source of truth para el split de reservas largas.
// Regla: ninguna reserva puede exceder MAX_BOOKING_NIGHTS noches. Si el rango
// pedido excede el cap, se parte en N segmentos consecutivos de MAX noches +
// un último segmento con el remanente.
//
// Aplica a CUALQUIER modo (temporario, mensual, etc.). El consumidor decide qué
// hacer con cada segmento (cleaning_fee solo en el último, seña solo en el
// primero, payment_schedule solo si es mensual, etc.).

export const MAX_BOOKING_NIGHTS = 30;

export interface LeaseSegment {
  from: string;
  to: string;
  nights: number;
  isLast: boolean;
}

export function nightsBetween(checkInISO: string, checkOutISO: string): number {
  if (!checkInISO || !checkOutISO || checkOutISO <= checkInISO) return 0;
  const ci = new Date(checkInISO + "T12:00:00").getTime();
  const co = new Date(checkOutISO + "T12:00:00").getTime();
  return Math.round((co - ci) / 86_400_000);
}

function addNights(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Divide [checkIn, checkOut) en segmentos consecutivos de a lo sumo
 * `maxNights` noches. El último segmento contiene el remanente.
 *
 * Si el rango total <= maxNights → retorna [] (no hay split, una sola reserva).
 *
 * Ejemplos con maxNights=30:
 *   32 noches → [{30n}, {2n, isLast}]
 *   60 noches → [{30n}, {30n, isLast}]
 *   75 noches → [{30n}, {30n}, {15n, isLast}]
 *
 * Garantías:
 *   - segments[i].to === segments[i+1].from (sin huecos ni overlaps)
 *   - sum(nights) === nightsBetween(checkIn, checkOut)
 *   - el primero arranca exactamente en checkIn
 *   - el último termina exactamente en checkOut
 */
export function splitBookingSegments(
  checkIn: string,
  checkOut: string,
  maxNights: number = MAX_BOOKING_NIGHTS
): LeaseSegment[] {
  const total = nightsBetween(checkIn, checkOut);
  if (total <= maxNights) return [];
  if (maxNights < 1) return [];

  const fullChunks = Math.floor(total / maxNights);
  const remainder = total - fullChunks * maxNights;

  const segments: LeaseSegment[] = [];
  let cursor = checkIn;

  for (let i = 0; i < fullChunks; i++) {
    const next = addNights(cursor, maxNights);
    const isLast = remainder === 0 && i === fullChunks - 1;
    segments.push({
      from: cursor,
      to: isLast ? checkOut : next,
      nights: maxNights,
      isLast,
    });
    cursor = next;
  }

  if (remainder > 0) {
    segments.push({
      from: cursor,
      to: checkOut,
      nights: remainder,
      isLast: true,
    });
  }

  return segments;
}
