"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type {
  BookingSource,
  BookingStatus,
  Unit,
  UnitStatus,
  UnitWithRelations,
  Owner,
} from "@/lib/types/database";
import { BOOKING_SOURCE_META, TICKET_PRIORITY_META } from "@/lib/constants";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import { pickChargeOwner, type UnitOwnerLite } from "@/lib/settlements/charge-owner";
import { getOwnerScope, scopeFilter } from "@/lib/auth/owner-scope";
import { unitPriceKinds } from "@/lib/units/pricing";
import { revalidateStorefront } from "@/lib/marketplace/storefront";

const unitSchema = z.object({
  code: z.string().min(1, "Código requerido"),
  name: z.string().min(1, "Nombre requerido"),
  address: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  apartment: z.string().optional().nullable(),
  tower: z.string().optional().nullable(),
  internal_extra: z.string().optional().nullable(),
  // Los mensajes van en castellano: `validarUnidad` los devuelve tal cual al
  // cartel del formulario (antes el error se lanzaba y nadie lo leía).
  bedrooms: z.coerce.number().int("Dormitorios tiene que ser un número entero.").min(0, "Dormitorios no puede ser negativo.").optional().nullable(),
  bathrooms: z.coerce.number().int("Baños tiene que ser un número entero.").min(0, "Baños no puede ser negativo.").optional().nullable(),
  max_guests: z.coerce.number().int("La capacidad tiene que ser un número entero.").min(1, "La capacidad tiene que ser de al menos 1 persona.").optional().nullable(),
  size_m2: z.coerce.number().min(0, "La superficie no puede ser negativa.").optional().nullable(),
  base_price: z.coerce.number().min(0, "El precio por noche no puede ser negativo.").optional().nullable(),
  base_price_currency: z.string().default("ARS"),
  // Precio de un mes completo (migraciones 063 y 066). Sólo se guarda en
  // unidades mensuales y mixtas: `conPrecioMensual` lo anula en temporario.
  // min(0.01) y no positive(): numeric(14,2) redondea 0,004 a 0,00 y el CHECK
  // units_monthly_price_positive lo rechazaría con un error sin campo.
  monthly_price: z.coerce
    .number()
    .min(0.01, "El precio por mes tiene que ser mayor a 0. Si no lo querés cargar, dejalo vacío.")
    .max(999_999_999_999.99, "Ese precio por mes es demasiado grande.")
    .optional()
    .nullable(),
  cleaning_fee: z.coerce.number().min(0, "El fee de limpieza no puede ser negativo.").optional().nullable(),
  // Sin default acá: si el form no manda nada, `createUnit` hereda el de la org
  // (Configuración → Organización). Un default fijo de 20 acá se comía siempre
  // esa preferencia.
  default_commission_pct: z.coerce
    .number()
    .min(0, "La comisión de administración va de 0 a 100 %.")
    .max(100, "La comisión de administración va de 0 a 100 %.")
    .optional(),
  default_mode: z
    .enum(["temporario", "mensual", "mixto"])
    .default("temporario"),
  status: z
    .enum(["disponible", "reservado", "ocupado", "limpieza", "mantenimiento", "bloqueado"])
    .default("disponible"),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type UnitInput = z.infer<typeof unitSchema>;

function logActionError(context: string, e: unknown) {
  if (e instanceof Error) console.error(`[units:${context}]`, e.message, e.stack);
  else console.error(`[units:${context}]`, e);
}

/**
 * Lista todas las unidades de la org con datos enriquecidos:
 * primary_owner, next_booking (si existe), open_ticket (más urgente abierto).
 */
export async function listUnitsEnriched(): Promise<UnitWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();

  const { data: units, error } = await admin
    .from("units")
    .select("*")
    .eq("organization_id", organization.id)
    .filter(...scopeFilter(ownerScope, "id"))
    .eq("active", true)
    .order("position")
    .order("code");
  if (error) throw new Error(error.message);

  if (!units || units.length === 0) return [];
  const unitIds = units.map((u) => u.id);

  // Horizonte de bookings: solo necesitamos el próximo, no la temporada completa.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today);
  horizon.setDate(today.getDate() + 90);
  const horizonStr = horizon.toISOString().slice(0, 10);

  // 3 lookups dependen solo de unitIds → paralelos.
  const [{ data: unitOwners }, { data: bookings }, { data: tickets }] = await Promise.all([
    admin
      .from("unit_owners")
      .select("unit_id, owner:owners(*)")
      .in("unit_id", unitIds)
      .eq("is_primary", true),
    admin
      .from("bookings")
      .select(
        "id, unit_id, guest_id, check_in_date, check_out_date, guests_count, guest:guests(id, full_name)",
      )
      .in("unit_id", unitIds)
      .gte("check_in_date", todayStr)
      .lte("check_in_date", horizonStr)
      .in("status", ["confirmada", "check_in"])
      .eq("is_block", false) // un bloqueo OTA no es la "próxima reserva" de la unidad
      .order("check_in_date"),
    admin
      .from("maintenance_tickets")
      .select("id, unit_id, title, priority, status")
      .in("unit_id", unitIds)
      .not("status", "in", "(resuelto,cerrado)"),
  ]);

  const ownerByUnit = new Map<string, Owner>();
  (unitOwners ?? []).forEach((uo) => {
    if (uo.owner) ownerByUnit.set(uo.unit_id, uo.owner as unknown as Owner);
  });

  const nextBookingByUnit = new Map<string, NonNullable<UnitWithRelations["next_booking"]>>();
  (bookings ?? []).forEach((b) => {
    if (!nextBookingByUnit.has(b.unit_id)) {
      nextBookingByUnit.set(b.unit_id, b as unknown as NonNullable<UnitWithRelations["next_booking"]>);
    }
  });

  const openTicketByUnit = new Map<string, NonNullable<UnitWithRelations["open_ticket"]>>();
  (tickets ?? []).forEach((t) => {
    const current = openTicketByUnit.get(t.unit_id);
    const w = TICKET_PRIORITY_META[t.priority as keyof typeof TICKET_PRIORITY_META]?.weight ?? 0;
    const cw = current
      ? TICKET_PRIORITY_META[current.priority as keyof typeof TICKET_PRIORITY_META]?.weight ?? 0
      : -1;
    if (w > cw) {
      openTicketByUnit.set(t.unit_id, t as unknown as NonNullable<UnitWithRelations["open_ticket"]>);
    }
  });

  return (units as Unit[]).map((u) => ({
    ...u,
    primary_owner: ownerByUnit.get(u.id) ?? null,
    next_booking: nextBookingByUnit.get(u.id) ?? null,
    open_ticket: openTicketByUnit.get(u.id) ?? null,
  }));
}

// No confundir con `UnitRef` de database.ts (datos de acceso para personal de
// campo): esto es solo lo necesario para selects y matching.
export type UnitOption = Pick<Unit, "id" | "code" | "name" | "marketplace_title">;

/**
 * Lista liviana de unidades activas para selects y matching (caja, inventario,
 * channel manager): 1 query de 4 columnas, sin los lookups de owner/booking/
 * ticket de listUnitsEnriched. `marketplace_title` viaja porque el importador
 * masivo de listings OTA lo usa para el fuzzy match.
 */
export async function listUnitRefs(): Promise<UnitOption[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select("id, code, name, marketplace_title")
    .eq("organization_id", organization.id)
    .filter(...scopeFilter(ownerScope, "id"))
    .eq("active", true)
    .order("code");
  if (error) throw new Error(error.message);
  return (data as UnitOption[]) ?? [];
}

// Campos que el form de reserva (booking-form-dialog) realmente consume:
// pricing + modo por defecto. Estructuralmente compatible con su
// `UnitForBookingForm` local.
export type UnitForBookingForm = Pick<
  Unit,
  | "id"
  | "code"
  | "name"
  | "default_commission_pct"
  | "base_price"
  | "base_price_currency"
  | "monthly_price"
  | "cleaning_fee"
  | "default_mode"
> & {
  /**
   * % acordado con el propietario que absorbe los cargos de esta unidad, si
   * tiene uno propio. El form lo necesita para calcular la comisión con la
   * misma cascada que la liquidación (migración 059).
   */
  owner_commission_pct_override?: number | null;
};

/**
 * Unidades activas con los campos que necesita el form de reserva (crear/editar)
 * en 1 query. Reemplaza a `listUnitsEnriched` (4 queries + lookups de owner/
 * booking/ticket) en /dashboard/reservas y reservas/[id], que sólo lo usaban
 * para alimentar el form (y un map id/code/name).
 */
export async function listUnitsForBookingForm(): Promise<UnitForBookingForm[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select(
      "id, code, name, default_commission_pct, base_price, base_price_currency, monthly_price, cleaning_fee, default_mode, unit_owners(owner_id, ownership_pct, is_primary, commission_pct_override)",
    )
    .eq("organization_id", organization.id)
    .filter(...scopeFilter(ownerScope, "id"))
    .eq("active", true)
    .order("position")
    .order("code");
  if (error) throw new Error(error.message);

  // El % acordado con el propietario que absorbe los cargos. Viaja con la
  // unidad para que el formulario de reserva calcule la comisión igual que la
  // liquidación (misma cascada: propietario → canal → unidad → org).
  type OwnerRow = UnitOwnerLite & { commission_pct_override: number | null };
  return ((data ?? []) as Array<
    UnitForBookingForm & { unit_owners?: OwnerRow[] | null }
  >).map(({ unit_owners, ...u }) => {
    const owners = unit_owners ?? [];
    const chargeOwnerId = pickChargeOwner(owners);
    const override =
      owners.find((o) => o.owner_id === chargeOwnerId)?.commission_pct_override ?? null;
    return { ...u, owner_commission_pct_override: override };
  });
}

export async function getUnit(id: string) {
  const { organization } = await getCurrentOrg();
  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select(`*, unit_owners(id, ownership_pct, is_primary, commission_pct_override, owner:owners(*))`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .filter(...scopeFilter(ownerScope, "id"))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Última renta mensual cargada en una unidad: la sugerencia del precio por mes. */
export type UnitRentSuggestion = {
  amount: number;
  currency: string;
  /** Desde cuándo rige esa renta: el check-in de la reserva. */
  check_in_date: string;
};

export type UnitRentSuggestionResult =
  | { ok: true; suggestion: UnitRentSuggestion | null }
  | { ok: false; error: string };

/** Rentas que se miran antes de rendirse: las más recientes, por si alguna es basura. */
const RENTAS_A_REVISAR = 5;

/**
 * Piso de una renta creíble por moneda, además del precio por noche. Hace
 * falta aparte porque muchas mensuales no tienen noche cargada, y en pesos una
 * renta de tres o cuatro cifras no existe (la mediana real ronda 600.000): hay
 * una unidad con cinco reservas seguidas a "ARS 550", casi seguro dólares
 * cargados en la moneda equivocada. En otras monedas, 100.
 */
const RENTA_MINIMA_POR_MONEDA: Record<string, number> = { ARS: 10_000 };
const RENTA_MINIMA_OTRA_MONEDA = 100;

/**
 * Sugerencia para el precio por mes de una unidad mensual o mixta que todavía
 * no lo tiene: la renta de su última reserva mensual. La 066 no hizo backfill
 * a propósito — las rentas cargadas son ruidosas (hay reservas con 550 ARS de
 * renta) —, así que el formulario la ofrece y una persona la confirma.
 *
 * Una renta tiene que ser creíble para sugerirse: un mes nunca cuesta menos
 * que una noche (`base_price`, que en las mensuales sigue en la base) ni menos
 * que el piso de su moneda. Y va en la moneda de la unidad: una renta en USD
 * no dice nada de un precio en ARS.
 *
 * Son montos de contratos: sólo los ve quien puede editar la unidad. Nunca
 * lanza — es una ayuda del formulario y, si algo falla, el campo queda vacío
 * como siempre.
 */
export async function getUnitRentSuggestion(unitId: string): Promise<UnitRentSuggestionResult> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) return { ok: true, suggestion: null };
  if (!unitId) return { ok: false, error: "No encontramos la unidad." };
  // Hoy ningún rol con alcance de propietario edita unidades; si eso cambia,
  // igual no lee rentas de unidades ajenas.
  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();

  const { data: unit, error: unitError } = await admin
    .from("units")
    .select("id, base_price, base_price_currency")
    .eq("id", unitId)
    .eq("organization_id", organization.id)
    .filter(...scopeFilter(ownerScope, "id"))
    .maybeSingle();
  if (unitError) {
    logActionError("getUnitRentSuggestion:unit", unitError);
    return { ok: false, error: "No se pudo leer la unidad." };
  }
  if (!unit) return { ok: false, error: "No encontramos la unidad." };

  const currency = (unit.base_price_currency as string | null) || "ARS";
  // PostgREST puede devolver el numeric como string.
  const noche = Number(unit.base_price);
  const piso = Math.max(
    RENTA_MINIMA_POR_MONEDA[currency] ?? RENTA_MINIMA_OTRA_MONEDA,
    Number.isFinite(noche) && noche > 0 ? noche : 0,
  );

  const { data: rentas, error } = await admin
    .from("bookings")
    .select("monthly_rent, check_in_date")
    .eq("organization_id", organization.id)
    .eq("unit_id", unit.id)
    .eq("mode", "mensual")
    .eq("currency", currency)
    .not("status", "in", "(cancelada,no_show)")
    .gt("monthly_rent", 0)
    .order("check_in_date", { ascending: false })
    .limit(RENTAS_A_REVISAR);
  if (error) {
    logActionError("getUnitRentSuggestion:bookings", error);
    return { ok: false, error: "No se pudo leer la última renta." };
  }

  const creible = (rentas ?? [])
    .map((r) => ({ amount: Number(r.monthly_rent), check_in_date: r.check_in_date as string }))
    .find((r) => Number.isFinite(r.amount) && r.amount >= piso);
  return {
    ok: true,
    suggestion: creible ? { ...creible, currency } : null,
  };
}

/**
 * Resultado de alta/edición de unidad.
 *
 * Devuelve el error en vez de lanzarlo a propósito: Next.js reemplaza el
 * mensaje de cualquier excepción de una Server Action en producción por
 * "An error occurred in the Server Components render…", así que un `throw`
 * con texto en castellano llega al usuario como un error en inglés que no
 * dice nada. Pasó de verdad: dos departamentos del mismo edificio con el
 * mismo código, y la pantalla sólo mostraba ese cartel rojo.
 */
export type UnitMutationResult =
  | { ok: true; unit: Unit }
  | { ok: false; error: string; field?: UnitFormField };

/** Campos del formulario que pueden recibir un error del servidor en línea. */
export type UnitFormField = "code" | "monthly_price";

type ValidatedUnit = z.infer<typeof unitSchema>;

/**
 * Valida sin lanzar: un `parse` que falla es una excepción, y en producción
 * Next.js la muestra como un cartel en inglés sin el motivo.
 */
function validarUnidad(
  input: UnitInput,
): { ok: true; data: ValidatedUnit } | { ok: false; error: string; field?: UnitFormField } {
  const r = unitSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  const campo = issue?.path[0];
  return {
    ok: false,
    // Un dato del tipo equivocado ("abc" donde va un número) no tiene mensaje
    // propio: el de zod está en inglés.
    error:
      !issue || issue.code === "invalid_type"
        ? "Hay un dato que no es válido. Revisá el formulario."
        : issue.message,
    field: campo === "code" || campo === "monthly_price" ? campo : undefined,
  };
}

/**
 * El precio mensual es de las mensuales y las mixtas (migraciones 063 y 066).
 * Si la vocación cambió a temporario se borra acá, en el servidor, para que
 * ningún lector muestre el precio de un mes de una unidad que ya no se
 * alquila así. (Si el pedido no trae el campo, queda `undefined`: supabase-js
 * no lo manda y lo guardado no se toca.)
 */
function conPrecioMensual(v: ValidatedUnit): ValidatedUnit {
  return unitPriceKinds(v.default_mode).monthly ? v : { ...v, monthly_price: null };
}

/** Traduce los choques esperables contra la base: código repetido y precio por mes en 0. */
function traducirErrorDeUnidad(
  message: string,
): { error: string; field?: UnitFormField } | null {
  if (message.includes("units_organization_id_code_key")) {
    return {
      error: "Ese código ya lo usa otra unidad. Elegí uno distinto.",
      field: "code",
    };
  }
  if (message.includes("units_monthly_price_positive")) {
    return {
      error: "El precio por mes tiene que ser mayor a 0. Si no lo querés cargar, dejalo vacío.",
      field: "monthly_price",
    };
  }
  return null;
}

/** Unidad (activa o archivada) que ya ocupa ese código dentro de la org. */
async function unidadConEseCodigo(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  code: string,
  exceptId?: string,
): Promise<{ id: string; code: string; name: string; active: boolean } | null> {
  let q = admin
    .from("units")
    .select("id, code, name, active")
    .eq("organization_id", organizationId)
    .eq("code", code)
    .limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.maybeSingle();
  return (data as { id: string; code: string; name: string; active: boolean } | null) ?? null;
}

/** "Ese código ya lo usa Alto Tucumán 7B" — con nombre, para que se entienda. */
function mensajeCodigoOcupado(otra: { name: string; active: boolean }): string {
  return otra.active
    ? `El código ya lo usa "${otra.name}". Poné uno distinto (por ejemplo AT-4 o AT-71).`
    : `El código ya lo usa "${otra.name}", una unidad archivada. Poné uno distinto (por ejemplo AT-4 o AT-71).`;
}

export async function createUnit(input: UnitInput): Promise<UnitMutationResult> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // La UI ya esconde el alta a quien sólo ve unidades; esto es el borde real
  // (las actions usan service_role, así que la base no frena nada).
  if (!can(role, "units", "create")) {
    return { ok: false, error: "No tenés permiso para crear unidades." };
  }
  const parsed = validarUnidad(input);
  if (!parsed.ok) return parsed;
  const validated = conPrecioMensual(parsed.data);
  const admin = createAdminClient();

  // El código es único por organización y la unicidad incluye a las unidades
  // archivadas (active=false), que no se ven en ningún listado. Sin este
  // chequeo previo el choque sale como error de Postgres y el usuario no tiene
  // forma de saber contra qué chocó.
  const ocupado = await unidadConEseCodigo(admin, organization.id, validated.code);
  if (ocupado) {
    return { ok: false, error: mensajeCodigoOcupado(ocupado), field: "code" };
  }

  // Posición = última + 1 dentro de su columna
  const { data: maxRow } = await admin
    .from("units")
    .select("position")
    .eq("organization_id", organization.id)
    .eq("status", validated.status)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = (maxRow?.position ?? -1) + 1;

  const { data, error } = await admin
    .from("units")
    .insert({
      ...validated,
      // Cascada de la comisión de administración: lo que se cargó en el form →
      // el default de la org → 20. La unidad guarda SIEMPRE un número concreto,
      // así cambiar el default de la org después no altera lo ya liquidado.
      default_commission_pct:
        validated.default_commission_pct ?? organization.default_commission_pct ?? 20,
      organization_id: organization.id,
      position: newPosition,
    })
    .select()
    .single();
  if (error) {
    // Carrera: dos pestañas guardando el mismo código a la vez.
    const traducido = traducirErrorDeUnidad(error.message);
    if (traducido) return { ok: false, ...traducido };
    logActionError("createUnit", error);
    return { ok: false, error: "No se pudo crear la unidad. Probá de nuevo." };
  }

  revalidatePath("/dashboard/unidades");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  return { ok: true, unit: data as Unit };
}

