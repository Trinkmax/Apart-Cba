"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { propertyAddress } from "@/lib/rentals/labels";
import { isYmd } from "@/lib/rentals/ymd";
import type { RentalPerson, RentalProperty } from "@/lib/types/database";
import {
  accentInsensitiveRegex,
  digitsOnly,
  docLabel,
  normalizeDocNumber,
  sanitizeSearchTerm,
} from "@/components/rentals/people/person-helpers";
import { loadContractSummaries } from "@/components/rentals/properties/queries.server";
import type { ContractSummary } from "@/components/rentals/properties/property-types";
import type {
  PersonContractLink,
  PersonDetail,
  PersonInput,
  PersonListItem,
  PersonSaveResult,
} from "@/components/rentals/people/person-types";

// ─── Validación ─────────────────────────────────────────────────────────────

const optText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}: hasta ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));

const personSchema = z.object({
  person_type: z.enum(["fisica", "juridica"]).default("fisica"),
  full_name: z.string().trim().min(2, "Escribí el nombre completo.").max(160, "El nombre: hasta 160 caracteres."),
  doc_type: z.enum(["DNI", "CUIT", "CUIL", "PASAPORTE", "OTRO"]).nullable().optional().transform((v) => v ?? null),
  doc_number: optText(30, "Número de documento"),
  tax_id: optText(20, "CUIT/CUIL"),
  birth_date: z
    .union([z.string().refine(isYmd, "La fecha de nacimiento no es válida."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  nationality: optText(60, "Nacionalidad"),
  email: z
    .union([z.string().trim().email("El mail no es válido."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: optText(40, "Teléfono"),
  phone_alt: optText(40, "Otro teléfono"),
  address: optText(200, "Domicilio"),
  city: optText(80, "Ciudad"),
  province: optText(80, "Provincia"),
  occupation: optText(120, "Ocupación"),
  employer: optText(160, "Empleador"),
  employer_phone: optText(40, "Teléfono del trabajo"),
  monthly_income: z
    .number({ invalid_type_error: "Revisá los ingresos." })
    .min(0, "Los ingresos no pueden ser negativos.")
    .max(999_999_999_999, "Revisá los ingresos.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  income_currency: z.enum(["ARS", "USD", "EUR"]).nullable().optional().transform((v) => v ?? null),
  notes: optText(2000, "Notas"),
});

type ParsedPerson = z.infer<typeof personSchema>;

function firstIssue(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? "Revisá los datos.", field: issue?.path?.[0] ? String(issue.path[0]) : undefined };
}

/** Normaliza documentos y valida lo que la base no puede (largos de DNI/CUIT). */
function finalize(p: ParsedPerson): { ok: true; row: ParsedPerson } | { ok: false; error: string; field: string } {
  const row = { ...p };
  if (row.doc_number && !row.doc_type) row.doc_type = row.person_type === "juridica" ? "CUIT" : "DNI";
  row.doc_number = normalizeDocNumber(row.doc_type, row.doc_number);
  if (!row.doc_number) row.doc_type = null;
  if (row.doc_type === "DNI" && row.doc_number && (row.doc_number.length < 6 || row.doc_number.length > 9)) {
    return { ok: false, field: "doc_number", error: "Revisá el DNI: tiene que tener 7 u 8 números." };
  }
  if ((row.doc_type === "CUIT" || row.doc_type === "CUIL") && row.doc_number && row.doc_number.length !== 11) {
    return { ok: false, field: "doc_number", error: "El CUIT/CUIL tiene 11 números (por ejemplo, 20-30123456-7)." };
  }
  row.tax_id = row.tax_id ? digitsOnly(row.tax_id) || null : null;
  if (row.tax_id && row.tax_id.length !== 11) {
    return { ok: false, field: "tax_id", error: "El CUIT/CUIL tiene 11 números (por ejemplo, 20-30123456-7)." };
  }
  if (row.monthly_income != null && !row.income_currency) row.income_currency = "ARS";
  if (row.monthly_income == null) row.income_currency = null;
  return { ok: true, row };
}

/** Misma persona ya cargada (por documento o CUIT): devuelve la fila para ofrecer "Usar esta persona". */
async function findDuplicate(ctx: RentalsCtx, row: ParsedPerson, excludeId?: string): Promise<RentalPerson | null> {
  // Valores entre comillas: un pasaporte puede traer espacios o signos que rompen el or() de PostgREST.
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const ors: string[] = [];
  if (row.doc_number) ors.push(`doc_number.eq.${quote(row.doc_number)}`);
  if (row.tax_id) ors.push(`tax_id.eq.${quote(row.tax_id)}`, `doc_number.eq.${quote(row.tax_id)}`);
  if (!ors.length) return null;
  let q = ctx.admin.from("rental_people").select("*").eq("organization_id", ctx.organization.id).or(ors.join(","));
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q.limit(1);
  if (error) {
    logRentalsError("findDuplicate", error);
    return null;
  }
  return ((data ?? [])[0] as RentalPerson | undefined) ?? null;
}

function duplicateMessage(p: RentalPerson): string {
  const doc = docLabel(p.doc_type, p.doc_number) || (p.tax_id ? `CUIT ${p.tax_id}` : "");
  return `Esa persona ya está cargada: ${p.full_name}${doc ? ` (${doc})` : ""}${p.active ? "" : ", archivada"}.`;
}

type PropertyRef = Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower">;

async function loadPropertyRefs(ctx: RentalsCtx, ids?: string[]): Promise<Map<string, PropertyRef>> {
  const out = new Map<string, PropertyRef>();
  if (ids && !ids.length) return out;
  let q = ctx.admin.from("rental_properties").select("id, code, street, street_number, floor, apartment, tower").eq("organization_id", ctx.organization.id);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.limit(3000);
  if (error) logRentalsError("loadPropertyRefs", error);
  for (const p of (data ?? []) as PropertyRef[]) out.set(p.id, p);
  return out;
}

const STATUS_RANK: Record<string, number> = { vigente: 0, borrador: 1, finalizado: 2, rescindido: 3 };

/** Los contratos de una persona, vigentes primero. */
function linksFor(personId: string, contracts: ContractSummary[], props: Map<string, PropertyRef>): PersonContractLink[] {
  const out: PersonContractLink[] = [];
  for (const c of contracts) {
    for (const party of c.parties) {
      if (party.person_id !== personId) continue;
      const p = props.get(c.property_id);
      out.push({
        contract_id: c.id,
        number: c.number,
        status: c.status,
        display_state: c.display_state,
        role: party.role,
        is_primary: party.is_primary,
        guarantee_type: party.guarantee_type,
        start_date: c.start_date,
        end_date: c.end_date,
        currency: c.currency,
        current_rent: c.current_rent,
        property: p ? { id: p.id, code: p.code, address: propertyAddress(p) } : null,
        tenant_name: c.tenant?.full_name ?? null,
        balance: c.balance,
        overdue: c.overdue,
      });
    }
  }
  return out.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || b.start_date.localeCompare(a.start_date));
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function listPeople(filters: { includeArchived?: boolean } = {}): Promise<ActionResult<{ items: PersonListItem[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  try {
    let pq = ctx.admin.from("rental_people").select("*").eq("organization_id", orgId);
    if (!filters.includeArchived) pq = pq.eq("active", true);
    const [{ data, error }, contracts, props] = await Promise.all([
      pq.order("full_name").limit(3000),
      loadContractSummaries(ctx.admin, orgId, ctx.today),
      loadPropertyRefs(ctx),
    ]);
    if (error) return dbFailure("listPeople", error, "No se pudieron cargar las personas.");
    const items = ((data ?? []) as RentalPerson[]).map((person) => {
      const all = linksFor(person.id, contracts, props);
      return {
        person,
        links: all.filter((l) => l.status === "vigente" || l.status === "borrador"),
        past_contracts: new Set(all.filter((l) => l.status === "finalizado" || l.status === "rescindido").map((l) => l.contract_id)).size,
      };
    });
    return { ok: true, items };
  } catch (e) {
    logRentalsError("listPeople", e);
    return { ok: false, error: "No se pudieron cargar las personas. Probá de nuevo." };
  }
}

/**
 * Buscador de personas (nombre, DNI/CUIT, mail o teléfono). El nombre se busca
 * sin tildes y en cualquier orden: cada palabra es una regex POSIX
 * ("munoz" → m[uú…][nñ…][oó…]z) para el `imatch` de PostgREST. Sin término →
 * las últimas cargadas.
 */
export async function searchPeople(q: string, opts: { limit?: number } = {}): Promise<ActionResult<{ people: RentalPerson[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const term = sanitizeSearchTerm(q);
  let query = ctx.admin.from("rental_people").select("*").eq("organization_id", ctx.organization.id).eq("active", true);
  const digits = digitsOnly(term);
  const patterns = term
    .split(" ")
    .filter((w) => !/\d/.test(w))
    .map(accentInsensitiveRegex)
    .filter((re) => re.length > 0);
  if (!term) {
    query = query.order("updated_at", { ascending: false });
  } else if (term.includes("@")) {
    query = query.ilike("email", `%${term}%`).order("full_name");
  } else if (digits.length >= 3 && !patterns.length) {
    query = query
      .or(`doc_number.ilike.%${digits}%,tax_id.ilike.%${digits}%,phone.ilike.%${digits}%,phone_alt.ilike.%${digits}%`)
      .order("full_name");
  } else if (patterns.length) {
    for (const re of patterns) query = query.filter("full_name", "imatch", re);
    query = query.order("full_name");
  } else {
    query = query.ilike("full_name", `%${term}%`).order("full_name");
  }
  const { data, error } = await query.limit(limit);
  if (error) return dbFailure("searchPeople", error, "No se pudo buscar.");
  return { ok: true, people: (data ?? []) as RentalPerson[] };
}

export async function getPerson(id: string): Promise<ActionResult<{ detail: PersonDetail }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos a la persona." };
  try {
    const [{ data: person, error }, { data: parties }] = await Promise.all([
      ctx.admin.from("rental_people").select("*").eq("organization_id", orgId).eq("id", id).maybeSingle(),
      ctx.admin.from("rental_contract_parties").select("contract_id").eq("organization_id", orgId).eq("person_id", id),
    ]);
    if (error) return dbFailure("getPerson", error, "No se pudo cargar a la persona.");
    if (!person) return { ok: false, error: "No encontramos a la persona." };
    const contractIds = Array.from(new Set(((parties ?? []) as { contract_id: string }[]).map((p) => p.contract_id)));
    const contracts = await loadContractSummaries(ctx.admin, orgId, ctx.today, { contractIds });
    const props = await loadPropertyRefs(ctx, Array.from(new Set(contracts.map((c) => c.property_id))));
    return { ok: true, detail: { person: person as RentalPerson, links: linksFor(id, contracts, props) } };
  } catch (e) {
    logRentalsError("getPerson", e);
    return { ok: false, error: "No se pudo cargar a la persona. Probá de nuevo." };
  }
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

export async function createPerson(input: PersonInput): Promise<PersonSaveResult> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const fin = finalize(parsed.data);
  if (!fin.ok) return fin;
  const dup = await findDuplicate(ctx, fin.row);
  if (dup) return { ok: false, field: dup.doc_number === fin.row.doc_number ? "doc_number" : "tax_id", error: duplicateMessage(dup), existing: dup };
  const { data, error } = await ctx.admin
    .from("rental_people")
    .insert({ ...fin.row, organization_id: ctx.organization.id, created_by: ctx.session.userId })
    .select("*")
    .single();
  if (error || !data) return dbFailure("createPerson", error, "No se pudo guardar la persona.");
  const person = data as RentalPerson;
  revalidateRentals({ personId: person.id });
  return { ok: true, person };
}

export async function updatePerson(id: string, input: PersonInput): Promise<PersonSaveResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos a la persona." };
  const parsed = personSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const fin = finalize(parsed.data);
  if (!fin.ok) return fin;
  const dup = await findDuplicate(ctx, fin.row, id);
  if (dup) return { ok: false, field: dup.doc_number === fin.row.doc_number ? "doc_number" : "tax_id", error: duplicateMessage(dup), existing: dup };
  const { data, error } = await ctx.admin
    .from("rental_people")
    .update(fin.row)
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return dbFailure("updatePerson", error, "No se pudieron guardar los cambios.");
  if (!data) return { ok: false, error: "No encontramos a la persona." };
  revalidateRentals({ personId: id });
  // El nombre del inquilino o garante se ve en la ficha de sus contratos.
  revalidatePath("/dashboard/alquileres/contratos/[id]", "page");
  return { ok: true, person: data as RentalPerson };
}

/** Archivar: deja de aparecer en buscadores. Bloquea si está en un contrato vigente o en borrador. */
export async function archivePerson(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos a la persona." };
  const { data: parties, error } = await ctx.admin
    .from("rental_contract_parties")
    .select("contract_id, role")
    .eq("organization_id", orgId)
    .eq("person_id", id);
  if (error) return dbFailure("archivePerson.parties", error, "No se pudo revisar sus contratos.");
  const ids = Array.from(new Set(((parties ?? []) as { contract_id: string }[]).map((p) => p.contract_id)));
  if (ids.length) {
    const { data: open } = await ctx.admin
      .from("rental_contracts")
      .select("number, status")
      .eq("organization_id", orgId)
      .in("id", ids)
      .in("status", ["vigente", "borrador"])
      .limit(1);
    const c = ((open ?? []) as { number: number; status: string }[])[0];
    if (c) {
      const n = `C-${String(c.number).padStart(4, "0")}`;
      return {
        ok: false,
        error: c.status === "vigente" ? `Está en el contrato ${n}, que sigue vigente.` : `Está en el contrato ${n}, que está en borrador.`,
      };
    }
  }
  const { data, error: upErr } = await ctx.admin
    .from("rental_people")
    .update({ active: false })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (upErr) return dbFailure("archivePerson", upErr, "No se pudo archivar.");
  if (!data) return { ok: false, error: "No encontramos a la persona." };
  revalidateRentals({ personId: id });
  return { ok: true };
}

export async function restorePerson(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos a la persona." };
  const { data, error } = await ctx.admin
    .from("rental_people")
    .update({ active: true })
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure("restorePerson", error, "No se pudo reactivar.");
  if (!data) return { ok: false, error: "No encontramos a la persona." };
  revalidateRentals({ personId: id });
  return { ok: true };
}
