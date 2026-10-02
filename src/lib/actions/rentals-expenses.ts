"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseAmountInput } from "@/lib/format";
import { zonedTimeToUtc } from "@/lib/dates";
import { isYmd } from "@/lib/rentals/ymd";
import { EXPENSE_CATEGORY_LABEL, formatContractNumber, formatStatementNumber, propertyAddress } from "@/lib/rentals/labels";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { sniffReceiptMime } from "@/lib/marketplace/reservation-view";
import type { RentalContract, RentalExpense, RentalProperty } from "@/lib/types/database";
import { cajaBillableFor, cajaCategoryForExpense, canPayFromCaja, expenseLockReason, isPaidByAllowed } from "@/components/rentals/expenses/expense-meta";
import type { ExpenseFormOptions, ExpenseListItem, ExpensesSummary } from "@/components/rentals/expenses/types";

/**
 * Gastos y arreglos de las propiedades en alquiler tradicional.
 * - A cargo del propietario: se descuentan en su próxima rendición.
 * - A cargo del inquilino: la sincronización del contrato los suma a su
 *   próximo cargo mensual (por eso exigen contrato y la misma moneda).
 * - Pagarlo desde Caja: egreso con ref_type "rental_expense" que sólo se
 *   maneja desde acá (Caja no deja editarlo ni borrarlo).
 */

const BUCKET = "rental-docs";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

const uuid = z.string().uuid();
const CHARGED_TO_PHRASE: Record<RentalExpense["charged_to"], string> = { propietario: "del propietario", inquilino: "del inquilino", inmobiliaria: "de la inmobiliaria" };
type PropertyLite = Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower" | "active">;
type ContractLite = Pick<RentalContract, "id" | "number" | "property_id" | "status" | "currency">;

const CATEGORIES = ["reparacion", "mantenimiento", "expensas_extraordinarias", "impuesto", "servicio", "seguro", "honorarios_terceros", "otro"] as const;

const formSchema = z.object({
  propertyId: z.string().uuid("Elegí la propiedad."),
  contractId: z.string().uuid().nullable(),
  occurredOn: z.string().refine(isYmd, "La fecha no es válida."),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Elegí el tipo de gasto." }) }),
  description: z.string().trim().min(1, "Contá qué fue el gasto.").max(200, "La descripción es muy larga (máximo 200 caracteres)."),
  provider: z.string().trim().max(120, "El proveedor es muy largo.").nullable(),
  amount: z.number().positive("Ingresá un importe mayor a cero."),
  currency: z.string().min(3).max(5),
  chargedTo: z.enum(["propietario", "inquilino", "inmobiliaria"]),
  paidBy: z.enum(["inmobiliaria", "propietario", "inquilino", "pendiente"]),
  notes: z.string().trim().max(1000, "La nota es muy larga.").nullable(),
});
type FormValues = z.infer<typeof formSchema>;

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function readForm(fd: FormData): { ok: true; values: FormValues } | { ok: false; error: string; field?: string } {
  const rawAmount = str(fd, "amount");
  const amount = rawAmount ? parseAmountInput(rawAmount) : null;
  if (amount == null || !(amount > 0)) return { ok: false, error: "Ingresá un importe válido (por ejemplo 45.000,50).", field: "amount" };
  const parsed = formSchema.safeParse({
    propertyId: str(fd, "propertyId"),
    contractId: str(fd, "contractId"),
    occurredOn: str(fd, "occurredOn"),
    category: str(fd, "category"),
    description: str(fd, "description") ?? "",
    provider: str(fd, "provider"),
    amount: Math.round(amount * 100) / 100,
    currency: str(fd, "currency") ?? "ARS",
    chargedTo: str(fd, "chargedTo"),
    paidBy: str(fd, "paidBy") ?? "pendiente",
    notes: str(fd, "notes"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Revisá los datos.", field: issue?.path?.[0]?.toString() };
  }
  return { ok: true, values: parsed.data };
}

function isFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && "arrayBuffer" in v && (v as File).size > 0;
}

async function loadProperty(ctx: RentalsCtx, propertyId: string): Promise<PropertyLite | null> {
  const { data } = await ctx.admin
    .from("rental_properties")
    .select("id, code, street, street_number, floor, apartment, tower, active")
    .eq("organization_id", ctx.organization.id)
    .eq("id", propertyId)
    .maybeSingle();
  return (data as PropertyLite | null) ?? null;
}

async function primaryOwnerId(ctx: RentalsCtx, propertyId: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from("rental_property_owners")
    .select("owner_id, is_primary, ownership_pct")
    .eq("organization_id", ctx.organization.id)
    .eq("property_id", propertyId);
  const rows = (data ?? []) as { owner_id: string; is_primary: boolean; ownership_pct: number }[];
  rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(b.ownership_pct) - Number(a.ownership_pct));
  return rows[0]?.owner_id ?? null;
}

