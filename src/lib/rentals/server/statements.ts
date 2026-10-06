import "server-only";
import { round2 } from "@/lib/finance/booking-economics";
import { zonedTimeToUtc } from "@/lib/dates";
import type {
  RentalChargeItemKind,
  RentalCommissionRule,
  RentalContract,
  RentalExpense,
  RentalOwnerStatement,
  RentalPayee,
  RentalProperty,
} from "@/lib/types/database";
import { commissionAmount } from "@/lib/rentals/entry-costs";
import { stipulatedContractValue, type PlanContract } from "@/lib/rentals/plan";
import { formatContractNumber, propertyAddress } from "@/lib/rentals/labels";
import { deriveRentalToken, hashRentalToken, statementPublicPath } from "@/lib/rentals/link-token";
import {
  buildOwnerStatementLines,
  totalsOf,
  type CollectedEntry,
  type StatementLineDraft,
  type StatementTotals,
} from "@/lib/rentals/owner-statement";
import { logRentalEvent } from "./contract-sync";
import { dbFailure, type ActionResult, type AdminClient, type RentalsCtx } from "./access";

/**
 * Rendiciones al propietario: "se rinde lo cobrado, no lo facturado".
 *
 * Lo pendiente de rendir de un propietario = imputaciones de pagos (no
 * anulados, hasta la fecha de corte) a ítems cuyo dueño es el propietario, en
 * contratos que cobra la inmobiliaria, que todavía no figuran en una rendición
 * vigente de ESE propietario; más los gastos a su cargo y la comisión por la
 * locación de cada contrato, también una sola vez. La base garantiza el "una
 * sola vez" con un índice único (068), así que dos personas generando a la
 * vez no pueden rendir dos veces lo mismo.
 */

const PAGE = 1000;

export interface OwnerPending {
  ownerId: string;
  currency: string;
  lines: StatementLineDraft[];
  totals: StatementTotals;
  /** Cuántos cobros entran (para "3 cobros sin rendir"). */
  collectedCount: number;
  lastPaidAt: string | null;
  /**
   * Importe completo de cada gasto (id → importe) tal como se leyó. Viaja a la
   * RPC como `ref_amount`: si alguien edita el gasto entre esta lectura y la
   * RPC, la rendición frena en vez de descontar el importe viejo (068k).
   */
  expenseAmounts: Record<string, number>;
}

type PropertyLite = Pick<RentalProperty, "id" | "street" | "street_number" | "floor" | "apartment" | "tower">;
// Las condiciones del plan (PlanContract) van para la base de los honorarios
// "% del total del contrato": en un escalonado o un % fijo es la suma de los
// montos pactados, no alquiler inicial × meses.
type ContractLite = Pick<
  RentalContract,
  "id" | "number" | "property_id" | "currency" | "status" | "collector" | "admin_fee_pct" | "admin_fee_vat" | "owner_commission"
> &
  PlanContract;

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Pendiente de rendir de varios propietarios a la vez (o de todos los que
 * tienen propiedades en alquiler). Pocas lecturas, cálculo en memoria.
 */
