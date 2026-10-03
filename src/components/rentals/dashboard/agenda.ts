import { diffDays } from "@/lib/rentals/ymd";
import { consecutiveUnpaidRun } from "@/lib/rentals/arrears";
import { takesEffectAfterExit } from "@/lib/rentals/exit";
import { formatContractNumber, formatStatementNumber } from "@/lib/rentals/labels";
import {
  formatVariation,
  plainMoney,
  shortDate,
  waitingForIndexText,
} from "@/components/rentals/adjustments/adjustment-text";
import type { IndexSummary } from "@/components/rentals/indices/index-model";

/**
 * Agenda "Para hacer hoy" del resumen de Alquileres. Pura: recibe lo que ya
 * leyó el server y devuelve la lista ordenada por urgencia, con el texto y el
 * botón de cada cosa. Una fila por contrato (no una por cargo) y agrupada
 * cuando hay muchas del mismo tipo, para que la lista se lea de un vistazo.
 */

export type AgendaUrgency = "critical" | "high" | "medium" | "low";

export type AgendaKind =
  | "two_unpaid"
  | "overdue"
  | "payment_report"
  | "adjustment_ready"
  | "adjustment_manual"
  | "adjustment_stuck"
  | "expired_open"
  | "expiring"
  | "insurance"
  | "deposit_return"
  | "proof_review"
  | "statement_unpaid"
  | "draft";

export interface AgendaItem {
  key: string;
  kind: AgendaKind;
  urgency: AgendaUrgency;
  title: string;
  detail: string;
  href: string;
  cta: string;
  amount: number | null;
  currency: string | null;
  /** Fecha que ordena dentro de la misma urgencia (lo más viejo primero). */
  date: string | null;
  /** Para acciones directas (registrar el cobro sin salir del resumen). */
  contractId: string | null;
}

export interface AgendaContract {
  id: string;
  number: number;
  status: string;
  address: string;
  tenantName: string | null;
  endDate: string;
  terminatedAt: string | null;
  currency: string;
  insuranceRequired: boolean;
  insuranceExpiresAt: string | null;
  depositStatus: string;
  depositAmount: number;
  depositCurrency: string | null;
  /** Días de gracia del contrato (para no contar como impago un período todavía en plazo). */
  graceDays?: number;
  /**
   * Contrato del que es renovación (renewed_from_id). Con la renovación en la
   * lista, el anterior no pide "definí si se renueva" ni "devolvé el depósito".
   */
  renewedFromId?: string | null;
}

export interface AgendaOverdueCharge {
  contractId: string;
  kind: string;
  label: string;
  dueDate: string;
  outstanding: number;
  currency: string;
  /** Período del cronograma (cargos mensuales). Sin él no se puede hablar de períodos consecutivos. */
  periodIndex?: number | null;
  /** Alquiler del período y lo que falta pagar de él (ver `rentBalanceOf`): punitorios y otros conceptos no cuentan. */
  rentAmount?: number | null;
  rentOutstanding?: number | null;
}

export interface AgendaAdjustment {
  id: string;
  contractId: string;
  status: string;
  effectiveDate: string;
  baseAmount: number | null;
  computedAmount: number | null;
  variationPct: number | null;
  indexCode: string | null;
  toKey: string | null;
  fromKey?: string | null;
}

export interface AgendaInput {
  today: string;
  contracts: AgendaContract[];
  overdue: AgendaOverdueCharge[];
  adjustments: AgendaAdjustment[];
  /** Resúmenes de índices: con la cobertura de Casa Propia se nombra el mes que de verdad falta. */
  indices?: Pick<IndexSummary, "code" | "coverage">[];
  /** createdOn: el día del aviso en la zona de la organización (createdAt es timestamptz y su fecha UTC puede ser "mañana"). */
  paymentReports: { id: string; contractId: string; amount: number | null; currency: string | null; createdAt: string; createdOn?: string }[];
  proofsInReview: number;
  unpaidStatements: { id: string; number: number; ownerName: string; net: number; currency: string; date: string | null }[];
}

