/**
 * Anular el pago de una liquidación (migración 069): tipos y lógica pura que
 * comparten la acción, el diálogo de confirmación y los avisos de Caja.
 *
 * Vive fuera de `actions/settlements.ts` porque un archivo "use server" no
 * puede exportar tipos ni funciones sincrónicas, y el diálogo (cliente) y
 * `cash.ts` necesitan los mismos textos y el mismo criterio.
 */
import { formatMoney } from "@/lib/format";

export type PaymentUndoMovementKind = "pago" | "ajuste";

/** Un movimiento de Caja que se borra al anular el pago. */
export interface PaymentUndoMovement {
  id: string;
  kind: PaymentUndoMovementKind;
  account_id: string;
  account_name: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  occurred_at: string;
  description: string | null;
}

/** Lo que muestra la confirmación antes de anular. */
export interface PaymentUndoPreview {
  settlement_id: string;
  period_label: string;
  owner_name: string | null;
  currency: string;
  net_payable: number;
  paid_at: string | null;
  movements: PaymentUndoMovement[];
}

/** Tope del motivo — espejo del chequeo MOTIVO_LARGO del RPC. */
export const PAYMENT_UNDO_REASON_MAX = 300;

/** Mínimo del motivo: "x" o "." no le explican nada a quien lea el historial. */
export const PAYMENT_UNDO_REASON_MIN = 3;

/** La advertencia de la confirmación: se borra plata registrada en Caja. */
export const PAYMENT_UNDO_WARNING =
  "Hacelo sólo si la transferencia no se hizo o se devolvió: borra el egreso de Caja.";

/**
 * Mismo criterio que el RPC: el movimiento de `paid_movement_id` y los
 * `settlement_payment` son el pago (uno por cuenta si se dividió); los
 * `settlement_adjustment` son los asientos que postearon las ediciones hechas
 * después de pagar.
 */
export function paymentMovementKind(
  m: { id: string; ref_type: string | null },
  paidMovementId: string | null,
): PaymentUndoMovementKind {
  return m.ref_type === "settlement_adjustment" && m.id !== paidMovementId
    ? "ajuste"
    : "pago";
}

/** Cronológico, como en Caja; el id desempata para que el orden no salte. */
export function sortPaymentUndoMovements<
  T extends { id: string; occurred_at: string },
