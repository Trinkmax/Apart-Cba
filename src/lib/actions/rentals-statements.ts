"use server";

import { z } from "zod";
import { absoluteUrl } from "@/lib/app-url";
import { isYmd } from "@/lib/rentals/ymd";
import { propertyAddress } from "@/lib/rentals/labels";
import { hashRentalToken, isWellFormedRentalToken, rentalTokenMatches, statementPublicPath } from "@/lib/rentals/link-token";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type AdminClient, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import {
  computePendingForOwners,
  createOwnerStatement,
  emitOwnerStatement,
  markStatementSent,
  payOwnerStatement,
  voidOwnerStatement,
  closeOwnerStatement,
  regenerateStatementLink as regenerateStatementLinkService,
} from "@/lib/rentals/server/statements";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { sendGuestMail } from "@/lib/email/guest";
import { renderStatementEmail } from "@/lib/email/rentals-statements";
import { createAdminClient } from "@/lib/supabase/server";
import type { Owner, RentalOwnerStatement, RentalOwnerStatementLine, RentalStatementStatus } from "@/lib/types/database";
import type { OrgBranding } from "@/lib/pdf/org-header";
import {
  buildStatementDoc,
  statementWhatsappText,
  validateSplits,
  type ContractRef,
  type PropertyRef,
  type StatementDocModel,
  type StatementLineInput,
  type StatementOwnerInput,
} from "@/components/rentals/statements/statement-model";
import type {
  PendingBoard,
  PendingOwnerCard,
  PayoutAccount,
  PublicStatement,
  StatementDetail,
  StatementListItem,
  StatementShareInfo,
} from "@/components/rentals/statements/types";

/**
 * Rendiciones al propietario (pantallas /dashboard/alquileres/rendiciones y el
 * link público /rendicion/<token>). Envuelve los servicios de
 * `src/lib/rentals/server/statements.ts`: acá sólo hay permisos, validación,
 * lecturas para la UI y revalidación. Errores como valor, nunca throw.
 */

type OwnerRow = Pick<Owner, "id" | "full_name" | "email" | "phone" | "bank_name" | "cbu" | "alias_cbu">;
const OWNER_COLS = "id, full_name, email, phone, bank_name, cbu, alias_cbu";

const uuid = z.string().uuid();

function ownerInput(o: OwnerRow | null | undefined): StatementOwnerInput {
  return {
    full_name: o?.full_name ?? "Propietario",
    email: o?.email ?? null,
    phone: o?.phone ?? null,
    bank_name: o?.bank_name ?? null,
    cbu: o?.cbu ?? null,
    alias_cbu: o?.alias_cbu ?? null,
  };
}

function brandingOf(org: { name: string; legal_name: string | null; tax_id: string | null; logo_url: string | null; primary_color: string | null }): OrgBranding {
  return { name: org.name, legal_name: org.legal_name, tax_id: org.tax_id, logo_url: org.logo_url, primary_color: org.primary_color };
}

