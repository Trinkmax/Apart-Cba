import "server-only";
import { notifyOrg } from "@/lib/actions/notifications";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import type { RentalContract } from "@/lib/types/database";
import { consecutiveUnpaidRun, rentBalanceOf, type ArrearsPeriod, type RentItemLike } from "@/lib/rentals/arrears";
import { formatContractNumber } from "@/lib/rentals/labels";
import { isRenewalHandover, takesEffectAfterExit } from "@/lib/rentals/exit";
import { addDays, diffDays } from "@/lib/rentals/ymd";
import { closeRenewedAtEnd, finishContract, getRentalSettings, type ContractCloseOut } from "./contracts";
import { syncContract, type ContractSyncSummary } from "./contract-sync";
import { loadSeriesForContracts } from "./series";
import { logRentalsError, type AdminClient } from "./access";

/**
 * Tarea diaria del módulo Alquileres (la corre `daily-dispatch` a las 00:00 de
 * Argentina). Para cada organización con el módulo encendido:
 *   1. sincroniza cada contrato vigente (ajustes, cargos, diferencias, saldo a
 *      favor, comprobantes del mes) y cierra los que ya pasaron su salida
 *      registrada (rescisión notificada o entrega programada) o vencieron con
 *      su renovación ya vigente (traspaso: sin cargo de salida);
 *   2. avisa en la campanita lo que necesita una persona: cobros vencidos, dos
 *      períodos impagos (causal de resolución, art. 1219 CCyC), ajustes
 *      aplicados o trabados sin índice, contratos por vencer y seguros.
 * Los avisos son idempotentes (dedup_key único por organización).
 * La sincronización de índices (INDEC/BCRA) va antes, una vez para todos.
 */

export interface RentalsDailyResult {
  indices: { code: string; upserted: number; latest: string | null; error?: string }[];
  orgs: number;
  contracts: number;
  /** Contratos con la salida ya pasada que esta corrida pasó a finalizado/rescindido. */
  contractsClosed: number;
  chargesCreated: number;
  adjustmentsApplied: number;
  notifications: number;
  errors: string[];
}

const EXPIRY_THRESHOLDS = [90, 60, 30] as const;

export async function runRentalsDaily(admin: AdminClient): Promise<RentalsDailyResult> {
  const result: RentalsDailyResult = { indices: [], orgs: 0, contracts: 0, contractsClosed: 0, chargesCreated: 0, adjustmentsApplied: 0, notifications: 0, errors: [] };
  // 0) Índices públicos (una vez para todas las orgs). Nunca tira: cada fuente aislada.
  try {
    const { syncEconomicIndices } = await import("@/lib/rentals/indices-sync");
    const synced = await syncEconomicIndices(admin);
    result.indices = synced.map((r) => ({ code: r.code, upserted: r.upserted, latest: r.latest, ...(r.error ? { error: r.error } : {}) }));
  } catch (e) {
    result.errors.push(`indices: ${(e as Error).message}`);
  }
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, timezone")
    .eq("rentals_enabled", true)
    .eq("active", true);
  if (error) {
    result.errors.push(`orgs: ${error.message}`);
    return result;
  }
  for (const org of (orgs ?? []) as { id: string; timezone: string | null }[]) {
    result.orgs += 1;
    try {
      await runForOrg(admin, org.id, todayYmdInTz(org.timezone || DEFAULT_ORG_TIMEZONE), result);
    } catch (e) {
      result.errors.push(`${org.id}: ${(e as Error).message}`);
      logRentalsError("runRentalsDaily", e);
    }
  }
  return result;
}

async function notify(
  orgId: string,
  result: RentalsDailyResult,
  payload: Parameters<typeof notifyOrg>[1],
): Promise<void> {
  await notifyOrg(orgId, payload);
  result.notifications += 1;
}