const RANK: Record<AgendaUrgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const BASE = "/dashboard/alquileres";
const contractHref = (id: string, tab?: string) => `${BASE}/contratos/${id}${tab ? `?tab=${tab}` : ""}`;

/** "hace 3 días" · "hoy" · "en 5 días". */
export function relativeDays(from: string, to: string): string {
  const d = diffDays(from, to);
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  if (d === -1) return "ayer";
  return d > 0 ? `en ${d} días` : `hace ${-d} días`;
}

function who(c: AgendaContract | undefined): string {
  if (!c) return "Contrato";
  return c.tenantName || formatContractNumber(c.number);
}

function overdueItems(input: AgendaInput, byId: Map<string, AgendaContract>): AgendaItem[] {
  const groups = new Map<string, AgendaOverdueCharge[]>();
  for (const ch of input.overdue) {
    if (!(ch.outstanding > 0.005)) continue;
    const list = groups.get(ch.contractId) ?? [];
    list.push(ch);
    groups.set(ch.contractId, list);
  }
  const out: AgendaItem[] = [];
  for (const [contractId, list] of groups) {
    const c = byId.get(contractId);
    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const oldest = list[0];
    const total = list.reduce((s, x) => s + x.outstanding, 0);
    const currency = oldest.currency;
    // Causal del art. 1219 inc. c sólo con DOS PERÍODOS CONSECUTIVOS con el alquiler
    // impago: dos cargos vencidos cualesquiera (o un resto de punitorios) no alcanzan.
    const run = consecutiveUnpaidRun(
      list.map((x) => ({ kind: x.kind, periodIndex: x.periodIndex, dueDate: x.dueDate, rentAmount: x.rentAmount, rentOutstanding: x.rentOutstanding })),
      { today: input.today, graceDays: c?.graceDays ?? 0 },
    );
    const where = c ? `${c.address} · ` : "";
    if (run.length >= 2) {
      out.push({
        key: `two_unpaid:${contractId}`,
        kind: "two_unpaid",
        urgency: "critical",
        title: `${run.length} períodos seguidos sin pagar · ${who(c)}`,
        detail: `${where}debe ${plainMoney(total, currency)}. Dos períodos consecutivos sin pagar son causal de resolución (art. 1219 CCyC): antes de reclamar, intimá el pago con 10 días de plazo.`,
        href: contractHref(contractId, "cuenta"),
        cta: "Ver cuenta",
        amount: total,
        currency,
        date: oldest.dueDate,
        contractId,
      });
      continue;
    }
    const extra = list.length > 1 ? ` y ${list.length - 1} cargo${list.length > 2 ? "s" : ""} más` : "";
    out.push({
      key: `overdue:${contractId}`,
      kind: "overdue",
      urgency: "high",
      title: `Cobro vencido · ${who(c)}`,
      detail: `${where}${oldest.label} venció el ${shortDate(oldest.dueDate)} (${relativeDays(input.today, oldest.dueDate)})${extra}.`,
      href: contractHref(contractId, "cuenta"),
      cta: "Registrar cobro",
      amount: total,
      currency,
      date: oldest.dueDate,
      contractId,
    });
  }
  return out;
}

const ADJ_META: Record<"calculado" | "pendiente_manual" | "pendiente_indice", { kind: AgendaKind; title: string; cta: string; many: (n: number) => string }> = {
  calculado: { kind: "adjustment_ready", title: "Ajuste listo para aplicar", cta: "Aplicar", many: (n) => `${n} ajustes listos para aplicar` },
  pendiente_manual: { kind: "adjustment_manual", title: "Falta cargar el monto del ajuste", cta: "Cargar monto", many: (n) => `${n} ajustes sin monto cargado` },
  pendiente_indice: { kind: "adjustment_stuck", title: "Ajuste trabado: falta el índice", cta: "Ver ajuste", many: (n) => `${n} ajustes esperando índice` },
};