export async function updateUnit(id: string, input: UnitInput): Promise<UnitMutationResult> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) {
    return { ok: false, error: "No tenés permiso para editar unidades." };
  }
  const parsed = validarUnidad(input);
  if (!parsed.ok) return parsed;
  const validated = conPrecioMensual(parsed.data);
  const admin = createAdminClient();

  const ocupado = await unidadConEseCodigo(admin, organization.id, validated.code, id);
  if (ocupado) {
    return { ok: false, error: mensajeCodigoOcupado(ocupado), field: "code" };
  }

  const { data, error } = await admin
    .from("units")
    .update(validated)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) {
    const traducido = traducirErrorDeUnidad(error.message);
    if (traducido) return { ok: false, ...traducido };
    logActionError("updateUnit", error);
    return { ok: false, error: "No se pudieron guardar los cambios. Probá de nuevo." };
  }

  revalidatePath("/dashboard/unidades");
  revalidatePath(`/dashboard/unidades/${id}`);
  revalidatePath(`/dashboard/unidades/${id}/precios`);
  revalidatePath(`/dashboard/unidades/${id}/marketplace`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  // El formulario de reserva lee los precios de la unidad (el mensual completa
  // la Renta de una reserva mensual).
  revalidatePath("/dashboard/reservas", "layout"); // incluye /reservas/[id]
  revalidatePath("/dashboard");
  // El precio por noche también se ve en la web pública (el mensual todavía
  // no: por ahora es sólo del panel).
  const actualizada = data as Unit;
  if (actualizada.marketplace_published) {
    // Catálogo cacheado de la vidriera (precios, nombre, barrio, capacidad).
    revalidateStorefront();
    revalidatePath("/");
    revalidatePath("/buscar");
    if (actualizada.slug) revalidatePath(`/u/${actualizada.slug}`);
  }
  return { ok: true, unit: actualizada };
}