>(movements: readonly T[]): T[] {
  return [...movements].sort((a, b) => {
    // Una fecha ilegible va primero en vez de devolver NaN (orden indefinido).
    const ta = Date.parse(a.occurred_at) || 0;
    const tb = Date.parse(b.occurred_at) || 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PaymentUndoSummary {
  count: number;
  /** Egresos que se borran: esa plata vuelve a figurar en la cuenta. */
  totalOut: number;
  /** Ingresos de ajuste que se borran: esa plata deja de figurar. */
  totalIn: number;
  /** Lo que vuelve a la Caja en neto (egresos − ingresos). */
  net: number;
  /** Efecto neto por cuenta, en el orden en que aparece cada una. */
  byAccount: Array<{
    account_id: string;
    account_name: string;
    currency: string;
    net: number;
  }>;
}

/**
 * Qué le pasa a la Caja si se confirma. Borrar un egreso SUMA al saldo de su
 * cuenta y borrar un ingreso de ajuste RESTA: la confirmación muestra el neto
 * por cuenta para que nadie se sorprenda después con el saldo.
 */
export function summarizePaymentUndo(
  movements: readonly PaymentUndoMovement[],
): PaymentUndoSummary {
  let totalOut = 0;
  let totalIn = 0;
  const byAccount = new Map<string, PaymentUndoSummary["byAccount"][number]>();
  for (const m of movements) {
    const amount = Number(m.amount) || 0;
    const signed = m.direction === "out" ? amount : -amount;
    if (m.direction === "out") totalOut += amount;
    else totalIn += amount;
    const prev = byAccount.get(m.account_id);
    if (prev) prev.net = round2(prev.net + signed);
    else
      byAccount.set(m.account_id, {
        account_id: m.account_id,
        account_name: m.account_name,
        currency: m.currency,
        net: round2(signed),
      });
  }
  return {
    count: movements.length,
    totalOut: round2(totalOut),
    totalIn: round2(totalIn),
    net: round2(totalOut - totalIn),
    byAccount: [...byAccount.values()],
  };
}

/** "Egreso del pago" / "Ingreso de ajuste": qué fue cada movimiento. */
export function paymentUndoMovementLabel(
  m: Pick<PaymentUndoMovement, "kind" | "direction">,
): string {
  const what = m.direction === "out" ? "Egreso" : "Ingreso";
  return m.kind === "ajuste" ? `${what} de ajuste` : `${what} del pago`;
}

/**
 * Cómo cambia el saldo de cada cuenta al borrar: lo que más sorprende después
 * de anular es ver la cuenta con más plata, así que se dice antes.
 */
export function paymentUndoBalanceText(summary: PaymentUndoSummary): string | null {
  if (summary.count === 0) return null;
  const moved = summary.byAccount.filter((a) => Math.abs(a.net) >= 0.005);
  if (moved.length === 0) return "El saldo de las cuentas no cambia.";
  const verb = (net: number) => (net > 0 ? "sube" : "baja");
  const lead = summary.count === 1 ? "Al borrarlo" : "Al borrarlos";
  if (moved.length === 1) {
    const a = moved[0];
    return `${lead}, el saldo de ${a.account_name} ${verb(a.net)} ${formatMoney(Math.abs(a.net), a.currency)}.`;
  }
  const parts = moved.map(
    (a) => `${a.account_name} ${verb(a.net)} ${formatMoney(Math.abs(a.net), a.currency)}`,
  );
  return `${lead}: ${parts.join(" · ")}.`;
}

/** Lo que Caja tiene como pagado contra lo que la liquidación da hoy. */
export interface PaymentUndoNetGap {
  /** Lo que salió según Caja: egresos − ingresos de los movimientos que se borran. */
  paidNet: number;
  /** El neto de la liquidación hoy: lo que va a pedir «Registrar pago». */
  net: number;
  /** net − paidNet. Positivo: hoy pide más de lo que salió; negativo, menos. */
  gap: number;
}

/**
 * Una edición «Solo visual» después de pagar cambia el neto sin tocar Caja (a
 * propósito: el egreso queda intacto). Al anular y volver a pagar, «Registrar
 * pago» exige el neto de HOY, no lo que salió del banco: quien anula sólo para
 * corregir la cuenta o la fecha terminaría registrando en Caja plata que no
 * salió (o menos de la que salió) sin enterarse.
 *
 * `null` cuando no hay con qué comparar: sin movimientos en Caja (no hay un
 * pago registrado que se pierda) o con otra moneda (no se restan pesos y
 * dólares).
 */
export function paymentUndoNetGap(
  preview: Pick<PaymentUndoPreview, "net_payable" | "currency" | "movements">,
): PaymentUndoNetGap | null {
  const { movements } = preview;
  if (movements.length === 0) return null;
  if (movements.some((m) => m.currency !== preview.currency)) return null;
  const paidNet = summarizePaymentUndo(movements).net;
  const net = round2(Number(preview.net_payable) || 0);
  return { paidNet, net, gap: round2(net - paidNet) };
}

/** Diferencia que vale la pena avisar: un centavo o más. */
export function hasPaymentUndoNetGap(
  gap: PaymentUndoNetGap | null,
): gap is PaymentUndoNetGap {
  return gap !== null && Math.abs(gap.gap) >= 0.01;
}

export const PAYMENT_UNDO_GAP_TITLE = "Caja y la liquidación no dan lo mismo";

/**
 * El aviso de la confirmación cuando hay diferencia: cuánto salió según Caja,
 * cuánto da hoy la liquidación y qué se registraría al pagarla de nuevo.
 */
export function paymentUndoNetGapText(
  gap: PaymentUndoNetGap,
  currency: string,
): string {
  const paid = formatMoney(gap.paidNet, currency);
  const net = formatMoney(gap.net, currency);
  const head = `En Caja el pago suma ${paid}, pero la liquidación hoy da ${net} (pasa cuando se la edita después de pagada con «Solo visual», que no toca Caja).`;
  if (!(gap.net > 0)) {
    return `${head} Así no se puede volver a pagar: «Registrar pago» necesita un neto mayor a cero. Corregí la liquidación antes de pagarla de nuevo.`;
  }
  const diff = formatMoney(Math.abs(gap.gap), currency);
  const effect =
    gap.gap > 0
      ? `Caja registraría ${diff} que no salieron`
      : `Caja registraría ${diff} menos de lo que salió`;
  return `${head} Si la volvés a pagar, «Registrar pago» te va a pedir ${net}. Si el pago sí salió por ${paid} y anulás sólo para corregir la cuenta o la fecha, ${effect}: primero corregí la liquidación para que dé lo que salió.`;
}

/** El aviso de éxito: qué se borró y en qué quedó la liquidación. */
export function paymentUndoSuccessText(result: PaymentUndoResult): string {
  const tail = "La liquidación volvió a Revisada.";
  if (result.count === 0) {
    return `No había movimientos del pago en Caja. ${tail}`;
  }
  if (result.count === 1) {
    const m = result.movements[0];
    return `Se borró de Caja el ${paymentUndoMovementLabel(m).toLowerCase()} de ${formatMoney(m.amount, m.currency)} (${m.account_name}). ${tail}`;
  }
  const currency = result.movements[0]?.currency ?? "ARS";
  return `Se borraron ${result.count} movimientos de Caja (${formatMoney(Math.abs(result.net), currency)} en neto). ${tail}`;
}

/** Lo que devuelve la anulación ya hecha: lo borrado y su efecto en Caja. */
export interface PaymentUndoResult extends PaymentUndoSummary {
  movements: PaymentUndoMovement[];
}

/**
 * Lee la lista `movements` que devuelve el RPC (jsonb). Defensivo: un campo
 * que falte no puede tirar abajo una anulación que YA se confirmó en la base;
 * a lo sumo se muestra menos detalle.
 */
export function parsePaymentUndoRpcMovements(raw: unknown): PaymentUndoMovement[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentUndoMovement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      kind: r.kind === "ajuste" ? "ajuste" : "pago",
      account_id: typeof r.account_id === "string" ? r.account_id : "",
      account_name:
        typeof r.account_name === "string" && r.account_name.trim()
          ? r.account_name
          : "Cuenta sin nombre",
      direction: r.direction === "in" ? "in" : "out",
      amount: Number(r.amount) || 0,
      currency: typeof r.currency === "string" ? r.currency : "ARS",
      occurred_at: typeof r.occurred_at === "string" ? r.occurred_at : "",
      description: typeof r.description === "string" ? r.description : null,
    });
  }
  return sortPaymentUndoMovements(out);
}

