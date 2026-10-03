import "server-only";
import { round2 } from "@/lib/finance/booking-economics";
import type {
  RentalAdjustment,
  RentalAdjustmentStatus,
  RentalCharge,
  RentalChargeItem,
  RentalContract,
  RentalExpense,
  RentalPayment,
} from "@/lib/types/database";
import { AUTO_APPLY_HORIZON_DAYS, rentForPeriod, type ChainStep } from "@/lib/rentals/adjustments";
import { planCreditAllocations, type CreditTarget } from "@/lib/rentals/allocation";
import {
  buildMonthlyCharge,
  carryOverItems,
  chooseDifferenceTarget,
  periodsDueForCharging,
  pickCarrySource,
  type ChargeItemDraft,
  type VoidedMonthlyCharge,
} from "@/lib/rentals/charges";
import type { IndexLookup } from "@/lib/rentals/indices";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/rentals/labels";
import { takesEffectAfterExit } from "@/lib/rentals/exit";
import {
  appliedMapOf,
  buildContractPlan,
  chargingSchedule,
  rentInForceOn,
  skippedSetOf,
  type ContractPlan,
} from "@/lib/rentals/plan";
import { addDays, addMonthsToMonth, monthOf, monthsBetween } from "@/lib/rentals/ymd";
import type { AdminClient } from "./access";
import { logRentalsError } from "./access";

/**
 * Sincronización de un contrato con la realidad: ajustes según los índices
 * publicados, cargos de los períodos que ya tocan, diferencias de ajustes que
 * llegaron tarde, saldo a favor y comprobantes esperados del mes.
 *
 * Todo es idempotente: lo corre el cron todos los días y lo dispara la UI
 * después de cada cambio; correrlo dos veces no duplica nada.
 */

// ─── Historial ──────────────────────────────────────────────────────────────

