/**
 * Etiquetas y ayudas de las herramientas de lectura de Tex (nov-2026). Puro y
 * client-safe: lo usan las herramientas y el buscador global
 * (src/lib/actions/global-search.ts).
 *
 * Las etiquetas se repiten acá a propósito: las de Caja viven en componentes
 * "use client" y un string de un módulo de cliente no sirve en el servidor.
 */
import { BOOKING_SOURCE_META, BOOKING_STATUS_META, TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { dayRangeInTz, ymdInTz } from "@/lib/dates";
import type { CardTone } from "../../types";
import { dateRange } from "../../format";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST devuelve `numeric` como string: siempre un número finito. */
export function num(x: unknown): number {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : 0;
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Reservas ─────────────────────────────────────────────────────────────────

export const BOOKING_STATUSES = ["pendiente", "confirmada", "check_in", "check_out", "cancelada", "no_show"] as const;

export function bookingStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return BOOKING_STATUS_META[status as keyof typeof BOOKING_STATUS_META]?.label ?? status;
}

export function bookingStatusTone(status: string | null | undefined): CardTone {
  switch (status) {
    case "pendiente":
      return "warn";
    case "confirmada":
      return "good";
    case "check_in":
      return "info";
    case "cancelada":
    case "no_show":
      return "bad";
    default:
      return "neutral";
  }
}

/** Lo cancelado y el no-show no ocupan ni se cobran. */
export function isDeadBooking(status: string | null | undefined): boolean {
  return status === "cancelada" || status === "no_show";
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  return BOOKING_SOURCE_META[source as keyof typeof BOOKING_SOURCE_META]?.label ?? source;
}

/** "SAL525 · Salta 525" (o lo que haya). */
export function unitLabel(u: { code?: string | null; name?: string | null } | null | undefined): string {
  if (!u) return "Sin unidad";
  return [u.code, u.name].filter((s) => s && String(s).trim()).join(" · ") || "Sin unidad";
}

/** "14 al 18 nov", con el año si no es el de hoy. */
export function stayLabel(fromYmd: string, toYmd: string, todayYmd: string): string {
  if (!fromYmd || !toYmd) return "—";
  const base = dateRange(fromYmd.slice(0, 10), toYmd.slice(0, 10));
  const y = toYmd.slice(0, 4);
  return y !== todayYmd.slice(0, 4) ? `${base} ${y}` : base;
}

// ── Fechas ───────────────────────────────────────────────────────────────────

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "noviembre 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** Día local (`YYYY-MM-DD`) de un timestamptz en la zona de la organización. */
export function localYmd(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ymdInTz(d, tz);
}

/** "14:30" de un timestamptz en la zona de la organización. */
export function localTime(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/**
 * Del primer instante de `fromYmd` al último de `toYmd` (los dos días
 * incluidos) en la zona de la organización, en ISO-UTC: para filtrar columnas
 * timestamptz que se comparan con `gte`/`lte`.
 */
export function tzRangeIso(fromYmd: string, toYmd: string, tz: string): { fromIso: string; toIso: string } {
  const fromIso = dayRangeInTz(fromYmd, tz).startIso;
  const endIso = dayRangeInTz(toYmd, tz).endIso;
  return { fromIso, toIso: new Date(Date.parse(endIso) - 1).toISOString() };
}

// ── Caja ─────────────────────────────────────────────────────────────────────

export const CASH_CATEGORY_LABEL: Record<string, string> = {
  booking_payment: "Cobro de reserva",
  extra_charge: "Cobro extra",
  refund: "Devolución",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación a propietario",
  transfer: "Transferencia entre cuentas",
  adjustment: "Ajuste",
  salary: "Sueldos",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  rent_collection: "Cobro de alquiler",
  rent_owner_payout: "Rendición a propietario",
  security_deposit: "Depósito en garantía",
  agency_fee: "Honorarios inmobiliarios",
  other: "Otro",
};

export function cashCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Otro";
  return CASH_CATEGORY_LABEL[category] ?? category;
}

// ── Liquidaciones ────────────────────────────────────────────────────────────

export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador",
  revisada: "Revisada",
  enviada: "Enviada",
  pagada: "Pagada",
  disputada: "En disputa",
  anulada: "Anulada",
};

export function settlementStatusTone(status: string): CardTone {
  if (status === "pagada") return "good";
  if (status === "disputada" || status === "anulada") return "bad";
  if (status === "revisada" || status === "enviada") return "info";
  return "neutral";
}

// ── Mantenimiento y tareas ───────────────────────────────────────────────────

export function ticketStatusLabel(status: string): string {
  return TICKET_STATUS_META[status as keyof typeof TICKET_STATUS_META]?.label ?? status;
}

export function ticketPriorityLabel(priority: string): string {
  return TICKET_PRIORITY_META[priority as keyof typeof TICKET_PRIORITY_META]?.label ?? priority;
}

export function priorityWeight(priority: string | null | undefined): number {
  switch (priority) {
    case "urgente":
      return 4;
    case "alta":
      return 3;
    case "media":
    case "normal":
      return 2;
    default:
      return 1;
  }
}

export function priorityTone(priority: string | null | undefined): CardTone {
  if (priority === "urgente") return "bad";
  if (priority === "alta") return "warn";
  if (priority === "media" || priority === "normal") return "info";
  return "neutral";
}

/** Pluraliza con el número adelante: "1 reserva", "3 reservas". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
