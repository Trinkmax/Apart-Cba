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

/**
 * Parsea un importe tipeado por el usuario aceptando tanto `.` como `,` como
 * separador decimal (es-AR usa coma; el placeholder de los inputs muestra
 * "0,00"). Vacío o inválido → null. Ej: "1.500,50" y "1500.50" → 1500.5.
 * Sin esto, `Number("1500,50")` es NaN y rompe silenciosamente la carga.
 */
export function parseAmountInput(v: string | null | undefined): number | null {
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed === "") return null;
  // Heurística: probamos el input "internacional" (solo coma→punto). Si no
  // parsea (tenía miles con punto), quitamos los puntos de miles y usamos coma.
  const direct = Number(trimmed.replace(",", "."));
  const n = Number.isFinite(direct)
    ? direct
    : Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
