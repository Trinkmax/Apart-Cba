import { INDEX_META, indexFrequency, isIndexCode, type IndexCode } from "@/lib/rentals/indices";
import { addMonthsToMonth, isYmd, monthsBetween } from "@/lib/rentals/ymd";
import type { RentalAdjustmentMethod } from "@/lib/types/database";

/**
 * Textos de los ajustes (puros, sin red ni base): la línea del método que se
 * ve en cada tarjeta, los meses que usa el índice, la variación en es-AR y el
 * aviso al inquilino (mail y WhatsApp). Los usan las tarjetas de /ajustes, la
 * sección del contrato, la calculadora y el mail — así todos dicen lo mismo.
 */

const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthIdx(ymd: string): number {
  return Number(ymd.slice(5, 7)) - 1;
}

/** "trimestral", "cuatrimestral"… o "cada 5 meses". */
export function frequencyLabel(every: number | null | undefined): string {
  switch (every) {
    case 1:
      return "mensual";
    case 2:
      return "bimestral";
    case 3:
      return "trimestral";
    case 4:
      return "cuatrimestral";
    case 6:
      return "semestral";
    case 12:
      return "anual";
    default:
      return every && every > 0 ? `cada ${every} meses` : "sin ajuste";
  }
}

/** "1 de diciembre de 2026". */
export function longDate(ymd: string): string {
  if (!isYmd(ymd)) return ymd;
  return `${Number(ymd.slice(8, 10))} de ${MONTHS_LONG[monthIdx(ymd)]} de ${ymd.slice(0, 4)}`;
}

