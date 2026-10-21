import { renderTemplate } from "./render";
import { effectiveSena, fmtLong, moneyMsg } from "./booking-confirmation";
import { extractVariablesFromBody } from "./templates/variables";

/**
 * Mensajes al huésped armados con una plantilla de la org (Configuración →
 * Comunicaciones): la confirmación que se copia desde la reserva y el
 * instructivo. Pieza pura —sin DB— para que la use igual la ficha de la
 * reserva (cliente, con la seña en vivo), el borrador del mail de
 * confirmación (servidor) y la vista previa del editor.
 */

export interface BookingMessageSource {
  booking: {
    check_in_date: string;
    check_out_date: string;
    check_in_time?: string | null;
    check_out_time?: string | null;
    guests_count?: number | null;
    total_amount?: number | string | null;
    paid_amount?: number | string | null;
    deposit_amount?: number | string | null;
    security_deposit?: number | string | null;
    currency?: string | null;
    mode?: string | null;
  };
  guest?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  unit?: {
    name?: string | null;
    code?: string | null;
    address?: string | null;
    marketplace_title?: string | null;
    guest_maps_url?: string | null;
    guest_instructions?: string | null;
  } | null;
  org?: {
    name?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    address?: string | null;
  } | null;
}

// `type` y no `interface`: renderTemplate pide Record<string, unknown> y una
// interface no tiene firma de índice implícita.
export type BookingMessageVariables = {
  guest: { full_name: string; first_name: string; email: string; phone: string };
  org: { name: string; contact_phone: string; contact_email: string; address: string };
  unit: { name: string; code: string; address: string; maps_url: string; instructions: string };
  booking: {
    check_in_date: string;
    check_in_date_iso: string;
    check_in_time: string;
    check_out_date: string;
    check_out_date_iso: string;
    check_out_time: string;
    nights: number;
    guests_count: number;
    guests: string;
    total_amount: string;
    total_amount_raw: string;
    currency: string;
    balance_due: string;
    deposit_amount: string;
    deposit_amount_raw: string;
    remaining_after_deposit: string;
    security_deposit: string;
    security_deposit_raw: string;
    mode: string;
    payment_link: string;
  };
};