export async function logRentalEvent(
  admin: AdminClient,
  e: {
    organizationId: string;
    contractId?: string | null;
    propertyId?: string | null;
    type: string;
    summary: string;
    payload?: Record<string, unknown>;
    actorId?: string | null;
    actorName?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("rental_events").insert({
    organization_id: e.organizationId,
    contract_id: e.contractId ?? null,
    property_id: e.propertyId ?? null,
    event_type: e.type,
    summary: e.summary.slice(0, 400),
    payload: e.payload ?? {},
    actor_user_id: e.actorId ?? null,
    actor_name: e.actorName ?? null,
  });
  if (error) logRentalsError("logRentalEvent", error);
}

// ─── Ajustes ────────────────────────────────────────────────────────────────

// AUTO_APPLY_HORIZON_DAYS vive en el motor puro (también lo usa la UI).
export { AUTO_APPLY_HORIZON_DAYS };

function persistedStatusOf(step: ChainStep, today: string, autoApply: boolean, terminatedAt: string | null): RentalAdjustmentStatus {
  if (step.status === "aplicado" || step.status === "omitido") return step.status;
  // Rige después de la salida registrada (preaviso): el inquilino ya no va a estar.
  // Queda programado: no se aplica solo, no se avisa ni pide que alguien lo cargue.
  // Si la salida se anula o se corre, la próxima sincronización lo retoma.
  if (takesEffectAfterExit(step.window.effectiveDate, terminatedAt)) return "programado";
  switch (step.status) {
    case "calculado":
      return autoApply && step.window.effectiveDate <= addDays(today, AUTO_APPLY_HORIZON_DAYS) ? "aplicado" : "calculado";
    case "pendiente_indice":
      return step.window.effectiveDate <= today ? "pendiente_indice" : "programado";
    case "pendiente_manual":
    case "invalido":
      return "pendiente_manual";
    case "bloqueado":
    default:
      return "programado";
  }
}

export interface AdjustmentSyncResult {
  plan: ContractPlan;
  rows: RentalAdjustment[];
  /** Ajustes que esta corrida aplicó automáticamente. */
  autoApplied: RentalAdjustment[];
  /** Alquiler vigente hoy después de sincronizar. */
  currentRent: number;
}

/**
 * Recalcula y guarda los ajustes de un contrato. Con `autoApply`, lo que se
 * pudo calcular queda aplicado (es el monto que van a usar los cargos); sin
 * él, queda "listo para aplicar" hasta que alguien confirme.
 */
export async function syncContractAdjustments(
  admin: AdminClient,
  contract: RentalContract,
  opts: { series: IndexLookup | null; autoApply: boolean; today: string },
): Promise<AdjustmentSyncResult> {
  const { data: existingData, error } = await admin
    .from("rental_adjustments")
    .select("*")
    .eq("contract_id", contract.id)
    .order("sequence", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los ajustes: ${error.message}`);
  const existing = (existingData ?? []) as RentalAdjustment[];
  const bySeq = new Map(existing.map((a) => [a.sequence, a]));

  const plan = buildContractPlan(contract, {
    series: opts.series,
    applied: appliedMapOf(existing),
    skipped: skippedSetOf(existing),
  });
  const now = new Date().toISOString();
  const autoApplied: RentalAdjustment[] = [];
  const rows: RentalAdjustment[] = [];

  for (const step of plan.chain) {
    const w = step.window;
    const prev = bySeq.get(w.sequence);
    if (prev && (prev.status === "aplicado" || prev.status === "omitido")) {
      rows.push(prev);
      continue;
    }
    const status = persistedStatusOf(step, opts.today, opts.autoApply, contract.terminated_at);
    const r = step.result?.status === "ok" ? step.result : null;
    const values = {
      organization_id: contract.organization_id,
      contract_id: contract.id,
      sequence: w.sequence,
      period_index: w.periodIndex,
      effective_date: w.effectiveDate,
      status,
      method: contract.adjustment_method,
      index_code: contract.adjustment_method === "indice" ? contract.index_code : null,
      from_key: w.fromMonth ?? w.fromDate,
      to_key: w.toMonth ?? w.toDate,
      from_value: r?.fromValue ?? null,
      to_value: r?.toValue ?? null,
      coefficient: r ? Number(r.coefficient.toFixed(10)) : null,
      variation_pct: r?.variationPct ?? null,
      base_amount: step.base,
      computed_amount: r?.amount ?? null,
      applied_amount: status === "aplicado" ? (r?.amount ?? null) : null,
      computed_at: r ? now : null,
      applied_at: status === "aplicado" ? now : null,
    };
    const changed =
      !prev ||
      prev.status !== values.status ||
      Number(prev.computed_amount ?? 0) !== Number(values.computed_amount ?? 0) ||
      Number(prev.base_amount ?? 0) !== Number(values.base_amount ?? 0) ||
      prev.effective_date !== values.effective_date ||
      prev.period_index !== values.period_index;
    if (!changed) {
      rows.push(prev);
      continue;
    }
    const { data: saved, error: upErr } = await admin
      .from("rental_adjustments")
      .upsert(values, { onConflict: "contract_id,sequence" })
      .select("*")
      .single();
    if (upErr) throw new Error(`No se pudo guardar el ajuste ${w.sequence}: ${upErr.message}`);
    const row = saved as RentalAdjustment;
    rows.push(row);
    if (status === "aplicado") autoApplied.push(row);
  }

  // Ventanas que ya no existen (se acortó el contrato o cambió la frecuencia).
  const maxSeq = plan.windows.length;
  const stale = existing.filter((a) => a.sequence > maxSeq && a.status !== "aplicado").map((a) => a.id);
  if (stale.length) await admin.from("rental_adjustments").delete().in("id", stale);

  // Plan final con lo recién aplicado: de ahí sale el alquiler vigente hoy.
  const finalPlan = autoApplied.length
    ? buildContractPlan(contract, { series: opts.series, applied: appliedMapOf(rows), skipped: skippedSetOf(rows) })
    : plan;
  const inForce = rentInForceOn(finalPlan, Number(contract.initial_rent), opts.today);
  const currentRent = inForce ?? Number(contract.current_rent);
  if (Math.abs(currentRent - Number(contract.current_rent)) > 0.004) {
    await admin.from("rental_contracts").update({ current_rent: currentRent }).eq("id", contract.id);
  }
  return { plan: finalPlan, rows, autoApplied, currentRent };
}

// ─── Cargos ─────────────────────────────────────────────────────────────────

/** Gastos a cargo del inquilino que todavía no se le cobraron (se suman al próximo cargo o al de salida). */
export async function pendingTenantExpenseItems(admin: AdminClient, contract: RentalContract): Promise<ChargeItemDraft[]> {
  const { data, error } = await admin
    .from("rental_expenses")
    .select("id, category, description, amount, currency, paid_by")
    .eq("organization_id", contract.organization_id)
    .eq("contract_id", contract.id)
    .eq("charged_to", "inquilino")
    .eq("status", "pendiente");
  if (error) {
    logRentalsError("pendingTenantExpenseItems", error);
    return [];
  }
  return ((data ?? []) as Pick<RentalExpense, "id" | "category" | "description" | "amount" | "currency" | "paid_by">[])
    .filter((x) => x.currency === contract.currency)
    .map((x) => ({
      kind: x.category === "reparacion" || x.category === "mantenimiento" ? ("reparacion" as const) : ("otro" as const),
      // Quien adelantó la plata es quien la recupera cuando paga el inquilino.
      payee: x.paid_by === "propietario" ? ("propietario" as const) : x.paid_by === "inmobiliaria" ? ("inmobiliaria" as const) : ("tercero" as const),
      description: `${EXPENSE_CATEGORY_LABEL[x.category]}: ${x.description}`.slice(0, 200),
      amount: Number(x.amount),
      ref_type: "rental_expense",
      ref_id: x.id,
      sort_order: 30,
    }));
}

/**
 * Genera los cargos mensuales que ya tocan (períodos que empiezan dentro de
 * `leadDays`). Usa sólo ajustes APLICADOS: si el del período no está, el cargo
 * sale con el precio anterior y queda marcado para cobrar la diferencia.
 */
export async function ensureContractCharges(
  admin: AdminClient,
  contract: RentalContract,
  plan: ContractPlan,
  opts: { today: string; leadDays: number; actorId?: string | null },
): Promise<{ created: number }> {
  if (contract.status !== "vigente") return { created: 0 };
  const { data: existingData, error } = await admin
    .from("rental_charges")
    .select("period_index")
    .eq("contract_id", contract.id)
    .eq("kind", "mensual")
    .is("voided_at", null);
  if (error) throw new Error(`No se pudieron leer los cargos: ${error.message}`);
  const existing = new Set(((existingData ?? []) as { period_index: number }[]).map((r) => r.period_index));
  // Con el cobro de la continuación encendido (art. 1218) también los meses posteriores al fin.
  const schedule = chargingSchedule(plan.schedule, contract, addDays(opts.today, Math.max(0, opts.leadDays)));
  const due = periodsDueForCharging(schedule, {
    today: opts.today,
    leadDays: opts.leadDays,
    billingStartsOn: contract.billing_starts_on ?? contract.start_date,
    terminatedAt: contract.terminated_at,
    existing,
  });
  if (!due.length) return { created: 0 };

  let extras = await pendingTenantExpenseItems(admin, contract);
  const voided = await voidedMonthlyChargesFor(admin, contract, due);
  let created = 0;
  for (const period of due) {
    const rent = rentForPeriod(Number(contract.initial_rent), plan.chain, period.index, { onlyApplied: true });
    // Si este mes ya tuvo un mensual que se anuló (se editó el contrato, una persona
    // lo anuló, se movió la salida), lo que le cargaron una persona o un cobro pasa a
    // éste: expensas, conceptos a mano, punitorios y lo condonado. Va en la misma
    // transacción que crea el cargo, así no queda a mitad de camino.
    const source = pickCarrySource(voided, period.start, contract.currency);
    const carried = source ? carryOverItems(source.items) : [];
    const create = async (carriedItems: ChargeItemDraft[]) => {
      const draft = buildMonthlyCharge({ period, rent, currency: contract.currency, extraItems: extras, carriedItems });
      const { items, ...charge } = draft;
      const res = await admin.rpc("rental_create_charge", {
        p_organization_id: contract.organization_id,
        p_contract_id: contract.id,
        p_charge: { ...charge, created_by: opts.actorId ?? null },
        p_items: items,
      });
      return { ...res, label: draft.label };
    };
    let attempt = carried;
    let res = await create(attempt);
    // Sólo un rechazo de la base (raise de un trigger, P0xxx, o una restricción,
    // 23xxx) por algo de lo que pasaba, p. ej. un depósito que ya se marcó cobrado
    // a mano (068j). El mes no puede quedarse sin cargo por eso: primero sin el
    // depósito, si no sin nada de lo que pasaba, y queda escrito para que una
    // persona lo vuelva a cargar. Un corte de red o un timeout no: se lanza y la
    // próxima sincronización lo reintenta con todo.
    while (res.error && attempt.length && /^(P0|23)/.test(res.error.code ?? "")) {
      logRentalsError("ensureContractCharges:carry", res.error);
      attempt = attempt.some((c) => c.kind === "deposito") ? attempt.filter((c) => c.kind !== "deposito") : [];
      res = await create(attempt);
    }
    const dropped = carried.filter((c) => !attempt.includes(c));
    if (res.error) throw new Error(`No se pudo generar el cargo de ${res.label}: ${res.error.message}`);
    if ((res.data as { created?: boolean } | null)?.created) {
      created += 1;
      extras = []; // los gastos van una sola vez, en el primer cargo nuevo
      if (dropped.length) {
        await logRentalEvent(admin, {
          organizationId: contract.organization_id,
          contractId: contract.id,
          type: "cargo_conceptos_no_pasados",
          summary: `No se pudieron pasar a ${res.label} los conceptos del cargo anulado de ese mes (${dropped.map((d) => d.description).join(", ")}): cargalos de nuevo si corresponden.`,
          payload: { source_charge_id: source?.id ?? null, items: dropped.map((d) => d.meta?.carried_from ?? null) },
          actorId: opts.actorId ?? null,
        });
      }
    }
  }
  return { created };
}

/**
 * Mensuales anulados de los meses que se van a generar (con sus ítems), para
 * pasarle al cargo nuevo lo que tenía el anulado. Si no se pueden leer, no se
 * genera nada: generar igual perdería en silencio lo que había que pasar.
 */
async function voidedMonthlyChargesFor(admin: AdminClient, contract: RentalContract, due: readonly { start: string }[]): Promise<VoidedMonthlyCharge[]> {
  const months = [...new Set(due.map((p) => monthOf(p.start)))].sort();
  if (!months.length) return [];
  const { data, error } = await admin
    .from("rental_charges")
    .select("id, period_start, currency, voided_at, items:rental_charge_items(id, kind, payee, description, amount, original_amount, discount_reason, ref_type, ref_id, meta, sort_order)")
    .eq("organization_id", contract.organization_id)
    .eq("contract_id", contract.id)
    .eq("kind", "mensual")
    .not("voided_at", "is", null)
    .gte("period_start", months[0])
    .lt("period_start", addMonthsToMonth(months[months.length - 1], 1));
  if (error) throw new Error(`No se pudieron leer los cargos anulados: ${error.message}`);
  return (data ?? []) as unknown as VoidedMonthlyCharge[];
}

/**
 * Mantiene el alquiler facturado de cada período alineado con los ajustes
 * aplicados. Cubre dos casos:
 *   - el cargo salió con el precio anterior porque el ajuste todavía no tenía
 *     índice (pending_adjustment_seq), y
 *   - alguien corrigió el monto de un ajuste ya aplicado después de generar
 *     cargos.
 * La base de comparación es lo que facturó el MOTOR (meta.billed_rent del ítem
 * de alquiler + diferencias ya agregadas para ese período), no el importe
 * actual: una bonificación hecha a mano baja `amount` pero no la base, así que
 * nunca se "corrige".
 *   - Sube: se agrega una "Diferencia por ajuste" (al mismo cargo si sigue
 *     abierto; si ya se pagó, al cargo abierto más reciente o a uno aparte).
 *   - Baja: se reduce el alquiler impago del período (nunca por debajo de lo
 *     pagado); si ya se cobró de más, queda en el historial para que una
 *     persona lo bonifique.
 */
export async function reconcileAdjustmentDifferences(
  admin: AdminClient,
  contract: RentalContract,
  plan: ContractPlan,
  opts: { today: string; actorId?: string | null },
): Promise<number> {
  // También los anulados: una diferencia que una persona anuló cuenta como saldada (ver abajo).
  const { data, error } = await admin
    .from("rental_charges")
    .select("id, kind, period_index, period_start, label, status, due_date, voided_at, pending_adjustment_seq, items:rental_charge_items(id, kind, amount, original_amount, paid_amount, ref_type, ref_id, meta, sort_order)")
    .eq("organization_id", contract.organization_id)
    .eq("contract_id", contract.id)
    .order("due_date", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los cargos del contrato: ${error.message}`);
  type Item = Pick<RentalChargeItem, "id" | "kind" | "amount" | "original_amount" | "paid_amount" | "ref_type" | "ref_id" | "meta" | "sort_order">;
  type Row = Pick<RentalCharge, "id" | "kind" | "period_index" | "period_start" | "label" | "status" | "due_date" | "voided_at" | "pending_adjustment_seq"> & { items: Item[] };
  const all = (data ?? []) as Row[];
  const rows = all.filter((r) => !r.voided_at);
  const monthly = rows.filter((r) => r.kind === "mensual" && r.period_index != null);
  if (!monthly.length) return 0;

  // Diferencias ya agregadas por período (pueden vivir en otro cargo: ref_id = cargo de origen).
  // Un cargo aparte (extra) anulado a mano = la diferencia se perdonó: cuenta como
  // saldada y no se vuelve a cobrar (para bajarla sin anular está "bonificar").
  // Un MENSUAL anulado sí se regenera, y sus diferencias con él: se registran
  // aparte para avisar en el historial cuando vuelven a cobrarse.
  const diffsBySource = new Map<string, number>();
  const diffsInVoidedMonthly = new Map<string, string>();
  for (const r of all) {
    for (const i of r.items) {
      if (i.kind !== "diferencia_ajuste" || i.ref_type !== "rental_charge" || !i.ref_id) continue;
      if (r.voided_at && r.kind === "mensual") {
        diffsInVoidedMonthly.set(i.ref_id, r.label);
        continue;
      }
      diffsBySource.set(i.ref_id, round2((diffsBySource.get(i.ref_id) ?? 0) + Number(i.original_amount ?? i.amount)));
    }
  }

  let changes = 0;
  const touched = new Set<string>();
  const resolvedPending: string[] = [];
  for (const c of monthly) {
    const rent = rentForPeriod(Number(contract.initial_rent), plan.chain, c.period_index ?? 0, { onlyApplied: true });
    if (rent.pendingSequence != null) continue; // el ajuste de este período todavía no se puede saber
    if (c.pending_adjustment_seq != null) resolvedPending.push(c.id);
    const rentItem = [...c.items].filter((i) => i.kind === "alquiler").sort((a, b) => a.sort_order - b.sort_order)[0];
    if (!rentItem) continue;
    const meta = (rentItem.meta ?? {}) as Record<string, unknown>;
    const engineBilled = Number(meta.billed_rent ?? rentItem.original_amount ?? rentItem.amount);
    const diff = round2(rent.amount - (engineBilled + (diffsBySource.get(c.id) ?? 0)));

    if (diff > 0.009) {
      // Nunca a un cargo vencido: los punitorios correrían desde antes de que la
      // diferencia existiera. Si no hay un mensual en plazo, va a un cargo aparte.
      let targetId = chooseDifferenceTarget(c, rows, { today: opts.today, terminatedAt: contract.terminated_at });
      if (!targetId) {
        const { data: extra, error: exErr } = await admin.rpc("rental_create_charge", {
          p_organization_id: contract.organization_id,
          p_contract_id: contract.id,
          p_charge: {
            kind: "extra",
            label: `Diferencia por ajuste · ${c.label}`.slice(0, 200),
            due_date: addDays(opts.today, contract.payment_window_days || 10),
            currency: contract.currency,
            created_by: opts.actorId ?? null,
          },
          p_items: [],
        });
        if (exErr) throw new Error(`No se pudo crear el cargo de la diferencia: ${exErr.message}`);
        targetId = (extra as { charge_id: string }).charge_id;
      }
      const { error: insErr } = await admin.from("rental_charge_items").insert({
        organization_id: contract.organization_id,
        charge_id: targetId,
        kind: "diferencia_ajuste",
        payee: "propietario",
        description: `Diferencia por ajuste · ${c.label}`.slice(0, 200),
        amount: diff,
        ref_type: "rental_charge",
        ref_id: c.id,
        meta: { period_index: c.period_index },
        sort_order: 5,
      });
      if (insErr) throw new Error(`No se pudo agregar la diferencia: ${insErr.message}`);
      touched.add(targetId);
      changes += 1;
      const voidedIn = diffsInVoidedMonthly.get(c.id);
      if (voidedIn) {
        // Nada se vuelve a cobrar en silencio: la diferencia estaba en un mensual que se anuló.
        await logRentalEvent(admin, {
          organizationId: contract.organization_id,
          contractId: contract.id,
          type: "diferencia_recobrada",
          summary: `La diferencia por ajuste de ${c.label} (${diff.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${contract.currency}) se volvió a cobrar: estaba en ${voidedIn}, que se anuló. Si la querías perdonar, bonificala.`,
          payload: { charge_id: c.id, target_id: targetId, amount: diff },
          actorId: opts.actorId ?? null,
        });
      }
    } else if (diff < -0.009) {
      const unpaid = round2(Number(rentItem.amount) - Number(rentItem.paid_amount));
      const reduceBy = round2(Math.min(-diff, Math.max(0, unpaid)));
      const overcharged = round2(-diff - reduceBy);
      const { error: upErr } = await admin
        .from("rental_charge_items")
        .update({
          amount: round2(Number(rentItem.amount) - reduceBy),
          meta: { ...meta, billed_rent: round2(engineBilled + diff), ...(overcharged > 0 ? { overcharged } : {}) },
        })
        .eq("id", rentItem.id);
      if (upErr) throw new Error(`No se pudo corregir el alquiler de ${c.label}: ${upErr.message}`);
      if (reduceBy > 0) touched.add(c.id);
      changes += 1;
      if (overcharged > 0) {
        await logRentalEvent(admin, {
          organizationId: contract.organization_id,
          contractId: contract.id,
          type: "ajuste_cobrado_de_mas",
          summary: `Con el ajuste corregido, en ${c.label} se cobraron ${overcharged.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${contract.currency} de más. Bonificalo en un próximo cargo.`,
          payload: { charge_id: c.id, overcharged },
        });
      }
    }
  }
  if (resolvedPending.length) await admin.from("rental_charges").update({ pending_adjustment_seq: null }).in("id", resolvedPending);
  if (touched.size) await admin.rpc("rental_recompute_charges", { p_charge_ids: [...touched] });
  return changes;
}

// ─── Anular cargos en lote ──────────────────────────────────────────────────

export interface VoidChargesResult {
  voided: string[];
  /** Siguen teniendo cobros: no se anulan, los decide una persona. */
  kept: string[];
  /** Saldo a favor que volvió al inquilino (imputaciones deshechas). */
  creditRestored: number;
  /** Gastos del inquilino que volvieron a "pendiente". */
  expensesReleased: number;
}

/** PostgREST no encuentra la función: la 068f todavía no está aplicada. */
function isMissingRpc(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** Gastos que se le trasladaban al inquilino en esos cargos: vuelven a "pendiente". */
async function releaseExpensesOf(admin: AdminClient, organizationId: string, chargeIds: string[]): Promise<number> {
  if (!chargeIds.length) return 0;
  const { data: items } = await admin.from("rental_charge_items").select("id").eq("organization_id", organizationId).in("charge_id", chargeIds);
  const itemIds = ((items ?? []) as { id: string }[]).map((i) => i.id);
  if (!itemIds.length) return 0;
  const { data, error } = await admin
    .from("rental_expenses")
    .update({ status: "pendiente", charge_item_id: null })
    .eq("organization_id", organizationId)
    .eq("status", "aplicado")
    .in("charge_item_id", itemIds)
    .select("id");
  if (error) {
    logRentalsError("releaseExpensesOf", error);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Anula en lote cargos sin cobros de un contrato y devuelve a "pendiente" los
 * gastos que se le trasladaban al inquilino en ellos: si no, quedan
 * 'aplicado' apuntando a un cargo anulado, no se cobran nunca y no se pueden
 * editar. Con `undoCredit` primero deshace el saldo a favor imputado a esos
 * cargos que todavía no se rindió. Todo en una transacción
 * (rental_void_charges, 068f). Lo que sigue con cobros vuelve en `kept`.
 */
export async function voidContractCharges(
  admin: AdminClient,
  organizationId: string,
  contractId: string,
  chargeIds: string[],
  reason: string,
  opts: { undoCredit?: boolean } = {},
): Promise<VoidChargesResult> {
  const ids = [...new Set(chargeIds)];
  if (!ids.length) return { voided: [], kept: [], creditRestored: 0, expensesReleased: 0 };
  const { data, error } = await admin.rpc("rental_void_charges", {
    p_organization_id: organizationId,
    p_contract_id: contractId,
    p_charge_ids: ids,
    p_reason: reason,
    p_undo_credit: opts.undoCredit ?? false,
  });
  if (!error) {
    const r = (data ?? {}) as { voided?: string[]; kept?: string[]; credit_restored?: number; expenses_released?: number };
    return {
      voided: r.voided ?? [],
      kept: r.kept ?? [],
      creditRestored: round2(Number(r.credit_restored ?? 0)),
      expensesReleased: Number(r.expenses_released ?? 0),
    };
  }
  if (!isMissingRpc(error)) throw new Error(`No se pudieron anular los cargos: ${error.message}`);

  // Sin la 068f: lo mismo en dos pasos y sin devolver el saldo a favor.
  const { data: voidedRows, error: vErr } = await admin
    .from("rental_charges")
    .update({ voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), status: "anulado" })
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .in("id", ids)
    .is("voided_at", null)
    .eq("paid_amount", 0)
    .select("id");
  if (vErr) throw new Error(`No se pudieron anular los cargos: ${vErr.message}`);
  const voided = ((voidedRows ?? []) as { id: string }[]).map((r) => r.id);
  const { data: keptRows } = await admin
    .from("rental_charges")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", ids)
    .is("voided_at", null);
  const expensesReleased = await releaseExpensesOf(admin, organizationId, voided);
  return { voided, kept: ((keptRows ?? []) as { id: string }[]).map((r) => r.id), creditRestored: 0, expensesReleased };
}

export interface StaleDifferencesResult {
  /** Diferencias que se sacaron (ítems borrados más cargos aparte anulados enteros). */
  dropped: number;
  amount: number;
  /** Cargos de donde salieron, para avisar. */
  chargeLabels: string[];
}

/**
 * Diferencias por ajuste de períodos cuyos cargos se acaban de anular: el
 * período se vuelve a facturar con el precio que corresponde (o ya no se
 * factura), así que esas diferencias sobran y cobrarlas sería cobrar dos
 * veces. Las impagas se borran; un cargo aparte que sólo tenía esas
 * diferencias se anula entero (las marcas en $ 0 de punitorios condonados no
 * cuentan: no son deuda, y dejarlo vivo lo mostraba "pagado" sin que nadie
 * pagara nada).
 */
export async function dropStaleDifferences(
  admin: AdminClient,
  organizationId: string,
  contractId: string,
  voidedChargeIds: string[],
  reason: string,
): Promise<StaleDifferencesResult> {
  const none: StaleDifferencesResult = { dropped: 0, amount: 0, chargeLabels: [] };
  if (!voidedChargeIds.length) return none;
  const voidedSet = new Set(voidedChargeIds);
  const { data, error } = await admin
    .from("rental_charges")
    .select("id, kind, label, paid_amount, items:rental_charge_items(id, kind, amount, ref_type, ref_id, paid_amount)")
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .is("voided_at", null);
  if (error) {
    logRentalsError("dropStaleDifferences", error);
    return none;
  }
  type Row = { id: string; kind: string; label: string; paid_amount: number; items: Pick<RentalChargeItem, "id" | "kind" | "amount" | "ref_type" | "ref_id" | "paid_amount">[] };
  const wholeCharges: Row[] = [];
  const staleItems: { id: string; amount: number }[] = [];
  const touched: Row[] = [];
  for (const r of (data ?? []) as Row[]) {
    const stale = r.items.filter(
      (i) => i.kind === "diferencia_ajuste" && i.ref_type === "rental_charge" && !!i.ref_id && voidedSet.has(i.ref_id) && Number(i.paid_amount) === 0,
    );
    if (!stale.length) continue;
    const staleIds = new Set(stale.map((i) => i.id));
    // ¿Queda algo que se deba o se haya cobrado, además de las diferencias que sobran?
    const rest = r.items.filter((i) => !staleIds.has(i.id) && !(Number(i.amount) === 0 && Number(i.paid_amount) === 0));
    if (r.kind !== "mensual" && !rest.length && Number(r.paid_amount) === 0) wholeCharges.push(r);
    else {
      staleItems.push(...stale.map((i) => ({ id: i.id, amount: Number(i.amount) })));
      touched.push(r);
    }
  }
  const out: StaleDifferencesResult = { dropped: 0, amount: 0, chargeLabels: [] };
  if (wholeCharges.length) {
    const res = await voidContractCharges(admin, organizationId, contractId, wholeCharges.map((r) => r.id), reason);
    for (const r of wholeCharges.filter((w) => res.voided.includes(w.id))) {
      out.dropped += 1;
      out.amount = round2(out.amount + r.items.reduce((s, i) => s + Number(i.amount), 0));
      out.chargeLabels.push(r.label);
    }
  }
  if (staleItems.length) {
    const { error: delErr } = await admin
      .from("rental_charge_items")
      .delete()
      .eq("organization_id", organizationId)
      .in("id", staleItems.map((i) => i.id))
      .eq("paid_amount", 0);
    if (delErr) logRentalsError("dropStaleDifferences:items", delErr);
    else {
      out.dropped += staleItems.length;
      out.amount = round2(out.amount + staleItems.reduce((s, i) => s + i.amount, 0));
      out.chargeLabels.push(...touched.map((r) => r.label));
      await admin.rpc("rental_recompute_charges", { p_charge_ids: touched.map((r) => r.id) });
    }
  }
  return out;
}

/**
 * Al cerrar un contrato, los gastos a cargo del inquilino que quedaron sin
 * cobrar (por ejemplo, los que iban en el cargo de un mes que se anuló) van a
 * un cargo de salida: ya no hay próximo mensual que los lleve y, si no, la
 * plata que adelantó la inmobiliaria o el propietario se pierde.
 */
export async function billPendingTenantExpenses(
  admin: AdminClient,
  contract: RentalContract,
  opts: { dueDate: string; actorId?: string | null },
): Promise<{ chargeId: string | null; total: number; count: number }> {
  const items = await pendingTenantExpenseItems(admin, contract);
  if (!items.length) return { chargeId: null, total: 0, count: 0 };
  const { data, error } = await admin.rpc("rental_create_charge", {
    p_organization_id: contract.organization_id,
    p_contract_id: contract.id,
    p_charge: { kind: "salida", label: "Gastos pendientes", due_date: opts.dueDate, currency: contract.currency, created_by: opts.actorId ?? null },
    p_items: items.map((i, idx) => ({ ...i, sort_order: idx })),
  });
  if (error) throw new Error(`No se pudieron cargar los gastos pendientes: ${error.message}`);
  return {
    chargeId: (data as { charge_id?: string } | null)?.charge_id ?? null,
    total: round2(items.reduce((s, i) => s + i.amount, 0)),
    count: items.length,
  };
}

// ─── Saldo a favor ──────────────────────────────────────────────────────────

/**
 * Imputa el saldo a favor de pagos anteriores a lo que el inquilino debe (lo
 * más viejo primero), cada pago en su moneda. Nunca a un mensual que empieza
 * después de la salida: si sigue vivo es porque tiene cobros directos y lo
 * resuelve una persona; ponerle saldo a favor (el que el cierre le acaba de
 * devolver al inquilino) se le rendía al propietario como alquiler de un mes
 * en el que el inquilino ya no vive.
 */
export async function applyAvailableCredit(admin: AdminClient, organizationId: string, contractId: string): Promise<number> {
  const { data: pays, error } = await admin
    .from("rental_payments")
    .select("id, unallocated_amount, paid_at, currency")
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .is("voided_at", null)
    .gt("unallocated_amount", 0)
    .order("paid_at", { ascending: true });
  if (error || !pays?.length) return 0;
  const [{ data: contractRow }, { data: charges, error: chErr }] = await Promise.all([
    admin.from("rental_contracts").select("terminated_at").eq("id", contractId).eq("organization_id", organizationId).maybeSingle(),
    admin
      .from("rental_charges")
      .select("id, kind, due_date, period_start, currency, items:rental_charge_items(id, kind, amount, paid_amount, sort_order)")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .is("voided_at", null)
      .in("status", ["pendiente", "parcial"]),
  ]);
  if (!contractRow || chErr) return 0;
  const terminatedAt = (contractRow as { terminated_at: string | null }).terminated_at;
  type C = Pick<RentalCharge, "id" | "kind" | "due_date" | "period_start" | "currency"> & {
    items: Pick<RentalChargeItem, "id" | "kind" | "amount" | "paid_amount" | "sort_order">[];
  };
  const targets: CreditTarget[] = ((charges ?? []) as C[])
    .filter((c) => !(terminatedAt && c.kind === "mensual" && c.period_start && c.period_start > terminatedAt))
    .flatMap((c) =>
      c.items.map((i) => ({
        itemId: i.id,
        chargeId: c.id,
        dueDate: c.due_date,
        kind: i.kind,
        outstanding: round2(Number(i.amount) - Number(i.paid_amount)),
        sortOrder: i.sort_order,
        currency: c.currency,
      })),
    );
  const sources = (pays as Pick<RentalPayment, "id" | "unallocated_amount" | "currency">[]).map((p) => ({
    paymentId: p.id,
    currency: p.currency,
    available: Number(p.unallocated_amount),
  }));
  const allocations = planCreditAllocations(sources, targets).map((a) => ({ payment_id: a.paymentId, item_id: a.itemId, amount: a.amount }));
  if (!allocations.length) return 0;
  const { data, error: rpcErr } = await admin.rpc("rental_apply_credit", {
    p_organization_id: organizationId,
    p_contract_id: contractId,
    p_allocations: allocations,
  });
  if (rpcErr) {
    logRentalsError("applyAvailableCredit", rpcErr);
    return 0;
  }
  return Number((data as { applied?: number } | null)?.applied ?? 0);
}

/**
 * Saldo a favor que el inquilino tiene sin imputar (en la moneda del
 * contrato). Para avisar lo que de verdad quedó a favor después de una
 * sincronización, que puede haber usado parte en deudas anteriores. null si
 * no se pudo leer.
 */
export async function unallocatedCreditOf(admin: AdminClient, organizationId: string, contractId: string, currency: string): Promise<number | null> {
  const { data, error } = await admin
    .from("rental_payments")
    .select("unallocated_amount")
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .eq("currency", currency)
    .is("voided_at", null)
    .gt("unallocated_amount", 0);
  if (error) {
    logRentalsError("unallocatedCreditOf", error);
    return null;
  }
  return round2(((data ?? []) as { unallocated_amount: number }[]).reduce((s, p) => s + Number(p.unallocated_amount), 0));
}

// ─── Comprobantes esperados ─────────────────────────────────────────────────

/** Qué comprobantes tiene que presentar el inquilino en un mes dado. */
export function expectedProofKinds(contract: RentalContract, month: string): string[] {
  const kinds: string[] = [];
  if (contract.expensas_payer === "inquilino" && contract.expensas_mode === "paga_inquilino") kinds.push("expensas");
  const offset = monthsBetween(monthOf(contract.start_date), monthOf(month));
  for (const s of contract.services ?? []) {
    if (!s.proof_required || s.payer !== "inquilino" || s.kind === "expensas") continue;
    if (s.frequency === "bimestral" && offset % 2 !== 0) continue;
    kinds.push(s.kind);
  }
  return kinds;
}

/** Crea (si faltan) las filas "pendiente" de los comprobantes del mes. */
export async function ensureMonthProofs(admin: AdminClient, contract: RentalContract, month: string): Promise<number> {
  if (contract.status !== "vigente") return 0;
  const period = monthOf(month);
  const billingStart = monthOf(contract.billing_starts_on ?? contract.start_date);
  // Hasta el fin o la salida, lo que llegue antes (igual que el portal). Si se cobran
  // los meses de continuación (art. 1218), hasta la salida o sin tope mientras siga.
  const lastDay = contract.continuation_billing
    ? contract.terminated_at
    : contract.terminated_at && contract.terminated_at < contract.end_date
      ? contract.terminated_at
      : contract.end_date;
  if (period < billingStart || (lastDay && period > monthOf(lastDay))) return 0;
  const kinds = expectedProofKinds(contract, period);
  if (!kinds.length) return 0;
  const rows = kinds.map((kind) => ({
    organization_id: contract.organization_id,
    contract_id: contract.id,
    kind,
    period,
    status: "pendiente",
  }));
  const { data, error } = await admin
    .from("rental_proofs")
    .upsert(rows, { onConflict: "contract_id,kind,period", ignoreDuplicates: true })
    .select("id");
  if (error) {
    logRentalsError("ensureMonthProofs", error);
    return 0;
  }
  return data?.length ?? 0;
}

// ─── Orquestador ────────────────────────────────────────────────────────────

export interface ContractSyncSettings {
  autoApply: boolean;
  leadDays: number;
}

export interface ContractSyncSummary {
  autoApplied: RentalAdjustment[];
  chargesCreated: number;
  differencesAdded: number;
  creditApplied: number;
  proofsCreated: number;
  currentRent: number;
}

/** Todo junto, en orden: ajustes → cargos → diferencias → saldo a favor → comprobantes del mes. */
export async function syncContract(
  admin: AdminClient,
  contract: RentalContract,
  settings: ContractSyncSettings,
  opts: { series: IndexLookup | null; today: string; actorId?: string | null },
): Promise<ContractSyncSummary> {
  const adj = await syncContractAdjustments(admin, contract, {
    series: opts.series,
    autoApply: settings.autoApply,
    today: opts.today,
  });
  const fresh: RentalContract = { ...contract, current_rent: adj.currentRent };
  const charges = await ensureContractCharges(admin, fresh, adj.plan, {
    today: opts.today,
    leadDays: settings.leadDays,
    actorId: opts.actorId,
  });
  const differencesAdded = await reconcileAdjustmentDifferences(admin, fresh, adj.plan, { today: opts.today, actorId: opts.actorId });
  const creditApplied = await applyAvailableCredit(admin, contract.organization_id, contract.id);
  const proofsCreated = await ensureMonthProofs(admin, fresh, opts.today);
  return {
    autoApplied: adj.autoApplied,
    chargesCreated: charges.created,
    differencesAdded,
    creditApplied,
    proofsCreated,
    currentRent: adj.currentRent,
  };
}