/** Reglas de negocio que dependen de la base (contrato de la propiedad, moneda, vigencia). */
async function checkRules(ctx: RentalsCtx, v: FormValues): Promise<{ ok: true; property: PropertyLite } | { ok: false; error: string; field?: string }> {
  const property = await loadProperty(ctx, v.propertyId);
  if (!property) return { ok: false, error: "No encontramos la propiedad." };
  if (v.occurredOn > ctx.today) return { ok: false, error: "La fecha del gasto no puede ser futura.", field: "occurredOn" };
  if (!isPaidByAllowed(v.chargedTo, v.paidBy)) return { ok: false, error: "Esa combinación de 'a cargo de' y 'quién lo pagó' no se puede liquidar.", field: "paidBy" };
  if (v.contractId) {
    const { data } = await ctx.admin
      .from("rental_contracts")
      .select("id, number, property_id, status, currency")
      .eq("organization_id", ctx.organization.id)
      .eq("id", v.contractId)
      .maybeSingle();
    const c = data as ContractLite | null;
    if (!c || c.property_id !== v.propertyId) return { ok: false, error: "El contrato no es de esta propiedad.", field: "contractId" };
    if (v.chargedTo === "inquilino") {
      if (c.status !== "vigente" && c.status !== "borrador") {
        return { ok: false, error: "Ese contrato ya terminó: no hay próximos cargos donde sumarle el gasto al inquilino.", field: "contractId" };
      }
      if (c.currency !== v.currency) {
        return { ok: false, error: `El contrato es en ${c.currency}: cargá el gasto en ${c.currency} para poder cobrárselo al inquilino.`, field: "currency" };
      }
    }
  } else if (v.chargedTo === "inquilino") {
    return { ok: false, error: "Para cobrárselo al inquilino, elegí el contrato.", field: "contractId" };
  }
  return { ok: true, property };
}

/** Sube la factura/foto al bucket privado. Valida tamaño y tipo real (magic bytes). */
async function uploadFile(ctx: RentalsCtx, expenseId: string, file: File): Promise<{ ok: true; path: string; mime: string } | { ok: false; error: string }> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "El archivo pesa más de 4 MB. Probá con una foto más liviana o un PDF comprimido." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffReceiptMime(bytes);
  if (!mime) return { ok: false, error: "El archivo tiene que ser una foto (JPG, PNG, HEIC) o un PDF." };
  const path = `${ctx.organization.id}/expenses/${expenseId}/${randomUUID()}.${EXT_BY_MIME[mime] ?? "bin"}`;
  const { error } = await ctx.admin.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    logRentalsError("uploadExpenseFile", error);
    return { ok: false, error: "No se pudo subir el archivo." };
  }
  return { ok: true, path, mime };
}

async function removeFile(ctx: RentalsCtx, path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await ctx.admin.storage.from(BUCKET).remove([path]);
  if (error) logRentalsError("removeExpenseFile", error);
}

/** Cuenta de Caja válida para pagar: de la org, activa y en la misma moneda (receta de Caja). */
async function checkAccount(
  ctx: RentalsCtx,
  accountId: string | null,
  currency: string,
  paidAt: string | null,
): Promise<{ ok: true; account: { id: string; name: string } } | { ok: false; error: string; field?: string }> {
  if (!paidAt || !isYmd(paidAt) || paidAt > ctx.today) return { ok: false, error: "La fecha del pago no es válida.", field: "paidAt" };
  if (!accountId || !uuid.safeParse(accountId).success) return { ok: false, error: "Elegí de qué cuenta sale la plata.", field: "accountId" };
  const { data } = await ctx.admin
    .from("cash_accounts")
    .select("id, name, currency, active")
    .eq("organization_id", ctx.organization.id)
    .eq("id", accountId)
    .maybeSingle();
  const account = data as { id: string; name: string; currency: string; active: boolean } | null;
  if (!account || !account.active) return { ok: false, error: "La cuenta no existe o está archivada.", field: "accountId" };
  if (account.currency !== currency) {
    return { ok: false, error: `La cuenta "${account.name}" es en ${account.currency} y el gasto en ${currency}.`, field: "accountId" };
  }
  return { ok: true, account: { id: account.id, name: account.name } };
}