function adjustmentItems(input: AgendaInput, byId: Map<string, AgendaContract>): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const status of ["calculado", "pendiente_manual", "pendiente_indice"] as const) {
    const meta = ADJ_META[status];
    const rows = input.adjustments.filter((a) => {
      if (a.status !== status) return false;
      // Rige después de la salida registrada: el inquilino ya no va a estar.
      if (takesEffectAfterExit(a.effectiveDate, byId.get(a.contractId)?.terminatedAt)) return false;
      // El índice suele salir a mitad de mes: recién es "trabado" si lleva 5 días.
      if (status === "pendiente_indice") return diffDays(a.effectiveDate, input.today) >= 5;
      return diffDays(input.today, a.effectiveDate) <= 15;
    });
    if (!rows.length) continue;
    rows.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const urgencyOf = (d: string): AgendaUrgency => (status !== "pendiente_indice" && d <= input.today ? "high" : "medium");
    if (rows.length > 3) {
      out.push({
        key: `${meta.kind}:many`,
        kind: meta.kind,
        urgency: urgencyOf(rows[0].effectiveDate),
        title: meta.many(rows.length),
        detail: `El primero rige desde el ${shortDate(rows[0].effectiveDate)}.`,
        href: `${BASE}/ajustes?tab=pendientes`,
        cta: "Ver ajustes",
        amount: null,
        currency: null,
        date: rows[0].effectiveDate,
        contractId: null,
      });
      continue;
    }
    for (const a of rows) {
      const c = byId.get(a.contractId);
      const cur = c?.currency ?? "ARS";
      let detail = `Rige desde el ${shortDate(a.effectiveDate)}.`;
      if (status === "calculado" && a.baseAmount != null && a.computedAmount != null) {
        detail = `${plainMoney(a.baseAmount, cur)} → ${plainMoney(a.computedAmount, cur)} (${formatVariation(a.variationPct)}) desde el ${shortDate(a.effectiveDate)}.`;
      } else if (status === "pendiente_indice") {
        // Sin resumen del índice, coverage queda undefined (null sería "no hay nada cargado").
        const coverage = input.indices?.find((s) => s.code === a.indexCode)?.coverage;
        detail = `Rige desde el ${shortDate(a.effectiveDate)}. ${waitingForIndexText(a.indexCode, a.toKey, { coverage, fromKey: a.fromKey })}`;
      }
      out.push({
        key: `${meta.kind}:${a.id}`,
        kind: meta.kind,
        urgency: urgencyOf(a.effectiveDate),
        title: `${meta.title} · ${who(c)}`,
        detail: c ? `${c.address} · ${detail}` : detail,
        href: `${BASE}/ajustes?tab=pendientes#ajuste-${a.id}`,
        cta: meta.cta,
        amount: null,
        currency: null,
        date: a.effectiveDate,
        contractId: a.contractId,
      });
    }
  }
  return out;
}

