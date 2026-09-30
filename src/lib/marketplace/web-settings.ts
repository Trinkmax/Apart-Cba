import type { OrgWebSettings } from "@/lib/types/database";
import { DEFAULT_DEPOSIT_POLICY, type DepositPolicy } from "./sena";

/**
 * Configuración de la web y del cobro de la seña (Configuración → Web y cobros)
 * ya resuelta con sus valores por defecto. Una organización sin fila en
 * `org_web_settings` funciona igual: seña de 1 noche, 24 h para pagarla,
 * respuesta prometida en 24 h y sin datos de transferencia (el equipo los pasa
 * por WhatsApp hasta que los cargue).
 */
export interface ResolvedWebSettings {
  whatsappNumber: string | null;
  publicEmail: string | null;
  instagramHandle: string | null;
  responseHours: number;
  deposit: DepositPolicy;
  transfer: TransferDetails | null;
  cancellationText: string | null;
}

export interface TransferDetails {
  holder: string | null;
  cuit: string | null;
  bank: string | null;
  cbu: string | null;
  alias: string | null;
  notes: string | null;
}

export const DEFAULT_RESPONSE_HOURS = 24;

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/**
 * Normaliza la fila (o su ausencia). `fallbackEmail` es el contact_email de la
 * organización, que se usa si no hay un email público propio de la web.
 */
export function resolveWebSettings(
  row: Partial<OrgWebSettings> | null | undefined,
  fallback?: { email?: string | null; phone?: string | null },
): ResolvedWebSettings {
  const r = row ?? {};
  const transfer: TransferDetails = {
    holder: clean(r.transfer_holder),
    cuit: clean(r.transfer_cuit),
    bank: clean(r.transfer_bank),
    cbu: clean(r.transfer_cbu),
    alias: clean(r.transfer_alias),
    notes: clean(r.transfer_notes),
  };
  const hasTransfer = Boolean(transfer.cbu || transfer.alias);

  const rule = r.deposit_rule ?? DEFAULT_DEPOSIT_POLICY.rule;
  const percent = r.deposit_percent != null ? Number(r.deposit_percent) : null;
  const dueHours = Number(r.deposit_due_hours ?? DEFAULT_DEPOSIT_POLICY.dueHours);
  const responseHours = Number(r.response_hours ?? DEFAULT_RESPONSE_HOURS);

  const phoneDigits = (clean(r.whatsapp_number) ?? clean(fallback?.phone) ?? "").replace(/\D+/g, "");

  return {
    whatsappNumber: phoneDigits.length >= 8 ? phoneDigits : null,
    publicEmail: clean(r.public_email) ?? clean(fallback?.email),
    instagramHandle: clean(r.instagram_handle)?.replace(/^@+/, "") ?? null,
    responseHours: Number.isFinite(responseHours) && responseHours > 0 ? responseHours : DEFAULT_RESPONSE_HOURS,
    deposit: {
      rule: rule === "percent" && (percent == null || percent <= 0) ? "one_night" : rule,
      percent,
      dueHours: Number.isFinite(dueHours) && dueHours > 0 ? dueHours : DEFAULT_DEPOSIT_POLICY.dueHours,
    },
    transfer: hasTransfer ? transfer : null,
    cancellationText: clean(r.cancellation_text),
  };
}

/** "24 horas" / "1 hora" / "2 días" para textos al huésped. */
export function hoursLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "unas horas";
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} días`;
  return hours === 1 ? "1 hora" : `${hours} horas`;
}
