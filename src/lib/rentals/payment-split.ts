import { round2 } from "@/lib/finance/booking-economics";
import type { ChargeItemKind, Payee } from "./allocation";
import { VAT_PCT } from "./entry-costs";
import { FEE_BASE_KINDS, ownerShare } from "./owner-statement";

/**
 * Reparto de un cobro cuando el inquilino le paga DIRECTO al propietario
 * (contrato con `collector = 'propietario'`).
 *
 * El inquilino hace dos transferencias: la parte del propietario va a la
 * cuenta del propietario (no pasa por la Caja de la inmobiliaria) y la parte
 * de la inmobiliaria —los honorarios de administración y lo que ya era suyo—
 * entra a la cuenta de Caja que se elige al registrar el cobro.
 *
 * Las reglas son las de la rendición (`owner-statement.ts`), así la comisión
 * sale igual venga la plata por donde venga:
 *
 *   honorarios   = Σ imputaciones del propietario de alquiler / diferencia de ajuste × %
 *   IVA          = honorarios × 21 %   (si la inmobiliaria factura con IVA)
 *   inmobiliaria = honorarios + IVA + ítems de la inmobiliaria + pasamanos (consorcio, terceros)
 *   propietario  = lo pagado − inmobiliaria   (incluye el saldo a favor que sobre)
 *
 * La parte del propietario se reparte por % de titularidad, truncada al
 * centavo como en la rendición; lo que deja la truncación va al titular
 * principal, así las partes suman exacto lo pagado.
 */

export interface SplitLine {
  kind: ChargeItemKind;
  payee: Payee;
  /** Lo que este cobro imputa al ítem. */
  amount: number;
}

export interface SplitOwner {
  ownerId: string;
  name: string;
  /** 0..100 */
  pct: number;
  isPrimary: boolean;
}

export interface SplitRule {
  /** % de honorarios de administración (8 = 8 %). 0 = no cobra. */
  adminFeePct: number;
  adminFeeVat: boolean;
}

export interface SplitOwnerShare {
  ownerId: string;
  name: string;
  pct: number;
  amount: number;
}

export interface PaymentSplit {
  /** Lo que pagó el inquilino en total. */
  total: number;
  owner: {
    total: number;
    shares: SplitOwnerShare[];
  };
  agency: {
    total: number;
    feeBase: number;
    feePct: number;
    fee: number;
    vat: number;
    /** Ítems que ya eran de la inmobiliaria (honorarios de locación, punitorios a su favor…). */
    own: number;
    /** Plata que la inmobiliaria recibe para pagarle a otro (consorcio, terceros). */
    passThrough: number;
  };
  /** Lo que sobra del pago (saldo a favor del inquilino): queda en la parte del propietario. */
  remainder: number;
}

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Titular principal: el marcado como tal; si no hay, el de mayor %. Mismo criterio que el ingreso en Caja. */
export function primaryOwnerIndex(owners: readonly SplitOwner[]): number {
  if (!owners.length) return -1;
  const marked = owners.findIndex((o) => o.isPrimary);
  if (marked >= 0) return marked;
  let best = 0;
  owners.forEach((o, i) => {
    if (Number(o.pct) > Number(owners[best].pct)) best = i;
  });
  return best;
}

export function splitDirectPayment(input: {
  total: number;
  lines: readonly SplitLine[];
  rule: SplitRule;
  owners: readonly SplitOwner[];
}): PaymentSplit {
  const total = round2(Math.max(0, input.total));
  const lines = input.lines.filter((l) => l.amount > 0);
  const allocated = sum(lines.map((l) => l.amount));
  const remainder = round2(Math.max(0, total - allocated));

  const ownerAllocated = sum(lines.filter((l) => l.payee === "propietario").map((l) => l.amount));
  const feeBase = sum(lines.filter((l) => l.payee === "propietario" && FEE_BASE_KINDS.has(l.kind)).map((l) => l.amount));
  const feePct = input.rule.adminFeePct > 0 ? input.rule.adminFeePct : 0;
  let fee = feePct > 0 ? round2((feeBase * feePct) / 100) : 0;
  let vat = input.rule.adminFeeVat && fee > 0 ? round2((fee * VAT_PCT) / 100) : 0;
  // Los honorarios salen de la parte del propietario: nunca pueden dejarla negativa.
  const room = round2(ownerAllocated + remainder);
  if (fee > room) {
    fee = room;
    vat = 0;
  } else if (round2(fee + vat) > room) {
    vat = round2(room - fee);
  }
  const own = sum(lines.filter((l) => l.payee === "inmobiliaria").map((l) => l.amount));
  const passThrough = sum(lines.filter((l) => l.payee === "consorcio" || l.payee === "tercero").map((l) => l.amount));
  const agencyTotal = Math.min(total, round2(fee + vat + own + passThrough));
  const ownerTotal = round2(total - agencyTotal);

  const primary = primaryOwnerIndex(input.owners);
  const shares: SplitOwnerShare[] = input.owners.map((o, i) => ({
    ownerId: o.ownerId,
    name: o.name,
    pct: Number(o.pct),
    amount: i === primary ? 0 : ownerShare(ownerTotal, Number(o.pct)),
  }));
  if (primary >= 0) {
    const others = sum(shares.filter((_, i) => i !== primary).map((s) => s.amount));
    shares[primary].amount = round2(Math.max(0, ownerTotal - others));
  }

  return {
    total,
    owner: { total: ownerTotal, shares },
    agency: { total: agencyTotal, feeBase, feePct, fee, vat, own, passThrough },
    remainder,
  };
}

/** "honorarios 8 % + IVA" / "honorarios 8 % y expensas para el consorcio"… para textos cortos. */
export function agencyPartLabel(split: PaymentSplit): string {
  const parts: string[] = [];
  if (split.agency.fee > 0) {
    parts.push(`honorarios ${split.agency.feePct.toLocaleString("es-AR")} %${split.agency.vat > 0 ? " + IVA" : ""}`);
  }
  if (split.agency.own > 0) parts.push("conceptos de la inmobiliaria");
  if (split.agency.passThrough > 0) parts.push("pagos a terceros (consorcio, servicios)");
  if (!parts.length) return "nada";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
