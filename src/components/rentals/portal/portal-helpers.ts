import type { RentalAdjustmentMethod, RentalIndexCode } from "@/lib/types/database";
import { INDEX_META } from "@/lib/rentals/indices";
import { MONTHS } from "@/lib/settlements/labels";

/**
 * Textos y cuentas chicas del portal del inquilino. Puro (tests en
 * __tests__/): lo usa el servidor para armar la vista y los componentes para
 * mostrarla. Castellano simple: lo lee alguien desde el celular.
 */

/** "8,7 %" (es-AR, hasta 1 decimal). */
export function formatPctAr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

function monthName(ymd: string): string {
  return (MONTHS[Number(ymd.slice(5, 7)) - 1] ?? "").toLowerCase();
}

function dmy(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/** Siguiente mes de una clave YYYY-MM-01. */
function nextMonthKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Meses que mide un ajuste mensual: los de `fromKey+1` a `toKey`.
 * "febrero a abril de 2026", "noviembre de 2025 a enero de 2026", "marzo de 2026".
 */
export function monthSpanLabel(fromKey: string, toKey: string): string {
  const start = nextMonthKey(fromKey);
  const sy = start.slice(0, 4);
  const ty = toKey.slice(0, 4);
  if (start === toKey.slice(0, 7) + "-01") return `${monthName(toKey)} de ${ty}`;
  if (sy === ty) return `${monthName(start)} a ${monthName(toKey)} de ${ty}`;
  return `${monthName(start)} de ${sy} a ${monthName(toKey)} de ${ty}`;
}

/** Explicación simple de cada índice, para alguien que no es del rubro. */
export const INDEX_PLAIN: Record<RentalIndexCode, string> = {
  ipc: "El IPC es la inflación que publica el INDEC todos los meses: tu alquiler sube lo mismo que subieron los precios en esos meses.",
  icl: "El ICL lo publica el Banco Central todos los días y combina inflación y salarios.",
  casa_propia: "El coeficiente Casa Propia toma lo que menos haya subido entre la inflación y los salarios.",
  uva: "La UVA sigue a la inflación día a día; la publica el Banco Central.",
  cer: "El CER sigue a la inflación día a día; lo publica el Banco Central.",
  ripte: "El RIPTE sigue cómo suben los sueldos de los trabajadores registrados.",
};

const EVERY_LABEL: Record<number, string> = { 1: "todos los meses", 3: "cada 3 meses", 4: "cada 4 meses", 6: "cada 6 meses", 12: "una vez por año" };

function everyLabel(every: number | null | undefined): string {
  if (!every) return "";
  return EVERY_LABEL[every] ?? `cada ${every} meses`;
}

/** "Se actualiza cada 3 meses por IPC" / "Precio fijo durante todo el contrato". */
export function adjustmentSummary(input: {
  method: RentalAdjustmentMethod;
  indexCode: RentalIndexCode | null;
  every: number | null;
  fixedPct: number | null;
}): string {
  const every = everyLabel(input.every);
  const words = (...xs: string[]) => xs.filter(Boolean).join(" ");
  switch (input.method) {
    case "indice":
      return words("Se actualiza", every, "por", input.indexCode ? INDEX_META[input.indexCode].label : "índice");
    case "porcentaje_fijo":
      return words("Sube un", formatPctAr(input.fixedPct), every);
    case "escalonado":
      return words("Sube", every, "a los montos pactados en el contrato");
    case "manual":
      return words("Se actualiza", every, "según lo que se acuerde");
    default:
      return "Precio fijo durante todo el contrato";
  }
}

/** Por qué cambió el alquiler en un ajuste ya aplicado. */
export function adjustmentExplanation(input: {
  method: RentalAdjustmentMethod;
  indexCode: RentalIndexCode | null;
  variationPct: number | null;
  fromKey: string | null;
  toKey: string | null;
}): string {
  const pct = input.variationPct;
  const up = pct != null && pct < 0 ? "Bajó" : "Subió";
  const amount = pct != null ? ` un ${formatPctAr(Math.abs(pct))}` : "";
  if (input.method === "indice" && input.indexCode) {
    const label = INDEX_META[input.indexCode].label;
    if (input.fromKey && input.toKey && INDEX_META[input.indexCode].frequency === "monthly") {
      return `${up}${amount} según el ${label} de ${monthSpanLabel(input.fromKey, input.toKey)}.`;
    }
    if (input.fromKey && input.toKey) {
      return `${up}${amount} según el ${label} entre el ${dmy(input.fromKey)} y el ${dmy(input.toKey)}.`;
    }
    return `${up}${amount} según el ${label}.`;
  }
  if (input.method === "porcentaje_fijo") return `${up}${amount}, como dice el contrato.`;
  if (input.method === "escalonado") return "Pasó al monto pactado en el contrato para esta etapa.";
  return `${up}${amount}: es el monto acordado.`;
}

export interface InstructionLine {
  text: string;
  copy: { label: string; value: string } | null;
}

/**
 * Parte los datos para transferir en renglones y detecta lo que conviene
 * copiar con un toque: CBU/CVU (22 cifras), alias y CUIT.
 */
export function parsePaymentInstructions(text: string | null | undefined): InstructionLine[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const compact = line.replace(/[\s-]/g, "");
      const cbu = compact.match(/(?<!\d)\d{22}(?!\d)/);
      if (cbu) return { text: line, copy: { label: /cvu/i.test(line) ? "CVU" : "CBU", value: cbu[0] } };
      const alias = line.match(/alias\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9.\-]{4,19})/i);
      if (alias) return { text: line, copy: { label: "Alias", value: alias[1] } };
      const cuit = line.match(/(?<!\d)(\d{2})-?(\d{8})-?(\d)(?!\d)/);
      if (cuit && /cuit|cuil/i.test(line)) return { text: line, copy: { label: "CUIT", value: `${cuit[1]}${cuit[2]}${cuit[3]}` } };
      return { text: line, copy: null };
    });
}

/** Días hasta una fecha (negativo si ya pasó). */
export function daysUntil(today: string, ymd: string): number {
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** "vence hoy", "vence mañana", "vence en 5 días", "venció hace 3 días". */
export function dueInWords(today: string, dueDate: string): string {
  const d = daysUntil(today, dueDate);
  if (d === 0) return "vence hoy";
  if (d === 1) return "vence mañana";
  if (d > 1) return `vence en ${d} días`;
  if (d === -1) return "venció ayer";
  return `venció hace ${-d} días`;
}

/** Color de texto legible sobre el color de marca (blanco o casi negro), por luminancia relativa. */
export function readableTextOn(hex: string): "#ffffff" | "#111827" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  // Contraste contra blanco vs contra #111827 (lum ≈ 0.012).
  return (1.05 / (lum + 0.05) >= (lum + 0.05) / 0.062) ? "#ffffff" : "#111827";
}