/** Direcciones de las propiedades y N° + inquilino titular de los contratos (para agrupar renglones). */
async function loadRefs(
  admin: AdminClient,
  organizationId: string,
  propertyIds: string[],
  contractIds: string[],
): Promise<{ properties: PropertyRef[]; contracts: ContractRef[] }> {
  const [propsRes, contractsRes, partiesRes] = await Promise.all([
    propertyIds.length
      ? admin
          .from("rental_properties")
          .select("id, code, street, street_number, floor, apartment, tower")
          .eq("organization_id", organizationId)
          .in("id", propertyIds)
      : Promise.resolve({ data: [], error: null }),
    contractIds.length
      ? admin.from("rental_contracts").select("id, number").eq("organization_id", organizationId).in("id", contractIds)
      : Promise.resolve({ data: [], error: null }),
    contractIds.length
      ? admin
          .from("rental_contract_parties")
          .select("contract_id, is_primary, person:rental_people(full_name)")
          .eq("organization_id", organizationId)
          .eq("role", "inquilino")
          .in("contract_id", contractIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  type PropRow = { id: string; code: string | null; street: string; street_number: string | null; floor: string | null; apartment: string | null; tower: string | null };
  type PartyRow = { contract_id: string; is_primary: boolean; person: { full_name: string } | { full_name: string }[] | null };
  const tenantByContract = new Map<string, { name: string; primary: boolean }>();
  for (const p of (partiesRes.data ?? []) as PartyRow[]) {
    const person = Array.isArray(p.person) ? p.person[0] : p.person;
    if (!person?.full_name) continue;
    const prev = tenantByContract.get(p.contract_id);
    if (!prev || (p.is_primary && !prev.primary)) tenantByContract.set(p.contract_id, { name: person.full_name, primary: p.is_primary });
  }
  return {
    properties: ((propsRes.data ?? []) as PropRow[]).map((p) => ({ id: p.id, label: propertyAddress(p), code: p.code })),
    contracts: ((contractsRes.data ?? []) as { id: string; number: number }[]).map((c) => ({
      id: c.id,
      number: c.number,
      tenantName: tenantByContract.get(c.id)?.name ?? null,
    })),
  };
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

// ─── Para rendir ────────────────────────────────────────────────────────────

/** Tarjetas "Para rendir": lo cobrado y no rendido de cada propietario a la fecha de corte. */
export async function listPendingByOwner(cutoff?: string | null): Promise<ActionResult<{ board: PendingBoard }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const cut = cutoff && isYmd(cutoff) ? cutoff : ctx.today;
  try {
    const [pending, sharesRes] = await Promise.all([
      computePendingForOwners(ctx.admin, ctx.organization.id, { cutoff: cut }),
      ctx.admin.from("rental_property_owners").select("owner_id").eq("organization_id", ctx.organization.id),
    ]);
    const ownersWithProperties = uniq(((sharesRes.data ?? []) as { owner_id: string }[]).map((s) => s.owner_id)).length;
    if (!pending.length) return { ok: true, board: { cutoff: cut, cards: [], ownersWithProperties } };

    const ownerIds = uniq(pending.map((p) => p.ownerId));
    const propertyIds = uniq(pending.flatMap((p) => p.lines.map((l) => l.propertyId)));
    const [{ data: ownersData }, refs] = await Promise.all([
      ctx.admin.from("owners").select(OWNER_COLS).eq("organization_id", ctx.organization.id).in("id", ownerIds),
      loadRefs(ctx.admin, ctx.organization.id, propertyIds, []),
    ]);
    const owners = new Map(((ownersData ?? []) as OwnerRow[]).map((o) => [o.id, o]));
    const labelOf = new Map(refs.properties.map((p) => [p.id, p.label]));
    const cards: PendingOwnerCard[] = pending.map((p) => {
      const o = owners.get(p.ownerId);
      return {
        ownerId: p.ownerId,
        ownerName: o?.full_name ?? "Propietario",
        ownerEmail: o?.email ?? null,
        ownerPhone: o?.phone ?? null,
        hasBankData: !!(o?.cbu || o?.alias_cbu),
        currency: p.currency,
        totals: p.totals,
        collectedCount: p.collectedCount,
        lastPaidAt: p.lastPaidAt,
        properties: uniq(p.lines.map((l) => (l.propertyId ? labelOf.get(l.propertyId) : null))).sort((a, b) => a.localeCompare(b, "es")),
      };
    });
    cards.sort((a, b) => b.totals.net - a.totals.net || a.ownerName.localeCompare(b.ownerName, "es"));
    return { ok: true, board: { cutoff: cut, cards, ownersWithProperties } };
  } catch (e) {
    logRentalsError("listPendingByOwner", e);
    return { ok: false, error: "No se pudo calcular lo pendiente de rendir. Probá de nuevo en un rato." };
  }
}

/** Vista previa del documento antes de generarlo (mismo componente que la rendición real). */
export async function previewOwnerPending(
  ownerId: string,
  currency: string,
  cutoff: string,
): Promise<ActionResult<{ model: StatementDocModel }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(ownerId).success) return { ok: false, error: "Propietario inválido." };
  if (!isYmd(cutoff)) return { ok: false, error: "La fecha de corte no es válida.", field: "cutoff" };
  if (cutoff > ctx.today) return { ok: false, error: "La fecha de corte no puede ser futura.", field: "cutoff" };
  try {
    const pending = await computePendingForOwners(ctx.admin, ctx.organization.id, { cutoff, ownerIds: [ownerId] });
    const mine = pending.find((p) => p.currency === currency);
    if (!mine || !mine.lines.length) return { ok: false, error: "No hay nada pendiente de rendir para este propietario a esa fecha." };
    const [{ data: ownerData }, refs] = await Promise.all([
      ctx.admin.from("owners").select(OWNER_COLS).eq("organization_id", ctx.organization.id).eq("id", ownerId).maybeSingle(),
      loadRefs(ctx.admin, ctx.organization.id, uniq(mine.lines.map((l) => l.propertyId)), uniq(mine.lines.map((l) => l.contractId))),
    ]);
    const lines: StatementLineInput[] = mine.lines.map((l, i) => ({
      id: `preview-${i}`,
      line_type: l.lineType,
      sign: l.sign,
      amount: l.amount,
      description: l.description,
      contract_id: l.contractId,
      property_id: l.propertyId,
      share_pct: l.sharePct,
      sort_order: i + 1,
    }));
    const model = buildStatementDoc({
      header: {
        id: "preview",
        number: 0,
        status: "borrador",
        currency,
        cutoff_date: cutoff,
        collected_amount: mine.totals.collected,
        fees_amount: mine.totals.fees,
        vat_amount: mine.totals.vat,
        expenses_amount: mine.totals.expenses,
        other_amount: mine.totals.other,
        net_amount: mine.totals.net,
        generated_at: new Date().toISOString(),
        sent_at: null,
        sent_to: null,
        paid_at: null,
        voided_at: null,
        void_reason: null,
        notes: null,
      },
      lines,
      owner: ownerInput(ownerData as OwnerRow | null),
      ...refs,
    });
    return { ok: true, model };
  } catch (e) {
    logRentalsError("previewOwnerPending", e);
    return { ok: false, error: "No se pudo armar la vista previa." };
  }
}

const createSchema = z.object({
  ownerId: z.string().uuid("Elegí un propietario"),
  currency: z.string().min(3).max(5),
  cutoff: z.string().refine(isYmd, "La fecha de corte no es válida."),
  notes: z.string().max(2000, "La nota es muy larga (máximo 2000 caracteres).").nullable().optional(),
});

export async function createStatement(input: z.input<typeof createSchema>): Promise<ActionResult<{ statementId: string; number: number }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  if (parsed.data.cutoff > ctx.today) return { ok: false, error: "La fecha de corte no puede ser futura.", field: "cutoff" };
  try {
    const res = await createOwnerStatement(ctx, parsed.data);
    if (!res.ok) return res;
    revalidateRentals({ statementId: res.statementId, ownerId: parsed.data.ownerId });
    return { ok: true, statementId: res.statementId, number: res.number };
  } catch (e) {
    logRentalsError("createStatement", e);
    return { ok: false, error: "No se pudo generar la rendición." };
  }
}

