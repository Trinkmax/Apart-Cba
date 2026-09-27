import {
  format,
  formatDistanceToNow,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from "date-fns";
import { es } from "date-fns/locale";

const CURRENCY_DECIMALS: Record<string, number> = {
  ARS: 2,
  USD: 2,
  EUR: 2,
  USDT: 2,
  USDC: 2,
  BTC: 8,
};

const CURRENCY_LOCALE: Record<string, string> = {
  ARS: "es-AR",
  USD: "en-US",
  EUR: "de-DE",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  ARS: "$",
  ARS_EFECTIVO: "$",
  ARS_TRANSFERENCIA: "$",
  USD: "US$",
  EUR: "€",
  USDT: "₮",
  USDC: "USDC",
  BTC: "₿",
};

export const CURRENCY_LABELS: Record<string, string> = {
  ARS: "ARS — Efectivo",
  ARS_EFECTIVO: "ARS — Efectivo",
  ARS_TRANSFERENCIA: "ARS — Transferencia",
  USD: "USD — Dólares",
  EUR: "EUR — Euros",
  USDT: "USDT",
};

export function formatMoney(amount: number | null | undefined, currency: string = "ARS"): string {
  if (amount === null || amount === undefined) return "—";
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const locale = CURRENCY_LOCALE[currency] ?? "es-AR";
  const isCrypto = ["USDT", "USDC", "BTC"].includes(currency);

  if (isCrypto) {
    return `${amount.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals,
    })} ${currency}`;
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

// ─── Importes tipeados ──────────────────────────────────────────────────────
// Ésta es LA regla de separadores para los inputs de TEXTO donde la gente
// tipea un importe (type="text" + inputMode="decimal"). La usan
// parseAmountInput (Caja, cobros extra, cuotas, pagos de liquidación y de
// tickets, filtros de precio del PMS), parseMoneyInput (form de reserva),
// parsePriceInput (precios de la unidad) y parsePercentInput: antes cada uno
// tenía su heurística y divergían — "1.500" era $1.500 en el precio de la
// unidad y $1,50 en un gasto de Caja.
//
// Un <input type="number"> NO pasa por acá: el browser ya entrega el valor
// canónico, punto decimal y sin miles, y "1.085" (un tipo de cambio de 1,085)
// esta regla lo leería como 1085. Esos inputs se quedan con Number() — el num()
// de editable-settlement-statement.tsx y de add-booking-row-dialog.tsx —; si
// alguno pasa a type="text", recién ahí se cambia a parseAmountInput.

/** Miles es-AR bien agrupados, con coma decimal opcional: "45.000", "1.100.000,50". */
const GROUPED_ES_AR = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/;
/** Miles en-US bien agrupados, con punto decimal opcional: "1,500", "1,100,000.50". */
const GROUPED_EN_US = /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d+))?$/;
/** Un único separador, que entonces es decimal: "45,5", "1100.125", ",5". */
const SINGLE_DECIMAL = /^(\d*)[.,](\d+)$/;

/**
 * Un importe tipeado, ya separado en sus partes. Cuántos decimales se aceptan
 * lo decide cada parser: parseAmountInput cualquier cantidad, parsePriceInput
 * uno o dos.
 */
export interface TypedAmount {
  negative: boolean;
  /** Cifras enteras sin separadores de miles ("" en ",5"). */
  int: string;
  /** Cifras decimales; null si no tiene. */
  frac: string | null;
}

function matchAmountShape(t: string): Omit<TypedAmount, "negative"> | null {
  if (/^\d+$/.test(t)) return { int: t, frac: null };
  // Miles agrupados primero: un grupo de tres cifras detrás de un separador es
  // miles, no decimales. El primer grupo no empieza en 0: "0.500" es 0,5.
  const es = GROUPED_ES_AR.exec(t);
  if (es) return { int: es[1].replace(/\./g, ""), frac: es[2] ?? null };
  const en = GROUPED_EN_US.exec(t);
  if (en) return { int: en[1].replace(/,/g, ""), frac: en[2] ?? null };
  const single = SINGLE_DECIMAL.exec(t);
  if (single) return { int: single[1], frac: single[2] };
  return null;
}

/**
 * Separa un importe tipeado en signo, enteros y decimales. Sin cifras o con
 * separadores que no encajan en ninguna forma ("1.100.000.50", "1,2,3") → null:
 * no se adivina.
 *
 * - Miles bien agrupados ganan: "45.000" → 45000, "1.100.000,50" → 1100000,5,
 *   "1,200.50" → 1200,5, "1,500" → 1500.
 * - Si no, un separador único es decimal, con cualquier cantidad de cifras:
 *   "45,5", "1100.125" y los strings de máquina de String(n) como
 *   "1499.8999999999999" se siguen leyendo igual.
 * - Separador colgando mientras se tipea ("45.", "1.100." camino a
 *   "1.100.000"): como si no estuviera.
 */
export function splitTypedAmount(text: string | null | undefined): TypedAmount | null {
  if (text == null) return null;
  let t = text.replace(/\s/g, "");
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1);
  if (!/\d/.test(t)) return null;
  const shape = matchAmountShape(t);
  if (shape) return { negative, ...shape };
  if (/[.,]$/.test(t)) {
    // Sólo sobre enteros: detrás de decimales ("45,5.") no hay nada que seguir tipeando.
    const sin = matchAmountShape(t.slice(0, -1));
    if (sin && sin.frac === null) return { negative, ...sin };
  }
  return null;
}

