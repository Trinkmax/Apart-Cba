import { formatDate, formatMoney } from "@/lib/format";

/**
 * Textos para pegar en WhatsApp (recibo y aviso de pago). Puros: los usan las
 * server actions y los componentes por igual. Sin emojis: el texto se COPIA
 * y se abre el chat con `wa.me/<dígitos>` sin `?text=` (iOS rompe los emojis
 * que viajan en la URL; ver guest-message-card.tsx).
 */

/** Leyenda de reserva del recibo (pagos parciales, saldos e intereses). */
export const RECEIPT_LEGEND =
  "Este recibo no implica conformidad con pagos parciales ni renuncia a reclamar saldos e intereses.";

/** "Juan" de "Juan Pérez"; una persona jurídica queda con el nombre completo. */
export function firstNameOf(fullName: string | null | undefined, isCompany = false): string {
  const clean = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (isCompany) return clean;
  if (clean.includes(",")) {
    const after = clean.split(",")[1]?.trim();
    if (after) return after.split(" ")[0];
  }
  return clean.split(" ")[0];
}

/** Moneda sin espacios raros (formatMoney mete un NBSP entre símbolo y número). */
export function plainMoney(amount: number, currency: string): string {
  return formatMoney(amount, currency).replace(/\s/g, " ");
}

export interface ReceiptMessageInput {
  tenantName: string;
  isCompany?: boolean;
  orgName: string;
  address: string;
  amount: number;
  currency: string;
  receiptNumber: string;
  /** Lo que sigue debiendo después de este pago (0 = al día). */
  pendingTotal: number;
  /** Saldo a favor que dejó este pago. */
  creditLeft: number;
  portalUrl?: string | null;
  voided?: boolean;
}

export function buildReceiptWhatsappText(m: ReceiptMessageInput): string {
  const name = firstNameOf(m.tenantName, m.isCompany);
  const lines: string[] = [];
  if (m.voided) {
    lines.push(
      `Hola${name ? ` ${name}` : ""}! Te avisamos que el recibo N° ${m.receiptNumber} por ${plainMoney(m.amount, m.currency)} (alquiler de ${m.address}) quedó anulado.`,
      "Si tenés alguna duda, escribinos.",
      "",
      m.orgName,
    );
    return lines.join("\n");
  }
  lines.push(`Hola${name ? ` ${name}` : ""}! Te confirmamos que recibimos tu pago de ${plainMoney(m.amount, m.currency)} por el alquiler de ${m.address}.`);
  lines.push(`Recibo N° ${m.receiptNumber}.`);
  if (m.creditLeft > 0.004) {
    lines.push(`Te quedó un saldo a favor de ${plainMoney(m.creditLeft, m.currency)}, que se descuenta de lo próximo que venza.`);
  }
  if (m.pendingTotal > 0.004) {
    lines.push(`Queda pendiente: ${plainMoney(m.pendingTotal, m.currency)}.`);
  } else {
    lines.push("Con este pago quedás al día.");
  }
  if (m.portalUrl) lines.push("", `Tus recibos y tu cuenta, siempre a mano: ${m.portalUrl}`);
  lines.push("", "Gracias!", m.orgName);
  return lines.join("\n");
}

export interface ReminderLine {
  label: string;
  dueDate: string;
  outstanding: number;
}

export interface ReminderMessageInput {
  tenantName: string;
  isCompany?: boolean;
  orgName: string;
  address: string;
  currency: string;
  /** Hoy (YYYY-MM-DD, zona de la org). */
  today: string;
  lines: ReminderLine[];
  /** El contrato cobra intereses por mora (para avisarlo en una línea). */
  hasLateFees: boolean;
  paymentInstructions?: string | null;
  portalUrl?: string | null;
}

export function reminderTotal(lines: ReminderLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.outstanding, 0) * 100) / 100;
}

export function buildReminderWhatsappText(m: ReminderMessageInput): string {
  const name = firstNameOf(m.tenantName, m.isCompany);
  const open = m.lines.filter((l) => l.outstanding > 0.004);
  const out: string[] = [];
  out.push(`Hola${name ? ` ${name}` : ""}, ¿cómo estás? Te escribimos de ${m.orgName} por el alquiler de ${m.address}.`);
  if (!open.length) {
    out.push("Te contamos que no tenés nada pendiente. Gracias!");
    return out.join("\n");
  }
  const anyOverdue = open.some((l) => l.dueDate < m.today);
  out.push(anyOverdue ? "Te pasamos lo que tenés pendiente:" : "Te recordamos lo que vence:");
  for (const l of open) {
    const when = l.dueDate < m.today ? `venció el ${formatDate(l.dueDate, "dd/MM")}` : `vence el ${formatDate(l.dueDate, "dd/MM")}`;
    out.push(`- ${l.label}: ${plainMoney(l.outstanding, m.currency)} (${when})`);
  }
  if (open.length > 1) out.push(`Total: ${plainMoney(reminderTotal(open), m.currency)}`);
  if (m.hasLateFees) {
    out.push(
      anyOverdue
        ? "Al pagar se suman los intereses por mora que fija el contrato, calculados al día del pago."
        : "Después del vencimiento se suman intereses por mora, como dice el contrato.",
    );
  }
  const instructions = m.paymentInstructions?.trim();
  if (instructions) out.push("", "Para pagar:", instructions);
  out.push(
    "",
    m.portalUrl
      ? `Cuando pagues, avisanos y subí el comprobante desde tu link: ${m.portalUrl}`
      : "Cuando pagues, mandanos el comprobante por acá.",
  );
  out.push("Gracias!", m.orgName);
  return out.join("\n");
}