export async function computePendingForOwners(
  admin: AdminClient,
  organizationId: string,
  opts: { cutoff: string; ownerIds?: string[] },
): Promise<OwnerPending[]> {
  let poQuery = admin
    .from("rental_property_owners")
    .select("owner_id, property_id, ownership_pct")
    .eq("organization_id", organizationId);
  if (opts.ownerIds?.length) poQuery = poQuery.in("owner_id", opts.ownerIds);
  const { data: poData, error: poErr } = await poQuery;
  if (poErr) throw new Error(poErr.message);
  const shares = (poData ?? []) as { owner_id: string; property_id: string; ownership_pct: number }[];
  if (!shares.length) return [];
  const propertyIds = [...new Set(shares.map((s) => s.property_id))];

  const [{ data: propsData }, { data: contractsData }] = await Promise.all([
    admin.from("rental_properties").select("id, street, street_number, floor, apartment, tower").in("id", propertyIds),
    admin
      .from("rental_contracts")
      .select(
        "id, number, property_id, currency, status, collector, admin_fee_pct, admin_fee_vat, owner_commission, start_date, duration_months, initial_rent, adjustment_method, index_code, adjustment_every_months, index_lag_months, fixed_pct, steps, rounding, cap_pct, allow_decrease, payment_window_days",
      )
      .eq("organization_id", organizationId)
      .in("property_id", propertyIds)
      .neq("status", "borrador")
      .eq("collector", "inmobiliaria"),
  ]);
  const props = new Map(((propsData ?? []) as PropertyLite[]).map((p) => [p.id, p]));
  const contracts = (contractsData ?? []) as ContractLite[];
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const contractIds = contracts.map((c) => c.id);

  type AllocRow = {
    id: string;
    amount: number;
    charge: { contract_id: string; label: string } | null;
    item: { kind: RentalChargeItemKind; payee: RentalPayee } | null;
    payment: { paid_at: string; voided_at: string | null } | null;
  };
  const allocs: AllocRow[] = contractIds.length
    ? await paged<AllocRow>((from, to) =>
        admin
          .from("rental_payment_allocations")
          .select("id, amount, charge:rental_charges!inner(contract_id, label), item:rental_charge_items!inner(kind, payee), payment:rental_payments!inner(paid_at, voided_at)")
          .eq("organization_id", organizationId)
          // Mismo criterio que revalida la RPC (068k): una imputación anulada no se rinde.
          .eq("voided", false)
          .in("charge.contract_id", contractIds)
          .eq("item.payee", "propietario")
          .is("payment.voided_at", null)
          // 070: un cobro con reparto lo cobró el propietario directo (ya tiene esa
          // plata): nunca se rinde, aunque el contrato pase a cobrarlo la inmobiliaria.
          // La RPC lo frena igual (COBRO_DIRECTO).
          .is("payment.split", null)
          .lte("payment.paid_at", opts.cutoff)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];

  const expenses = await paged<Pick<RentalExpense, "id" | "property_id" | "occurred_on" | "description" | "amount" | "currency">>((from, to) =>
    admin
      .from("rental_expenses")
      .select("id, property_id, occurred_on, description, amount, currency")
      .eq("organization_id", organizationId)
      .eq("charged_to", "propietario")
      // Si lo pagó el propio propietario (o el inquilino) no hay nada que retenerle.
      .in("paid_by", ["inmobiliaria", "pendiente"])
      .neq("status", "anulado")
      .in("property_id", propertyIds)
      .lte("occurred_on", opts.cutoff)
      .order("occurred_on", { ascending: true })
      .range(from, to),
  );

  // Lo que ya se rindió a cada propietario (renglones vigentes).
  const ownerIds = [...new Set(shares.map((s) => s.owner_id))];
  const rendered = await paged<{ owner_id: string; ref_type: string; ref_id: string }>((from, to) =>
    admin
      .from("rental_owner_statement_lines")
      .select("owner_id, ref_type, ref_id")
      .eq("organization_id", organizationId)
      .eq("voided", false)
      .in("owner_id", ownerIds)
      .not("ref_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const renderedKey = new Set(rendered.map((r) => `${r.owner_id}:${r.ref_type}:${r.ref_id}`));

  // Rendiciones cerradas con neto negativo: lo que el propietario quedó debiendo
  // se descuenta en la próxima (una sola vez: statement_carry en el índice único).
  const { data: closedNeg } = await admin
    .from("rental_owner_statements")
    .select("id, owner_id, number, currency, net_amount")
    .eq("organization_id", organizationId)
    .eq("status", "pagada")
    .lt("net_amount", 0)
    .in("owner_id", ownerIds);
  const carries = ((closedNeg ?? []) as { id: string; owner_id: string; number: number; currency: string; net_amount: number }[]).filter(
    (s) => !renderedKey.has(`${s.owner_id}:statement_carry:${s.id}`),
  );

  const out: OwnerPending[] = [];
  for (const ownerId of ownerIds) {
    const ownerShares = shares.filter((s) => s.owner_id === ownerId);
    const ownerPropertyIds = new Set(ownerShares.map((s) => s.property_id));
    const ownerContracts = contracts.filter((c) => ownerPropertyIds.has(c.property_id));
    const currencies = new Set<string>([
      ...ownerContracts.map((c) => c.currency),
      ...expenses.filter((x) => ownerPropertyIds.has(x.property_id)).map((x) => x.currency),
    ]);
    for (const currency of currencies) {
      const collected: CollectedEntry[] = [];
      let lastPaidAt: string | null = null;
      for (const a of allocs) {
        if (!a.charge || !a.item || !a.payment) continue;
        const c = contractById.get(a.charge.contract_id);
        if (!c || c.currency !== currency || !ownerPropertyIds.has(c.property_id)) continue;
        if (renderedKey.has(`${ownerId}:allocation:${a.id}`)) continue;
        const p = props.get(c.property_id);
        collected.push({
          allocationId: a.id,
          contractId: c.id,
          propertyId: c.property_id,
          propertyLabel: p ? propertyAddress(p) : formatContractNumber(c.number),
          kind: a.item.kind,
          payee: a.item.payee,
          amount: Number(a.amount),
          paidAt: a.payment.paid_at,
          periodLabel: a.charge.label.replace(/^Alquiler\s+/i, ""),
        });
        if (!lastPaidAt || a.payment.paid_at > lastPaidAt) lastPaidAt = a.payment.paid_at;
      }
      const ownerExpenses = expenses
        .filter((x) => x.currency === currency && ownerPropertyIds.has(x.property_id) && !renderedKey.has(`${ownerId}:expense:${x.id}`))
        .map((x) => ({ id: x.id, propertyId: x.property_id, date: x.occurred_on, description: `Gasto: ${x.description}`, amount: Number(x.amount) }));
      const oneTime = ownerContracts
        .filter((c) => c.currency === currency && !renderedKey.has(`${ownerId}:contract_commission:${c.id}`))
        .map((c) => {
          const rule = c.owner_commission as RentalCommissionRule | null;
          // Misma base que el cargo de ingreso: montos pactados o precio a la firma.
          const amount = commissionAmount(rule, {
            monthlyRent: Number(c.initial_rent),
            durationMonths: c.duration_months,
            contractValue: stipulatedContractValue(c),
          }).total;
          const p = props.get(c.property_id);
          return {
            id: c.id,
            contractId: c.id,
            propertyId: c.property_id,
            description: `Honorarios por la locación · ${formatContractNumber(c.number)}${p ? ` · ${propertyAddress(p)}` : ""}`,
            amount,
          };
        })
        .filter((x) => x.amount > 0);

      const built = buildOwnerStatementLines({
        collected,
        shares: ownerShares.map((s) => ({ propertyId: s.property_id, pct: Number(s.ownership_pct) })),
        feeRules: ownerContracts.map((c) => ({ contractId: c.id, adminFeePct: Number(c.admin_fee_pct), adminFeeVat: c.admin_fee_vat })),
        expenses: ownerExpenses,
        oneTime,
      });
      if (!built.lines.length) continue;
      const carryLines: StatementLineDraft[] = carries
        .filter((s) => s.owner_id === ownerId && s.currency === currency)
        .map((s) => ({
          lineType: "ajuste" as const,
          sign: -1 as const,
          amount: round2(Math.abs(Number(s.net_amount))),
          description: `Saldo de la rendición N° ${String(s.number).padStart(4, "0")} (lo que quedó debiendo)`,
          contractId: null,
          propertyId: null,
          refType: "statement_carry" as const,
          refId: s.id,
          sharePct: 100,
        }));
      const lines = [...built.lines, ...carryLines];
      out.push({
        ownerId,
        currency,
        lines,
        totals: carryLines.length ? totalsOf(lines) : built.totals,
        collectedCount: collected.length,
        lastPaidAt,
        expenseAmounts: Object.fromEntries(ownerExpenses.map((x) => [x.id, x.amount])),
      });
    }
  }
  return out;
}

// ─── Crear / emitir / pagar / anular ────────────────────────────────────────

export async function createOwnerStatement(
  ctx: RentalsCtx,
  input: { ownerId: string; currency: string; cutoff: string; notes?: string | null },
): Promise<ActionResult<{ statementId: string; number: number }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.cutoff)) return { ok: false, error: "La fecha de corte no es válida." };
  const pending = await computePendingForOwners(ctx.admin, ctx.organization.id, { cutoff: input.cutoff, ownerIds: [input.ownerId] });
  const mine = pending.find((p) => p.currency === input.currency);
  if (!mine || !mine.lines.length) return { ok: false, error: "No hay nada pendiente de rendir para este propietario a esa fecha." };

  const { data, error } = await ctx.admin.rpc("rental_create_owner_statement", {
    p_organization_id: ctx.organization.id,
    p_owner_id: input.ownerId,
    p_header: {
      period_year: Number(input.cutoff.slice(0, 4)),
      period_month: Number(input.cutoff.slice(5, 7)),
      cutoff_date: input.cutoff,
      currency: input.currency,
      notes: input.notes?.trim() || null,
      generated_by: ctx.session.userId,
    },
    p_lines: mine.lines.map((l, i) => ({
      line_type: l.lineType,
      sign: l.sign,
      amount: l.amount,
      description: l.description.slice(0, 300),
      contract_id: l.contractId,
      property_id: l.propertyId,
      ref_type: l.refType,
      ref_id: l.refId,
      // La RPC (068k) frena si el gasto cambió de importe desde que se leyó;
      // antes de la 068k la clave se ignora.
      ref_amount: l.refType === "expense" && l.refId ? (mine.expenseAmounts[l.refId] ?? null) : null,
      share_pct: l.sharePct,
      sort_order: i + 1,
    })),
  });
  if (error) return dbFailure("createOwnerStatement", error, "No se pudo generar la rendición.");
  const res = data as { statement_id: string; number: number };
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    type: "rendicion_generada",
    summary: `Rendición N° ${String(res.number).padStart(4, "0")} generada (neto ${round2(mine.totals.net).toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${input.currency}).`,
    payload: { statement_id: res.statement_id, owner_id: input.ownerId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, statementId: res.statement_id, number: res.number };
}