/** Egreso en Caja del gasto + vínculo (CAS). Si el vínculo falla, borra el egreso. */
async function payFromCaja(
  ctx: RentalsCtx,
  expense: Pick<RentalExpense, "id" | "property_id" | "category" | "description" | "amount" | "currency" | "charged_to" | "cash_movement_id">,
  propertyLabel: string,
  input: { accountId: string; paidAt: string },
): Promise<{ ok: true; movementId: string; accountName: string } | { ok: false; error: string; field?: string }> {
  const checked = await checkAccount(ctx, input.accountId, expense.currency, input.paidAt);
  if (!checked.ok) return checked;
  const { account } = checked;
  const ownerId = await primaryOwnerId(ctx, expense.property_id);
  const { data: mov, error } = await ctx.admin
    .from("cash_movements")
    .insert({
      organization_id: ctx.organization.id,
      account_id: account.id,
      direction: "out",
      amount: Number(expense.amount),
      currency: expense.currency,
      category: cajaCategoryForExpense(expense.category),
      ref_type: "rental_expense",
      ref_id: expense.id,
      unit_id: null,
      owner_id: ownerId,
      billable_to: cajaBillableFor(expense.charged_to),
      description: `${EXPENSE_CATEGORY_LABEL[expense.category]} · ${propertyLabel}: ${expense.description}`.slice(0, 300),
      occurred_at: zonedTimeToUtc(input.paidAt, "12:00", ctx.tz).toISOString(),
      created_by: ctx.session.userId,
    })
    .select("id")
    .single();
  if (error || !mov) return dbFailure("payExpenseFromCaja.insert", error, "No se pudo registrar el egreso en Caja.");
  const movementId = (mov as { id: string }).id;
  const { data: linked, error: linkErr } = await ctx.admin
    .from("rental_expenses")
    .update({ cash_movement_id: movementId, account_id: account.id, paid_by: "inmobiliaria" })
    .eq("id", expense.id)
    .eq("organization_id", ctx.organization.id)
    .is("cash_movement_id", null)
    .neq("status", "anulado")
    .select("id");
  if (linkErr || !linked?.length) {
    await ctx.admin.from("cash_movements").delete().eq("id", movementId).eq("organization_id", ctx.organization.id);
    if (linkErr) return dbFailure("payExpenseFromCaja.link", linkErr, "No se pudo registrar el pago del gasto.");
    return { ok: false, error: "Este gasto ya tiene un pago registrado (se registró en paralelo) o fue anulado." };
  }
  return { ok: true, movementId, accountName: account.name };
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

/** Lo que necesita el formulario: contratos de la propiedad, cuentas de Caja, monedas y dueños. */
export async function getExpenseFormOptions(propertyId: string): Promise<ActionResult<{ options: ExpenseFormOptions }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(propertyId).success) return { ok: false, error: "No encontramos la propiedad." };
  const property = await loadProperty(ctx, propertyId);
  if (!property) return { ok: false, error: "No encontramos la propiedad." };
  const [contractsRes, accountsRes, ownersRes] = await Promise.all([
    ctx.admin
      .from("rental_contracts")
      .select("id, number, status, currency, start_date")
      .eq("organization_id", ctx.organization.id)
      .eq("property_id", propertyId)
      .order("start_date", { ascending: false })
      .limit(20),
    ctx.admin
      .from("cash_accounts")
      .select("id, name, currency, type, color")
      .eq("organization_id", ctx.organization.id)
      .eq("active", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    ctx.admin
      .from("rental_property_owners")
      .select("ownership_pct, is_primary, owner:owners(full_name)")
      .eq("organization_id", ctx.organization.id)
      .eq("property_id", propertyId),
  ]);
  const contracts = (contractsRes.data ?? []) as { id: string; number: number; status: string; currency: string }[];
  const contractIds = contracts.map((c) => c.id);
  const { data: partiesData } = contractIds.length
    ? await ctx.admin
        .from("rental_contract_parties")
        .select("contract_id, is_primary, person:rental_people(full_name)")
        .eq("organization_id", ctx.organization.id)
        .eq("role", "inquilino")
        .in("contract_id", contractIds)
    : { data: [] };
  const tenant = new Map<string, string>();
  for (const p of (partiesData ?? []) as { contract_id: string; is_primary: boolean; person: { full_name: string } | { full_name: string }[] | null }[]) {
    const person = Array.isArray(p.person) ? p.person[0] : p.person;
    if (person?.full_name && (p.is_primary || !tenant.has(p.contract_id))) tenant.set(p.contract_id, person.full_name);
  }
  const accounts = (accountsRes.data ?? []) as ExpenseFormOptions["accounts"];
  const current = contracts.find((c) => c.status === "vigente");
  const currencies = [...new Set(["ARS", ...contracts.map((c) => c.currency), ...accounts.map((a) => a.currency)])];
  type OwnerShareRow = { ownership_pct: number; is_primary: boolean; owner: { full_name: string } | { full_name: string }[] | null };
  return {
    ok: true,
    options: {
      property: { id: property.id, label: propertyAddress(property), code: property.code },
      contracts: contracts.map((c) => ({
        id: c.id,
        label: `${formatContractNumber(c.number)}${tenant.get(c.id) ? ` · ${tenant.get(c.id)}` : ""}`,
        status: c.status,
        currency: c.currency,
        canCharge: c.status === "vigente" || c.status === "borrador",
      })),
      accounts,
      currencies,
      defaultCurrency: current?.currency ?? "ARS",
      owners: ((ownersRes.data ?? []) as OwnerShareRow[])
        .map((o) => ({ name: (Array.isArray(o.owner) ? o.owner[0] : o.owner)?.full_name ?? "Propietario", pct: Number(o.ownership_pct), primary: o.is_primary }))
        .sort((a, b) => Number(b.primary) - Number(a.primary) || b.pct - a.pct)
        .map(({ name, pct }) => ({ name, pct })),
      today: ctx.today,
    },
  };
}