async function runForOrg(admin: AdminClient, orgId: string, today: string, result: RentalsDailyResult): Promise<void> {
  const settings = await getRentalSettings(admin, orgId);
  const { data: contractsData, error } = await admin
    .from("rental_contracts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "vigente");
  if (error) throw new Error(error.message);
  const contracts = (contractsData ?? []) as RentalContract[];
  if (!contracts.length) return;
  const seriesByIndex = await loadSeriesForContracts(admin, contracts);
  // Renovación ya vigente de cada contrato (misma propiedad): los meses desde que empieza los cobra ella.
  const renewalOf = new Map<string, RentalContract>();
  for (const r of contracts) {
    const from = r.renewed_from_id ? contracts.find((p) => p.id === r.renewed_from_id) : null;
    if (from && from.property_id === r.property_id) renewalOf.set(from.id, r);
  }

  // Contratos que esta corrida cerró (su salida registrada ya pasó): no reciben más avisos de vigentes.
  const closedIds = new Set<string>();
  for (const c of contracts) {
    result.contracts += 1;
    const renewal = renewalOf.get(c.id) ?? null;
    try {
      const series = c.index_code ? (seriesByIndex.get(c.index_code) ?? null) : null;
      let sync: ContractSyncSummary;
      // undefined = no le toca cerrarse hoy.
      let closed: ContractCloseOut | null | undefined;
      if (c.terminated_at && c.terminated_at < today) {
        // Desocupó (o entregó las llaves) ayer o antes: se cierra. Anula lo posterior
        // devolviendo el saldo a favor, factura lo que falte y los gastos pendientes
        // (o, si lo sigue su renovación, se los pasa a ella).
        closed = await finishContract(admin, c, { today, settings, series });
      } else if (!c.terminated_at && renewal && c.end_date < today && isRenewalHandover(c.end_date, renewal.start_date)) {
        // Venció y desde el día siguiente rige su renovación: se cierra en su fin, como traspaso.
        closed = await closeRenewedAtEnd(admin, c, renewal, { today, settings, series });
      }
      if (closed !== undefined) {
        closedIds.add(c.id);
        if (!closed) continue;
        result.contractsClosed += 1;
        sync = closed.sync;
        const exitDay = (c.terminated_at ?? c.end_date).split("-").reverse().join("/");
        await notify(orgId, result, {
          type: "rental_expiring",
          severity: "info",
          title: `${formatContractNumber(c.number)} ${closed.status === "rescindido" ? "rescindido" : "finalizado"}${closed.renewal ? " · renovado" : ""}`,
          body: closed.renewal
            ? `Siguió con la renovación ${formatContractNumber(closed.renewal.number)} desde el ${closed.renewal.startDate.split("-").reverse().join("/")}.${c.deposit_status === "retenido" && Number(c.deposit_amount) > 0 ? " Pasale el depósito a la renovación desde la ficha («Cerrar el depósito»)." : ""}${closed.kept.length ? " Hay cargos posteriores con cobros: revisalos." : ""}`
            : `${closed.status === "rescindido" ? "Desocupó" : "Entregó las llaves"} el ${exitDay}. Revisá la cuenta del contrato y el depósito antes de devolverlo.${closed.kept.length ? " Hay cargos posteriores a la salida con cobros: revisalos." : ""}`,
          ref_type: "rental_contract",
          ref_id: c.id,
          action_url: `/dashboard/alquileres/contratos/${c.id}?tab=cuenta`,
          dedup_key: `rental_closed:${c.id}`,
        });
      } else {
        sync = await syncContract(
          admin,
          c,
          { autoApply: settings.auto_apply_adjustments, leadDays: settings.charge_lead_days },
          { series, today },
        );
      }
      result.chargesCreated += sync.chargesCreated;
      result.adjustmentsApplied += sync.autoApplied.length;
      for (const a of sync.autoApplied) {
        // Rige después de la salida registrada: el inquilino ya no va a estar (no se aplica ni se avisa).
        if (takesEffectAfterExit(a.effective_date, c.terminated_at)) continue;
        const pct = a.variation_pct != null ? ` (${Number(a.variation_pct) >= 0 ? "+" : ""}${Number(a.variation_pct).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %)` : "";
        await notify(orgId, result, {
          type: "rental_adjustment",
          severity: "info",
          title: `Ajuste aplicado · ${formatContractNumber(c.number)}${pct}`,
          body: `Desde el ${a.effective_date.split("-").reverse().join("/")} el alquiler pasa a ${Number(a.applied_amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${c.currency}. Avisale al inquilino.`,
          ref_type: "rental_adjustment",
          ref_id: a.id,
          action_url: `/dashboard/alquileres/contratos/${c.id}?tab=ajustes`,
          dedup_key: `rental_adj:${a.id}`,
        });
      }
    } catch (e) {
      result.errors.push(`${formatContractNumber(c.number)}: ${(e as Error).message}`);
      logRentalsError(`sync ${c.id}`, e);
      // La salida ya pasó y no se pudo cerrar: queda vigente (y en la agenda). Que alguien lo mire.
      if (c.terminated_at && c.terminated_at < today) {
        try {
          await notify(orgId, result, {
            type: "rental_expiring",
            severity: "warning",
            title: `${formatContractNumber(c.number)}: no se pudo cerrar`,
            body: `La salida del ${c.terminated_at.split("-").reverse().join("/")} ya pasó y el contrato sigue abierto. Entrá a la ficha: si ya entregó las llaves, registrá la entrega; si sigue adentro, cambiá la salida.`,
            ref_type: "rental_contract",
            ref_id: c.id,
            action_url: `/dashboard/alquileres/contratos/${c.id}`,
            dedup_key: `rental_close_failed:${c.id}:${c.terminated_at}`,
          });
        } catch (ne) {
          logRentalsError(`notify close failed ${c.id}`, ne);
        }
      }
    }

    // Ya cerrado, con la salida registrada o con la renovación activa: no hay que decidir si se renueva.
    if (closedIds.has(c.id)) continue;
    const exitDecided = Boolean(c.terminated_at) || Boolean(renewal);

    // Por vencer (90/60/30 días) y vencido sin cerrar.
    const daysLeft = diffDays(today, c.end_date);
    const threshold = EXPIRY_THRESHOLDS.find((t) => daysLeft <= t && daysLeft > (t === 30 ? 0 : t - 30));
    if (!exitDecided && daysLeft >= 0 && threshold) {
      await notify(orgId, result, {
        type: "rental_expiring",
        severity: threshold === 30 ? "warning" : "info",
        title: `${formatContractNumber(c.number)} vence en ${daysLeft} días`,
        body: "Definí si se renueva: armá la renovación o coordiná la entrega del inmueble.",
        ref_type: "rental_contract",
        ref_id: c.id,
        action_url: `/dashboard/alquileres/contratos/${c.id}`,
        dedup_key: `rental_expiring:${c.id}:${threshold}`,
      });
    }
    if (!exitDecided && daysLeft < 0) {
      await notify(orgId, result, {
        type: "rental_expiring",
        severity: "warning",
        title: `${formatContractNumber(c.number)} venció y sigue abierto`,
        body: c.continuation_billing
          ? "El contrato terminó y se están cobrando los meses de continuación al último alquiler (art. 1218 CCyC). Renovalo o, cuando entregue las llaves, finalizalo."
          : "El contrato terminó y no se cerró. Si el inquilino sigue, activá en la ficha el cobro de los meses de continuación: hasta entonces no se genera ningún cargo. Si ya se fue, finalizalo.",
        ref_type: "rental_contract",
        ref_id: c.id,
        action_url: `/dashboard/alquileres/contratos/${c.id}`,
        dedup_key: `rental_expired:${c.id}`,
      });
    }

    // Seguro de incendio por vencer.
    if (c.insurance_required && c.insurance_expires_at && c.insurance_expires_at <= addDays(today, 30)) {
      await notify(orgId, result, {
        type: "rental_expiring",
        severity: c.insurance_expires_at < today ? "warning" : "info",
        title: `Seguro ${c.insurance_expires_at < today ? "vencido" : "por vencer"} · ${formatContractNumber(c.number)}`,
        body: `La póliza vence el ${c.insurance_expires_at.split("-").reverse().join("/")}. Pedile la renovación al inquilino.`,
        ref_type: "rental_contract",
        ref_id: c.id,
        action_url: `/dashboard/alquileres/contratos/${c.id}`,
        dedup_key: `rental_insurance:${c.id}:${c.insurance_expires_at}`,
      });
    }
  }

  const open = contracts.filter((c) => !closedIds.has(c.id));
  await notifyOverdue(admin, orgId, today, open, result);
  await notifyStuckAdjustments(admin, orgId, today, open, result);
}

async function notifyOverdue(
  admin: AdminClient,
  orgId: string,
  today: string,
  contracts: RentalContract[],
  result: RentalsDailyResult,
): Promise<void> {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const { data } = await admin
    .from("rental_charges")
    .select("id, contract_id, kind, label, due_date, subtotal, paid_amount, period_index, items:rental_charge_items(kind, amount, paid_amount)")
    .eq("organization_id", orgId)
    .is("voided_at", null)
    .in("status", ["pendiente", "parcial"])
    .lt("due_date", today)
    .order("due_date", { ascending: true });
  type OverdueRow = {
    id: string;
    contract_id: string;
    kind: string;
    label: string;
    due_date: string;
    subtotal: number;
    paid_amount: number;
    period_index: number | null;
    items: RentItemLike[];
  };
  const rows = (data ?? []) as OverdueRow[];
  const periodsByContract = new Map<string, (ArrearsPeriod & { id: string })[]>();
  for (const ch of rows) {
    const c = byId.get(ch.contract_id);
    if (!c) continue;
    const owed = Number(ch.subtotal) - Number(ch.paid_amount);
    await notify(orgId, result, {
      type: "rental_overdue",
      severity: "warning",
      title: `Vencido · ${formatContractNumber(c.number)} · ${ch.label}`,
      body: `Debe ${owed.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${c.currency} desde el ${ch.due_date.split("-").reverse().join("/")}.`,
      ref_type: "rental_charge",
      ref_id: ch.id,
      action_url: `/dashboard/alquileres/contratos/${c.id}?tab=cuenta`,
      dedup_key: `rental_overdue:${ch.id}`,
    });
    if (ch.kind === "mensual") {
      const rent = rentBalanceOf(ch.items ?? []);
      const list = periodsByContract.get(c.id) ?? [];
      list.push({ id: ch.id, kind: ch.kind, periodIndex: ch.period_index, dueDate: ch.due_date, rentAmount: rent.rent, rentOutstanding: rent.outstanding });
      periodsByContract.set(c.id, list);
    }
  }
  // Causal de resolución sólo con DOS PERÍODOS CONSECUTIVOS con el alquiler impago
  // (art. 1219 inc. c): dos cargos vencidos cualesquiera, o un saldo chico de
  // punitorios, no alcanzan. Para lo demás ya están los avisos de "Vencido".
  for (const [contractId, list] of periodsByContract) {
    const c = byId.get(contractId)!;
    const run = consecutiveUnpaidRun(list, { today, graceDays: c.grace_days });
    if (run.length < 2) continue;
    const last = run[run.length - 1];
    await notify(orgId, result, {
      type: "rental_overdue",
      severity: "critical",
      title: `${run.length} períodos seguidos sin pagar · ${formatContractNumber(c.number)}`,
      body: "Dos períodos consecutivos sin pagar son causal de resolución del contrato (art. 1219 CCyC). Antes de un desalojo hay que intimar el pago con 10 días de plazo (art. 1222).",
      ref_type: "rental_contract",
      ref_id: c.id,
      action_url: `/dashboard/alquileres/contratos/${c.id}?tab=cuenta`,
      dedup_key: `rental_two_unpaid:${c.id}:${last.id}`,
    });
  }
}

async function notifyStuckAdjustments(
  admin: AdminClient,
  orgId: string,
  today: string,
  contracts: RentalContract[],
  result: RentalsDailyResult,
): Promise<void> {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const { data } = await admin
    .from("rental_adjustments")
    .select("id, contract_id, effective_date, status")
    .eq("organization_id", orgId)
    .in("status", ["pendiente_indice", "pendiente_manual", "calculado"])
    .lte("effective_date", addDays(today, 15));
  for (const a of (data ?? []) as { id: string; contract_id: string; effective_date: string; status: string }[]) {
    const c = byId.get(a.contract_id);
    if (!c) continue;
    // Rige después de la salida registrada: nadie tiene que aplicarlo ni cargarlo.
    if (takesEffectAfterExit(a.effective_date, c.terminated_at)) continue;
    // El índice suele salir a mitad de mes: un "esperando índice" recién se avisa si lleva 5 días.
    const tooEarly = a.status === "pendiente_indice" && diffDays(a.effective_date, today) < 5;
    if (tooEarly) continue;
    const title =
      a.status === "calculado"
        ? `Ajuste listo para aplicar · ${formatContractNumber(c.number)}`
        : a.status === "pendiente_manual"
          ? `Falta cargar el monto del ajuste · ${formatContractNumber(c.number)}`
          : `Ajuste trabado: falta el índice · ${formatContractNumber(c.number)}`;
    await notify(orgId, result, {
      type: "rental_adjustment",
      severity: a.status === "calculado" ? "info" : "warning",
      title,
      body: `Rige desde el ${a.effective_date.split("-").reverse().join("/")}.`,
      ref_type: "rental_adjustment",
      ref_id: a.id,
      action_url: `/dashboard/alquileres/ajustes`,
      dedup_key: `rental_adj_${a.status}:${a.id}`,
    });
  }
}
