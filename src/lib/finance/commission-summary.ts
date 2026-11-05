/**
 * Cómo se le cuenta a una persona qué comisión de administración rige.
 *
 * Habitana (05/11/2026): a una unidad nueva se le cargó el acuerdo con la dueña en
 * 100 %, seguramente confundido con el "% de propiedad", que está justo arriba. La
 * ficha seguía diciendo "0 %" y el formulario "manda la de la unidad": las dos cosas
 * eran falsas, porque rige la cascada de `resolveCommissionPct`. Cecilia veía la
 * liquidación en 100 %, buscaba el 100 y no lo encontraba en ninguna parte.
 *
 * Toda pantalla que muestre "la comisión" sale de acá: la de la unidad sola casi
 * nunca es la que se termina cobrando.
 */

import { BOOKING_SOURCE_META } from "@/lib/constants";
import { resolveCommissionPct } from "@/lib/finance/booking-economics";
import type { BookingSource } from "@/lib/types/database";

/** Desde acá un acuerdo con un propietario pide confirmación. Nadie cobra tanto de verdad. */
const HIGH_OWNER_COMMISSION_PCT = 50;

export function formatCommissionPct(pct: number): string {
  return `${Number(pct).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}

/** La que rige sin acuerdo con el propietario: "Directo 27,5% · Booking 20% · otros canales 0%". */
export function commissionSummary(input: {
  bySource?: Partial<Record<string, number>> | null;
  unitPct?: number | null;
  orgPct?: number | null;
}): string {
  const rest = resolveCommissionPct({ unitPct: input.unitPct, orgPct: input.orgPct }).pct;
  const channels = (Object.keys(BOOKING_SOURCE_META) as BookingSource[]).flatMap((source) => {
    const raw = input.bySource?.[source];
    if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return [];
    return [`${BOOKING_SOURCE_META[source].label} ${formatCommissionPct(Number(raw))}`];
  });
  if (channels.length === 0) return formatCommissionPct(rest);
  return `${channels.join(" · ")} · otros canales ${formatCommissionPct(rest)}`;
}

/** Lo que rige en una unidad, contando los acuerdos con cada propietario, que mandan. */
export function unitCommissionLabel(input: {
  owners: { name: string; override: number | null | undefined }[];
  summary: string;
}): string {
  const agreed = input.owners.filter((o) => o.override !== null && o.override !== undefined);
  if (agreed.length === 0) return input.summary;
  const parts = agreed.map(
    (o) => `${formatCommissionPct(Number(o.override))} (acordada con ${o.name.trim()})`,
  );
  // Con co-propietarios, el que no tiene acuerdo sigue con la normal.
  if (agreed.length < input.owners.length) parts.push(`los demás: ${input.summary}`);
  return parts.join(" · ");
}

/** Lo tipeado en el campo de acuerdo. Vacío = sin acuerdo, rige la comisión normal. */
export function parseOwnerCommission(
  raw: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) return { ok: false };
  return { ok: true, value };
}

/** `null` = nada que avisar. Si no, hay que confirmar antes de guardar. */
export function ownerCommissionWarning(pct: number | null): string | null {
  if (pct === null || pct < HIGH_OWNER_COMMISSION_PCT) return null;
  const owner =
    pct >= 100
      ? "el propietario no cobra nada de sus reservas"
      : `el propietario cobra sólo el ${formatCommissionPct(100 - pct)} de sus reservas`;
  return `Con ${formatCommissionPct(pct)}, ${owner}. Si querías decir que es dueño del 100%, eso va en «% de propiedad» y este campo queda vacío.`;
}