/** Lo que dice la seña (y el restante) cuando no hay seña. */
const SIN_SENA = "a coordinar";

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function text(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** "14:00:00" → "14:00". */
function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

export function nightsBetweenIso(ciIso: string, coIso: string): number {
  const ci = new Date(ciIso + "T12:00:00").getTime();
  const co = new Date(coIso + "T12:00:00").getTime();
  return Math.max(1, Math.round((co - ci) / 86_400_000));
}

export function bookingMessageVariables(src: BookingMessageSource): BookingMessageVariables {
  const b = src.booking;
  const currency = text(b.currency) || "ARS";
  const total = num(b.total_amount);
  const paid = num(b.paid_amount);
  const nights = nightsBetweenIso(b.check_in_date, b.check_out_date);
  const guestsCount = num(b.guests_count) || 1;
  const fullName = text(src.guest?.full_name);
  // Misma seña que el mensaje original: la informada → lo cobrado → 1 noche.
  const sena = effectiveSena(
    b.deposit_amount != null ? num(b.deposit_amount) : null,
    paid,
    Math.round(total / nights),
  );
  const securityDeposit = num(b.security_deposit);

  const vars: BookingMessageVariables = {
    guest: {
      full_name: fullName,
      first_name: fullName.split(/\s+/)[0] ?? "",
      email: text(src.guest?.email),
      phone: text(src.guest?.phone),
    },
    org: {
      name: text(src.org?.name),
      contact_phone: text(src.org?.contact_phone),
      contact_email: text(src.org?.contact_email),
      address: text(src.org?.address),
    },
    unit: {
      // El nombre que ve el huésped: el título de la web si lo tiene, como
      // el mensaje original.
      name: text(src.unit?.marketplace_title) || text(src.unit?.name),
      code: text(src.unit?.code),
      address: text(src.unit?.address),
      maps_url: text(src.unit?.guest_maps_url),
      instructions: text(src.unit?.guest_instructions),
    },
    booking: {
      check_in_date: fmtLong(b.check_in_date).toLowerCase(),
      check_in_date_iso: b.check_in_date,
      check_in_time: hhmm(b.check_in_time),
      check_out_date: fmtLong(b.check_out_date).toLowerCase(),
      check_out_date_iso: b.check_out_date,
      check_out_time: hhmm(b.check_out_time),
      nights,
      guests_count: guestsCount,
      guests: `${guestsCount} ${guestsCount === 1 ? "persona" : "personas"}`,
      total_amount: moneyMsg(total, currency),
      total_amount_raw: String(total),
      currency,
      balance_due: moneyMsg(Math.max(0, total - paid), currency),
      deposit_amount: SIN_SENA,
      deposit_amount_raw: "",
      remaining_after_deposit: SIN_SENA,
      security_deposit: securityDeposit > 0 ? moneyMsg(securityDeposit, currency) : "",
      security_deposit_raw: securityDeposit > 0 ? String(securityDeposit) : "",
      mode: text(b.mode) || "temporario",
      payment_link: "",
    },
  };
  return withDeposit(vars, sena, total);
}

/**
 * Reemplaza la seña (y el restante) por otra: la ficha de la reserva la
 * recalcula en vivo mientras se tipea la seña a informar.
 */
export function withDeposit(
  vars: BookingMessageVariables,
  sena: number | null,
  total: number,
): BookingMessageVariables {
  const currency = vars.booking.currency;
  const hay = sena != null && sena > 0;
  return {
    ...vars,
    booking: {
      ...vars.booking,
      deposit_amount: hay ? moneyMsg(sena, currency) : SIN_SENA,
      deposit_amount_raw: hay ? String(sena) : "",
      remaining_after_deposit: hay ? moneyMsg(Math.max(0, total - sena), currency) : SIN_SENA,
    },
  };
}

/**
 * Completa la plantilla. Un dato vacío que ocupaba su propia línea (el
 * instructivo de un depto que todavía no lo tiene) dejaría un hueco doble:
 * se colapsa a una sola línea en blanco.
 */
export function renderGuestMessage(body: string, vars: BookingMessageVariables): string {
  return renderTemplate(body, vars)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ¿La plantilla muestra la seña? Si no, la ficha no ofrece cargarla. */
export function templateUsesDeposit(body: string): boolean {
  return extractVariablesFromBody(body).some(
    (v) => v.startsWith("booking.deposit_amount") || v === "booking.remaining_after_deposit",
  );
}

const UNIT_FIELDS: readonly { key: keyof BookingMessageVariables["unit"]; label: string }[] = [
  { key: "address", label: "la dirección" },
  { key: "maps_url", label: "el link de Google Maps" },
  { key: "instructions", label: "el instructivo" },
];

/**
 * Datos del depto que la plantilla usa y este depto no tiene cargados: el
 * mensaje saldría con el renglón vacío, así que la ficha lo avisa.
 */
export function missingUnitFields(body: string, vars: BookingMessageVariables): string[] {
  const used = new Set(extractVariablesFromBody(body));
  return UNIT_FIELDS.filter((f) => used.has(`unit.${f.key}`) && !vars.unit[f.key]).map(
    (f) => f.label,
  );
}

/** Datos de ejemplo para la vista previa cuando la org no tiene reservas. */
export function sampleMessageVariables(orgName: string): BookingMessageVariables {
  return bookingMessageVariables({
    booking: {
      check_in_date: "2026-11-12",
      check_out_date: "2026-11-16",
      check_in_time: "14:00",
      check_out_time: "10:00",
      guests_count: 2,
      total_amount: 240000,
      paid_amount: 60000,
      currency: "ARS",
    },
    guest: { full_name: "María González", phone: "+54 9 351 555-1234" },
    unit: {
      name: "Depto 3B",
      code: "3B",
      address: "Av. Colón 123, Córdoba",
      guest_maps_url: "https://maps.app.goo.gl/ejemplo",
      guest_instructions: "Piso 3, depto B. Las llaves te las entregamos en la puerta.\nWifi: Depto3B · Clave: bienvenidos",
    },
    org: { name: orgName },
  });
}