async function loadStatementRow(ctx: RentalsCtx, statementId: string): Promise<RentalOwnerStatement | null> {
  const { data } = await ctx.admin
    .from("rental_owner_statements")
    .select("*")
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  return (data as RentalOwnerStatement | null) ?? null;
}

/** Asegura el link público de la rendición y devuelve su path (`/rendicion/<token>`). */
export async function ensureStatementLink(ctx: RentalsCtx, statement: RentalOwnerStatement): Promise<string> {
  const version = statement.public_token_version || 1;
  const hash = hashRentalToken(deriveRentalToken("rendicion", statement.id, version));
  if (statement.public_token_hash !== hash) {
    // Con la versión en el filtro, una lectura vieja nunca revive un link que se dio de baja.
    await ctx.admin
      .from("rental_owner_statements")
      .update({ public_token_hash: hash })
      .eq("id", statement.id)
      .eq("organization_id", ctx.organization.id)
      .eq("public_token_version", version);
  }
  return statementPublicPath(statement.id, version);
}

/**
 * Link nuevo para la rendición: sube la versión del token y el link anterior
 * deja de funcionar. Para cuando se mandó a quien no correspondía: el link
 * muestra el CBU del propietario, los inquilinos y cada importe.
 * Anular no apaga el link (el propietario ve que se anuló); en una anulada esto
 * lo da de baja del todo, porque una anulada no se vuelve a compartir.
 */