/** Una reserva que todavía ocupa la unidad y frena el borrado. */
export interface ArchiveBlockingBooking {
  id: string;
  status: BookingStatus;
  source: BookingSource | null;
  is_block: boolean;
  check_in_date: string;
  check_out_date: string;
  guest_name: string | null;
}

/** Una conexión con Airbnb/Booking que sigue sincronizando la unidad. */
export interface ArchiveBlockingLink {
  id: string;
  channel: "airbnb" | "booking";
}

export type ArchiveUnitResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** Qué hay que resolver antes de borrar; ausente si el problema fue otro. */
      blockers?: {
        bookings: ArchiveBlockingBooking[];
        /** Total real: `bookings` trae como mucho las primeras ARCHIVE_BLOCKERS_LISTED. */
        bookingsTotal: number;
        links: ArchiveBlockingLink[];
      };
    };

const ARCHIVE_BLOCKERS_LISTED = 5;

/**
 * "Borrar" unidad = soft delete. La marcamos como `active=false` para que
 * desaparezca del listado pero se conserve la historia de reservas, tickets y
 * liquidaciones que la referencian (FK).
 *
 * Devuelve el motivo en vez de lanzarlo: en producción un `throw` llegaba como
 * el cartel en inglés de Next.js y nadie se enteraba de qué frenaba el borrado
 * (TREJO1, 15/09/2026). Se niega mientras haya:
 *
 *  - reservas que todavía ocupan la unidad: los mismos estados que cuenta
 *    `bookings_no_overlap` (pendiente, confirmada, check_in) con salida de hoy
 *    en adelante. Una estadía en `check_out` ya terminó aunque su fecha de
 *    salida sea futura (un "uso propietario" cargado hasta fin de año y cerrado
 *    antes): no hay nada que cancelar, y contarla dejaba la unidad imposible
 *    de borrar.
 *  - conexiones activas con canales: el dispatcher reclama links por
 *    `channel_links.status` sin mirar `units.active`, así que una unidad
 *    archivada seguiría recibiendo reservas que no aparecen en ningún listado.
 */