// ─── Lista y detalle ────────────────────────────────────────────────────────

const STATUSES: RentalStatementStatus[] = ["borrador", "emitida", "pagada", "anulada"];

export async function listStatements(filters: { status?: RentalStatementStatus | null; ownerId?: string | null } = {}): Promise<
  ActionResult<{ items: StatementListItem[] }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  filters = filters ?? {};
  let q = ctx.admin
    .from("rental_owner_statements")
    .select("id, number, status, currency, cutoff_date, owner_id, collected_amount, fees_amount, vat_amount, expenses_amount, net_amount, generated_at, sent_at, paid_at")
    .eq("organization_id", ctx.organization.id)
    .order("generated_at", { ascending: false })
    .limit(500);
  if (filters.status && STATUSES.includes(filters.status)) q = q.eq("status", filters.status);
  if (filters.ownerId && uuid.safeParse(filters.ownerId).success) q = q.eq("owner_id", filters.ownerId);
  const { data, error } = await q;
  if (error) return dbFailure("listStatements", error, "No se pudieron leer las rendiciones.");
  type Row = Pick<
    RentalOwnerStatement,
    "id" | "number" | "status" | "currency" | "cutoff_date" | "owner_id" | "collected_amount" | "fees_amount" | "vat_amount" | "expenses_amount" | "net_amount" | "generated_at" | "sent_at" | "paid_at"
  >;
  const rows = (data ?? []) as Row[];
  const ownerIds = uniq(rows.map((x) => x.owner_id));
  const { data: ownersData } = ownerIds.length
    ? await ctx.admin.from("owners").select("id, full_name").eq("organization_id", ctx.organization.id).in("id", ownerIds)
    : { data: [] };
  const names = new Map(((ownersData ?? []) as { id: string; full_name: string }[]).map((o) => [o.id, o.full_name]));
  return {
    ok: true,
    items: rows.map((x) => ({
      id: x.id,
      number: x.number,
      status: x.status,
      currency: x.currency,
      cutoffDate: x.cutoff_date,
      ownerId: x.owner_id,
      ownerName: names.get(x.owner_id) ?? "Propietario",
      collected: Number(x.collected_amount),
      fees: Number(x.fees_amount),
      vat: Number(x.vat_amount),
      expenses: Number(x.expenses_amount),
      net: Number(x.net_amount),
      generatedAt: x.generated_at,
      sentAt: x.sent_at,
      paidAt: x.paid_at,
    })),
  };
}