/** Gastos de una propiedad (o de un contrato) con a dónde fueron a parar. */
export async function listExpenses(filters: { propertyId?: string | null; contractId?: string | null; status?: RentalExpense["status"] | null } = {}): Promise<
  ActionResult<{ items: ExpenseListItem[]; summary: ExpensesSummary }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  filters = filters ?? {};
  let q = ctx.admin
    .from("rental_expenses")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (filters.propertyId && uuid.safeParse(filters.propertyId).success) q = q.eq("property_id", filters.propertyId);
  if (filters.contractId && uuid.safeParse(filters.contractId).success) q = q.eq("contract_id", filters.contractId);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) return dbFailure("listExpenses", error, "No se pudieron leer los gastos.");
  const rows = (data ?? []) as RentalExpense[];
  const ids = (pick: (e: RentalExpense) => string | null) => [...new Set(rows.map(pick).filter((x): x is string => !!x))];
  const org = ctx.organization.id;
  const [propsRes, contractsRes, accountsRes, liveStatements, itemsRes, usersRes] = await Promise.all([
    ids((e) => e.property_id).length
      ? ctx.admin.from("rental_properties").select("id, street, street_number, floor, apartment, tower").eq("organization_id", org).in("id", ids((e) => e.property_id))
      : Promise.resolve({ data: [] }),
    ids((e) => e.contract_id).length
      ? ctx.admin.from("rental_contracts").select("id, number").eq("organization_id", org).in("id", ids((e) => e.contract_id))
      : Promise.resolve({ data: [] }),
    ids((e) => e.account_id).length
      ? ctx.admin.from("cash_accounts").select("id, name").eq("organization_id", org).in("id", ids((e) => e.account_id))
      : Promise.resolve({ data: [] }),
    liveStatementsByExpense(
      ctx,
      rows.filter((e) => e.status === "aplicado" && e.charged_to === "propietario"),
    ),
    ids((e) => e.charge_item_id).length
      ? ctx.admin.from("rental_charge_items").select("id, charge_id").eq("organization_id", org).in("id", ids((e) => e.charge_item_id))
      : Promise.resolve({ data: [] }),
    // user_profiles no tiene `id`: la clave es user_id (= auth.users.id, lo que guarda created_by).
    ids((e) => e.created_by).length
      ? ctx.admin.from("user_profiles").select("user_id, full_name").in("user_id", ids((e) => e.created_by))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (usersRes.error) logRentalsError("listExpenses.profiles", usersRes.error);
  const items = (itemsRes.data ?? []) as { id: string; charge_id: string }[];
  const chargeIds = [...new Set(items.map((i) => i.charge_id))];
  const { data: chargesData } = chargeIds.length
    ? await ctx.admin.from("rental_charges").select("id, label").eq("organization_id", org).in("id", chargeIds)
    : { data: [] };
  const chargeLabel = new Map(((chargesData ?? []) as { id: string; label: string }[]).map((c) => [c.id, c.label]));
  const itemLabel = new Map(items.map((i) => [i.id, chargeLabel.get(i.charge_id) ?? null]));
  const propLabel = new Map(
    ((propsRes.data ?? []) as Pick<RentalProperty, "id" | "street" | "street_number" | "floor" | "apartment" | "tower">[]).map((p) => [p.id, propertyAddress(p)]),
  );
  const contractNo = new Map(((contractsRes.data ?? []) as { id: string; number: number }[]).map((c) => [c.id, formatContractNumber(c.number)]));
  const accountName = new Map(((accountsRes.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const userName = new Map(((usersRes.data ?? []) as { user_id: string; full_name: string | null }[]).map((u) => [u.user_id, u.full_name]));

  const byCurrency = new Map<string, { currency: string; toDeduct: number; toCharge: number; unpaid: number; total: number }>();
  for (const e of rows) {
    if (e.status === "anulado") continue;
    const acc = byCurrency.get(e.currency) ?? { currency: e.currency, toDeduct: 0, toCharge: 0, unpaid: 0, total: 0 };
    const amount = Number(e.amount);
    acc.total += amount;
    if (e.status === "pendiente" && e.charged_to === "propietario") acc.toDeduct += amount;
    if (e.status === "pendiente" && e.charged_to === "inquilino") acc.toCharge += amount;
    if (e.paid_by === "pendiente" && !e.cash_movement_id) acc.unpaid += amount;
    byCurrency.set(e.currency, acc);
  }
  return {
    ok: true,
    items: rows.map((e) => ({
      expense: { ...e, amount: Number(e.amount) },
      propertyLabel: propLabel.get(e.property_id) ?? "Propiedad",
      contractNumber: e.contract_id ? contractNo.get(e.contract_id) ?? null : null,
      accountName: e.account_id ? accountName.get(e.account_id) ?? null : null,
      statements: liveStatements.get(e.id) ?? [],
      chargeLabel: e.charge_item_id ? itemLabel.get(e.charge_item_id) ?? null : null,
      createdByName: e.created_by ? userName.get(e.created_by) ?? null : null,
    })),
    summary: { byCurrency: [...byCurrency.values()], count: rows.filter((e) => e.status !== "anulado").length },
  };
}

// ─── Alta / edición ─────────────────────────────────────────────────────────

/**
 * Alta de un gasto (FormData: campos + `file` opcional + `payNow`/`accountId`/`paidAt`).
 * Si el pago en Caja falla, el gasto queda cargado y se avisa con `warning`.
 */
export async function createExpense(fd: FormData): Promise<ActionResult<{ expenseId: string; expense: RentalExpense; warning: string | null }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const form = readForm(fd);
  if (!form.ok) return form;
  const v = form.values;
  const rules = await checkRules(ctx, v);
  if (!rules.ok) return rules;
  const payNow = fd.get("payNow") === "1";
  const paidAt = str(fd, "paidAt") ?? ctx.today;
  if (payNow) {
    if (v.paidBy !== "inmobiliaria" && v.paidBy !== "pendiente") return { ok: false, error: "Sólo se paga desde Caja lo que paga la inmobiliaria.", field: "paidBy" };
    const acc = await checkAccount(ctx, str(fd, "accountId"), v.currency, paidAt);
    if (!acc.ok) return acc;
  }

  const id = randomUUID();
  const file = fd.get("file");
  let filePath: string | null = null;
  let fileMime: string | null = null;
  if (isFile(file)) {
    const up = await uploadFile(ctx, id, file);
    if (!up.ok) return { ok: false, error: up.error, field: "file" };
    filePath = up.path;
    fileMime = up.mime;
  }
  const { data, error } = await ctx.admin
    .from("rental_expenses")
    .insert({
      id,
      organization_id: ctx.organization.id,
      property_id: v.propertyId,
      contract_id: v.contractId,
      occurred_on: v.occurredOn,
      category: v.category,
      description: v.description,
      provider: v.provider,
      amount: v.amount,
      currency: v.currency,
      charged_to: v.chargedTo,
      paid_by: payNow ? "inmobiliaria" : v.paidBy,
      status: "pendiente",
      file_path: filePath,
      file_mime: fileMime,
      notes: v.notes,
      created_by: ctx.session.userId,
    })
    .select("*")
    .single();
  if (error || !data) {
    await removeFile(ctx, filePath);
    return dbFailure("createExpense", error, "No se pudo guardar el gasto.");
  }
  const expense = data as RentalExpense;
  const label = propertyAddress(rules.property);
  let warning: string | null = null;
  let saved: RentalExpense = { ...expense, amount: Number(expense.amount) };
  if (payNow) {
    const paid = await payFromCaja(ctx, expense, label, { accountId: str(fd, "accountId") ?? "", paidAt });
    if (!paid.ok) warning = `El gasto quedó cargado, pero no se pudo registrar el pago en Caja: ${paid.error}`;
    else saved = (await loadExpense(ctx, id)) ?? saved;
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: v.contractId,
    propertyId: v.propertyId,
    type: "gasto_cargado",
    summary: `Gasto cargado: ${v.description} (${v.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${v.currency}, a cargo ${CHARGED_TO_PHRASE[v.chargedTo]}).`,
    payload: { expense_id: id },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: v.propertyId, contractId: v.contractId, caja: payNow });
  return { ok: true, expenseId: id, expense: saved, warning };
}

async function loadExpense(ctx: RentalsCtx, id: string): Promise<RentalExpense | null> {
  if (!uuid.safeParse(id).success) return null;
  const { data } = await ctx.admin.from("rental_expenses").select("*").eq("organization_id", ctx.organization.id).eq("id", id).maybeSingle();
  return (data as RentalExpense | null) ?? null;
}

/**
 * Rendiciones vivas (no anuladas) que descuentan cada gasto, de la más vieja a
 * la más nueva. Con varios dueños el mismo gasto tiene un renglón en la
 * rendición de cada uno y statement_id guarda sólo la última: hay que mirar
 * los renglones. statement_id entra igual, por si un renglón no se pudo leer.
 */
async function liveStatementsByExpense(
  ctx: RentalsCtx,
  expenses: Pick<RentalExpense, "id" | "statement_id">[],
): Promise<Map<string, { id: string; number: string }[]>> {
  const out = new Map<string, { id: string; number: string }[]>();
  if (!expenses.length) return out;
  const org = ctx.organization.id;
  const pairs = expenses.filter((e) => e.statement_id).map((e) => ({ expenseId: e.id, statementId: e.statement_id as string }));
  const expenseIds = expenses.map((e) => e.id);
  for (let i = 0; i < expenseIds.length; i += 150) {
    const { data, error } = await ctx.admin
      .from("rental_owner_statement_lines")
      .select("ref_id, statement_id")
      .eq("organization_id", org)
      .eq("ref_type", "expense")
      .eq("voided", false)
      .in("ref_id", expenseIds.slice(i, i + 150));
    if (error) {
      logRentalsError("liveStatementsByExpense.lines", error);
      break;
    }
    for (const l of (data ?? []) as { ref_id: string; statement_id: string }[]) pairs.push({ expenseId: l.ref_id, statementId: l.statement_id });
  }
  const statementIds = [...new Set(pairs.map((p) => p.statementId))];
  const numberOf = new Map<string, number>();
  for (let i = 0; i < statementIds.length; i += 150) {
    const { data: sts, error } = await ctx.admin
      .from("rental_owner_statements")
      .select("id, number, status")
      .eq("organization_id", org)
      .in("id", statementIds.slice(i, i + 150));
    if (error) {
      logRentalsError("liveStatementsByExpense.statements", error);
      break;
    }
    for (const s of (sts ?? []) as { id: string; number: number; status: string }[]) if (s.status !== "anulada") numberOf.set(s.id, s.number);
  }
  const byExpense = new Map<string, Map<string, number>>();
  for (const p of pairs) {
    const n = numberOf.get(p.statementId);
    if (n == null) continue;
    const m = byExpense.get(p.expenseId) ?? new Map<string, number>();
    m.set(p.statementId, n);
    byExpense.set(p.expenseId, m);
  }
  for (const [expenseId, m] of byExpense) {
    out.set(
      expenseId,
      [...m].sort((a, b) => a[1] - b[1]).map(([id, n]) => ({ id, number: formatStatementNumber(n) })),
    );
  }
  return out;
}

async function lockRefs(ctx: RentalsCtx, e: RentalExpense): Promise<{ statementNumbers: string[]; chargeLabel: string | null }> {
  let statementNumbers: string[] = [];
  let chargeLabel: string | null = null;
  // Todas las rendiciones que lo siguen descontando: con varios dueños hay que
  // anularlas todas antes de editarlo o anularlo, no sólo la última.
  if (e.status === "aplicado" && e.charged_to === "propietario") {
    statementNumbers = ((await liveStatementsByExpense(ctx, [e])).get(e.id) ?? []).map((s) => s.number);
  }
  if (e.charge_item_id) {
    const { data } = await ctx.admin.from("rental_charge_items").select("charge_id").eq("organization_id", ctx.organization.id).eq("id", e.charge_item_id).maybeSingle();
    const chargeId = (data as { charge_id: string } | null)?.charge_id;
    if (chargeId) {
      const { data: ch } = await ctx.admin.from("rental_charges").select("label").eq("organization_id", ctx.organization.id).eq("id", chargeId).maybeSingle();
      chargeLabel = (ch as { label: string } | null)?.label ?? null;
    }
  }
  return { statementNumbers, chargeLabel };
}

/** Edición (sólo mientras no se descontó ni se cargó al inquilino). FormData igual al alta + `removeFile`. */
export async function updateExpense(id: string, fd: FormData): Promise<ActionResult<{ expenseId: string; expense: RentalExpense }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const e = await loadExpense(ctx, id);
  if (!e) return { ok: false, error: "No encontramos el gasto." };
  const lock = expenseLockReason(e, await lockRefs(ctx, e));
  if (lock) return { ok: false, error: lock };
  fd.set("propertyId", e.property_id);
  const form = readForm(fd);
  if (!form.ok) return form;
  const v = form.values;
  const paidFromCaja = !!e.cash_movement_id;
  if (paidFromCaja && (Math.abs(v.amount - Number(e.amount)) > 0.004 || v.currency !== e.currency)) {
    return { ok: false, error: "Este gasto ya se pagó desde Caja: para cambiar el importe o la moneda, deshacé el pago primero.", field: "amount" };
  }
  const paidBy = paidFromCaja ? "inmobiliaria" : v.paidBy;
  const rules = await checkRules(ctx, { ...v, paidBy });
  if (!rules.ok) return rules;

  let filePath = e.file_path;
  let fileMime = e.file_mime;
  const file = fd.get("file");
  const replacing = isFile(file);
  if (replacing) {
    const up = await uploadFile(ctx, e.id, file);
    if (!up.ok) return { ok: false, error: up.error, field: "file" };
    filePath = up.path;
    fileMime = up.mime;
  } else if (fd.get("removeFile") === "1") {
    filePath = null;
    fileMime = null;
  }
  const { data, error } = await ctx.admin
    .from("rental_expenses")
    .update({
      contract_id: v.contractId,
      occurred_on: v.occurredOn,
      category: v.category,
      description: v.description,
      provider: v.provider,
      amount: v.amount,
      currency: v.currency,
      charged_to: v.chargedTo,
      paid_by: paidBy,
      file_path: filePath,
      file_mime: fileMime,
      notes: v.notes,
    })
    .eq("id", e.id)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "pendiente")
    .select("id");
  if (error || !data?.length) {
    if (replacing) await removeFile(ctx, filePath);
    if (error) return dbFailure("updateExpense", error, "No se pudo guardar el gasto.");
    return { ok: false, error: "El gasto cambió mientras lo editabas (se descontó o se anuló). Recargá la página." };
  }
  if (e.file_path && e.file_path !== filePath) await removeFile(ctx, e.file_path);
  if (paidFromCaja && e.cash_movement_id) {
    // El egreso lo maneja Alquileres: mantenemos su descripción y a quién se le imputa.
    const { error: movErr } = await ctx.admin
      .from("cash_movements")
      .update({
        category: cajaCategoryForExpense(v.category),
        billable_to: cajaBillableFor(v.chargedTo),
        description: `${EXPENSE_CATEGORY_LABEL[v.category]} · ${propertyAddress(rules.property)}: ${v.description}`.slice(0, 300),
      })
      .eq("id", e.cash_movement_id)
      .eq("organization_id", ctx.organization.id);
    if (movErr) logRentalsError("updateExpense.movement", movErr);
  }
  revalidateRentals({ propertyId: e.property_id, contractId: v.contractId ?? e.contract_id, caja: paidFromCaja });
  if (e.contract_id && e.contract_id !== v.contractId) revalidateRentals({ contractId: e.contract_id });
  const fresh = await loadExpense(ctx, e.id);
  return { ok: true, expenseId: e.id, expense: fresh ? { ...fresh, amount: Number(fresh.amount) } : { ...e, amount: v.amount } };
}

