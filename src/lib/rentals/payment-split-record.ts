import { round2 } from "@/lib/finance/booking-economics";
import type { RentalPaymentSplitSnapshot } from "@/lib/types/database";
import type { ChargeItemKind, Payee } from "./allocation";
import { agencyPartLabel, splitDirectPayment, type PaymentSplit, type SplitLine, type SplitOwner, type SplitRule } from "./payment-split";

/**
 * Puente entre el reparto calculado (`payment-split.ts`) y lo que se guarda o
 * se muestra de un cobro que el inquilino le pagó directo al propietario:
 *
 *   imputaciones de la vista previa → renglones del reparto
 *   reparto → foto que se guarda en el cobro (`rental_payments.split`, 070)
 *   reparto → qué dicen los dos ingresos en Caja (honorarios / para terceros)
 *   foto → lo que muestran la cuenta corriente y el recibo
 *   deuda abierta → a quién le transfiere el inquilino cada parte (aviso de pago)
 */

export interface SplitAllocationRef {
  /** Ítem existente, o null si es un punitorio que nace con este cobro. */
  itemId: string | null;
  newItemIndex: number | null;
  amount: number;
}

export interface SplitItemRef {
  kind: ChargeItemKind;
  payee: Payee;
}

/**
 * Cada imputación del cobro con el tipo y el destinatario de su ítem. Los
 * punitorios que nacen con el cobro son de quien diga el contrato
 * (`late_fee_payee`). Un ítem que no aparece (no debería pasar: la imputación
 * sale de esos mismos cargos) cuenta como del propietario y sin honorarios, así
 * nunca se le cobra de más a nadie.
 *
 * El depósito en garantía va SIEMPRE a la parte del propietario, diga lo que
 * diga su renglón (con "lo guarda la inmobiliaria" el renglón es de 'tercero'):
 * cuando cobra el propietario, el módulo del depósito (`depositPlace` y su
 * espejo `apartcba.rental_deposit_holder`) da por hecho que lo tiene él, y su
 * cierre no saca nada de Caja. Mandarlo a la inmobiliaria lo dejaba en Caja
 * como un ingreso más y al propietario debiendo devolver una plata que nunca
 * recibió. No genera honorarios: no es alquiler.
 */
export function splitLinesFromAllocations(
  allocations: readonly SplitAllocationRef[],
  items: ReadonlyMap<string, SplitItemRef>,
  lateFeePayee: Payee,
): SplitLine[] {
  return allocations
    .filter((a) => a.amount > 0)
    .map((a): SplitLine => {
      if (a.itemId == null && a.newItemIndex != null) return { kind: "punitorio", payee: lateFeePayee, amount: round2(a.amount) };
      const item = a.itemId ? items.get(a.itemId) : undefined;
      const kind = item?.kind ?? "otro";
      return { kind, payee: kind === "deposito" ? "propietario" : (item?.payee ?? "propietario"), amount: round2(a.amount) };
    });
}

/** Titular con los datos bancarios a los que el inquilino le transfiere su parte. */
export interface SplitOwnerBank extends SplitOwner {
  bankName: string | null;
  cbu: string | null;
  alias: string | null;
}

const clean = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

/**
 * Cómo le llegó la plata a cada uno. Lo esperado es que el inquilino le pague a
 * cada uno su parte ('cada_uno'); a veces le paga todo al propietario (que
 * después le pasa a la inmobiliaria la suya) o todo a la inmobiliaria (que le
 * pasa al propietario la suya). Los montos del reparto son los mismos: cambia
 * lo que dice el recibo y lo que queda anotado. Mismos valores que el diálogo.
 */
export const PAYMENT_ROUTES = ["cada_uno", "todo_propietario", "todo_inmobiliaria"] as const;
export type PaymentRoute = (typeof PAYMENT_ROUTES)[number];

export function isPaymentRoute(x: unknown): x is PaymentRoute {
  return typeof x === "string" && (PAYMENT_ROUTES as readonly string[]).includes(x);
}

/** "el inquilino le pagó todo al propietario" / "…todo a Apart CBA"; "" si le pagó a cada uno su parte. */
export function paymentRouteText(route: PaymentRoute | null | undefined, agencyName: string): string {
  if (route === "todo_propietario") return "el inquilino le pagó todo al propietario";
  if (route === "todo_inmobiliaria") return `el inquilino le pagó todo a ${agencyName.trim() || "la inmobiliaria"}`;
  return "";
}

