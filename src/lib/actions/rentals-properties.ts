"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { propertyAddress } from "@/lib/rentals/labels";
import { isYmd } from "@/lib/rentals/ymd";
import type { RentalProperty } from "@/lib/types/database";
import {
  firstFreeCode,
  normalizePropertyCode,
  propertyDisplayState,
  suggestPropertyCode,
  validateOwnership,
} from "@/components/rentals/properties/property-helpers";
import { loadContractSummaries, loadPropertyOwners } from "@/components/rentals/properties/queries.server";
import type {
  ContractSummary,
  OwnerOption,
  PropertyDetail,
  PropertyEventView,
  PropertyFormOptions,
  PropertyInput,
  PropertyListItem,
  PropertyOwnerInput,
  PropertySaveResult,
  QuickOwnerInput,
} from "@/components/rentals/properties/property-types";

// ─── Validación ─────────────────────────────────────────────────────────────

const optText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}: hasta ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const optInt = (label: string) =>
  z
    .number({ invalid_type_error: `${label}: tiene que ser un número.` })
    .int(`${label}: tiene que ser un número entero.`)
    .min(0, `${label}: no puede ser negativo.`)
    .max(99, `${label}: revisá el número.`)
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const optM2 = (label: string) =>
  z
    .number({ invalid_type_error: `${label}: tiene que ser un número.` })
    .positive(`${label}: tiene que ser mayor a 0.`)
    .max(999_999, `${label}: revisá el número.`)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const serviceSchema = z.object({
  kind: z.enum(["expensas", "luz", "gas", "agua", "municipal", "inmobiliario", "internet", "seguro", "otro"]),
  provider: optText(80, "Empresa del servicio"),
  account_number: optText(60, "Número de cuenta"),
  holder: optText(120, "Titular del servicio"),
  notes: optText(200, "Nota del servicio"),
});

const ownerRowSchema = z.object({
  owner_id: z.string().uuid("Elegí el propietario en cada fila."),
  ownership_pct: z.number({ invalid_type_error: "Revisá los porcentajes." }),
  is_primary: z.boolean(),
});