/** Arma el documento completo de una rendición de la org (null = no existe o es de otra org). */
async function loadDetail(ctx: RentalsCtx, statementId: string): Promise<StatementDetail | null> {
  const { data: header } = await ctx.admin
    .from("rental_owner_statements")
    .select("*")
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const s = header as RentalOwnerStatement | null;
  if (!s) return null;
  const [{ data: linesData }, { data: ownerData }] = await Promise.all([
    ctx.admin
      .from("rental_owner_statement_lines")
      .select("id, line_type, sign, amount, description, contract_id, property_id, share_pct, sort_order")
      .eq("organization_id", ctx.organization.id)
      .eq("statement_id", s.id)
      .order("sort_order", { ascending: true }),
    ctx.admin.from("owners").select(OWNER_COLS).eq("organization_id", ctx.organization.id).eq("id", s.owner_id).maybeSingle(),
  ]);
  const lines = (linesData ?? []) as Pick<
    RentalOwnerStatementLine,
    "id" | "line_type" | "sign" | "amount" | "description" | "contract_id" | "property_id" | "share_pct" | "sort_order"
  >[];
  const owner = ownerData as OwnerRow | null;
  const movementIds = s.paid_movement_ids ?? [];
  const [refs, movesRes, accountsRes] = await Promise.all([
    loadRefs(ctx.admin, ctx.organization.id, uniq(lines.map((l) => l.property_id)), uniq(lines.map((l) => l.contract_id))),
    movementIds.length
      ? ctx.admin.from("cash_movements").select("id, account_id, amount").eq("organization_id", ctx.organization.id).in("id", movementIds)
      : Promise.resolve({ data: [], error: null }),
    s.status === "borrador" || s.status === "emitida"
      ? ctx.admin
          .from("cash_accounts")
          .select("id, name, currency, type, color")
          .eq("organization_id", ctx.organization.id)
          .eq("active", true)
          .eq("currency", s.currency)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const moves = (movesRes.data ?? []) as { id: string; account_id: string; amount: number }[];
  const accountIds = uniq(moves.map((m) => m.account_id));
  const { data: moveAccounts } = accountIds.length
    ? await ctx.admin.from("cash_accounts").select("id, name").eq("organization_id", ctx.organization.id).in("id", accountIds)
    : { data: [] };
  const accountName = new Map(((moveAccounts ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  const model = buildStatementDoc({
    header: s,
    lines: lines.map((l) => ({ ...l, sign: Number(l.sign), amount: Number(l.amount), share_pct: Number(l.share_pct) })),
    owner: ownerInput(owner),
    ...refs,
    payments: moves.map((m) => ({ accountName: accountName.get(m.account_id) ?? "Cuenta", amount: Number(m.amount) })),
  });
  const publicUrl = s.status !== "borrador" && s.public_token_hash ? absoluteUrl(statementPublicPath(s.id, s.public_token_version || 1)) : null;
  return {
    model,
    ownerId: s.owner_id,
    orgName: ctx.organization.name,
    branding: brandingOf(ctx.organization),
    publicUrl,
    whatsappText: publicUrl ? statementWhatsappText(model, publicUrl, ctx.organization.name) : null,
    ownerWhatsappDigits: toWhatsappDigits(owner?.phone) || null,
    accounts: ((accountsRes.data ?? []) as PayoutAccount[]).map((a) => ({ id: a.id, name: a.name, currency: a.currency, type: a.type, color: a.color })),
  };
}

export async function getStatement(statementId: string): Promise<ActionResult<{ detail: StatementDetail }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  try {
    const detail = await loadDetail(r.ctx, statementId);
    if (!detail) return { ok: false, error: "No encontramos la rendición." };
    return { ok: true, detail };
  } catch (e) {
    logRentalsError("getStatement", e);
    return { ok: false, error: "No se pudo abrir la rendición." };
  }
}

// ─── Emitir / enviar ────────────────────────────────────────────────────────

/** Borrador → emitida (si hacía falta) y devuelve el link público + el mensaje de WhatsApp. */
export async function emitStatement(statementId: string): Promise<ActionResult<{ share: StatementShareInfo }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  try {
    const emitted = await emitOwnerStatement(ctx, statementId);
    if (!emitted.ok) return emitted;
    const detail = await loadDetail(ctx, statementId);
    if (!detail) return { ok: false, error: "No encontramos la rendición." };
    const url = absoluteUrl(emitted.path);
    revalidateRentals({ statementId, ownerId: detail.ownerId });
    return {
      ok: true,
      share: {
        path: emitted.path,
        url,
        whatsappText: statementWhatsappText(detail.model, url, ctx.organization.name),
        ownerWhatsappDigits: detail.ownerWhatsappDigits,
        ownerEmail: detail.model.owner.email,
      },
    };
  } catch (e) {
    logRentalsError("emitStatement", e);
    return { ok: false, error: "No se pudo emitir la rendición." };
  }
}

/** Manda la rendición por mail (PDF adjunto + link). Si estaba en borrador, la emite. */
export async function sendStatementEmail(statementId: string, to?: string | null): Promise<ActionResult<{ sentTo: string }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  try {
    const emitted = await emitOwnerStatement(ctx, statementId);
    if (!emitted.ok) return emitted;
    const detail = await loadDetail(ctx, statementId);
    if (!detail) return { ok: false, error: "No encontramos la rendición." };
    const dest = (typeof to === "string" ? to.trim() : "") || detail.model.owner.email || "";
    if (!dest) return { ok: false, error: "El propietario no tiene mail cargado. Escribí uno.", field: "to" };
    if (!z.string().email().max(200).safeParse(dest).success) return { ok: false, error: "El mail no es válido.", field: "to" };
    const url = absoluteUrl(emitted.path);

    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const { renderRentalStatementPdfBuffer } = await import("@/lib/pdf/rental-statement-pdf");
      const pdf = await renderRentalStatementPdfBuffer(detail.model, detail.branding);
      attachments = [{ filename: pdf.filename, content: pdf.buffer }];
    } catch (e) {
      // Sin PDF igual sirve: el mail lleva el link al documento.
      logRentalsError("sendStatementEmail.pdf", e);
    }
    const mail = renderStatementEmail({
      model: detail.model,
      orgName: ctx.organization.name,
      brandColor: ctx.organization.primary_color,
      publicUrl: url,
      contactEmail: ctx.organization.contact_email ?? null,
      contactPhone: ctx.organization.contact_phone ?? null,
      hasAttachment: !!attachments,
    });
    const res = await sendGuestMail({
      organizationId: ctx.organization.id,
      to: dest,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: ctx.organization.contact_email || undefined,
      attachments,
    });
    if (!res.ok) {
      logRentalsError("sendStatementEmail", res.error);
      return { ok: false, error: "No se pudo mandar el mail. Revisá la dirección o probá de nuevo en un rato." };
    }
    await markStatementSent(ctx, statementId, dest);
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      type: "rendicion_enviada",
      summary: `Rendición N° ${detail.model.number} enviada por mail a ${dest}.`,
      payload: { statement_id: statementId },
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
    revalidateRentals({ statementId, ownerId: detail.ownerId });
    return { ok: true, sentTo: dest };
  } catch (e) {
    logRentalsError("sendStatementEmail", e);
    return { ok: false, error: "No se pudo mandar el mail." };
  }
}

// ─── Pagar / anular ─────────────────────────────────────────────────────────

const paySchema = z.object({
  splits: z
    .array(
      z.object({
        accountId: z.string().uuid("Elegí la cuenta de cada pago."),
        amount: z.coerce.number().positive("Cada cuenta tiene que tener un importe mayor a cero."),
      }),
    )
    .min(1, "Elegí al menos una cuenta.")
    .max(10, "Como máximo 10 cuentas."),
  paidAt: z.string().refine(isYmd, "La fecha del pago no es válida."),
});

/** Registra la transferencia al propietario: un egreso de Caja por cuenta; la suma tiene que dar el neto. */
export async function payStatement(statementId: string, input: z.input<typeof paySchema>): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const { data } = await ctx.admin
    .from("rental_owner_statements")
    .select("status, net_amount, currency, owner_id")
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const s = data as Pick<RentalOwnerStatement, "status" | "net_amount" | "currency" | "owner_id"> | null;
  if (!s) return { ok: false, error: "No encontramos la rendición." };
  if (s.status === "pagada") return { ok: false, error: "La rendición ya figura como pagada." };
  if (s.status === "anulada") return { ok: false, error: "La rendición está anulada." };
  if (!(Number(s.net_amount) > 0)) return { ok: false, error: "El neto no es positivo: no hay nada para transferirle al propietario." };
  const check = validateSplits(parsed.data.splits, Number(s.net_amount), s.currency);
  if (!check.ok) return { ok: false, error: check.error };
  try {
    const res = await payOwnerStatement(ctx, statementId, parsed.data);
    if (!res.ok) return res;
    revalidateRentals({ statementId, ownerId: s.owner_id, caja: true });
    return { ok: true };
  } catch (e) {
    logRentalsError("payStatement", e);
    return { ok: false, error: "No se pudo registrar el pago." };
  }
}

