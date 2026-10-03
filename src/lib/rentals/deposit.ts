import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney } from "@/lib/format";
import type { RentalContract, RentalMoneyOwner, RentalPayee } from "@/lib/types/database";

/**
 * Depósito en garantía: reglas puras que comparten el servidor (validación) y
 * el diálogo de cierre (avisos en vivo). El ciclo completo vive en la 068h:
 * pendiente → retenido (cobrado por la cuenta o marcado a mano) → devuelto /
 * aplicado a deudas / pasado a la renovación.
 */

/** Estados en que el depósito ya se cerró (incluye 'trasladado', de la 068h). */
const SETTLED: ReadonlySet<string> = new Set(["devuelto", "aplicado", "trasladado"]);

export function isDepositSettled(status: string): boolean {
  return SETTLED.has(status);
}

/** Lo que la ficha necesita saber para ofrecer las acciones del depósito. */
export interface DepositFlags {
  /** Hay renglón de depósito en la cuenta del inquilino: queda cobrado al registrar ese cobro, no a mano. */
  tracked: boolean;
  /** Se marcó cobrado a mano (se puede desmarcar mientras no se cierre). */
  receivedManually: boolean;
  /** N° del contrato anterior si el depósito viene de una renovación. */
  inheritedFromNumber: number | null;
  /** Quién tiene la plata del depósito hoy (depositPlace): puede no ser lo que dice el contrato. */
  heldBy: RentalMoneyOwner;
}

type DepositPlace = Pick<RentalContract, "currency" | "deposit_currency" | "deposit_holder" | "collector">;

export function depositCurrencyOf(c: Pick<RentalContract, "currency" | "deposit_currency">): string {
  return c.deposit_currency || c.currency;
}

/** Renglón 'deposito' de la cuenta del inquilino (de un cargo sin anular). */
export interface DepositItemRef {
  payee: string;
  amount: number;
  /** Lo cobrado del renglón (paid_amount). */
  paid?: number;
}

/**
 * Cuánto del depósito está de verdad en garantía (068j). Con renglones en la
 * cuenta, lo cobrado de ellos más lo que pasó de la renovación anterior. Sin
 * renglones, lo que pasó de la renovación anterior (si la renovación pide más y
 * la diferencia nunca se cobró, el contrato dice más de lo que hay); si no, el
 * monto del contrato (marcado a mano). Con un depósito en cuotas cuyas cuotas
 * impagas se anularon al rescindir, cerrar con el monto del contrato devolvería
 * desde Caja una plata que nunca entró. Espejo de v_basis en
 * apartcba.rental_settle_deposit.
 */
export function depositHeldAmount(c: Pick<RentalContract, "deposit_amount"> & { deposit_meta?: unknown }, items: readonly DepositItemRef[]): number {
  const meta = c.deposit_meta as { inherited?: { amount?: unknown } | null; received?: unknown } | null | undefined;
  const inheritedRaw = meta?.inherited ? meta.inherited.amount : undefined;
  const inherited = inheritedRaw == null || inheritedRaw === "" ? null : Number(inheritedRaw);
  const live = items.filter((i) => Number(i.amount) > 0);
  if (!live.length) {
    if (meta?.inherited && !meta.received && inherited != null && Number.isFinite(inherited)) return round2(inherited);
    return round2(Number(c.deposit_amount));
  }
  const paid = live.reduce((s, i) => s + Math.max(0, Math.min(Number(i.paid ?? 0), Number(i.amount))), 0);
  return round2(paid + (inherited != null && Number.isFinite(inherited) ? inherited : 0));
}

type PlaceInput = Pick<RentalContract, "collector" | "deposit_holder"> & { deposit_meta?: unknown };

export interface DepositPlaceInfo {
  /** Quién tiene la plata del depósito hoy. */
  heldBy: RentalMoneyOwner;
  /** Por qué no es quien dice el contrato (null = es ese). */
  note: string | null;
}

/**
 * Dónde está de verdad la plata del depósito (068j). El contrato dice quién lo
 * guarda, pero si se cobró por la cuenta del inquilino manda adónde fue ese
 * cobro: el renglón «para el propietario» se le rinde con los cobros (y si los
 * cobros los recibe él, lo cobró directamente), así que lo tiene él aunque el
 * contrato diga inmobiliaria. Con que una parte haya ido al propietario se toma
 * como suyo: así el cierre nunca saca de Caja ni le vuelve a rendir plata que
 * la inmobiliaria ya no tiene. Un depósito que pasó de la renovación anterior
 * trae dónde estaba (deposit_meta.inherited.held_by).
 * Es el espejo de apartcba.rental_deposit_holder: si cambia una, cambia la otra.
 */
