"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { propertyAddress } from "@/lib/rentals/labels";
import {
  firstIssue,
  OTHER_PERSON_HINT,
  ownerRowSchema,
  propertyInputSchema,
  quickOwnerInputSchema,
  type ParsedPropertyInput,
  type ParsedQuickOwnerInput,
} from "@/lib/rentals/property-input";
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
  QuickOwnerResult,
  SavedPropertyOwner,
} from "@/components/rentals/properties/property-types";

// ─── Validación ─────────────────────────────────────────────────────────────
// El esquema vive en un módulo común: el formulario corre el mismo ANTES de
// crear a un propietario nuevo, así nada que el servidor rechace aparece
// recién con el propietario ya creado (lo que dejó el 05/10 dueños sin propiedad).

type ParsedProperty = ParsedPropertyInput;

function toRow(p: ParsedProperty) {
  // El id nunca va en un update (es la clave) y en el alta se pone aparte.
  const { owners: _owners, code: _code, id: _id, ...rest } = p;
  void _owners;
  void _code;
  void _id;
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
/**
 * Lo que el formulario de la propiedad necesita al abrirse (y vuelve a pedir
 * antes de crear a un propietario nuevo). `clientId`: en un alta, el id con el
 * que se va a crear; si esa propiedad ya quedó guardada (se perdió la
 * respuesta, se recargó en medio), viene en `saved` y el formulario termina
 * ahí en vez de cargarla dos veces.
 */
export async function getPropertyFormOptions(
  propertyId?: string | null,
  clientId?: string | null,
): Promise<ActionResult<{ options: PropertyFormOptions }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const orgId = ctx.organization.id;
  const editing = propertyId && z.string().uuid().safeParse(propertyId).success ? propertyId : null;
  const creatingId = !editing && clientId && z.string().uuid().safeParse(clientId).success ? clientId : null;
  const [ownersRes, codesRes, currentRes, savedRes] = await Promise.all([
    ctx.admin.from("owners").select("id, full_name, phone, email, document_number, active").eq("organization_id", orgId).order("full_name").limit(3000),
    ctx.admin
      .from("rental_properties")
      .select("id, code, street, street_number, floor, apartment, tower")
      .eq("organization_id", orgId)
      .limit(3000),
    editing
      ? ctx.admin.from("rental_property_owners").select("owner_id, ownership_pct, is_primary").eq("organization_id", orgId).eq("property_id", editing)
      : Promise.resolve({ data: null, error: null }),
    creatingId
      ? ctx.admin.from("rental_properties").select("*").eq("organization_id", orgId).eq("id", creatingId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (ownersRes.error) return dbFailure("getPropertyFormOptions.owners", ownersRes.error, "No se pudieron cargar los propietarios.");
  if (codesRes.error) return dbFailure("getPropertyFormOptions.codes", codesRes.error, "No se pudieron cargar las propiedades.");
  // Sin los titulares actuales, la edición arrancaba sin dueño y guardar los reemplazaba.
  if (currentRes.error) return dbFailure("getPropertyFormOptions.current", currentRes.error, "No se pudieron cargar los propietarios de la propiedad.");
  if (savedRes.error) return dbFailure("getPropertyFormOptions.saved", savedRes.error, "No se pudieron cargar las propiedades.");
  const current = ((currentRes.data ?? null) as PropertyOwnerInput[] | null)?.map((o) => ({ ...o, ownership_pct: Number(o.ownership_pct) })) ?? null;
  const currentIds = new Set((current ?? []).map((o) => o.owner_id));
  const owners: OwnerOption[] = [];
  // Los archivados no se ofrecen, pero el sistema no deja crear otro con el mismo nombre: el formulario lo avisa antes.
  const archived: OwnerOption[] = [];
  for (const o of (ownersRes.data ?? []) as (OwnerOption & { active: boolean | null })[]) {
    (o.active !== false || currentIds.has(o.id) ? owners : archived).push(ownerOption(o));
  }
  const codes = ((codesRes.data ?? []) as Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower">[]).map((p) => ({
    id: p.id,
    code: p.code,
    label: propertyAddress(p),
  }));
  let saved: PropertyFormOptions["saved"] = null;
  const savedRow = (savedRes.data ?? null) as RentalProperty | null;
  if (savedRow) {
    const savedOwners = await savedOwnersOf(ctx, savedRow.id);
    if (!savedOwners) return { ok: false, error: "No se pudieron cargar los propietarios." };
    saved = { property: { ...savedRow, services: Array.isArray(savedRow.services) ? savedRow.services : [] }, owners: savedOwners };
  }
  return { ok: true, options: { owners, archived_owners: archived, codes, current_owners: editing ? current ?? [] : null, saved } };
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

function revalidateOwners(ownerIds: Iterable<string>): void {
  for (const id of new Set(ownerIds)) revalidatePath(`/dashboard/propietarios/${id}`);
}

/**
 * Una búsqueda por id que distingue "no está" de "no se pudo mirar". Tomar un
 * error de lectura por "no está" hacía que un reintento (justo cuando la base
 * anda lenta) cargara la propiedad o el propietario por segunda vez.
 */
type Lookup<T> = { ok: true; row: T | null } | { ok: false };

const UNSURE_PROPERTY = "No pudimos confirmar si la propiedad ya se había guardado. Probá de nuevo en un momento.";
const UNSURE_OWNER = "No pudimos confirmar si el propietario ya se había creado. Probá de nuevo en un momento.";

/** La propiedad con este id en ESTA organización. Nunca mira (ni cuenta nada de) otra organización. */
async function findOwnProperty(ctx: RentalsCtx, id: string): Promise<Lookup<RentalProperty>> {
  const { data, error } = await ctx.admin.from("rental_properties").select("*").eq("organization_id", ctx.organization.id).eq("id", id).maybeSingle();
  if (error) {
    logRentalsError("findOwnProperty", error);
    return { ok: false };
  }
  return { ok: true, row: (data as RentalProperty | null) ?? null };
}

/** Titulares guardados de una propiedad (con nombre), o null si no se pudieron leer. */
async function savedOwnersOf(ctx: RentalsCtx, propertyId: string): Promise<SavedPropertyOwner[] | null> {
  try {
    const owners = (await loadPropertyOwners(ctx.admin, ctx.organization.id, propertyId)).get(propertyId) ?? [];
    return owners.map((o) => ({ owner_id: o.owner_id, full_name: o.full_name, ownership_pct: o.ownership_pct, is_primary: o.is_primary }));
  } catch (e) {
    logRentalsError("savedOwnersOf", e);
    return null;
  }
}

/**
 * Reintento de un alta que ya había entrado (se perdió la respuesta): la misma
 * propiedad, con sus titulares. Si quedó a medias (la propiedad sin titulares:
 * se cortó antes de guardarlos), se termina acá con los de este pedido; si no,
 * quedaba "guardada" sin dueño y sin a quién rendirle.
 */
async function replayProperty(ctx: RentalsCtx, prev: RentalProperty, data: ParsedProperty): Promise<PropertySaveResult> {
  const owners = await savedOwnersOf(ctx, prev.id);
  if (!owners) return { ok: false, error: UNSURE_PROPERTY };
  if (owners.length) return { ok: true, property: prev, already_saved: true, owners };
  const own = validateOwnership(data.owners);
  if (!own.ok) return { ok: false, error: own.error, field: "owners" };
  const verified = await verifyOwners(ctx, data.owners);
  if (!verified.ok) return verified;
  const written = await writeOwners(ctx, prev.id, data.owners);
  if (!written.ok) return written;
  await logCreated(ctx, prev);
  revalidateRentals({ propertyId: prev.id });
  revalidateOwners(data.owners.map((o) => o.owner_id));
  // Si no se pueden releer, son los de este pedido (recién guardados): el formulario los arma con su lista.
  return { ok: true, property: prev, already_saved: true, owners: (await savedOwnersOf(ctx, prev.id)) ?? undefined };
}

async function logCreated(ctx: RentalsCtx, property: RentalProperty): Promise<void> {
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    propertyId: property.id,
    type: "property_created",
    summary: `Alta de la propiedad ${property.code} · ${propertyAddress(property)}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
}

export async function createProperty(input: PropertyInput): Promise<PropertySaveResult> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = propertyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;
  const orgId = ctx.organization.id;
  // El formulario manda siempre el mismo id para la misma alta (queda en el borrador). Si la
  // respuesta anterior se perdió, la propiedad ya está: se devuelve esa en vez de cargarla dos
  // veces. Va antes que el código: un código tipeado chocaría contra la propia propiedad.
  let clientId = data.id ?? null;
  if (clientId) {
    const prev = await findOwnProperty(ctx, clientId);
    if (!prev.ok) return { ok: false, error: UNSURE_PROPERTY };
    if (prev.row) return replayProperty(ctx, prev.row, data);
  }
  const own = validateOwnership(data.owners);
  if (!own.ok) return { ok: false, error: own.error, field: "owners" };
  const verified = await verifyOwners(ctx, data.owners);
  if (!verified.ok) return verified;

  let inserted: RentalProperty | null = null;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const code = await resolveCode(ctx, data, clientId ?? undefined);
    if (!code.ok) return code;
    const { data: row, error } = await ctx.admin
      .from("rental_properties")
      .insert({ ...toRow(data), ...(clientId ? { id: clientId } : {}), code: code.code, organization_id: orgId, created_by: ctx.session.userId })
      .select("*")
      .single();
    if (!error && row) {
      inserted = row as RentalProperty;
      break;
    }
    if (clientId) {
      // ¿Entró igual? Un choque puede ser el mismo alta por otro pedido (doble envío, reintento), y
      // cualquier otro error puede haber llegado DESPUÉS de guardarla (p. ej. se venció la espera).
      const prev = await findOwnProperty(ctx, clientId);
      if (!prev.ok) return { ok: false, error: UNSURE_PROPERTY };
      if (prev.row && error?.code === "23505") return replayProperty(ctx, prev.row, data);
      if (prev.row) {
        // Quedó guardada aunque la respuesta no llegó: se sigue con los titulares.
        inserted = prev.row;
        break;
      }
      // El id ya existe fuera de esta organización: no se dice nada de esa fila; se guarda con un id nuevo.
      if (error?.code === "23505" && error.message?.includes("rental_properties_pkey")) {
        clientId = null;
        continue;
      }
    }
    const dup = Boolean(error?.message?.includes("rental_properties_org_code_key"));
    // Código automático que otra persona tomó en el mismo segundo: se recalcula.
    if (dup && code.auto && attempt < 2) continue;
    if (dup) return { ok: false, field: "code", error: `El código ${code.code} ya está usado. Probá con otro.` };
    return dbFailure("createProperty", error, "No se pudo guardar la propiedad.");
  }
  if (!inserted) return { ok: false, error: "No se pudo guardar la propiedad. Probá de nuevo." };

  const owners = await writeOwners(ctx, inserted.id, data.owners);
  if (!owners.ok) {
    // Si no se puede deshacer, queda sin titulares: reintentar con el mismo id la termina (replayProperty).
    const { error: undoErr } = await ctx.admin.from("rental_properties").delete().eq("organization_id", orgId).eq("id", inserted.id);
    if (undoErr) logRentalsError("createProperty.undo", undoErr);
    return owners;
  }
  await logCreated(ctx, inserted);
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
  const parsed = propertyInputSchema.safeParse(input);
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

function foldName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const OWNER_OPTION_COLUMNS = "id, full_name, phone, email, document_number";

type OwnerRecord = OwnerOption & { cbu: string | null; alias_cbu: string | null };

function ownerOption({ id, full_name, phone, email, document_number }: OwnerOption): OwnerOption {
  return { id, full_name, phone, email, document_number };
}

/** El propietario con este id en ESTA organización. Nunca mira (ni cuenta nada de) otra organización. */
async function findOwnOwner(ctx: RentalsCtx, id: string): Promise<Lookup<OwnerRecord>> {
  const { data, error } = await ctx.admin
    .from("owners")
    .select(`${OWNER_OPTION_COLUMNS}, cbu, alias_cbu`)
    .eq("organization_id", ctx.organization.id)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logRentalsError("findOwnOwner", error);
    return { ok: false };
  }
  return { ok: true, row: (data as OwnerRecord | null) ?? null };
}

/**
 * Otro propietario de la organización con el mismo nombre (sin tildes ni
 * mayúsculas): el sistema no deja cargar dos iguales. `existing` deja ofrecer
 * "Usar ese propietario" aunque la lista del formulario sea de antes.
 */
async function sameNameProblem(ctx: RentalsCtx, name: string, exceptId?: string): Promise<QuickOwnerResult | null> {
  const { data, error } = await ctx.admin
    .from("owners")
    .select(`${OWNER_OPTION_COLUMNS}, active`)
    .eq("organization_id", ctx.organization.id)
    .ilike("full_name", escapeLike(name))
    .limit(5);
  // Sin poder mirar, crearlo igual podía dejar dos con el mismo nombre.
  if (error) return dbFailure("quickCreateOwner.sameName", error, "No pudimos revisar si ya está cargado. Probá de nuevo.");
  const dup = ((data ?? []) as (OwnerOption & { active: boolean | null })[]).find(
    (o) => o.id !== exceptId && foldName(o.full_name) === foldName(name),
  );
  if (!dup) return null;
  // Un archivado no aparece en el buscador: "usá ese" mandaba a buscar algo que no está.
  if (dup.active === false) {
    return { ok: false, field: "full_name", error: `Ya hay un «${dup.full_name}» archivado en Propietarios. ${OTHER_PERSON_HINT}` };
  }
  return {
    ok: false,
    field: "full_name",
    error: `«${dup.full_name}» ya está en Propietarios: si es la misma persona, usá ese en vez de crear otro. ${OTHER_PERSON_HINT}`,
    existing: ownerOption(dup),
  };
}

/**
 * Reintento del alta de un propietario que ya entró (se perdió la respuesta).
 * Si entretanto se corrigió algo (el CBU, el nombre), queda lo último que se
 * tipeó: si no, la propiedad se guardaba con el CBU viejo sin que nadie se
 * enterara. Sólo mientras ninguna propiedad lo use (recién creado); si ya lo
 * usa una (otra pestaña con el mismo borrador), no se toca: devuelve null.
 */
async function replayOwner(ctx: RentalsCtx, prev: OwnerRecord, data: ParsedQuickOwnerInput): Promise<QuickOwnerResult | null> {
  const sameName = foldName(prev.full_name) === foldName(data.full_name);
  if (sameName && prev.phone === data.phone && prev.email === data.email && prev.cbu === data.cbu && prev.alias_cbu === data.alias_cbu) {
    return { ok: true, owner: ownerOption(prev), already_saved: true };
  }
  const orgId = ctx.organization.id;
  const { count, error } = await ctx.admin
    .from("rental_property_owners")
    .select("owner_id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("owner_id", prev.id);
  if (error) {
    logRentalsError("quickCreateOwner.replay", error);
    return { ok: false, error: UNSURE_OWNER };
  }
  if (count) return null;
  if (!sameName) {
    const problem = await sameNameProblem(ctx, data.full_name, prev.id);
    if (problem) return problem;
  }
  const { data: row, error: upErr } = await ctx.admin
    .from("owners")
    .update({ full_name: data.full_name, phone: data.phone, email: data.email, cbu: data.cbu, alias_cbu: data.alias_cbu })
    .eq("organization_id", orgId)
    .eq("id", prev.id)
    .select(OWNER_OPTION_COLUMNS)
    .single();
  if (upErr || !row) return dbFailure("quickCreateOwner.replay", upErr, "No se pudo crear el propietario.");
  revalidatePath("/dashboard/propietarios");
  revalidatePath(`/dashboard/propietarios/${prev.id}`);
  return { ok: true, owner: row as OwnerOption, already_saved: true };
}

/**
 * Alta rápida de un propietario desde el formulario de la propiedad. Es el
 * mismo propietario de la sección Propietarios (tabla `owners`), no una copia.
 */
export async function quickCreateOwner(input: QuickOwnerInput): Promise<QuickOwnerResult> {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!can(ctx.role, "owners", "create")) return { ok: false, error: "No tenés permiso para crear propietarios." };
  const parsed = quickOwnerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, ...firstIssue(parsed.error) };
  const data = parsed.data;
  const orgId = ctx.organization.id;

  // Reintento de un alta que ya entró (se perdió la respuesta): es el mismo propietario. Va antes
  // del control de nombre repetido, que si no se encontraba a sí mismo y lo rechazaba.
  let clientId = data.id ?? null;
  if (clientId) {
    const prev = await findOwnOwner(ctx, clientId);
    if (!prev.ok) return { ok: false, error: UNSURE_OWNER };
    if (prev.row) {
      const replay = await replayOwner(ctx, prev.row, data);
      if (replay) return replay;
      // Ese id ya es de un propietario que usa una propiedad: éste se crea aparte, con un id nuevo.
      clientId = null;
    }
  }

  const problem = await sameNameProblem(ctx, data.full_name);
  if (problem) return problem;

  const fields = {
    organization_id: orgId,
    full_name: data.full_name,
    phone: data.phone,
    email: data.email,
    cbu: data.cbu,
    alias_cbu: data.alias_cbu,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error } = await ctx.admin
      .from("owners")
      .insert(clientId ? { id: clientId, ...fields } : fields)
      .select(OWNER_OPTION_COLUMNS)
      .single();
    if (!error && row) {
      revalidatePath("/dashboard/propietarios");
      return { ok: true, owner: row as OwnerOption };
    }
    if (clientId && error?.code === "23505") {
      // Otro pedido con el mismo id entró en este instante (doble envío): es el mismo propietario.
      const prev = await findOwnOwner(ctx, clientId);
      if (!prev.ok) return { ok: false, error: UNSURE_OWNER };
      if (prev.row) return (await replayOwner(ctx, prev.row, data)) ?? { ok: true, owner: ownerOption(prev.row), already_saved: true };
      // El id existe fuera de esta organización: no se dice nada de esa fila; se crea con un id nuevo.
      if (error.message?.includes("owners_pkey")) {
        clientId = null;
        continue;
      }
    }
    return dbFailure("quickCreateOwner", error, "No se pudo crear el propietario.");
  }
  return { ok: false, error: "No se pudo crear el propietario. Probá de nuevo." };
}