/**
 * Cierra una rendición con neto cero o negativo sin mover Caja: lo que el
 * propietario quedó debiendo se descuenta en su próxima rendición.
 */
export async function closeStatementWithCarry(statementId: string): Promise<ActionResult<{ carry: number }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  const { data } = await ctx.admin
    .from("rental_owner_statements")
    .select("owner_id")
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!data) return { ok: false, error: "No encontramos la rendición." };
  try {
    const res = await closeOwnerStatement(ctx, statementId);
    if (!res.ok) return res;
    revalidateRentals({ statementId, ownerId: (data as { owner_id: string }).owner_id });
    return res;
  } catch (e) {
    logRentalsError("closeStatementWithCarry", e);
    return { ok: false, error: "No se pudo cerrar la rendición." };
  }
}

const voidSchema = z.object({
  reason: z.string().trim().min(3, "Contá brevemente por qué se anula.").max(400, "El motivo es muy largo."),
  deletePayments: z.boolean().default(false),
});

/** Anula la rendición: sus cobros y gastos vuelven a quedar "para rendir". Si estaba pagada, borra los egresos de Caja. */
export async function voidStatement(statementId: string, input: z.input<typeof voidSchema>): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos.", field: "reason" };
  const { data } = await ctx.admin
    .from("rental_owner_statements")
    .select("owner_id")
    .eq("id", statementId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!data) return { ok: false, error: "No encontramos la rendición." };
  try {
    const res = await voidOwnerStatement(ctx, statementId, parsed.data);
    if (!res.ok) return res;
    revalidateRentals({ statementId, ownerId: (data as { owner_id: string }).owner_id, caja: parsed.data.deletePayments });
    return { ok: true };
  } catch (e) {
    logRentalsError("voidStatement", e);
    return { ok: false, error: "No se pudo anular la rendición." };
  }
}

