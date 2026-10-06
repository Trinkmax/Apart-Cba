import { formatMoney } from "@/lib/format";
import { VAT_PCT } from "@/lib/rentals/entry-costs";
import { agencyPartLabel, type PaymentSplit } from "@/lib/rentals/payment-split";
import type { LedgerPaymentSplit, PaymentOwner } from "@/lib/rentals/server/collections-queries";
import type { RentalPaymentMethod } from "@/lib/types/database";
import { plainMoney } from "./messages";

/**
 * Cómo se muestra el reparto de un cobro cuando el inquilino le paga directo
 * al propietario (contrato con `collector = 'propietario'`): la parte que va
 * a la cuenta del propietario y la que entra a la Caja de la inmobiliaria.
 * Puro: lo usan el diálogo de cobro, el resumen al registrar y la cuenta corriente.
 */

const EPS = 0.004;

/** Nombre de la inmobiliaria para los textos ("Apart CBA"); sin el dato, genérico. */
export function agencyNameOf(orgName: string | null | undefined): string {
  return (orgName ?? "").trim() || "la inmobiliaria";
}

/** Primera letra en mayúscula ("la inmobiliaria" → "La inmobiliaria"). */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("es-AR") + text.slice(1) : text;
}

/** ¿Hay que elegir la cuenta de Caja donde entra la parte de la inmobiliaria? */
export function needsAgencyAccount(split: PaymentSplit | null | undefined): boolean {
  return !!split && split.agency.total > EPS;
}

/** Sobra plata y el contrato cobra honorarios: la comisión de ese adelanto todavía no se calculó. */
export function showsRemainderWarning(split: PaymentSplit): boolean {
  return split.remainder > EPS && split.agency.feePct > 0;
}

export interface SplitOwnerBank {
  bankName: string | null;
  cbu: string | null;
  alias: string | null;
}

export interface SplitOwnerRow {
  ownerId: string;
  name: string;
  pct: number;
  amount: number;
  /** null = no tenemos sus datos (no es lo mismo que "no los cargó"). */
  bank: SplitOwnerBank | null;
  /** Sabemos que no tiene cargado ni CBU ni alias. */
  missingBank: boolean;
}

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

/** Una fila por titular: su parte del cobro con sus datos bancarios (a dónde transfiere el inquilino). */
export function splitOwnerRows(split: PaymentSplit, owners: readonly PaymentOwner[]): SplitOwnerRow[] {
  const byId = new Map(owners.map((o) => [o.ownerId, o]));
  return split.owner.shares.map((s) => {
    const o = byId.get(s.ownerId);
    const bank = o ? { bankName: clean(o.bankName), cbu: clean(o.cbu), alias: clean(o.alias) } : null;
    return {
      ownerId: s.ownerId,
      name: clean(s.name) ?? clean(o?.name) ?? "Propietario",
      pct: Number(s.pct),
      amount: s.amount,
      bank,
      missingBank: !!bank && !bank.cbu && !bank.alias,
    };
  });
}