/** La foto que se guarda con el cobro: el reparto y los datos bancarios de cada titular en ese momento. */
export function splitSnapshot(split: PaymentSplit, owners: readonly SplitOwnerBank[], route: PaymentRoute = "cada_uno"): RentalPaymentSplitSnapshot {
  const byId = new Map(owners.map((o) => [o.ownerId, o]));
  const label = agencyPartLabel(split);
  return {
    v: 1,
    route,
    total: split.total,
    owner: {
      total: split.owner.total,
      shares: split.owner.shares.map((s) => {
        const o = byId.get(s.ownerId);
        return {
          owner_id: s.ownerId,
          name: s.name,
          pct: s.pct,
          amount: s.amount,
          bank_name: clean(o?.bankName),
          cbu: clean(o?.cbu),
          alias: clean(o?.alias),
        };
      }),
    },
    agency: {
      total: split.agency.total,
      fee_base: split.agency.feeBase,
      fee_pct: split.agency.feePct,
      fee: split.agency.fee,
      vat: split.agency.vat,
      own: split.agency.own,
      pass_through: split.agency.passThrough,
      label: label === "nada" ? "" : label,
    },
    remainder: split.remainder,
  };
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Qué es el ingreso de la inmobiliaria en Caja (categoría agency_fee): sólo lo
 * que es plata suya — "Honorarios 8 % + IVA", "Honorarios 8 % y conceptos de la
 * inmobiliaria"… Lo que recibe para pagarle a otro (consorcio, terceros) entra
 * en un movimiento aparte (`passThroughMovementLabel`): si no, Caja lo contaba
 * como honorarios. La base le agrega " · recibo 000123".
 */
export function agencyMovementLabel(split: PaymentSplit): string {
  const parts: string[] = [];
  if (split.agency.fee > 0) {
    parts.push(`honorarios ${split.agency.feePct.toLocaleString("es-AR")} %${split.agency.vat > 0 ? " + IVA" : ""}`);
  }
  if (split.agency.own > 0) parts.push("conceptos de la inmobiliaria");
  return capitalized(parts.length ? parts.join(" y ") : "honorarios de administración").slice(0, 160);
}

/** Lo de la inmobiliaria que es plata suya (va a Caja como honorarios): todo menos lo que recibe para pagarle a otro. */
export function agencyFeePart(split: PaymentSplit): number {
  return round2(Math.max(0, split.agency.total - split.agency.passThrough));
}

/**
 * Qué es lo que la inmobiliaria recibe para pagarle a otro (categoría
 * rent_collection, aparte de los honorarios): "Expensas para el consorcio",
 * "Para pagarle a terceros"… La base le agrega " · recibo 000123".
 */
export function passThroughMovementLabel(lines: readonly SplitLine[]): string {
  const pass = lines.filter((l) => l.amount > 0 && (l.payee === "consorcio" || l.payee === "tercero"));
  const toConsorcio = pass.filter((l) => l.payee === "consorcio");
  const toOthers = pass.some((l) => l.payee === "tercero");
  if (toConsorcio.length && toOthers) return "Para pagarle al consorcio y a terceros";
  if (toConsorcio.length) return toConsorcio.every((l) => l.kind === "expensas") ? "Expensas para el consorcio" : "Para pagarle al consorcio";
  return "Para pagarle a terceros";
}

/** Cómo se repartió un cobro, para la cuenta corriente y el recibo. */
export interface LedgerPaymentSplit {
  /** Lo que fue directo a la cuenta del propietario. */
  ownerTotal: number;
  /** Lo que entró a la Caja de la inmobiliaria. */
  agencyTotal: number;
  agencyAccountName: string | null;
  /** "honorarios 8 % + IVA" */
  agencyLabel: string;
  owners: { name: string; amount: number }[];
  /** Cómo le llegó la plata a cada uno (sin el dato: a cada uno su parte). */
  route?: PaymentRoute;
}

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? round2(n) : 0;
};

/**
 * La foto guardada (jsonb) → lo que se muestra. null si no hay reparto o si la
 * foto no es una versión conocida (no se adivina: la base igual sabe que ese
 * cobro no se rinde porque `split` no es nulo).
 */