/**
 * Link nuevo para la rendición: el anterior deja de funcionar (se mandó a quien
 * no correspondía). En una anulada lo da de baja del todo (url null), porque
 * anular no apaga el link.
 */
export async function regenerateStatementLink(statementId: string): Promise<ActionResult<{ url: string | null; voided: boolean }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(statementId).success) return { ok: false, error: "No encontramos la rendición." };
  try {
    const res = await regenerateStatementLinkService(ctx, statementId);
    if (!res.ok) return res;
    revalidateRentals({ statementId, ownerId: res.ownerId });
    return { ok: true, url: res.path ? absoluteUrl(res.path) : null, voided: res.voided };
  } catch (e) {
    logRentalsError("regenerateStatementLink", e);
    return { ok: false, error: "No se pudo generar el link nuevo." };
  }
}

// ─── Link público (sin sesión) ──────────────────────────────────────────────

/**
 * Rendición de solo lectura para el propietario. El token se valida dos veces:
 * el hash encuentra la fila y el HMAC confirma que corresponde a ese id y
 * versión. No expone cuentas de Caja ni datos internos. null = link inválido.
 */
export async function getPublicStatement(token: string): Promise<PublicStatement | null> {
  if (!isWellFormedRentalToken(token)) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("rental_owner_statements").select("*").eq("public_token_hash", hashRentalToken(token)).maybeSingle();
    const s = data as RentalOwnerStatement | null;
    if (!s || s.status === "borrador") return null;
    if (!rentalTokenMatches("rendicion", token, s.id, s.public_token_version || 1)) return null;
    const [{ data: linesData }, { data: ownerData }, { data: orgData }] = await Promise.all([
      admin
        .from("rental_owner_statement_lines")
        .select("id, line_type, sign, amount, description, contract_id, property_id, share_pct, sort_order")
        .eq("organization_id", s.organization_id)
        .eq("statement_id", s.id)
        .order("sort_order", { ascending: true }),
      admin.from("owners").select(OWNER_COLS).eq("organization_id", s.organization_id).eq("id", s.owner_id).maybeSingle(),
      admin
        .from("organizations")
        .select("name, legal_name, tax_id, logo_url, primary_color, contact_email, contact_phone")
        .eq("id", s.organization_id)
        .maybeSingle(),
    ]);
    const lines = (linesData ?? []) as StatementLineInput[];
    const refs = await loadRefs(admin, s.organization_id, uniq(lines.map((l) => l.property_id)), uniq(lines.map((l) => l.contract_id)));
    const org = orgData as { name: string; legal_name: string | null; tax_id: string | null; logo_url: string | null; primary_color: string | null; contact_email: string | null; contact_phone: string | null } | null;
    const model = buildStatementDoc({
      // El motivo de anulación es texto interno del equipo ("retener, debe
      // expensas"…): el propietario sólo ve que se anuló. Vale para la página
      // y para el PDF que se baja desde ella (sale de este mismo modelo).
      header: { ...s, void_reason: null },
      lines: lines.map((l) => ({ ...l, sign: Number(l.sign), amount: Number(l.amount), share_pct: Number(l.share_pct) })),
      owner: ownerInput(ownerData as OwnerRow | null),
      ...refs,
    });
    return {
      model,
      branding: brandingOf(org ?? { name: "Rendición", legal_name: null, tax_id: null, logo_url: null, primary_color: null }),
      orgContact: { email: org?.contact_email ?? null, phone: org?.contact_phone ?? null },
    };
  } catch (e) {
    logRentalsError("getPublicStatement", e);
    return null;
  }
}
