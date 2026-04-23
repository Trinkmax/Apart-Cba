import { format, formatDistanceToNow, parseISO } from "date-fns";
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
  USD: "US$",
  EUR: "€",
  USDT: "₮",
  USDC: "USDC",
  BTC: "₿",
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