export function ledgerSplitFromSnapshot(raw: unknown, agencyAccountName: string | null): LedgerPaymentSplit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<RentalPaymentSplitSnapshot>;
  if (s.v !== 1) return null;
  const shares = Array.isArray(s.owner?.shares) ? s.owner.shares : [];
  const label = typeof s.agency?.label === "string" ? s.agency.label.trim() : "";
  const agencyTotal = num(s.agency?.total);
  return {
    ownerTotal: num(s.owner?.total),
    agencyTotal,
    agencyAccountName,
    agencyLabel: label && label !== "nada" ? label : agencyTotal > 0 ? "honorarios" : "sin honorarios",
    owners: shares.map((o) => ({
      name: typeof o?.name === "string" && o.name.trim() ? o.name.trim() : "Propietario",
      amount: num(o?.amount),
    })),
    route: isPaymentRoute(s.route) ? s.route : "cada_uno",
  };
}

/**
 * Las filas de "Cómo se pagó" del recibo: a cada uno su parte (una fila por
 * titular y la de la inmobiliaria), o una sola fila si el inquilino le pagó
 * todo a uno (el recibo dice a quién le pagó, no cómo se reparte después).
 */
export function receiptSplitRows(split: LedgerPaymentSplit, orgName: string): { label: string; amount: number }[] {
  const agency = orgName.trim() || "la inmobiliaria";
  const owners = split.owners.filter((o) => o.amount > 0.004);
  if (split.route === "todo_propietario") {
    const to = owners.length === 1 ? `Todo al propietario · ${owners[0].name}` : owners.length > 1 ? "Todo a los propietarios" : "Todo al propietario";
    return [{ label: to, amount: round2(split.ownerTotal + split.agencyTotal) }];
  }
  if (split.route === "todo_inmobiliaria") {
    return [{ label: [`Todo a ${agency}`, split.agencyAccountName].filter(Boolean).join(" · "), amount: round2(split.ownerTotal + split.agencyTotal) }];
  }
  const rows =
    owners.length > 1
      ? owners.map((o) => ({ label: `Al propietario · ${o.name}`, amount: o.amount }))
      : [{ label: owners.length === 1 ? `Al propietario · ${owners[0].name}` : "Al propietario", amount: split.ownerTotal }];
  if (split.agencyTotal > 0.004) {
    rows.push({ label: [`A ${agency}`, split.agencyLabel, split.agencyAccountName].filter(Boolean).join(" · "), amount: split.agencyTotal });
  }
  return rows;
}

/** Renglón abierto de la cuenta del inquilino (lo que todavía debe de un ítem). */
export interface DebtSplitItem {
  itemId: string;
  kind: ChargeItemKind;
  payee: Payee;
  outstanding: number;
}

/**
 * Cobra el propietario: cuánto le transfiere el inquilino a cada uno si paga
 * todo lo que debe hoy, con los datos bancarios de cada titular. Para el aviso
 * de pago (y el portal): si sólo dice "pagale al propietario", el inquilino le
 * manda todo a él y la parte de la inmobiliaria no llega. null si no debe nada.
 */
export interface DirectPaymentGuide {
  total: number;
  owner: {
    total: number;
    shares: { name: string; pct: number; amount: number; bankName: string | null; cbu: string | null; alias: string | null }[];
  };
  /** Va a la cuenta de la inmobiliaria (la de las instrucciones de pago). */
  agency: { total: number; label: string };
}

export function directPaymentGuide(input: {
  items: readonly DebtSplitItem[];
  rule: SplitRule;
  owners: readonly SplitOwnerBank[];
}): DirectPaymentGuide | null {
  const open = input.items.filter((i) => i.outstanding > 0.004);
  const total = round2(open.reduce((s, i) => s + i.outstanding, 0));
  if (!(total > 0)) return null;
  const lines = splitLinesFromAllocations(
    open.map((i) => ({ itemId: i.itemId, newItemIndex: null, amount: i.outstanding })),
    new Map(open.map((i) => [i.itemId, { kind: i.kind, payee: i.payee }])),
    "propietario",
  );
  const split = splitDirectPayment({ total, lines, rule: input.rule, owners: input.owners });
  const byId = new Map(input.owners.map((o) => [o.ownerId, o]));
  const label = agencyPartLabel(split);
  return {
    total: split.total,
    owner: {
      total: split.owner.total,
      shares: split.owner.shares
        .filter((s) => s.amount > 0.004)
        .map((s) => {
          const o = byId.get(s.ownerId);
          return { name: s.name, pct: s.pct, amount: s.amount, bankName: clean(o?.bankName), cbu: clean(o?.cbu), alias: clean(o?.alias) };
        }),
    },
    agency: { total: split.agency.total, label: label === "nada" ? "" : label },
  };
}