const propertySchema = z.object({
  code: z.string().max(80).optional().default(""),
  property_type: z.enum(["departamento", "casa", "ph", "duplex", "local", "oficina", "cochera", "deposito", "terreno", "otro"]),
  street: z.string().trim().min(2, "Escribí la calle.").max(120, "La calle: hasta 120 caracteres."),
  street_number: optText(20, "Número"),
  floor: optText(10, "Piso"),
  apartment: optText(10, "Departamento"),
  tower: optText(20, "Torre"),
  neighborhood: optText(80, "Barrio"),
  city: z.string().trim().min(2, "Escribí la ciudad.").max(80).default("Córdoba"),
  province: z.string().trim().min(2, "Escribí la provincia.").max(80).default("Córdoba"),
  postal_code: optText(12, "Código postal"),
  rooms: optInt("Ambientes"),
  bedrooms: optInt("Dormitorios"),
  bathrooms: optInt("Baños"),
  covered_m2: optM2("Superficie cubierta"),
  total_m2: optM2("Superficie total"),
  furnished: z.boolean().default(false),
  has_garage: z.boolean().default(false),
  consortium_name: optText(120, "Consorcio / administración"),
  consortium_phone: optText(40, "Teléfono del consorcio"),
  consortium_email: z
    .union([z.string().trim().email("El mail del consorcio no es válido."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  functional_unit: optText(20, "Unidad funcional"),
  cadastral_id: optText(60, "Catastro / cuenta de Rentas"),
  services: z.array(serviceSchema).max(20, "Hasta 20 servicios por propiedad.").default([]),
  listing_rent: z
    .number({ invalid_type_error: "Revisá el precio pretendido." })
    .positive("El precio pretendido tiene que ser mayor a 0.")
    .max(999_999_999_999)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  listing_currency: z.enum(["ARS", "USD", "EUR"]).nullable().optional().transform((v) => v ?? null),
  availability: z.enum(["disponible", "reservada", "en_refaccion", "retirada"]).default("disponible"),
  mandate_signed_at: z
    .union([z.string().refine(isYmd, "La fecha del mandato no es válida."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optText(2000, "Notas"),
  owners: z.array(ownerRowSchema).max(20, "Hasta 20 propietarios por propiedad."),
});

type ParsedProperty = z.infer<typeof propertySchema>;

function firstIssue(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? "Revisá los datos.", field: issue?.path?.[0] ? String(issue.path[0]) : undefined };
}

function toRow(p: ParsedProperty) {
  const { owners: _owners, code: _code, ...rest } = p;
  void _owners;
  void _code;
  return {
    ...rest,
    // Precio pretendido sin moneda no sirve: ARS por defecto.
    listing_currency: rest.listing_rent ? rest.listing_currency ?? "ARS" : null,
  };
}

// ─── Internos (NO exportados: un export en "use server" es un endpoint) ─────

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

type CodeResult = { ok: true; code: string; auto: boolean } | { ok: false; error: string; field: "code"; suggestion: string };

/** Código final: el tipeado (si no está usado) o el primero libre a partir de la dirección. */
async function resolveCode(ctx: RentalsCtx, parsed: ParsedProperty, excludeId?: string): Promise<CodeResult> {
  const typed = normalizePropertyCode(parsed.code);
  const base = typed || suggestPropertyCode(parsed) || "PROPIEDAD";
  const { data, error } = await ctx.admin
    .from("rental_properties")
    .select("id, code, street, street_number, floor, apartment, tower")
    .eq("organization_id", ctx.organization.id)
    .ilike("code", `${escapeLike(base)}%`)
    .limit(1000);
  if (error) logRentalsError("resolveCode", error);
  const rows = ((data ?? []) as Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower">[]).filter(
    (r) => r.id !== excludeId,
  );
  const taken = rows.map((r) => r.code);
  if (typed) {
    const dup = rows.find((r) => r.code.toUpperCase() === typed);
    if (dup) {
      const suggestion = firstFreeCode(typed, taken);
      return {
        ok: false,
        field: "code",
        suggestion,
        error: `El código ${typed} ya es de ${propertyAddress(dup)}. Usá otro, por ejemplo ${suggestion}.`,
      };
    }
    return { ok: true, code: typed, auto: false };
  }
  return { ok: true, code: firstFreeCode(base, taken), auto: true };
}

/** Los titulares tienen que ser propietarios de esta organización. */
async function verifyOwners(ctx: RentalsCtx, rows: PropertyOwnerInput[]): Promise<{ ok: true } | { ok: false; error: string; field: string }> {
  const ids = Array.from(new Set(rows.map((r) => r.owner_id)));
  if (!ids.length) return { ok: true };
  const { data, error } = await ctx.admin.from("owners").select("id").eq("organization_id", ctx.organization.id).in("id", ids);
  if (error) {
    logRentalsError("verifyOwners", error);
    return { ok: false, error: "No pudimos verificar los propietarios. Probá de nuevo.", field: "owners" };
  }
  if ((data ?? []).length !== ids.length) {
    return { ok: false, error: "Uno de los propietarios ya no existe. Volvé a elegirlo.", field: "owners" };
  }
  return { ok: true };
}

/** Reemplaza los titulares: primero upsert (atómico), después borra los que salieron. */
async function writeOwners(ctx: RentalsCtx, propertyId: string, rows: PropertyOwnerInput[]): Promise<ActionResult> {
  const orgId = ctx.organization.id;
  const { error: upErr } = await ctx.admin.from("rental_property_owners").upsert(
    rows.map((r) => ({
      organization_id: orgId,
      property_id: propertyId,
      owner_id: r.owner_id,
      ownership_pct: Math.round(r.ownership_pct * 100) / 100,
      is_primary: r.is_primary,
    })),
    { onConflict: "property_id,owner_id" },
  );
  if (upErr) return dbFailure("writeOwners.upsert", upErr, "No se pudieron guardar los propietarios.");
  const keep = rows.map((r) => r.owner_id);
  const { error: delErr } = await ctx.admin
    .from("rental_property_owners")
    .delete()
    .eq("organization_id", orgId)
    .eq("property_id", propertyId)
    .not("owner_id", "in", `(${keep.join(",")})`);
  if (delErr) return dbFailure("writeOwners.delete", delErr, "No se pudo sacar a un propietario anterior.");
  return { ok: true };
}

function matchesQuery(item: PropertyListItem, q: string): boolean {
  const hay = [
    item.property.code,
    propertyAddress(item.property),
    item.property.neighborhood,
    item.property.city,
    ...item.owners.map((o) => o.full_name),
    item.current?.tenant?.full_name,
    item.draft?.tenant?.full_name,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function assemble(property: RentalProperty, owners: PropertyListItem["owners"], contracts: ContractSummary[]): PropertyListItem {
  const current = contracts.find((c) => c.status === "vigente") ?? null;
  const draft = contracts.find((c) => c.status === "borrador") ?? null;
  let vacantSince: string | null = null;
  if (!current) {
    for (const c of contracts) {
      if (c.status !== "finalizado" && c.status !== "rescindido") continue;
      const end = c.terminated_at ?? c.end_date;
      if (!vacantSince || end > vacantSince) vacantSince = end;
    }
  }
  return {
    property: { ...property, services: Array.isArray(property.services) ? property.services : [] },
    state: propertyDisplayState(property, Boolean(current)),
    owners,
    current,
    draft,
    vacant_since: vacantSince,
  };
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function listProperties(
  filters: { q?: string; availability?: PropertyListItem["state"] | "todas"; includeArchived?: boolean } = {},
): Promise<ActionResult<{ items: PropertyListItem[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  try {
    let pq = ctx.admin.from("rental_properties").select("*").eq("organization_id", orgId);
    if (!filters.includeArchived) pq = pq.eq("active", true);
    const [{ data, error }, owners, contracts] = await Promise.all([
      pq.order("street").order("street_number").limit(2000),
      loadPropertyOwners(ctx.admin, orgId),
      loadContractSummaries(ctx.admin, orgId, ctx.today),
    ]);
    if (error) return dbFailure("listProperties", error, "No se pudieron cargar las propiedades.");
    const byProperty = new Map<string, ContractSummary[]>();
    for (const c of contracts) {
      const list = byProperty.get(c.property_id) ?? [];
      list.push(c);
      byProperty.set(c.property_id, list);
    }
    let items = ((data ?? []) as RentalProperty[]).map((p) => assemble(p, owners.get(p.id) ?? [], byProperty.get(p.id) ?? []));
    const q = filters.q?.trim();
    if (q) items = items.filter((it) => matchesQuery(it, q));
    if (filters.availability && filters.availability !== "todas") items = items.filter((it) => it.state === filters.availability);
    return { ok: true, items };
  } catch (e) {
    logRentalsError("listProperties", e);
    return { ok: false, error: "No se pudieron cargar las propiedades. Probá de nuevo." };
  }
}

export async function getProperty(id: string): Promise<ActionResult<{ detail: PropertyDetail }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos la propiedad." };
  try {
    const [{ data: property, error }, owners, contracts, { data: events }] = await Promise.all([
      ctx.admin.from("rental_properties").select("*").eq("organization_id", orgId).eq("id", id).maybeSingle(),
      loadPropertyOwners(ctx.admin, orgId, id),
      loadContractSummaries(ctx.admin, orgId, ctx.today, { propertyId: id }),
      ctx.admin
        .from("rental_events")
        .select("id, event_type, summary, created_at, actor_name")
        .eq("organization_id", orgId)
        .eq("property_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (error) return dbFailure("getProperty", error, "No se pudo cargar la propiedad.");
    if (!property) return { ok: false, error: "No encontramos la propiedad." };
    const base = assemble(property as RentalProperty, owners.get(id) ?? [], contracts);
    return { ok: true, detail: { ...base, contracts, events: (events ?? []) as PropertyEventView[] } };
  } catch (e) {
    logRentalsError("getProperty", e);
    return { ok: false, error: "No se pudo cargar la propiedad. Probá de nuevo." };
  }
}

/** Lo que necesita el formulario al abrirse: propietarios para el buscador, códigos usados y titulares actuales. */
export async function getPropertyFormOptions(propertyId?: string | null): Promise<ActionResult<{ options: PropertyFormOptions }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  const editing = propertyId && z.string().uuid().safeParse(propertyId).success ? propertyId : null;
  const [ownersRes, codesRes, currentRes] = await Promise.all([
    ctx.admin.from("owners").select("id, full_name, phone, email, document_number, active").eq("organization_id", orgId).order("full_name").limit(3000),
    ctx.admin
      .from("rental_properties")
      .select("id, code, street, street_number, floor, apartment, tower")
      .eq("organization_id", orgId)
      .limit(3000),
    editing
      ? ctx.admin.from("rental_property_owners").select("owner_id, ownership_pct, is_primary").eq("organization_id", orgId).eq("property_id", editing)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (ownersRes.error) return dbFailure("getPropertyFormOptions.owners", ownersRes.error, "No se pudieron cargar los propietarios.");
  if (codesRes.error) return dbFailure("getPropertyFormOptions.codes", codesRes.error, "No se pudieron cargar las propiedades.");
  const current = ((currentRes.data ?? null) as PropertyOwnerInput[] | null)?.map((o) => ({ ...o, ownership_pct: Number(o.ownership_pct) })) ?? null;
  const currentIds = new Set((current ?? []).map((o) => o.owner_id));
  const owners: OwnerOption[] = ((ownersRes.data ?? []) as (OwnerOption & { active: boolean })[])
    .filter((o) => o.active || currentIds.has(o.id))
    .map(({ active: _a, ...o }) => {
      void _a;
      return o;
    });
  const codes = ((codesRes.data ?? []) as Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower">[]).map((p) => ({
    id: p.id,
    code: p.code,
    label: propertyAddress(p),
  }));
  return { ok: true, options: { owners, codes, current_owners: editing ? current ?? [] : null } };
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

function revalidateOwners(ownerIds: Iterable<string>): void {
  for (const id of new Set(ownerIds)) revalidatePath(`/dashboard/propietarios/${id}`);
}

export async function createProperty(input: PropertyInput): Promise<PropertySaveResult> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = propertySchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;
  const own = validateOwnership(data.owners);
  if (!own.ok) return { ok: false, error: own.error, field: "owners" };
  const verified = await verifyOwners(ctx, data.owners);
  if (!verified.ok) return verified;

  const orgId = ctx.organization.id;
  let inserted: RentalProperty | null = null;
  for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
    const code = await resolveCode(ctx, data);
    if (!code.ok) return code;
    const { data: row, error } = await ctx.admin
      .from("rental_properties")
      .insert({ ...toRow(data), code: code.code, organization_id: orgId, created_by: ctx.session.userId })
      .select("*")
      .single();
    if (!error && row) {
      inserted = row as RentalProperty;
      break;
    }
    const dup = Boolean(error?.message?.includes("rental_properties_org_code_key"));
    // Código automático que otra persona tomó en el mismo segundo: se recalcula una vez.
    if (dup && code.auto && attempt === 0) continue;
    if (dup) return { ok: false, field: "code", error: `El código ${code.code} ya está usado. Probá con otro.` };
    return dbFailure("createProperty", error, "No se pudo guardar la propiedad.");
  }
  if (!inserted) return { ok: false, error: "No se pudo guardar la propiedad. Probá de nuevo." };

  const owners = await writeOwners(ctx, inserted.id, data.owners);
  if (!owners.ok) {
    await ctx.admin.from("rental_properties").delete().eq("organization_id", orgId).eq("id", inserted.id);
    return owners;
  }
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    propertyId: inserted.id,
    type: "property_created",
    summary: `Alta de la propiedad ${inserted.code} · ${propertyAddress(inserted)}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: inserted.id });
  revalidateOwners(data.owners.map((o) => o.owner_id));
  return { ok: true, property: inserted };
}

export async function updateProperty(id: string, input: PropertyInput): Promise<PropertySaveResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos la propiedad." };
  const parsed = propertySchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;
  const own = validateOwnership(data.owners);
  if (!own.ok) return { ok: false, error: own.error, field: "owners" };

  const [{ data: existing, error: exErr }, { data: prevOwners }] = await Promise.all([
    ctx.admin.from("rental_properties").select("*").eq("organization_id", orgId).eq("id", id).maybeSingle(),
    ctx.admin.from("rental_property_owners").select("owner_id").eq("organization_id", orgId).eq("property_id", id),
  ]);
  if (exErr) return dbFailure("updateProperty.load", exErr, "No se pudo cargar la propiedad.");
  if (!existing) return { ok: false, error: "No encontramos la propiedad." };
  const verified = await verifyOwners(ctx, data.owners);
  if (!verified.ok) return verified;

  // En la edición, dejar el código vacío no lo regenera: se conserva el actual.
  if (!normalizePropertyCode(data.code)) data.code = (existing as RentalProperty).code;
  const code = await resolveCode(ctx, data, id);
  if (!code.ok) return code;

  const { data: row, error } = await ctx.admin
    .from("rental_properties")
    .update({ ...toRow(data), code: code.code })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    if (error?.message?.includes("rental_properties_org_code_key")) {
      return { ok: false, field: "code", error: `El código ${code.code} ya está usado. Probá con otro.` };
    }
    return dbFailure("updateProperty", error, "No se pudieron guardar los cambios.");
  }
  const owners = await writeOwners(ctx, id, data.owners);
  if (!owners.ok) return owners;

  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    propertyId: id,
    type: "property_updated",
    summary: "Se actualizaron los datos de la propiedad",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: id });
  // La dirección se ve en la ficha de cada contrato de la propiedad.
  revalidatePath("/dashboard/alquileres/contratos/[id]", "page");
  revalidateOwners([...data.owners.map((o) => o.owner_id), ...((prevOwners ?? []) as { owner_id: string }[]).map((o) => o.owner_id)]);
  return { ok: true, property: row as RentalProperty };
}

export async function setPropertyOwners(propertyId: string, owners: PropertyOwnerInput[]): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(propertyId).success) return { ok: false, error: "No encontramos la propiedad." };
  const parsed = z.array(ownerRowSchema).max(20).safeParse(owners);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const own = validateOwnership(parsed.data);
  if (!own.ok) return { ok: false, error: own.error, field: "owners" };
  const [{ data: property }, { data: prevOwners }] = await Promise.all([
    ctx.admin.from("rental_properties").select("id").eq("organization_id", orgId).eq("id", propertyId).maybeSingle(),
    ctx.admin.from("rental_property_owners").select("owner_id").eq("organization_id", orgId).eq("property_id", propertyId),
  ]);
  if (!property) return { ok: false, error: "No encontramos la propiedad." };
  const verified = await verifyOwners(ctx, parsed.data);
  if (!verified.ok) return verified;
  const res = await writeOwners(ctx, propertyId, parsed.data);
  if (!res.ok) return res;
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    propertyId,
    type: "property_owners_updated",
    summary: "Se actualizaron los propietarios y sus porcentajes",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId });
  revalidateOwners([...parsed.data.map((o) => o.owner_id), ...((prevOwners ?? []) as { owner_id: string }[]).map((o) => o.owner_id)]);
  return { ok: true };
}

/** Archivar = dejar de administrarla (se conserva todo el historial). Bloquea si tiene contrato vigente o en borrador. */
export async function archiveProperty(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos la propiedad." };
  const [{ data: property }, { data: open, error }] = await Promise.all([
    ctx.admin.from("rental_properties").select("id, code").eq("organization_id", orgId).eq("id", id).maybeSingle(),
    ctx.admin.from("rental_contracts").select("number, status").eq("organization_id", orgId).eq("property_id", id).in("status", ["vigente", "borrador"]),
  ]);
  if (error) return dbFailure("archiveProperty.contracts", error, "No se pudo revisar los contratos de la propiedad.");
  if (!property) return { ok: false, error: "No encontramos la propiedad." };
  const rows = (open ?? []) as { number: number; status: string }[];
  const vigente = rows.find((c) => c.status === "vigente");
  if (vigente) {
    return { ok: false, error: `Tiene el contrato C-${String(vigente.number).padStart(4, "0")} vigente. Finalizalo antes de archivar la propiedad.` };
  }
  const draft = rows.find((c) => c.status === "borrador");
  if (draft) {
    return { ok: false, error: `Tiene un contrato en borrador (C-${String(draft.number).padStart(4, "0")}). Activalo o borralo antes de archivar.` };
  }
  const { error: upErr } = await ctx.admin.from("rental_properties").update({ active: false }).eq("organization_id", orgId).eq("id", id);
  if (upErr) return dbFailure("archiveProperty", upErr, "No se pudo archivar la propiedad.");
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    propertyId: id,
    type: "property_archived",
    summary: "Se archivó la propiedad",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: id });
  return { ok: true };
}

export async function restoreProperty(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "No encontramos la propiedad." };
  const { data, error } = await ctx.admin
    .from("rental_properties")
    .update({ active: true })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return dbFailure("restoreProperty", error, "No se pudo reactivar la propiedad.");
  if (!data) return { ok: false, error: "No encontramos la propiedad." };
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    propertyId: id,
    type: "property_restored",
    summary: "Se volvió a activar la propiedad",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ propertyId: id });
  return { ok: true };
}

const quickOwnerSchema = z.object({
  full_name: z.string().trim().min(2, "Escribí el nombre del propietario.").max(160, "El nombre: hasta 160 caracteres."),
  phone: optText(40, "Teléfono"),
  email: z
    .union([z.string().trim().email("El mail no es válido."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  cbu: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? "").replace(/\D+/g, "") || null)
    .refine((v) => v == null || v.length === 22, "El CBU/CVU tiene 22 números."),
  alias_cbu: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? "").trim() || null)
    .refine((v) => v == null || /^[A-Za-z0-9.-]{6,20}$/.test(v), "El alias tiene entre 6 y 20 letras, números, puntos o guiones."),
});

function foldName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Alta rápida de un propietario desde el formulario de la propiedad. Es el
 * mismo propietario de la sección Propietarios (tabla `owners`), no una copia.
 */
export async function quickCreateOwner(input: QuickOwnerInput): Promise<ActionResult<{ owner: OwnerOption }>> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!can(ctx.role, "owners", "create")) return { ok: false, error: "No tenés permiso para crear propietarios." };
  const parsed = quickOwnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;
  const orgId = ctx.organization.id;

  const { data: same } = await ctx.admin
    .from("owners")
    .select("id, full_name")
    .eq("organization_id", orgId)
    .ilike("full_name", escapeLike(data.full_name))
    .limit(5);
  const dup = ((same ?? []) as { id: string; full_name: string }[]).find((o) => foldName(o.full_name) === foldName(data.full_name));
  if (dup) {
    return { ok: false, field: "full_name", error: `Ya existe «${dup.full_name}» en Propietarios: elegilo en la lista.` };
  }

  const { data: row, error } = await ctx.admin
    .from("owners")
    .insert({
      organization_id: orgId,
      full_name: data.full_name,
      phone: data.phone,
      email: data.email,
      cbu: data.cbu,
      alias_cbu: data.alias_cbu,
    })
    .select("id, full_name, phone, email, document_number")
    .single();
  if (error || !row) return dbFailure("quickCreateOwner", error, "No se pudo crear el propietario.");
  revalidatePath("/dashboard/propietarios");
  return { ok: true, owner: row as OwnerOption };
}