/** "Juan Pérez" · "Juan Pérez y Ana Gómez" · "Juan, Ana y Luis". */
export function joinNames(names: readonly string[]): string {
  const xs = names.map((n) => n.trim()).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** Porcentaje en es-AR sin ceros de más ("50 %", "33,33 %"). */
export function pctLabel(pct: number): string {
  return `${Number(pct).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
}

export interface AgencyLine {
  label: string;
  amount: number;
}

/** De qué se compone la parte de la inmobiliaria (sólo lo que no es cero). */
export function agencyBreakdown(split: PaymentSplit, currency: string): AgencyLine[] {
  const a = split.agency;
  const lines: AgencyLine[] = [];
  if (a.fee > EPS) {
    lines.push({ label: `Honorarios ${pctLabel(a.feePct)} sobre ${formatMoney(a.feeBase, currency)} de alquiler`, amount: a.fee });
  }
  if (a.vat > EPS) lines.push({ label: `IVA de los honorarios (${VAT_PCT} %)`, amount: a.vat });
  if (a.own > EPS) lines.push({ label: "Conceptos de la inmobiliaria", amount: a.own });
  if (a.passThrough > EPS) lines.push({ label: "Para pagarle a terceros (consorcio, servicios)", amount: a.passThrough });
  return lines;
}

/** "honorarios 8 % + IVA"; vacío si la parte de la inmobiliaria no tiene nada. */
function cleanAgencyLabel(label: string | null | undefined): string {
  const l = (label ?? "").trim();
  return l === "nada" ? "" : l;
}

/** El reparto con la forma que usa la cuenta corriente (para el resumen al registrar, antes de recargar). */
export function toLedgerSplit(split: PaymentSplit, agencyAccountName: string | null): LedgerPaymentSplit {
  const hasAgency = split.agency.total > EPS;
  return {
    ownerTotal: split.owner.total,
    agencyTotal: split.agency.total,
    agencyAccountName: hasAgency ? clean(agencyAccountName) : null,
    agencyLabel: hasAgency ? cleanAgencyLabel(agencyPartLabel(split)) : "",
    owners: split.owner.shares.map((s) => ({ name: s.name, amount: s.amount })),
  };
}

/** "Directo al propietario $ 920.000 · A Banco Galicia $ 80.000 (honorarios 8 %)". */
export function splitSummaryText(s: LedgerPaymentSplit, currency: string): string {
  const hasAgency = s.agencyTotal > EPS;
  const parts: string[] = [];
  if (s.ownerTotal > EPS || !hasAgency) {
    parts.push(`${s.owners.length > 1 ? "Directo a los propietarios" : "Directo al propietario"} ${formatMoney(s.ownerTotal, currency)}`);
  }
  if (hasAgency) {
    const label = cleanAgencyLabel(s.agencyLabel);
    parts.push(`A ${clean(s.agencyAccountName) ?? "Caja"} ${formatMoney(s.agencyTotal, currency)}${label ? ` (${label})` : ""}`);
  }
  return parts.join(" · ");
}

/**
 * Cómo le llegó la plata a cada uno. Lo esperado es que el inquilino le pague a
 * cada uno su parte, pero a veces le paga todo a uno solo: en ese caso la Caja
 * sólo puede mostrar la parte de la inmobiliaria cuando esa plata ya llegó.
 */
export type PayRoute = "cada_uno" | "todo_propietario" | "todo_inmobiliaria";

const isTransfer = (method: RentalPaymentMethod | null | undefined) => method === "transferencia" || method === "deposito";

/** Nota bajo "Al propietario" en el diálogo: dónde está su parte (sin decir "transfiere" si pagó en efectivo). */
export function ownerPartNote(route: PayRoute | null, method: RentalPaymentMethod | null | undefined, agencyName: string): string {
  if (route === "todo_propietario") return `Lo recibió el propietario: no entra a la Caja de ${agencyName}.`;
  if (route === "todo_inmobiliaria") return `Entró a ${agencyName}, pero es del propietario: no se carga en Caja.`;
  return isTransfer(method)
    ? `Lo transfiere el inquilino directo a su cuenta: no entra a la Caja de ${agencyName}.`
    : `Lo paga el inquilino directo: no entra a la Caja de ${agencyName}.`;
}

/**
 * ¿Se puede registrar con este camino? Hay que elegir uno; y si le pagó todo al
 * propietario, sólo cuando él ya le pasó a la inmobiliaria su parte (si no, la
 * Caja mostraría plata que todavía no entró).
 */
export function routeReady(route: PayRoute | null, ownerAlreadyPassed: boolean): boolean {
  if (route === "todo_propietario") return ownerAlreadyPassed;
  return route != null;
}

/** Línea para la nota interna del cobro cuando no le pagó a cada uno su parte (queda en el registro). */
export function routeNoteText(route: PayRoute | null, split: PaymentSplit, agencyName: string, currency: string): string {
  if (route === "todo_propietario") {
    return `El inquilino le pagó todo al propietario y él le pasó ${plainMoney(split.agency.total, currency)} a ${agencyName}.`;
  }
  if (route === "todo_inmobiliaria") {
    return `El inquilino le pagó todo a ${agencyName}: hay que pasarle ${plainMoney(split.owner.total, currency)} al propietario (no se cargan en Caja).`;
  }
  return "";
}

/** Suma la línea del camino a la nota que escribió la persona, sin pasarse del máximo que acepta el servidor. */
export function withRouteNote(userNotes: string | null | undefined, routeNote: string, max = 500): string | null {
  const note = (userNotes ?? "").trim();
  const extra = routeNote.trim();
  if (!extra) return note ? note.slice(0, max) : null;
  if (!note) return extra.slice(0, max);
  const room = max - extra.length - 3;
  if (room < 2) return extra.slice(0, max);
  const kept = note.length <= room ? note : `${note.slice(0, room - 1).trimEnd()}…`;
  return `${kept} · ${extra}`;
}

/** Título y nota de la parte del propietario en el resumen del cobro registrado. */
export function successOwnerLines(route: PayRoute | null | undefined, owners: string, agencyName: string): { title: string; note: string; warn: boolean } {
  const name = owners.trim();
  if (route === "todo_inmobiliaria") {
    return { title: name ? `Para ${name}` : "Para el propietario", note: `Entró a ${agencyName}: pasáselo al propietario. No se carga en Caja.`, warn: true };
  }
  const title = name ? `Directo a ${name}` : "Directo al propietario";
  if (route === "todo_propietario") {
    return { title, note: `Lo recibió todo el propietario y ya le pasó a ${agencyName} su parte. No entra a Caja.`, warn: false };
  }
  return { title, note: "Lo pagó el inquilino directo: no entra a Caja.", warn: false };
}