export async function archiveUnit(id: string): Promise<ArchiveUnitResult> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "delete")) {
    return { ok: false, error: "Solo un administrador puede eliminar unidades." };
  }
  const admin = createAdminClient();

  const today = todayYmdInTz(organization.timezone || DEFAULT_ORG_TIMEZONE);
  const [bookingsRes, linksRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id, status, source, is_block, check_in_date, check_out_date, guest:guests(full_name)",
        { count: "exact" },
      )
      .eq("unit_id", id)
      .eq("organization_id", organization.id)
      .gte("check_out_date", today)
      .in("status", ["pendiente", "confirmada", "check_in"])
      .order("check_in_date")
      .limit(ARCHIVE_BLOCKERS_LISTED),
    admin
      .from("channel_links")
      .select("id, channel")
      .eq("unit_id", id)
      .eq("organization_id", organization.id)
      .eq("status", "active")
      .order("channel"),
  ]);
  if (bookingsRes.error || linksRes.error) {
    logActionError("archiveUnit:blockers", bookingsRes.error ?? linksRes.error);
    return { ok: false, error: "No se pudo revisar la unidad. Probá de nuevo." };
  }

  type BookingRow = Omit<ArchiveBlockingBooking, "guest_name"> & {
    guest: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const bookings = ((bookingsRes.data ?? []) as BookingRow[]).map(({ guest, ...b }) => ({
    ...b,
    guest_name: (Array.isArray(guest) ? guest[0] : guest)?.full_name?.trim() || null,
  }));
  const bookingsTotal = bookingsRes.count ?? bookings.length;
  const links = (linksRes.data ?? []) as ArchiveBlockingLink[];

  if (bookingsTotal > 0 || links.length > 0) {
    const motivos: string[] = [];
    if (bookingsTotal > 0) {
      motivos.push(
        bookingsTotal === 1
          ? "tiene 1 reserva activa o futura"
          : `tiene ${bookingsTotal} reservas activas o futuras`,
      );
    }
    if (links.length > 0) {
      motivos.push(
        `sigue conectada a ${links.map((l) => BOOKING_SOURCE_META[l.channel].label).join(" y ")}`,
      );
    }
    return {
      ok: false,
      error: `No se puede eliminar todavía: ${motivos.join(" y ")}.`,
      blockers: { bookings, bookingsTotal, links },
    };
  }

  const { data: archived, error } = await admin
    .from("units")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select("id, slug, marketplace_published");
  if (error) {
    logActionError("archiveUnit", error);
    return { ok: false, error: "No se pudo eliminar la unidad. Probá de nuevo." };
  }
  if (!archived || archived.length === 0) {
    return { ok: false, error: "No encontramos la unidad. Recargá la página." };
  }

  revalidatePath("/dashboard/unidades");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  // La vidriera sólo muestra unidades activas: si estaba publicada, que salga
  // ya de la web (catálogo cacheado + home, búsqueda y su ficha).
  const unit = archived[0] as { slug: string | null; marketplace_published: boolean | null };
  if (unit.marketplace_published) {
    revalidateStorefront();
    revalidatePath("/");
    revalidatePath("/buscar");
    if (unit.slug) revalidatePath(`/u/${unit.slug}`);
  }
  return { ok: true };
}