export async function regenerateStatementLink(
  ctx: RentalsCtx,
  statementId: string,
): Promise<ActionResult<{ path: string | null; ownerId: string; voided: boolean }>> {
  const s = await loadStatementRow(ctx, statementId);
  if (!s) return { ok: false, error: "No encontramos la rendición." };
  const voided = s.status === "anulada";
  if (s.status === "borrador" || !s.public_token_hash) {
    return { ok: false, error: voided ? "La rendición ya no tiene link." : "La rendición todavía no tiene link: se arma cuando la emitís o la compartís." };
  }
  const version = (s.public_token_version || 1) + 1;
  const hash = voided ? null : hashRentalToken(deriveRentalToken("rendicion", s.id, version));
  const { data, error } = await ctx.admin
    .from("rental_owner_statements")
    .update({ public_token_version: version, public_token_hash: hash })
    .eq("id", s.id)
    .eq("organization_id", ctx.organization.id)
    // Dos clics a la vez: el segundo no pisa la versión del primero.
    .eq("public_token_version", s.public_token_version)
    .select("id");
  if (error) return dbFailure("regenerateStatementLink", error, voided ? "No se pudo dar de baja el link." : "No se pudo generar el link nuevo.");
  if (!data?.length) return { ok: false, error: "El link cambió mientras tanto. Recargá la página." };
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    type: voided ? "rendicion_link_baja" : "rendicion_link_nuevo",
    summary: voided
      ? `Rendición N° ${String(s.number).padStart(4, "0")} (anulada): se dio de baja su link.`
      : `Rendición N° ${String(s.number).padStart(4, "0")}: se generó un link nuevo y el anterior dejó de funcionar.`,
    payload: { statement_id: s.id, owner_id: s.owner_id },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, path: voided ? null : statementPublicPath(s.id, version), ownerId: s.owner_id, voided };
}