/** TypedAmount → número (null si no es finito). */
export function typedAmountToNumber(a: TypedAmount): number | null {
  const n = Number(`${a.negative ? "-" : ""}${a.int || "0"}${a.frac ? `.${a.frac}` : ""}`);
  if (!Number.isFinite(n)) return null;
  // "-0" es 0: un -0 se ve igual pero Object.is lo distingue.
  return n === 0 ? 0 : n;
}

/**
 * Parsea un importe tipeado por el usuario (permisivo: para inputs sin aviso
 * de "no se entiende" en línea). Vacío, sin cifras o ilegible → null — el
 * caller tiene que mostrar un error, no guardar 0.
 *
 * es-AR escribe los miles con punto: "1.500" son mil quinientos (antes se
 * leía 1,5 y un gasto de $1.500 se guardaba como $1,50). La coma o el punto
 * solos siguen siendo decimales: "1500,50" y "1500.50" → 1500,5. Ambigüedad
 * asumida: "12.345" son doce mil — ningún importe lleva tres decimales.
 */
export function parseAmountInput(v: string | null | undefined): number | null {
  const a = splitTypedAmount(v);
  return a ? typedAmountToNumber(a) : null;
}

/**
 * Porcentaje tipeado → número. Un porcentaje nunca lleva miles, así que un
 * único separador es SIEMPRE decimal: "3,125" y "2.125" son 3,125 % y 2,125 %
 * (parseAmountInput los leería como 3125 y 2125, y el server los rechaza por
 * pasar de 100 con un error que en producción llega en inglés). Lo demás
 * —vacío, signo, basura— igual que parseAmountInput.
 */
export function parsePercentInput(v: string | null | undefined): number | null {
  if (v == null) return null;
  const t = v.replace(/\s/g, "");
  const m = /^(-?)(\d*)[.,](\d+)$/.exec(t);
  if (m && (m[2] !== "" || m[3] !== "")) {
    const n = Number(`${m[1]}${m[2] || "0"}.${m[3]}`);
    return Number.isFinite(n) ? (Object.is(n, -0) ? 0 : n) : null;
  }
  return parseAmountInput(v);
}

export function formatMoneyShort(amount: number | null | undefined, currency: string = "ARS"): string {
  if (amount === null || amount === undefined) return "—";
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  if (Math.abs(amount) >= 1_000_000) {
    return `${symbol} ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `${symbol} ${(amount / 1_000).toFixed(1)}k`;
  }
  return formatMoney(amount, currency);
}

export function formatDate(date: string | Date | null | undefined, fmt: string = "dd/MM/yyyy"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, fmt, { locale: es });
}

export function formatDateLong(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "EEEE d 'de' MMMM, yyyy", { locale: es });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy HH:mm", { locale: es });
}

/**
 * Etiqueta de día relativa para tareas operativas: "Hoy · 11:00",
 * "Mañana · 11:00", "Ayer · 14:30" o "vie 3/7 · 11:00". Responde de una la
 * pregunta que el equipo se hace frente al tablero: ¿esto toca hoy?
 */
export function formatDayRelative(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  const time = format(d, "HH:mm");
  if (isToday(d)) return `Hoy · ${time}`;
  if (isTomorrow(d)) return `Mañana · ${time}`;
  if (isYesterday(d)) return `Ayer · ${time}`;
  return `${format(d, "EEE d/M", { locale: es })} · ${time}`;
}

export function formatTimeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(d, { locale: es, addSuffix: true });
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.startsWith("54") && cleaned.length === 12) {
    return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)}-${cleaned.slice(8)}`;
  }
  return phone;
}

export function formatPercent(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function formatNights(checkIn: string, checkOut: string): number {
  const ci = parseISO(checkIn);
  const co = parseISO(checkOut);
  return Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