/**
 * Cambia el status de una unidad (lo dispara el drag&drop del Kanban).
 * Registra automáticamente en unit_status_history vía trigger.
 */
export async function changeUnitStatus(
  unitId: string,
  newStatus: UnitStatus,
  reason: string = "Drag & drop"
): Promise<void> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Lanza y no devuelve: el contrato es void y quien la llama ya maneja la
  // excepción. Es un borde de seguridad — la UI no ofrece esto a quien no
  // edita unidades —, no un error que alguien tenga que leer.
  if (!can(role, "units", "update")) throw new Error("No tenés permiso para editar unidades.");
  const admin = createAdminClient();

  // Posición al final de la nueva columna
  const { data: maxRow } = await admin
    .from("units")
    .select("position")
    .eq("organization_id", organization.id)
    .eq("status", newStatus)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = (maxRow?.position ?? -1) + 1;

  const { error } = await admin
    .from("units")
    .update({
      status: newStatus,
      status_changed_by: session.userId,
      position: newPosition,
    })
    .eq("id", unitId)
    .eq("organization_id", organization.id);

  if (error) throw new Error(error.message);

  // Loguear motivo en history (el trigger ya creó la fila básica)
  if (reason) {
    await admin
      .from("unit_status_history")
      .update({ reason })
      .eq("unit_id", unitId)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/unidades");
}