// ─── Anular / pagar / deshacer pago / archivo ───────────────────────────────

/** Anula un gasto que todavía no se aplicó. Si se había pagado desde Caja, borra ese egreso. */
export async function voidExpense(id: string, input: { reason: string }): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const e = await loadExpense(ctx, id);
  if (!e) return { ok: false, error: "No encontramos el gasto." };
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3) return { ok: false, error: "Contá brevemente por qué se anula.", field: "reason" };
  const lock = expenseLockReason(e, await lockRefs(ctx, e));
  if (lock) return { ok: false, error: lock };
  const notes = [e.notes, `Anulado: ${reason}`].filter(Boolean).join("\n").slice(0, 1000);
  const { data, error } = await ctx.admin
    .from("rental_expenses")
    .update({ status: "anulado", notes, cash_movement_id: null, account_id: e.cash_movement_id ? null : e.account_id })
    .eq("id", e.id)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "pendiente")
    .select("id");
  if (error) return dbFailure("voidExpense", error, "No se pudo anular el gasto.");
  if (!data?.length) return { ok: false, error: "El gasto cambió mientras lo mirabas. Recargá la página." };
  if (e.cash_movement_id) {
    const { error: delErr } = await ctx.admin.from("cash_movements").delete().eq("id", e.cash_movement_id).eq("organization_id", ctx.organization.id);
    if (delErr) logRentalsError("voidExpense.movement", delErr);
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: e.contract_id,
    propertyId: e.property_id,
    type: "gasto_anulado",
    summary: `Gasto anulado: ${e.description} — ${reason}`,
    payload: { expense_id: e.id },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: e.property_id, contractId: e.contract_id, caja: !!e.cash_movement_id });
  return { ok: true };
}