/** Mismo conjunto de ids, sin importar el orden ni los repetidos. */
export function samePaymentMovementSet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const id of sa) if (!sb.has(id)) return false;
  return true;
}

/**
 * Los errores del RPC llegan como "CODIGO: detalle". Se traducen a algo que
 * la persona pueda accionar; lo desconocido pasa tal cual (mejor un mensaje
 * técnico que uno inventado).
 */
export function paymentUndoErrorMessage(raw: string): string {
  if (raw.includes("MOTIVO_REQUERIDO")) return "Contá por qué anulás el pago.";
  if (raw.includes("MOTIVO_LARGO")) {
    return `El motivo no puede pasar de ${PAYMENT_UNDO_REASON_MAX} caracteres.`;
  }
  if (raw.includes("LIQUIDACION_NO_ENCONTRADA")) {
    return "No encontramos la liquidación.";
  }
  if (raw.includes("NO_PAGADA")) {
    return "La liquidación ya no figura como pagada: alguien anuló el pago o cambió el estado. Recargá la página.";
  }
  if (raw.includes("PAGO_CAMBIO")) {
    return "Los movimientos del pago cambiaron mientras confirmabas (alguien editó la liquidación). No se borró nada: revisá la lista otra vez.";
  }
  if (raw.includes("MOVIMIENTO_INESPERADO")) {
    return "Hay un movimiento vinculado al pago que no es un pago de liquidación. No se tocó nada: revisalo en Caja.";
  }
  return raw;
}

/**
 * Qué hacer con un movimiento de Caja protegido por su liquidación.
 * Antes decía "Anulá la liquidación primero", y una liquidación pagada no se
 * puede anular (la liquidación, a su vez, pedía anular el pago en Caja): no
 * había salida. Ahora apunta a «Anular el pago».
 */
export function settlementLockHint(status: string | null | undefined): string {
  if (status === "pagada") {
    // Sirve para borrar y para editar: con la cuenta o la fecha mal, lo
    // correcto es anular el pago y volver a registrarlo. No se promete "el
    // mismo pago": «Registrar pago» pide el neto de ese momento, que puede no
    // ser lo que salió si la liquidación se editó con «Solo visual».
    return "Es parte del pago de esa liquidación. Para borrarlo o corregirlo, usá «Anular el pago» en la liquidación: vuelve a Revisada y el movimiento se borra de Caja. Al volver a pagarla, se registra por el neto que dé en ese momento.";
  }
  if (status === "revisada" || status === "enviada") {
    return "La liquidación está cerrada: pasala a Borrador desde su estado para poder editarlo.";
  }
  return "Si la liquidación está pagada y el pago no se hizo, usá «Anular el pago» en la liquidación; si no, pasala a Borrador desde su estado.";
}

/**
 * El mensaje del RPC de Caja trae "SETTLEMENT_LOCKED: liquidación 9/2026 en
 * estado pagada". Se arma el aviso con el período y la salida que corresponde.
 */
export function settlementLockedMessage(raw: string): string {
  const m = raw.match(/liquidaci[oó]n (\d{1,2})\/(\d{4}) en estado (\w+)/);
  if (!m) {
    return `El movimiento está vinculado a una liquidación cerrada. ${settlementLockHint(null)}`;
  }
  const period = `${m[1].padStart(2, "0")}/${m[2]}`;
  return `El movimiento está vinculado a la liquidación ${period}. ${settlementLockHint(m[3])}`;
}