/** Borrador → emitida (lista para mandar al propietario). Devuelve el link público. */
export async function emitOwnerStatement(ctx: RentalsCtx, statementId: string): Promise<ActionResult<{ path: string }>> {
  const s = await loadStatementRow(ctx, statementId);
  if (!s) return { ok: false, error: "No encontramos la rendición." };
  if (s.status === "anulada") return { ok: false, error: "La rendición está anulada." };
  const path = await ensureStatementLink(ctx, s);
  if (s.status === "borrador") {
    const { error } = await ctx.admin
      .from("rental_owner_statements")
      .update({ status: "emitida" })
      .eq("id", s.id)
      .eq("organization_id", ctx.organization.id)
      .eq("status", "borrador");
    if (error) return dbFailure("emitOwnerStatement", error, "No se pudo emitir la rendición.");
  }
  return { ok: true, path };
}

export async function markStatementSent(ctx: RentalsCtx, statementId: string, sentTo: string): Promise<void> {
  await ctx.admin
    .from("rental_owner_statements")
    .update({ sent_at: new Date().toISOString(), sent_to: sentTo.slice(0, 200) })
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id);
}

export async function payOwnerStatement(
  ctx: RentalsCtx,
  statementId: string,
  input: { splits: { accountId: string; amount: number }[]; paidAt: string },
): Promise<ActionResult> {
  if (!input.splits.length) return { ok: false, error: "Elegí al menos una cuenta." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt) || input.paidAt > ctx.today) {
    return { ok: false, error: "La fecha del pago no es válida.", field: "paidAt" };
  }
  const s = await loadStatementRow(ctx, statementId);
  if (!s) return { ok: false, error: "No encontramos la rendición." };
  const { data: owner } = await ctx.admin.from("owners").select("full_name").eq("id", s.owner_id).maybeSingle();
  const { error } = await ctx.admin.rpc("rental_pay_owner_statement", {
    p_organization_id: ctx.organization.id,
    p_statement_id: statementId,
    p_splits: input.splits.map((x) => ({ account_id: x.accountId, amount: round2(x.amount) })),
    p_paid_at: zonedTimeToUtc(input.paidAt, "12:00", ctx.tz).toISOString(),
    p_actor: ctx.session.userId,
    p_description: `Rendición N° ${String(s.number).padStart(4, "0")}${owner?.full_name ? ` · ${owner.full_name}` : ""}`,
  });
  if (error) return dbFailure("payOwnerStatement", error, "No se pudo registrar el pago de la rendición.");
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    type: "rendicion_pagada",
    summary: `Rendición N° ${String(s.number).padStart(4, "0")} pagada al propietario.`,
    payload: { statement_id: statementId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true };
}

export async function voidOwnerStatement(
  ctx: RentalsCtx,
  statementId: string,
  input: { reason: string; deletePayments: boolean },
): Promise<ActionResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Contá brevemente por qué se anula.", field: "reason" };
  const { error } = await ctx.admin.rpc("rental_void_owner_statement", {
    p_organization_id: ctx.organization.id,
    p_statement_id: statementId,
    p_reason: reason,
    p_delete_payments: input.deletePayments,
  });
  if (error) return dbFailure("voidOwnerStatement", error, "No se pudo anular la rendición.");
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    type: "rendicion_anulada",
    summary: `Rendición anulada: ${reason}`.slice(0, 400),
    payload: { statement_id: statementId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true };
}

/**
 * Cierra una rendición con neto cero o negativo (los gastos superaron lo
 * cobrado): no mueve Caja y lo que el propietario quedó debiendo se descuenta
 * solo en su próxima rendición.
 */
export async function closeOwnerStatement(ctx: RentalsCtx, statementId: string): Promise<ActionResult<{ carry: number }>> {
  const s = await loadStatementRow(ctx, statementId);
  if (!s) return { ok: false, error: "No encontramos la rendición." };
  const { data, error } = await ctx.admin.rpc("rental_close_owner_statement", {
    p_organization_id: ctx.organization.id,
    p_statement_id: statementId,
    p_actor: ctx.session.userId,
  });
  if (error) return dbFailure("closeOwnerStatement", error, "No se pudo cerrar la rendición.");
  const carry = Number((data as { carry?: number } | null)?.carry ?? 0);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    type: "rendicion_cerrada",
    summary: carry > 0
      ? `Rendición N° ${String(s.number).padStart(4, "0")} cerrada sin pago: ${carry.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${s.currency} pasan a descontarse en la próxima.`
      : `Rendición N° ${String(s.number).padStart(4, "0")} cerrada sin pago (neto cero).`,
    payload: { statement_id: statementId, carry },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, carry };
}