export function depositPlace(c: PlaceInput, items: readonly DepositItemRef[]): DepositPlaceInfo {
  const live = items.filter((i) => Number(i.amount) > 0);
  const raw = (c.deposit_meta as { inherited?: { held_by?: unknown } | null } | null | undefined)?.inherited?.held_by;
  const inherited: RentalMoneyOwner | null = raw === "propietario" || raw === "inmobiliaria" ? raw : null;
  const viaAccount: RentalMoneyOwner | null = live.length
    ? c.collector === "propietario" || live.some((i) => i.payee === "propietario")
      ? "propietario"
      : "inmobiliaria"
    : null;
  const heldBy: RentalMoneyOwner =
    viaAccount === "propietario" || inherited === "propietario" ? "propietario" : (viaAccount ?? inherited ?? c.deposit_holder);
  if (heldBy === c.deposit_holder) return { heldBy, note: null };
  const fromAccount = viaAccount === heldBy;
  const note =
    heldBy === "propietario"
      ? fromAccount
        ? c.collector === "propietario"
          ? "Se cobró por la cuenta del inquilino y esos cobros los recibe el propietario: lo tiene él, aunque el contrato diga que lo guarda la inmobiliaria."
          : "Se cobró por la cuenta del inquilino para el propietario (se le rinde con los cobros): lo tiene él, aunque el contrato diga que lo guarda la inmobiliaria."
        : "Viene del contrato anterior, donde lo tenía el propietario: lo tiene él, aunque este contrato diga que lo guarda la inmobiliaria."
      : fromAccount
        ? "Se cobró por la cuenta del inquilino sin rendírselo al propietario: está en la Caja de la inmobiliaria, aunque el contrato diga que lo guarda el propietario."
        : "Viene del contrato anterior, donde estaba en la Caja de la inmobiliaria, aunque este contrato diga que lo guarda el propietario.";
  return { heldBy, note };
}

/** De quién es un renglón 'deposito' que se carga en la cuenta: lo mismo que arma activateContract. */
export function depositItemPayee(holder: RentalMoneyOwner): RentalPayee {
  return holder === "propietario" ? "propietario" : "tercero";
}

type DepositItemGate = Pick<RentalContract, "deposit_amount" | "deposit_status" | "currency" | "deposit_currency"> & { deposit_meta?: unknown };

/**
 * Por qué no se puede cargar un renglón de depósito en la cuenta del inquilino
 * (null = se puede). Sin depósito en el contrato la plata quedaría fuera de su
 * ciclo (nadie pediría devolverla); en otra moneda, la cuenta lo cobraría en la
 * del contrato (al activar tampoco entra al cargo de ingreso); con el depósito
 * ya marcado cobrado a mano se contaría dos veces y su ingreso en Caja no se
 * podría deshacer más.
 */
export function depositItemBlocker(c: DepositItemGate): string | null {
  if (!(Number(c.deposit_amount) > 0)) {
    return "Este contrato no tiene depósito: cargá el monto en el contrato (Editar) y después cobralo acá.";
  }
  const depositCurrency = depositCurrencyOf(c);
  if (depositCurrency !== c.currency) {
    return `El depósito es en ${depositCurrency} y la cuenta del inquilino en ${c.currency}: no se cobra por la cuenta. Cuando lo reciba, marcalo como cobrado desde la ficha del contrato («Más» → Marcar depósito como cobrado).`;
  }
  if (isDepositSettled(c.deposit_status)) {
    return "El depósito de este contrato ya se cerró: para cobrar más depósito, deshacé primero el cierre desde la ficha del contrato.";
  }
  const received = (c.deposit_meta as { received?: { on?: unknown } | null } | null | undefined)?.received;
  if (received) {
    const on = typeof received.on === "string" && received.on ? ` el ${ddmmyyyy(received.on)}` : "";
    return `El depósito ya se marcó como cobrado a mano${on}, así que no se cobra también por la cuenta del inquilino. Si se marcó por error, desmarcalo desde la ficha del contrato («Más» → Desmarcar depósito cobrado) y después cargalo acá.`;
  }
  return null;
}

/**
 * Por qué lo que se usa del depósito para deudas NO se puede imputar solo a la
 * cuenta del inquilino (null = sí se puede). Se imputa como un cobro sin
 * ingreso en Caja, así que la plata tiene que estar donde entran los cobros:
 * si el depósito lo tiene el propietario y los cobros pasan por la inmobiliaria,
 * imputarlo lo mandaría a la rendición y se le pagaría dos veces. `heldBy` es
 * dónde está la plata de verdad (depositPlace), que puede no ser lo que dice el
 * contrato: un depósito cobrado «para el propietario» ya se le rindió.
 */
export function depositAllocationBlocker(c: DepositPlace, heldBy: RentalMoneyOwner = c.deposit_holder): string | null {
  const depositCurrency = depositCurrencyOf(c);
  if (depositCurrency !== c.currency) {
    return `El depósito es en ${depositCurrency} y la cuenta del inquilino en ${c.currency}: lo que se use para deudas queda anotado, pero los cargos que cubra bonificalos desde la cuenta corriente.`;
  }
  if (heldBy === "propietario" && c.collector !== "propietario") {
    return heldBy !== c.deposit_holder
      ? "El depósito se cobró para el propietario (se le rinde con los cobros), así que lo tiene él: lo que use para deudas queda anotado, pero los cargos que cubra bonificalos desde la cuenta corriente (si se imputaran acá, se le rendirían otra vez)."
      : "El depósito lo tiene el propietario: lo que use para deudas queda anotado, pero los cargos que cubra bonificalos desde la cuenta corriente (si se imputaran acá, se le rendirían otra vez).";
  }
  if (heldBy === "inmobiliaria" && c.collector !== "inmobiliaria") {
    return "El alquiler lo cobra el propietario: entregale lo que se use del depósito y bonificá desde la cuenta corriente los cargos que cubra.";
  }
  return null;
}