/** Registra en Caja el pago de un gasto que todavía no tenía egreso. */
export async function payExpenseFromCaja(id: string, input: { accountId: string; paidAt: string }): Promise<ActionResult<{ accountName: string }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const e = await loadExpense(ctx, id);
  if (!e) return { ok: false, error: "No encontramos el gasto." };
  if (!canPayFromCaja(e)) {
    return {
      ok: false,
      error: e.cash_movement_id ? "Este gasto ya tiene su egreso en Caja." : e.status === "anulado" ? "El gasto está anulado." : "Este gasto lo pagó otra persona: no sale de Caja.",
    };
  }
  const property = await loadProperty(ctx, e.property_id);
  const paid = await payFromCaja(ctx, e, property ? propertyAddress(property) : "Propiedad", { accountId: String(input?.accountId ?? ""), paidAt: String(input?.paidAt ?? "") });
  if (!paid.ok) return paid;
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: e.contract_id,
    propertyId: e.property_id,
    type: "gasto_pagado",
    summary: `Gasto pagado desde Caja (${paid.accountName}): ${e.description}`,
    payload: { expense_id: e.id, cash_movement_id: paid.movementId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: e.property_id, contractId: e.contract_id, caja: true });
  return { ok: true, accountName: paid.accountName };
}

/** Deshace el pago desde Caja (borra el egreso). El gasto sigue vigente, como "sin pagar". */
export async function unpayExpense(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const e = await loadExpense(ctx, id);
  if (!e) return { ok: false, error: "No encontramos el gasto." };
  if (!e.cash_movement_id) return { ok: false, error: "Este gasto no tiene un pago en Caja." };
  const { data, error } = await ctx.admin
    .from("rental_expenses")
    .update({ cash_movement_id: null, account_id: null, paid_by: "pendiente" })
    .eq("id", e.id)
    .eq("organization_id", ctx.organization.id)
    .eq("cash_movement_id", e.cash_movement_id)
    .select("id");
  if (error) return dbFailure("unpayExpense", error, "No se pudo deshacer el pago.");
  if (!data?.length) return { ok: false, error: "El gasto cambió mientras lo mirabas. Recargá la página." };
  const { error: delErr } = await ctx.admin.from("cash_movements").delete().eq("id", e.cash_movement_id).eq("organization_id", ctx.organization.id);
  if (delErr) logRentalsError("unpayExpense.movement", delErr);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: e.contract_id,
    propertyId: e.property_id,
    type: "gasto_pago_deshecho",
    summary: `Se deshizo el pago desde Caja del gasto: ${e.description}`,
    payload: { expense_id: e.id },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: e.property_id, contractId: e.contract_id, caja: true });
  return { ok: true };
}

/** URL firmada (10 min) de la factura o foto del gasto. */
export async function getExpenseFileUrl(id: string): Promise<ActionResult<{ url: string; mime: string | null }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const e = await loadExpense(ctx, id);
  if (!e?.file_path) return { ok: false, error: "El gasto no tiene archivo adjunto." };
  if (!e.file_path.startsWith(`${ctx.organization.id}/`)) return { ok: false, error: "No encontramos el archivo." };
  const { data, error } = await ctx.admin.storage.from(BUCKET).createSignedUrl(e.file_path, 600);
  if (error || !data?.signedUrl) return dbFailure("getExpenseFileUrl", error, "No se pudo abrir el archivo.");
  return { ok: true, url: data.signedUrl, mime: e.file_mime };
}