/** "01/12/2026". */
export function shortDate(ymd: string): string {
  if (!isYmd(ymd)) return ymd;
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/** "septiembre" / "septiembre de 2026" (con año). */
export function monthName(monthKey: string, withYear = false): string {
  const name = MONTHS_LONG[monthIdx(monthKey)] ?? "?";
  return withYear ? `${name} de ${monthKey.slice(0, 4)}` : name;
}

/**
 * Meses que entran en la variación de un índice mensual: del mes siguiente al
 * base hasta el de llegada (base enero, llegada abril → feb, mar, abr).
 */
export function monthsUsed(fromKey: string, toKey: string): string[] {
  const n = monthsBetween(fromKey, toKey);
  if (!(n > 0) || n > 36) return [];
  return Array.from({ length: n }, (_, i) => addMonthsToMonth(fromKey, i + 1));
}

/** Compacto para tarjetas: "feb–abr" · "nov 25–ene 26" · "abr". */
export function monthsUsedShort(fromKey: string, toKey: string): string {
  const months = monthsUsed(fromKey, toKey);
  if (!months.length) return "—";
  const first = months[0];
  const last = months[months.length - 1];
  const crossYear = first.slice(0, 4) !== last.slice(0, 4);
  const fmt = (m: string) => `${MONTHS_SHORT[monthIdx(m)]}${crossYear ? ` ${m.slice(2, 4)}` : ""}`;
  return months.length === 1 ? fmt(first) : `${fmt(first)}–${fmt(last)}`;
}

/** Para leer de corrido: "febrero a abril" · "noviembre de 2025 a enero de 2026" · "abril". */
export function monthsUsedLong(fromKey: string, toKey: string): string {
  const months = monthsUsed(fromKey, toKey);
  if (!months.length) return "";
  const first = months[0];
  const last = months[months.length - 1];
  if (months.length === 1) return monthName(first);
  const crossYear = first.slice(0, 4) !== last.slice(0, 4);
  return `${monthName(first, crossYear)} a ${monthName(last, crossYear)}`;
}

const PCT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** 8.7 → "+8,7 %" · 0 → "0 %" · -1.25 → "-1,25 %". */
export function formatVariation(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const v = Math.abs(pct) < 0.005 ? 0 : pct;
  return `${v > 0 ? "+" : ""}${PCT.format(v)} %`;
}

/** Importe para textos al inquilino: sin centavos cuando es entero ("$ 543.500"). */
export function plainMoney(amount: number, currency = "ARS"): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export interface AdjustmentDescriptor {
  method: RentalAdjustmentMethod;
  index_code: string | null;
  from_key: string | null;
  to_key: string | null;
}

function indexLabel(code: string | null): string {
  return code && isIndexCode(code) ? INDEX_META[code].label : "Índice";
}

/** Qué datos usa el ajuste: "meses: feb–abr" · "del 01/06/2025 al 01/06/2026" · null. */
export function adjustmentWindowLabel(a: AdjustmentDescriptor): string | null {
  if (a.method !== "indice" || !a.from_key || !a.to_key) return null;
  const daily = a.index_code && isIndexCode(a.index_code) && indexFrequency(a.index_code) === "daily";
  if (daily) return `del ${shortDate(a.from_key)} al ${shortDate(a.to_key)}`;
  return `meses: ${monthsUsedShort(a.from_key, a.to_key)}`;
}

/**
 * Línea del método en la tarjeta:
 * "IPC · trimestral · meses: feb–abr" · "ICL · anual · del 01/06/2025 al 01/06/2026"
 * · "Porcentaje fijo +10 % · trimestral" · "Monto pactado · trimestral" · "Monto a mano · …".
 */
export function adjustmentMethodLine(
  a: AdjustmentDescriptor,
  every: number | null | undefined,
  opts: { fixedPct?: number | null } = {},
): string {
  const freq = frequencyLabel(every);
  switch (a.method) {
    case "indice": {
      const win = adjustmentWindowLabel(a);
      return [indexLabel(a.index_code), freq, win].filter(Boolean).join(" · ");
    }
    case "porcentaje_fijo":
      return opts.fixedPct != null ? `Porcentaje fijo ${formatVariation(opts.fixedPct)} · ${freq}` : `Porcentaje fijo · ${freq}`;
    case "escalonado":
      return `Monto pactado · ${freq}`;
    case "manual":
      return `Monto a mano · ${freq}`;
    case "sin_ajuste":
    default:
      return "Sin ajuste";
  }
}

/** Cuándo suele salir el dato que falta (para "Esperando el IPC de septiembre…"). */
export function waitingForIndexText(code: string | null, missingKey: string | null): string {
  if (!code || !isIndexCode(code) || !missingKey || !isYmd(missingKey)) return "Esperando que se publique el índice.";
  const meta = INDEX_META[code as IndexCode];
  if (indexFrequency(code) === "daily") {
    return `Esperando el ${meta.label} del ${shortDate(missingKey)} (el BCRA lo publica unos días antes).`;
  }
  const next = monthName(addMonthsToMonth(missingKey, 1));
  if (code === "ipc") return `Esperando el IPC de ${monthName(missingKey)} (el INDEC lo publica a mediados de ${next}).`;
  if (code === "casa_propia") return `Esperando el coeficiente Casa Propia de ${monthName(missingKey)} (se carga a mano cuando sale).`;
  return `Esperando el ${meta.label} de ${monthName(missingKey)}.`;
}

export interface NoticeInput extends AdjustmentDescriptor {
  effectiveDate: string;
  oldAmount: number;
  newAmount: number;
  currency: string;
  variationPct: number | null;
  fixedPct?: number | null;
  /** El monto se corrigió a mano (acuerdo con el inquilino): no se cita el índice. */
  overridden?: boolean;
}

/** "según IPC de febrero a abril" · "según ICL del 01/06/2025 al 01/06/2026" · "por el aumento pactado del 10 %". */
export function adjustmentBasisText(n: NoticeInput): string {
  if (n.overridden) return "según lo acordado";
  switch (n.method) {
    case "indice": {
      const label = indexLabel(n.index_code);
      if (!n.from_key || !n.to_key) return `según ${label}`;
      const daily = n.index_code && isIndexCode(n.index_code) && indexFrequency(n.index_code) === "daily";
      if (daily) return `según ${label} del ${shortDate(n.from_key)} al ${shortDate(n.to_key)}`;
      const months = monthsUsedLong(n.from_key, n.to_key);
      return months ? `según ${label} de ${months}` : `según ${label}`;
    }
    case "porcentaje_fijo":
      return n.fixedPct != null ? `por el aumento pactado del ${formatVariation(n.fixedPct).replace("+", "")}` : "por el aumento pactado";
    case "escalonado":
      return "según el monto pactado en el contrato";
    default:
      return "según lo acordado";
  }
}

/** "Desde el 1 de diciembre de 2026 el alquiler pasa de $ 500.000 a $ 543.500 (+8,7 % según IPC de agosto a octubre)." */
export function adjustmentSentence(n: NoticeInput): string {
  const pct = n.variationPct != null ? `${formatVariation(n.variationPct)} ` : "";
  return (
    `Desde el ${longDate(n.effectiveDate)} el alquiler pasa de ${plainMoney(n.oldAmount, n.currency)} ` +
    `a ${plainMoney(n.newAmount, n.currency)} (${pct}${adjustmentBasisText(n)}).`
  );
}

/** Primer nombre para el saludo ("María José Pérez" → "María"). */
export function firstNameOf(full: string | null | undefined): string {
  const t = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** Mensaje listo para pegar en WhatsApp. Sin emojis: en iOS se rompen al prellenar el chat. */
export function adjustmentWhatsappText(
  n: NoticeInput & { tenantName: string | null; orgName: string; address: string },
): string {
  const name = firstNameOf(n.tenantName);
  return [
    `Hola${name ? ` ${name}` : ""}, ¿cómo estás? Te escribimos de ${n.orgName} por el alquiler de ${n.address}.`,
    adjustmentSentence(n),
    "Cualquier duda, escribinos. ¡Gracias!",
  ].join("\n\n");
}