/** Reparto que se propone al abrir el diálogo: primero lo que quedó debiendo, el resto se devuelve. */
export function suggestDepositSplit(depositAmount: number, debt: number | null): { applied: number; returned: number } {
  const deposit = round2(Math.max(0, depositAmount));
  const applied = round2(Math.min(deposit, Math.max(0, debt ?? 0)));
  return { applied, returned: round2(deposit - applied) };
}

export interface DepositSettlementInput {
  depositAmount: number;
  currency: string;
  applied: number;
  returned: number;
  /** Deuda imputable hoy; null si lo aplicado no se imputa solo (sólo se anota). */
  debt: number | null;
  note: string;
}

export type DepositSettlementCheck =
  | { ok: true; status: "devuelto" | "aplicado"; difference: number }
  | { ok: false; error: string; field: "applied" | "returned" | "note"; difference: number };

/**
 * Valida el cierre. Lo aplicado más lo devuelto puede no dar el depósito (se
 * devuelve actualizado, o se retiene algo por un acuerdo), pero entonces se
 * pide una nota: así un cero de más no sale de Caja sin que nadie lo explique.
 */
export function checkDepositSettlement(input: DepositSettlementInput): DepositSettlementCheck {
  const applied = round2(input.applied);
  const returned = round2(input.returned);
  const deposit = round2(input.depositAmount);
  const difference = round2(applied + returned - deposit);
  if (!(applied >= 0) || !Number.isFinite(applied)) return { ok: false, error: "Lo aplicado no puede ser negativo.", field: "applied", difference };
  if (!(returned >= 0) || !Number.isFinite(returned)) return { ok: false, error: "Lo devuelto no puede ser negativo.", field: "returned", difference };
  if (applied + returned <= 0) {
    return { ok: false, error: "Ingresá cuánto se aplicó a deudas o cuánto se devolvió.", field: "returned", difference };
  }
  if (applied > deposit + 0.005) {
    return { ok: false, error: `No se puede aplicar más que el depósito (${formatMoney(deposit, input.currency)}).`, field: "applied", difference };
  }
  if (input.debt !== null && applied > round2(input.debt) + 0.005) {
    return {
      ok: false,
      error: round2(input.debt) > 0 ? `Lo que quedó debiendo es ${formatMoney(input.debt, input.currency)}: no se puede aplicar más que eso.` : "No quedó nada por cobrar: no hay deudas a las que aplicarlo.",
      field: "applied",
      difference,
    };
  }
  if (Math.abs(difference) > 0.01 && !input.note.trim()) {
    return { ok: false, error: "Lo aplicado más lo devuelto no da el depósito: contá por qué en la nota (queda en el historial).", field: "note", difference };
  }
  return { ok: true, status: returned > 0 ? "devuelto" : "aplicado", difference };
}

function ddmmyyyy(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

type DepositCard = Pick<
  RentalContract,
  "status" | "currency" | "deposit_amount" | "deposit_currency" | "deposit_holder" | "deposit_status" | "deposit_returned_amount" | "deposit_returned_at"
>;

/**
 * Texto corto del estado del depósito (tarjeta de la ficha). `heldBy`: dónde
 * está la plata de verdad (depositPlace); sin él, lo que dice el contrato.
 */
export function depositStatusHint(c: DepositCard, heldBy?: RentalMoneyOwner | null): string {
  if (!(Number(c.deposit_amount) > 0)) return "El contrato no tiene depósito";
  const holder = (heldBy ?? c.deposit_holder) === "propietario" ? "lo guarda el propietario" : "lo guarda la inmobiliaria";
  const ended = c.status === "finalizado" || c.status === "rescindido";
  const on = c.deposit_returned_at ? ` el ${ddmmyyyy(c.deposit_returned_at)}` : "";
  const status: string = c.deposit_status;
  switch (status) {
    case "pendiente":
      return ended ? `No figura cobrado · ${holder}` : `A cobrar · ${holder}`;
    case "retenido":
      return ended ? `Retenido · falta devolverlo o aplicarlo` : `Cobrado · ${holder}`;
    case "devuelto": {
      const returned = Number(c.deposit_returned_amount ?? 0);
      const amount = returned > 0 ? ` ${formatMoney(returned, depositCurrencyOf(c))}` : "";
      return `Devuelto${amount}${on}`;
    }
    case "aplicado":
      return `Aplicado a deudas${on}`;
    case "trasladado":
      return `Pasó a la renovación${on}`;
    default:
      return holder;
  }
}