function contractItems(input: AgendaInput): AgendaItem[] {
  const { today } = input;
  const out: AgendaItem[] = [];
  const drafts: AgendaContract[] = [];
  // Renovación de cada contrato (la activa gana sobre un borrador).
  const renewalOf = new Map<string, AgendaContract>();
  for (const r of input.contracts) {
    if (!r.renewedFromId) continue;
    const prev = renewalOf.get(r.renewedFromId);
    if (!prev || prev.status === "borrador") renewalOf.set(r.renewedFromId, r);
  }
  for (const c of input.contracts) {
    const base = { amount: null, currency: null, contractId: c.id };
    if (c.status === "borrador") {
      drafts.push(c);
      continue;
    }
    if (c.status === "vigente") {
      const left = diffDays(today, c.endDate);
      const renewal = renewalOf.get(c.id);
      const draftRenewal = renewal?.status === "borrador" ? renewal : null;
      if (c.terminatedAt && c.terminatedAt < today) {
        // La salida registrada ya pasó y sigue abierto (el cierre automático falló o
        // nadie lo cerró): no puede desaparecer de la agenda.
        out.push({
          ...base,
          key: `exit_overdue:${c.id}`,
          kind: "expired_open",
          urgency: "high",
          title: `Salida del ${shortDate(c.terminatedAt)} sin cerrar · ${who(c)}`,
          detail: `${c.address} · la salida registrada ya pasó y el contrato sigue abierto. Si ya entregó las llaves, registrá la entrega; si sigue adentro, cambiá la salida.`,
          href: contractHref(c.id),
          cta: "Revisar",
          date: c.terminatedAt,
        });
      } else if (renewal?.status === "vigente") {
        // Ya rige (o está por regir) su renovación: se cierra solo el día antes, sin nada que decidir.
      } else if (c.terminatedAt) {
        // La salida ya está registrada (rescisión notificada o entrega programada):
        // no hay que decidir si se renueva, hay que preparar la entrega.
        const toExit = diffDays(today, c.terminatedAt);
        if (toExit >= 0 && toExit <= 30) {
          out.push({
            ...base,
            key: `exit:${c.id}`,
            kind: "expiring",
            urgency: toExit <= 7 ? "high" : "medium",
            title: `Desocupa ${toExit === 0 ? "hoy" : toExit === 1 ? "mañana" : `en ${toExit} días`} · ${who(c)}`,
            detail: `${c.address} · el ${shortDate(c.terminatedAt)}. Coordiná la entrega de llaves, revisá el estado del inmueble y definí qué pasa con el depósito.`,
            href: contractHref(c.id),
            cta: "Ver contrato",
            date: c.terminatedAt,
          });
        }
      } else if (left < 0) {
        out.push({
          ...base,
          key: `expired_open:${c.id}`,
          kind: "expired_open",
          urgency: "high",
          title: `Contrato vencido sin cerrar · ${who(c)}`,
          detail: draftRenewal
            ? `${c.address} · terminó el ${shortDate(c.endDate)}. La renovación ${formatContractNumber(draftRenewal.number)} está en borrador: al activarla, cobra ella desde su inicio y este se cierra.`
            : `${c.address} · terminó el ${shortDate(c.endDate)} y sigue abierto. Si el inquilino sigue, activá en la ficha el cobro de los meses de continuación (hasta entonces no se genera ningún cargo); si ya se fue, finalizalo.`,
          href: contractHref(draftRenewal?.id ?? c.id),
          cta: draftRenewal ? "Ver renovación" : "Resolver",
          date: c.endDate,
        });
      } else if (left <= 90) {
        out.push({
          ...base,
          key: `expiring:${c.id}`,
          kind: "expiring",
          urgency: left <= 30 ? "high" : left <= 60 ? "medium" : "low",
          title: `Vence ${left === 0 ? "hoy" : `en ${left} días`} · ${who(c)}`,
          detail: draftRenewal
            ? `${c.address} · el ${shortDate(c.endDate)}. La renovación ${formatContractNumber(draftRenewal.number)} está en borrador: activala cuando esté firmada.`
            : `${c.address} · el ${shortDate(c.endDate)}. Definí si se renueva o coordiná la entrega.`,
          href: contractHref(draftRenewal?.id ?? c.id),
          cta: draftRenewal ? "Ver renovación" : "Ver contrato",
          date: c.endDate,
        });
      }
      if (c.insuranceRequired && c.insuranceExpiresAt && diffDays(today, c.insuranceExpiresAt) <= 30) {
        const expired = c.insuranceExpiresAt < today;
        out.push({
          ...base,
          key: `insurance:${c.id}`,
          kind: "insurance",
          urgency: expired ? "high" : "medium",
          title: `Seguro ${expired ? "vencido" : "por vencer"} · ${who(c)}`,
          detail: `${c.address} · la póliza ${expired ? "venció" : "vence"} el ${shortDate(c.insuranceExpiresAt)}. Pedile la renovación al inquilino.`,
          href: contractHref(c.id),
          cta: "Ver contrato",
          date: c.insuranceExpiresAt,
        });
      }
      continue;
    }
    if ((c.status === "finalizado" || c.status === "rescindido") && c.depositStatus === "retenido" && c.depositAmount > 0) {
      const ended = c.terminatedAt ?? c.endDate;
      // Siguió con su renovación: el depósito no se devuelve, sigue en garantía del contrato nuevo.
      const renewal = renewalOf.get(c.id);
      const renewed = renewal && renewal.status !== "borrador" ? renewal : null;
      out.push({
        key: `deposit_return:${c.id}`,
        kind: "deposit_return",
        urgency: "medium",
        title: renewed ? `Depósito para pasar a la renovación · ${who(c)}` : `Depósito a devolver · ${who(c)}`,
        detail: renewed
          ? `${c.address} · siguió con la renovación ${formatContractNumber(renewed.number)}: pasale el depósito para que siga en garantía (o devolvelo si no corresponde).`
          : `${c.address} · el contrato terminó el ${shortDate(ended)}. Devolvelo, aplicalo a lo que quedó debiendo o, si renovó, pasalo a la renovación.`,
        href: contractHref(c.id),
        cta: renewed ? "Pasar el depósito" : "Cerrar el depósito",
        amount: c.depositAmount,
        currency: c.depositCurrency ?? c.currency,
        date: ended,
        contractId: c.id,
      });
    }
  }
  if (drafts.length) {
    const one = drafts.length === 1 ? drafts[0] : null;
    out.push({
      key: one ? `draft:${one.id}` : "draft:many",
      kind: "draft",
      urgency: "low",
      title: one ? `Contrato en borrador · ${who(one)}` : `${drafts.length} contratos en borrador`,
      detail: one
        ? `${one.address} · todavía no genera cargos ni ajustes. Activalo cuando esté firmado.`
        : "Todavía no generan cargos ni ajustes. Activalos cuando estén firmados.",
      href: one ? contractHref(one.id) : `${BASE}/contratos?vista=borradores`,
      cta: one ? "Revisar" : "Ver borradores",
      amount: null,
      currency: null,
      date: null,
      contractId: one?.id ?? null,
    });
  }
  return out;
}