export async function reorderUnits(
  status: UnitStatus,
  orderedIds: string[]
): Promise<void> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) throw new Error("No tenés permiso para editar unidades.");
  const admin = createAdminClient();

  // Update en lote — para 60 units es trivial
  await Promise.all(
    orderedIds.map((id, idx) =>
      admin
        .from("units")
        .update({ position: idx })
        .eq("id", id)
        .eq("organization_id", organization.id)
        .eq("status", status)
    )
  );

  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
}

/**
 * Reordena globalmente todas las unidades (vista Unidades).
 * Asigna position = índice en el array, ignorando status.
 */
export async function reorderUnitsGlobal(orderedIds: string[]): Promise<void> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // El orden es de toda la org (lo ven todos en el Calendario): es editar.
  if (!can(role, "units", "update")) throw new Error("No tenés permiso para editar unidades.");
  const admin = createAdminClient();

  await Promise.all(
    orderedIds.map((id, idx) =>
      admin
        .from("units")
        .update({ position: idx })
        .eq("id", id)
        .eq("organization_id", organization.id)
    )
  );

  revalidatePath("/dashboard/unidades");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
}

export async function linkOwnerToUnit(
  unitId: string,
  ownerId: string,
  ownership_pct: number,
  is_primary: boolean = false,
  commission_pct_override: number | null = null
) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) throw new Error("No tenés permiso para editar unidades.");
  const admin = createAdminClient();

  // El vínculo no tiene organization_id propio: la unidad y el propietario
  // tienen que ser de la org activa (antes un id ajeno pasaba derecho).
  const [{ data: unit }, { data: owner }] = await Promise.all([
    admin
      .from("units")
      .select("id")
      .eq("id", unitId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin
      .from("owners")
      .select("id")
      .eq("id", ownerId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
  ]);
  if (!unit) throw new Error("Unidad no encontrada");
  if (!owner) throw new Error("Propietario no encontrado");

  if (is_primary) {
    // Asegurar que no haya otro primario
    await admin.from("unit_owners").update({ is_primary: false }).eq("unit_id", unitId);
  }

  const { error } = await admin.from("unit_owners").insert({
    unit_id: unitId,
    owner_id: ownerId,
    ownership_pct,
    is_primary,
    commission_pct_override,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/unidades/${unitId}`);
}

/**
 * Cambia la comisión de administración pactada con UN propietario dentro de una
 * unidad. `null` = vuelve a usar la de la unidad.
 *
 * Es el único nivel de excepción que existe: junto con `units.default_commission_pct`
 * son los dos valores que lee `buildSettlementLines` al generar la liquidación.
 * Antes solo se podía fijar al vincular al propietario y nunca más; con tres
 * condiciones distintas por dueño eso obligaba a desvincular y volver a vincular.
 */
export async function updateUnitOwnerCommission(
  unitOwnerId: string,
  unitId: string,
  commission_pct_override: number | null
) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) {
    throw new Error("No tenés permiso para cambiar la comisión");
  }
  const validated = z
    .number()
    .min(0, "La comisión no puede ser negativa")
    .max(100, "La comisión no puede pasar de 100%")
    .nullable()
    .parse(commission_pct_override);

  const admin = createAdminClient();

  // El vínculo no tiene organization_id propio: lo acotamos por la unidad.
  const { data: unit } = await admin
    .from("units")
    .select("id")
    .eq("id", unitId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!unit) throw new Error("Unidad no encontrada");

  const { data: updated, error } = await admin
    .from("unit_owners")
    .update({ commission_pct_override: validated })
    .eq("id", unitOwnerId)
    .eq("unit_id", unitId)
    .select("owner_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("No encontramos ese propietario en la unidad");

  revalidatePath(`/dashboard/unidades/${unitId}`);
  revalidatePath(`/dashboard/propietarios/${updated.owner_id}`);
  revalidatePath("/dashboard/propietarios");
}

export async function unlinkOwnerFromUnit(unitOwnerId: string, unitId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "units", "update")) throw new Error("No tenés permiso para editar unidades.");
  const admin = createAdminClient();

  // Mismo acote que updateUnitOwnerCommission: la unidad es de la org activa y
  // el vínculo es de esa unidad (antes se borraba por id, de cualquier org).
  const { data: unit } = await admin
    .from("units")
    .select("id")
    .eq("id", unitId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!unit) throw new Error("Unidad no encontrada");

  const { error } = await admin
    .from("unit_owners")
    .delete()
    .eq("id", unitOwnerId)
    .eq("unit_id", unitId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/unidades/${unitId}`);
}