function inboxItems(input: AgendaInput, byId: Map<string, AgendaContract>): AgendaItem[] {
  const out: AgendaItem[] = [];
  const reports = [...input.paymentReports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (reports.length === 1) {
    const r = reports[0];
    const c = byId.get(r.contractId);
    const amount = r.amount != null ? ` ${plainMoney(r.amount, r.currency ?? c?.currency ?? "ARS")}` : "";
    out.push({
      key: `payment_report:${r.id}`,
      kind: "payment_report",
      urgency: "high",
      title: `Aviso de pago · ${who(c)}`,
      detail: `${c ? `${c.address} · ` : ""}avisó desde su link que pagó${amount}. Registralo como cobro o descartalo.`,
      href: `${BASE}/comprobantes?tab=avisos`,
      cta: "Revisar",
      amount: r.amount,
      currency: r.currency,
      date: r.createdOn ?? r.createdAt.slice(0, 10),
      contractId: r.contractId,
    });
  } else if (reports.length > 1) {
    out.push({
      key: "payment_report:many",
      kind: "payment_report",
      urgency: "high",
      title: `${reports.length} avisos de pago para revisar`,
      detail: "Inquilinos que avisaron desde su link que ya pagaron. Registralos como cobro o descartalos.",
      href: `${BASE}/comprobantes?tab=avisos`,
      cta: "Revisar",
      amount: null,
      currency: null,
      date: reports[0].createdOn ?? reports[0].createdAt.slice(0, 10),
      contractId: null,
    });
  }
  if (input.proofsInReview > 0) {
    const n = input.proofsInReview;
    out.push({
      key: "proof_review",
      kind: "proof_review",
      urgency: "medium",
      title: n === 1 ? "1 comprobante para revisar" : `${n} comprobantes para revisar`,
      detail: "Expensas y servicios que subieron los inquilinos: validalos o rechazalos con el motivo.",
      href: `${BASE}/comprobantes`,
      cta: "Revisar",
      amount: null,
      currency: null,
      date: null,
      contractId: null,
    });
  }
  const sorted = [...input.unpaidStatements].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  // Neto cero o negativo: no hay nada que transferir. Se CIERRA con saldo a cuenta
  // (el saldo se descuenta en la próxima rendición); "Registrar pago" ni existe ahí.
  const toClose = sorted.filter((s) => s.net <= 0.005);
  const st = sorted.filter((s) => s.net > 0.005);
  if (toClose.length > 3) {
    out.push({
      key: "statement_close:many",
      kind: "statement_unpaid",
      urgency: "medium",
      title: `${toClose.length} rendiciones para cerrar`,
      detail: "Dieron neto cero o negativo: cerralas con saldo a cuenta para que lo que quedó debiendo cada propietario se descuente en su próxima rendición.",
      href: `${BASE}/rendiciones`,
      cta: "Ver rendiciones",
      amount: null,
      currency: null,
      date: toClose[0].date,
      contractId: null,
    });
  } else {
    for (const s of toClose) {
      const owes = s.net < -0.005;
      out.push({
        key: `statement_close:${s.id}`,
        kind: "statement_unpaid",
        urgency: "medium",
        title: `Rendición N° ${formatStatementNumber(s.number)} para cerrar · ${s.ownerName}`,
        detail: owes
          ? `Quedó debiendo ${plainMoney(Math.abs(s.net), s.currency)}: cerrala con saldo a cuenta para que se descuente en su próxima rendición.`
          : "Neto cero: no hay nada para transferir. Cerrala para que deje de figurar como sin pagar.",
        href: `${BASE}/rendiciones/${s.id}`,
        cta: "Cerrar rendición",
        amount: owes ? Math.abs(s.net) : null,
        currency: owes ? s.currency : null,
        date: s.date,
        contractId: null,
      });
    }
  }
  if (st.length > 3) {
    out.push({
      key: "statement_unpaid:many",
      kind: "statement_unpaid",
      urgency: "medium",
      title: `${st.length} rendiciones sin pagar`,
      detail: "Propietarios esperando la transferencia de lo cobrado.",
      href: `${BASE}/rendiciones`,
      cta: "Ver rendiciones",
      amount: null,
      currency: null,
      date: st[0].date,
      contractId: null,
    });
  } else {
    for (const s of st) {
      out.push({
        key: `statement_unpaid:${s.id}`,
        kind: "statement_unpaid",
        urgency: "medium",
        title: `Rendición N° ${formatStatementNumber(s.number)} sin pagar · ${s.ownerName}`,
        detail: `Neto a transferir: ${plainMoney(s.net, s.currency)}.`,
        href: `${BASE}/rendiciones/${s.id}`,
        cta: "Registrar pago",
        amount: s.net,
        currency: s.currency,
        date: s.date,
        contractId: null,
      });
    }
  }
  return out;
}

export interface Agenda {
  items: AgendaItem[];
  counts: Record<AgendaUrgency, number>;
}

export function buildAgenda(input: AgendaInput): Agenda {
  const byId = new Map(input.contracts.map((c) => [c.id, c]));
  const items = [
    ...overdueItems(input, byId),
    ...adjustmentItems(input, byId),
    ...contractItems(input),
    ...inboxItems(input, byId),
  ].sort(
    (a, b) =>
      RANK[a.urgency] - RANK[b.urgency] ||
      (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
      (b.amount ?? 0) - (a.amount ?? 0),
  );
  const counts: Record<AgendaUrgency, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const it of items) counts[it.urgency] += 1;
  return { items, counts };
}
