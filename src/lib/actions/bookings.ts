"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can, isAdminLevel } from "@/lib/permissions";
import { pickChargeOwner, type UnitOwnerLite } from "@/lib/settlements/charge-owner";
import {
  MAX_BOOKING_NIGHTS,
  nightsBetween,
  splitBookingSegments,
} from "@/lib/booking-split";
import type {
  Booking,
  BookingExtension,
  BookingListRow,
  BookingSearchResult,
  BookingWithRelations,
  BookingStatus,
  CashMovement,
} from "@/lib/types/database";
import { sendGuestMail } from "@/lib/email/guest";
import { plainTextToHtml } from "@/lib/email/render";
import { buildBookingContext, buildOwnerConfirmationDraft } from "@/lib/email/booking-templates";

// Defensa contra fechas con años absurdos (ej. "0004-05-08" tipeado por error
// en el form). Aceptamos sólo años entre 2020 y 2100 — más allá es claramente
// un error de tipeo y no una reserva real.
const sanitizedDate = z
  .string()
  .regex(
    /^(20[2-9]\d|2100)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "Fecha inválida"
  );

const bookingSchema = z.object({
  unit_id: z.string().uuid("Unidad requerida"),
  guest_id: z.string().uuid().optional().nullable(),
  source: z.enum([
    "directo", "airbnb", "booking", "expedia", "vrbo", "whatsapp", "instagram", "otro",
  ]).default("directo"),
  external_id: z.string().optional().nullable(),
  status: z.enum(["pendiente","confirmada","check_in","check_out","cancelada","no_show"]).default("confirmada"),
  mode: z.enum(["temporario", "mensual"]).default("temporario"),
  check_in_date: sanitizedDate,
  check_in_time: z.string().default("14:00"),
  check_out_date: sanitizedDate,
  check_out_time: z.string().default("10:00"),
  guests_count: z.coerce.number().int().min(1).default(1),
  currency: z.string().default("ARS"),
  total_amount: z.coerce.number().min(0).default(0),
  paid_amount: z.coerce.number().min(0).default(0),
  commission_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  cleaning_fee: z.coerce.number().min(0).optional().nullable(),
  // Mensual — todos opcionales: la renta puede cargarse después o ajustarse
  // por cuota; el form no debe forzar al usuario a tipear un monto si todavía
  // no lo tiene definido.
  monthly_rent: z.coerce.number().min(0).optional().nullable(),
  monthly_expenses: z.coerce.number().min(0).optional().nullable(),
  security_deposit: z.coerce.number().min(0).optional().nullable(),
  monthly_inflation_adjustment_pct: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .nullable(),
  rent_billing_day: z.coerce.number().int().min(1).max(28).optional().nullable(),
  notes: z.string().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
});

export type BookingInput = z.infer<typeof bookingSchema>;

// Input extendido con account_id para imputar el cobro a una cuenta de caja.
// account_id no se persiste en bookings — sólo dispara la creación de un
// cash_movement equivalente al delta de paid_amount.
// skip_split: si true, crea una sola reserva sin dividir aunque exceda
// MAX_BOOKING_NIGHTS. El usuario lo decide vía el diálogo de confirmación.
export type BookingInputWithAccount = BookingInput & {
  account_id?: string | null;
  skip_split?: boolean;
};

// Sincroniza `paid_amount` con caja: genera un cash_movement por el delta
// (positivo = nuevo cobro, negativo = devolución). Si delta = 0 no hace nada.
async function syncBookingPaymentToCash(params: {
  bookingId: string;
  organizationId: string;
  unitId: string;
  currency: string;
  delta: number; // positivo = entrada, negativo = salida
  accountId: string | null | undefined;
}): Promise<void> {
  if (!params.delta || Math.abs(params.delta) < 0.01) return;
  if (!params.accountId) return; // sin cuenta no podemos imputar
  const admin = createAdminClient();
  // Verificar que la cuenta exista y sea de la org + moneda correcta
  const { data: account } = await admin
    .from("cash_accounts")
    .select("id, currency")
    .eq("id", params.accountId)
    .eq("organization_id", params.organizationId)
    .eq("active", true)
    .maybeSingle();
  if (!account) return;
  if (account.currency !== params.currency) {
    throw new Error(
      `La cuenta seleccionada es ${account.currency} pero la reserva es en ${params.currency}`
    );
  }
  const { error } = await admin.from("cash_movements").insert({
    organization_id: params.organizationId,
    account_id: params.accountId,
    direction: params.delta > 0 ? "in" : "out",
    amount: Math.abs(params.delta),
    currency: params.currency,
    category: params.delta > 0 ? "booking_payment" : "refund",
    ref_type: "booking",
    ref_id: params.bookingId,
    unit_id: params.unitId,
    billable_to: "owner",
    description:
      params.delta > 0
        ? `Cobro de reserva ${params.bookingId.slice(0, 8)}`
        : `Devolución de reserva ${params.bookingId.slice(0, 8)}`,
    occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Error al registrar movimiento de caja: ${error.message}`);
}

/**
 * Si una reserva existente quedó con > MAX_BOOKING_NIGHTS (típicamente porque
 * se la extendió con moveBookingTransaction o updateBooking), la "materializa"
 * en N reservas back-to-back:
 *   - La fila original se RECORTA al primer segmento (mismo id, se preserva
 *     historial de extensiones, payments, etc).
 *   - Se INSERTAN N-1 filas nuevas con los segmentos restantes.
 *   - Si ninguna estaba en un lease_group, se crea uno nuevo y todas quedan
 *     bajo el mismo grupo.
 *   - total_amount, commission_amount y cleaning_fee se prorratean igual que
 *     en createBooking (cleaning sólo en el último; paid en el primero).
 *
 * Idempotente: si la reserva ya cabe en el cap, no hace nada.
 *
 * NO maneja conflictos con otras reservas en la unidad — si el rango chocaba,
 * la operación previa (UPDATE) ya hubiera fallado por bookings_no_overlap.
 * Igual capturamos ese error al insertar nuevos segmentos por si el delta
 * agregó un solapamiento.
 */
async function enforceLeaseSplitOnExisting(params: {
  bookingId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: original, error } = await admin
    .from("bookings")
    .select("*")
    .eq("id", params.bookingId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!original) return;

  const segments = splitBookingSegments(
    original.check_in_date,
    original.check_out_date,
    MAX_BOOKING_NIGHTS
  );
  if (segments.length < 2) return; // ya cabe en el cap

  // Si la reserva NO pertenece a un lease group, fue creada intencionalmente
  // como "reserva única" (el usuario eligió no dividir). No forzamos el split.
  if (!original.lease_group_id) return;

  const totalNights = nightsBetween(
    original.check_in_date,
    original.check_out_date
  );
  const totalAmount = Number(original.total_amount) || 0;
  const commissionPctValue = Number(original.commission_pct) || 0;
  const cleaningFeeOriginal = Number(original.cleaning_fee) || 0;
  const leaseGroupId = original.lease_group_id ?? crypto.randomUUID();

  // Segmento 0: UPDATE de la fila original (recorte + prorrateo).
  const seg0 = segments[0];
  const seg0Share = totalNights > 0 ? seg0.nights / totalNights : 0;
  const seg0Amount = Math.round(totalAmount * seg0Share * 100) / 100;
  const seg0Commission =
    Math.round((seg0Amount * commissionPctValue) / 100 * 100) / 100;
  // Cleaning fee va al último segmento — la fila original deja de tenerlo
  // (salvo que originalmente ya fuera el último, lo cual no aplica acá).
  const { error: errUpd } = await admin
    .from("bookings")
    .update({
      check_out_date: seg0.to,
      check_out_time: "12:00",
      total_amount: seg0Amount,
      commission_amount: seg0Commission,
      cleaning_fee: 0,
      lease_group_id: leaseGroupId,
    })
    .eq("id", original.id)
    .eq("organization_id", params.organizationId);
  if (errUpd) {
    if (errUpd.message.includes("bookings_no_overlap")) {
      throw new Error(
        "Conflicto al recortar la reserva al primer período: ya hay otra reserva en esa unidad"
      );
    }
    throw new Error(errUpd.message);
  }

  // Segmentos 1..N-1: INSERT de filas nuevas. Si algún insert falla, hacemos
  // rollback: borramos los nuevos y restauramos check_out_date/montos en la
  // fila original.
  const inserted: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const segShare = totalNights > 0 ? seg.nights / totalNights : 0;
    const segAmount = Math.round(totalAmount * segShare * 100) / 100;
    const segCommission =
      Math.round((segAmount * commissionPctValue) / 100 * 100) / 100;
    const isLast = i === segments.length - 1;
    const segCleaningFee = isLast ? cleaningFeeOriginal : 0;

    const { data: ins, error: errIns } = await admin
      .from("bookings")
      .insert({
        organization_id: params.organizationId,
        unit_id: original.unit_id,
        guest_id: original.guest_id,
        source: original.source,
        external_id: null,
        status: original.status,
        mode: original.mode,
        check_in_date: seg.from,
        check_in_time: "12:00",
        check_out_date: seg.to,
        check_out_time: isLast ? original.check_out_time : "12:00",
        guests_count: original.guests_count,
        currency: original.currency,
        total_amount: segAmount,
        paid_amount: 0,
        commission_pct: original.commission_pct,
        commission_amount: segCommission,
        cleaning_fee: segCleaningFee,
        monthly_rent: original.monthly_rent,
        monthly_expenses: original.monthly_expenses,
        security_deposit: original.security_deposit,
        monthly_inflation_adjustment_pct:
          original.monthly_inflation_adjustment_pct,
        rent_billing_day: original.rent_billing_day,
        notes: `Período ${i + 1}/${segments.length} del contrato.`,
        internal_notes: original.internal_notes,
        lease_group_id: leaseGroupId,
        created_by: params.userId,
      })
      .select("id")
      .single();

    if (errIns) {
      // Rollback: borrar los insertados y restaurar la fila original.
      if (inserted.length > 0) {
        await admin.from("bookings").delete().in("id", inserted);
      }
      await admin
        .from("bookings")
        .update({
          check_out_date: original.check_out_date,
          check_out_time: original.check_out_time,
          total_amount: original.total_amount,
          commission_amount: original.commission_amount,
          cleaning_fee: original.cleaning_fee,
          lease_group_id: original.lease_group_id,
        })
        .eq("id", original.id)
        .eq("organization_id", params.organizationId);
      if (errIns.message.includes("bookings_no_overlap")) {
        throw new Error(
          `Conflicto al crear el período ${i + 1}/${segments.length} (${seg.from} → ${seg.to}): ya hay una reserva en esa unidad`
        );
      }
      throw new Error(errIns.message);
    }
    inserted.push(ins.id);
  }

  // Si la original era mensual, regenerar payment_schedule por cada segmento.
  if (original.mode === "mensual") {
    const allIds = [original.id, ...inserted];
    for (const id of allIds) {
      const { error: schErr } = await admin.rpc(
        "generate_payment_schedule_for_booking",
        { p_booking_id: id }
      );
      if (schErr) {
        console.error("generate_payment_schedule_for_booking failed", schErr);
      }
    }
  }
}

export async function listBookings(filters?: {
  status?: BookingStatus;
  unitId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<BookingWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  let q = admin
    .from("bookings")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`)
    .eq("organization_id", organization.id);
  if (filters?.status) q = q.eq("status", filters.status);
  if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
  if (filters?.fromDate) q = q.gte("check_in_date", filters.fromDate);
  if (filters?.toDate) q = q.lte("check_in_date", filters.toDate);
  const { data, error } = await q.order("check_in_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BookingWithRelations[]) ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// Lista paginada de /dashboard/reservas
// ════════════════════════════════════════════════════════════════════════════

/**
 * Versión paginada + buscable de la lista de reservas. La usa SOLO
 * /dashboard/reservas — `listBookings` queda intacta para los callers que
 * necesitan el historial completo (ej. reservas/[id] lista todo el historial
 * de la unidad con `listBookings({ unitId })`).
 *
 * Decisiones:
 *   • Ventana por defecto: check-ins desde hace `windowDays` (90) + todo el
 *     futuro. Acota el payload de la lista (que crecía sin tope) y evita el
 *     acantilado del cap de 1.000 filas de PostgREST. Solo afecta a ESTA
 *     función — `listBookings` (que usa reservas/[id]) no tiene ventana. Al
 *     buscar (`q`), la ventana se desactiva para encontrar reservas viejas en
 *     todo el historial. `fromDate`/`windowDays: 0` la sobreescriben.
 *   • `q` busca server-side con el mismo patrón que searchBookingsGlobal:
 *     primero guest_ids / unit_ids por ilike (índice trigram en guests),
 *     después bookings por esos ids + external_id. Así sigue encontrando
 *     huéspedes viejos aunque la page ventanee la lista por fecha.
 *   • `total` = count del filtro actual (alimenta el paginador).
 *   • `totalAll` = count histórico real SIN ventana ni filtros (header
 *     "{N} reservas registradas").
 */
export async function listBookingsPaged(params?: {
  page?: number; // 0-based, igual que listAccountMovements en cash.ts
  pageSize?: number;
  q?: string;
  status?: BookingStatus;
  fromDate?: string; // check_in_date >= fromDate (override explícito de la ventana)
  windowDays?: number; // default 90; 0 = sin ventana
}): Promise<{
  rows: BookingListRow[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  const page = Math.max(0, params?.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 50));
  if (!can(role, "bookings", "view")) {
    return { rows: [], total: 0, totalAll: 0, page, pageSize };
  }
  const admin = createAdminClient();

  // Ventana por defecto resuelta acá (server action → Date.now() es puro por
  // request, sin las restricciones de pureza del render). Al buscar no se
  // aplica para no perder reservas viejas.
  const qActive = (params?.q?.trim().length ?? 0) > 0;
  const windowDays = params?.windowDays ?? 90;
  const fromDate =
    params?.fromDate ??
    (qActive || windowDays <= 0
      ? undefined
      : new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10));

  // Resolver la búsqueda ANTES de armar la query principal. Sanitizamos
  // `,()*` para no romper el parser de `.or()` de PostgREST (ver
  // searchBookingsGlobal).
  const qText = params?.q?.trim() ?? "";
  let searchOr: string | null = null;
  if (qText.length > 0) {
    const like = `%${qText.replace(/[,()*]/g, " ")}%`;
    const [guestRes, unitRes] = await Promise.all([
      admin
        .from("guests")
        .select("id")
        .eq("organization_id", organization.id)
        .or(
          `full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},document_number.ilike.${like}`
        )
        .limit(100),
      admin
        .from("units")
        .select("id")
        .eq("organization_id", organization.id)
        .or(`code.ilike.${like},name.ilike.${like}`)
        .limit(50),
    ]);
    const parts = [`external_id.ilike.${like}`];
    const guestIds = (guestRes.data ?? []).map((r) => r.id as string);
    const unitIds = (unitRes.data ?? []).map((r) => r.id as string);
    if (guestIds.length > 0) parts.push(`guest_id.in.(${guestIds.join(",")})`);
    if (unitIds.length > 0) parts.push(`unit_id.in.(${unitIds.join(",")})`);
    searchOr = parts.join(",");
  }

  let listQ = admin
    .from("bookings")
    .select(
      `id, status, source, check_in_date, check_out_date, guests_count, currency, total_amount, paid_amount,
      unit:units(id, code, name), guest:guests(id, full_name)`,
      { count: "exact" }
    )
    .eq("organization_id", organization.id)
    .eq("is_block", false); // los bloqueos OTA no son reservas
  if (params?.status) listQ = listQ.eq("status", params.status);
  if (fromDate) listQ = listQ.gte("check_in_date", fromDate);
  if (searchOr) listQ = listQ.or(searchOr);

  const fromRow = page * pageSize;
  const [listRes, countRes] = await Promise.all([
    listQ
      .order("check_in_date", { ascending: false })
      .range(fromRow, fromRow + pageSize - 1),
    admin
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("is_block", false),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);

  return {
    rows: (listRes.data as unknown as BookingListRow[]) ?? [],
    total: listRes.count ?? 0,
    totalAll: countRes.count ?? 0,
    page,
    pageSize,
  };
}

/**
 * Dataset liviano para el pre-check de solape del form de reserva: reservas
 * vigentes o futuras (check_out >= hoy), excluyendo canceladas/no_show. El
 * form necesita TODAS las futuras (hay check-ins a años vista), no la página
 * visible de la lista. La garantía dura contra double-booking sigue siendo
 * el constraint `bookings_no_overlap` en la DB.
 */
export async function listBookingsForOverlapCheck(): Promise<
  Pick<Booking, "id" | "unit_id" | "status" | "check_in_date" | "check_out_date">[]
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("bookings")
    .select("id, unit_id, status, check_in_date, check_out_date")
    .eq("organization_id", organization.id)
    .gte("check_out_date", today)
    .not("status", "in", "(cancelada,no_show)")
    .order("check_in_date");
  if (error) throw new Error(error.message);
  return (
    (data as Pick<
      Booking,
      "id" | "unit_id" | "status" | "check_in_date" | "check_out_date"
    >[]) ?? []
  );
}

/**
 * Bookings que *se solapan* con el rango [fromDate, toDate).
 * Útil para el PMS grid: incluye reservas que arrancan antes del rango pero
 * siguen activas dentro del mismo.
 */
export async function listBookingsInRange(
  fromDate: string,
  toDate: string
): Promise<BookingWithRelations[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`)
    .eq("organization_id", organization.id)
    .not("status", "in", "(cancelada,no_show)")
    .lt("check_in_date", toDate)
    .gt("check_out_date", fromDate)
    .order("check_in_date");
  if (error) throw new Error(error.message);
  return (data as BookingWithRelations[]) ?? [];
}

/**
 * Búsqueda global de reservas SIN restricción de fecha. Alimenta el
 * autocomplete del PMS Grid (`Buscar huésped, unidad…`) — necesario porque el
 * grid sólo carga una ventana de ~90 días en memoria y el filtro client-side
 * no encuentra reservas fuera de ese rango.
 *
 * Busca en paralelo por:
 *   - guest (full_name / email / phone / document_number) → aprovecha el
 *     índice gin_trgm `idx_guests_search`.
 *   - unit (code / name) → ilike sobre la tabla units.
 *   - bookings.external_id → match directo de IDs de Airbnb / Booking.
 *
 * Devuelve top N ordenado por check_in_date DESC (próximas / recientes
 * primero). Excluye canceladas y no_show.
 */
export async function searchBookingsGlobal(
  query: string,
  limit: number = 20,
): Promise<BookingSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return [];

  const admin = createAdminClient();
  // PostgREST escapa los `,` y `(` dentro de un `.or()`. Para `ilike`
  // alcanzan los `%`. Sanitizamos `,()` por las dudas — un nombre con coma
  // no es común y no querés que rompa el parser del filtro.
  const safe = q.replace(/[,()*]/g, " ");
  const like = `%${safe}%`;
  const cap = Math.max(1, Math.min(50, limit));
  const bookingSelect = `id, check_in_date, check_out_date, status, source, external_id,
    unit:units(id, code, name),
    guest:guests(id, full_name, phone, email)`;

  // 1) Match por huésped → traemos guest_ids y después las reservas. Pasamos
  //    por la tabla guests para usar el índice trigram (ilike directo sobre
  //    joins anidados no usa el índice eficientemente en PostgREST).
  const guestMatch = admin
    .from("guests")
    .select("id")
    .eq("organization_id", organization.id)
    .or(
      `full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},document_number.ilike.${like}`,
    )
    .limit(100);

  // 2) Match por unidad → traemos unit_ids.
  const unitMatch = admin
    .from("units")
    .select("id")
    .eq("organization_id", organization.id)
    .or(`code.ilike.${like},name.ilike.${like}`)
    .limit(50);

  // 3) Match por external_id (Airbnb / Booking confirmation codes).
  const externalMatch = admin
    .from("bookings")
    .select(bookingSelect)
    .eq("organization_id", organization.id)
    .not("status", "in", "(cancelada,no_show)")
    .ilike("external_id", like)
    .order("check_in_date", { ascending: false })
    .limit(cap);

  const [guestRes, unitRes, externalRes] = await Promise.all([
    guestMatch,
    unitMatch,
    externalMatch,
  ]);

  const guestIds = (guestRes.data ?? []).map((r) => r.id as string);
  const unitIds = (unitRes.data ?? []).map((r) => r.id as string);

  // 4) Reservas de los huéspedes y unidades matcheadas (en paralelo).
  type RawRow = {
    id: string;
    check_in_date: string;
    check_out_date: string;
    status: BookingStatus;
    source: BookingSearchResult["source"];
    external_id: string | null;
    unit: BookingSearchResult["unit"];
    guest: BookingSearchResult["guest"];
  };

  const guestBookings =
    guestIds.length > 0
      ? admin
          .from("bookings")
          .select(bookingSelect)
          .eq("organization_id", organization.id)
          .not("status", "in", "(cancelada,no_show)")
          .in("guest_id", guestIds)
          .order("check_in_date", { ascending: false })
          .limit(cap)
      : Promise.resolve({ data: [] as RawRow[], error: null });
  const unitBookings =
    unitIds.length > 0
      ? admin
          .from("bookings")
          .select(bookingSelect)
          .eq("organization_id", organization.id)
          .not("status", "in", "(cancelada,no_show)")
          .in("unit_id", unitIds)
          .order("check_in_date", { ascending: false })
          .limit(cap)
      : Promise.resolve({ data: [] as RawRow[], error: null });

  const [guestBookingsRes, unitBookingsRes] = await Promise.all([
    guestBookings,
    unitBookings,
  ]);

  // Merge + dedupe. Priorizamos "external" > "guest" > "unit" para
  // setear `match_field` — el bookings tagueado por external_id es lo más
  // específico, y un huésped pesa más que la unidad para guiar al usuario.
  const out = new Map<string, BookingSearchResult>();
  const push = (
    rows: unknown[] | null | undefined,
    field: BookingSearchResult["match_field"],
  ) => {
    (rows as RawRow[] | null | undefined)?.forEach((r) => {
      if (!out.has(r.id)) {
        out.set(r.id, {
          id: r.id,
          check_in_date: r.check_in_date,
          check_out_date: r.check_out_date,
          status: r.status,
          source: r.source,
          external_id: r.external_id,
          unit: r.unit,
          guest: r.guest,
          match_field: field,
        });
      }
    });
  };
  push(externalRes.data as unknown as unknown[], "external");
  push(guestBookingsRes.data as unknown as unknown[], "guest");
  push(unitBookingsRes.data as unknown as unknown[], "unit");

  return Array.from(out.values())
    .sort((a, b) => b.check_in_date.localeCompare(a.check_in_date))
    .slice(0, cap);
}

/**
 * Devuelve un mapa unit_id → ocupación actual (si la hay).
 * "Actual" = today está dentro de [check_in_date, check_out_date) y la reserva
 * NO está cancelada / no_show. Útil para mostrar "Ocupado por X" en formularios
 * que necesitan coordinar visitas con el huésped/inquilino (ej. mantenimiento).
 */
export type CurrentOccupancy = {
  guest_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  mode: "temporario" | "mensual";
  check_in_date: string;
  check_out_date: string;
  status: BookingStatus;
};

export async function listCurrentOccupancyByUnit(): Promise<
  Record<string, CurrentOccupancy>
> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("bookings")
    .select(
      "unit_id, mode, status, check_in_date, check_out_date, guest:guests(id, full_name, phone)"
    )
    .eq("organization_id", organization.id)
    .lte("check_in_date", today)
    .gt("check_out_date", today)
    .in("status", ["confirmada", "check_in"])
    .order("check_in_date", { ascending: false });
  if (error) throw new Error(error.message);

  const map: Record<string, CurrentOccupancy> = {};
  (data ?? []).forEach((b) => {
    if (map[b.unit_id]) return;
    const g = b.guest as unknown as {
      id?: string;
      full_name?: string | null;
      phone?: string | null;
    } | null;
    map[b.unit_id] = {
      guest_id: g?.id ?? null,
      guest_name: g?.full_name ?? null,
      guest_phone: g?.phone ?? null,
      mode: b.mode as "temporario" | "mensual",
      check_in_date: b.check_in_date,
      check_out_date: b.check_out_date,
      status: b.status as BookingStatus,
    };
  });
  return map;
}

/**
 * Snapshot del estado operativo de una unidad antes de hacer check-in.
 * Devuelve `ready: true` cuando la unidad está limpia + sin tickets abiertos
 * críticos. Se usa para mostrar un warning dialog al usuario y pedir
 * confirmación antes de mover la reserva a `check_in` cuando la unidad no
 * está lista (ej. limpieza pendiente del huésped anterior).
 */
export type UnitReadiness = {
  ready: boolean;
  unit_status:
    | "disponible"
    | "reservado"
    | "ocupado"
    | "limpieza"
    | "mantenimiento"
    | "bloqueado";
  pending_cleaning: { id: string; scheduled_for: string; status: string }[];
  open_maintenance: {
    id: string;
    title: string;
    priority: string;
    status: string;
  }[];
};

export async function getUnitReadinessForCheckIn(
  unitId: string
): Promise<UnitReadiness> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [unitRes, cleaningRes, ticketsRes] = await Promise.all([
    admin
      .from("units")
      .select("status")
      .eq("id", unitId)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin
      .from("cleaning_tasks")
      .select("id, scheduled_for, status")
      .eq("unit_id", unitId)
      .eq("organization_id", organization.id)
      .in("status", ["pendiente", "en_progreso"])
      .order("scheduled_for", { ascending: true }),
    admin
      .from("maintenance_tickets")
      .select("id, title, priority, status")
      .eq("unit_id", unitId)
      .eq("organization_id", organization.id)
      .not("status", "in", "(resuelto,cerrado)")
      .order("opened_at", { ascending: false }),
  ]);

  const unitStatus = (unitRes.data?.status ?? "disponible") as UnitReadiness["unit_status"];
  const pending = (cleaningRes.data ?? []) as {
    id: string;
    scheduled_for: string;
    status: string;
  }[];
  const tickets = (ticketsRes.data ?? []) as {
    id: string;
    title: string;
    priority: string;
    status: string;
  }[];

  // "ready" = la unidad NO está sucia y NO tiene limpieza pendiente.
  // Los tickets de mantenimiento abiertos los reportamos pero no bloquean
  // por sí solos (puede ser un arreglo menor). El warning final lo decide
  // el cliente con base en estos tres campos.
  const isDirty = unitStatus === "limpieza" || pending.length > 0;
  return {
    ready: !isDirty && tickets.length === 0,
    unit_status: unitStatus,
    pending_cleaning: pending,
    open_maintenance: tickets,
  };
}

export async function getBooking(id: string) {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`*, unit:units(*), guest:guests(*), payments:booking_payments(*)`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Setea (o limpia con null) la seña informada al huésped en una reserva.
 * Alimenta el mensaje/email de confirmación (Seña + Restante). Se clampea a
 * [0, total]. NO toca `paid_amount`/caja —el cobro real se registra en Caja
 * aparte— para no duplicar el monto.
 */
export async function setBookingDeposit(
  bookingId: string,
  amount: number | null
): Promise<{ ok: true; deposit: number | null } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    return { ok: false, error: "No tenés permisos para editar la reserva" };
  }
  const admin = createAdminClient();
  const { data: bk, error: readErr } = await admin
    .from("bookings")
    .select("total_amount")
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!bk) return { ok: false, error: "Reserva no encontrada" };

  const total = Number(bk.total_amount ?? 0);
  let deposit: number | null = null;
  if (amount != null) {
    const d = Number(amount);
    if (Number.isFinite(d) && d > 0) deposit = Math.min(Math.round(d * 100) / 100, total);
  }

  const { error } = await admin
    .from("bookings")
    .update({ deposit_amount: deposit })
    .eq("id", bookingId)
    .eq("organization_id", organization.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/reservas/${bookingId}`);
  return { ok: true, deposit };
}

export async function createBooking(
  input: BookingInputWithAccount
): Promise<Booking> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "create")) {
    throw new Error("No tenés permisos para crear reservas");
  }
  const { account_id: accountId, skip_split: skipSplit, ...rest } = input;
  const validated = bookingSchema.parse(rest);

  // En modo mensual, el constraint `bookings_monthly_requires_rent` exige
  // monthly_rent NOT NULL. Lo chequeamos acá para devolver un error claro en
  // español — sin esta defensa, en producción Next.js enmascara el mensaje
  // de Postgres como "Server Components render error" y el usuario no sabe
  // qué arreglar.
  if (
    validated.mode === "mensual" &&
    (validated.monthly_rent === null || validated.monthly_rent === undefined)
  ) {
    throw new Error(
      "En modo mensual tenés que cargar la Renta mensual antes de guardar la reserva.",
    );
  }

  // Buscar comisión default de la unit si no fue dada
  if (validated.commission_pct === null || validated.commission_pct === undefined) {
    const admin = createAdminClient();
    const { data: unit } = await admin
      .from("units")
      .select("default_commission_pct")
      .eq("id", validated.unit_id)
      .maybeSingle();
    validated.commission_pct = unit?.default_commission_pct ?? 20;
  }

  const admin = createAdminClient();

  // ─── Split condicional: si el usuario eligió "reserva única", se respeta ───
  // El flag skipSplit viene del diálogo de confirmación en el form cuando la
  // estadía excede MAX_BOOKING_NIGHTS. Si no lo marcó, aplica split automático.
  const segments = skipSplit
    ? []
    : splitBookingSegments(
        validated.check_in_date,
        validated.check_out_date,
        MAX_BOOKING_NIGHTS
      );

  if (segments.length >= 2) {
    // Generamos lease_group_id en cliente (UUID v4 via crypto)
    const leaseGroupId = crypto.randomUUID();
    const totalNights = nightsBetween(
      validated.check_in_date,
      validated.check_out_date
    );
    const totalAmount = Number(validated.total_amount) || 0;
    const commissionPctValue = validated.commission_pct ?? 0;

    const created: Booking[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segShare = totalNights > 0 ? seg.nights / totalNights : 0;
      const segAmount = Math.round(totalAmount * segShare * 100) / 100;
      const segCommission = Math.round((segAmount * commissionPctValue) / 100 * 100) / 100;
      // El cobrado se aplica al primer período (representa la seña/anticipo).
      const segPaid = i === 0 ? Number(validated.paid_amount) || 0 : 0;
      // Cleaning fee solo en el último período (al cierre del contrato).
      const segCleaningFee = i === segments.length - 1 ? validated.cleaning_fee : 0;

      const { data, error } = await admin
        .from("bookings")
        .insert({
          ...validated,
          check_in_date: seg.from,
          check_out_date: seg.to,
          // Las horas del primer/último segmento usan las del input;
          // los intermedios encadenan con check_out_time del anterior como
          // check_in_time del siguiente. Mantenemos defaults razonables.
          check_in_time:
            i === 0 ? validated.check_in_time : "12:00",
          check_out_time:
            i === segments.length - 1 ? validated.check_out_time : "12:00",
          total_amount: segAmount,
          paid_amount: segPaid,
          commission_amount: segCommission,
          cleaning_fee: segCleaningFee,
          lease_group_id: leaseGroupId,
          external_id: validated.external_id || null,
          notes:
            i === 0
              ? validated.notes
              : `Período ${i + 1}/${segments.length} del contrato.`,
          internal_notes: validated.internal_notes,
          organization_id: organization.id,
          created_by: session.userId,
        })
        .select()
        .single();

      if (error) {
        // Rollback manual: borramos los segmentos creados antes del fallo.
        if (created.length > 0) {
          await admin
            .from("bookings")
            .delete()
            .in("id", created.map((b) => b.id));
        }
        if (error.message.includes("bookings_no_overlap")) {
          throw new Error(
            `Conflicto en el período ${i + 1}/${segments.length} (${seg.from} → ${seg.to}): ya hay una reserva en esa unidad`
          );
        }
        throw new Error(error.message);
      }
      created.push(data as Booking);
    }

    // Cash movement solo para el seña/anticipo del primer período.
    if (
      created.length > 0 &&
      Number(validated.paid_amount) > 0 &&
      accountId
    ) {
      try {
        await syncBookingPaymentToCash({
          bookingId: created[0].id,
          organizationId: organization.id,
          unitId: validated.unit_id,
          currency: validated.currency,
          delta: Number(validated.paid_amount),
          accountId,
        });
      } catch (e) {
        console.error("syncBookingPaymentToCash failed (lease)", e);
        throw e;
      }
    }

    // Generar payment schedule (1 cuota por segmento del lease group)
    if (validated.mode === "mensual") {
      for (const seg of created) {
        const { error: scheduleErr } = await admin.rpc(
          "generate_payment_schedule_for_booking",
          { p_booking_id: seg.id }
        );
        if (scheduleErr) {
          console.error("generate_payment_schedule_for_booking failed", scheduleErr);
        }
      }
    }

    revalidatePath("/dashboard/reservas");
    revalidatePath("/dashboard/unidades/kanban");
    revalidatePath("/dashboard/unidades/calendario/mensual");
    revalidatePath("/dashboard/caja");
    revalidatePath("/dashboard/alertas");
    return created[0];
  }

  // ─── Single booking (caso normal) ───
  const commission_amount = validated.total_amount * (validated.commission_pct! / 100);

  const { data, error } = await admin
    .from("bookings")
    .insert({
      ...validated,
      external_id: validated.external_id || null,
      commission_amount,
      organization_id: organization.id,
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) {
    if (
      error.code === "23P01" ||
      error.message.includes("bookings_no_overlap")
    ) {
      throw new Error("Ya hay una reserva en esa unidad para esas fechas");
    }
    if (
      error.code === "23514" ||
      error.message.includes("bookings_dates_valid")
    ) {
      throw new Error("La fecha de check-out debe ser posterior al check-in");
    }
    throw new Error(error.message);
  }

  // Si se cobró algo al crear, registrar movimiento de caja
  if (validated.paid_amount > 0 && accountId) {
    try {
      await syncBookingPaymentToCash({
        bookingId: (data as Booking).id,
        organizationId: organization.id,
        unitId: validated.unit_id,
        currency: validated.currency,
        delta: validated.paid_amount,
        accountId,
      });
    } catch (e) {
      console.error("syncBookingPaymentToCash failed", e);
      throw e;
    }
  }

  // Generar payment schedule si es mensual standalone
  if (validated.mode === "mensual") {
    const { error: scheduleErr } = await admin.rpc(
      "generate_payment_schedule_for_booking",
      { p_booking_id: (data as Booking).id }
    );
    if (scheduleErr) {
      console.error("generate_payment_schedule_for_booking failed", scheduleErr);
    }
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/alertas");

  // CRM event publisher (best-effort; no falla si CRM no está configurado)
  try {
    const { publishCrmEvent } = await import("@/lib/crm/events");
    await publishCrmEvent({
      organizationId: organization.id,
      eventType: "booking.created",
      payload: { booking_id: data.id, unit_id: data.unit_id, guest_id: data.guest_id, status: data.status, mode: data.mode },
      refType: "booking",
      refId: data.id,
    });
  } catch (e) {
    console.warn("[bookings/createBooking] crm publish failed", e);
  }

  return data as Booking;
}

export async function updateBooking(
  id: string,
  input: BookingInputWithAccount
): Promise<Booking> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para editar reservas");
  }
  const { account_id: accountId, ...rest } = input;
  const validated = bookingSchema.parse(rest);

  // Mismo guard que createBooking — ver explicación allá.
  if (
    validated.mode === "mensual" &&
    (validated.monthly_rent === null || validated.monthly_rent === undefined)
  ) {
    throw new Error(
      "En modo mensual tenés que cargar la Renta mensual antes de guardar la reserva.",
    );
  }

  const commission_amount =
    validated.commission_pct !== null && validated.commission_pct !== undefined
      ? validated.total_amount * (validated.commission_pct / 100)
      : null;

  const admin = createAdminClient();
  // Leemos paid_amount actual + campos que afectan al schedule para detectar
  // si hay que regenerar las cuotas.
  const { data: current } = await admin
    .from("bookings")
    .select(
      "paid_amount, currency, unit_id, mode, monthly_rent, monthly_expenses, rent_billing_day, check_in_date, check_out_date"
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  const previousPaid = Number(current?.paid_amount ?? 0);
  const newPaid = Number(validated.paid_amount);
  const delta = newPaid - previousPaid;

  const { data, error } = await admin
    .from("bookings")
    .update({
      ...validated,
      external_id: validated.external_id || null,
      commission_amount,
    })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Si el cobrado cambió, sincronizamos con caja (delta append-only)
  if (delta !== 0 && accountId) {
    try {
      await syncBookingPaymentToCash({
        bookingId: id,
        organizationId: organization.id,
        unitId: validated.unit_id,
        currency: validated.currency,
        delta,
        accountId,
      });
    } catch (e) {
      console.error("syncBookingPaymentToCash failed", e);
      throw e;
    }
  }

  // Regenerar schedule si: cambió mode→mensual, o cambió cualquier campo
  // que afecte cuotas (renta/expensas/billing_day/fechas).
  const becameMonthly =
    validated.mode === "mensual" && current?.mode !== "mensual";
  const scheduleAffected =
    validated.mode === "mensual" &&
    (becameMonthly ||
      Number(current?.monthly_rent ?? 0) !== Number(validated.monthly_rent ?? 0) ||
      Number(current?.monthly_expenses ?? 0) !==
        Number(validated.monthly_expenses ?? 0) ||
      (current?.rent_billing_day ?? null) !==
        (validated.rent_billing_day ?? null) ||
      current?.check_in_date !== validated.check_in_date ||
      current?.check_out_date !== validated.check_out_date);
  if (scheduleAffected) {
    const { error: scheduleErr } = await admin.rpc(
      "generate_payment_schedule_for_booking",
      { p_booking_id: id }
    );
    if (scheduleErr) {
      console.error("generate_payment_schedule_for_booking failed", scheduleErr);
    }
  }
  // Si cambió a temporario, anular cuotas pending/overdue (no las paid)
  if (current?.mode === "mensual" && validated.mode === "temporario") {
    await admin
      .from("booking_payment_schedule")
      .update({ status: "cancelled" })
      .eq("booking_id", id)
      .eq("organization_id", organization.id)
      .in("status", ["pending", "overdue", "partial"]);
  }

  // Si la edición dejó la reserva con > MAX_BOOKING_NIGHTS, partirla en
  // segmentos consecutivos. Idempotente: si ya cabe, no hace nada.
  await enforceLeaseSplitOnExisting({
    bookingId: id,
    organizationId: organization.id,
    userId: session.userId,
  });

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/alertas");
  return data as Booking;
}

/**
 * Registra un pago adicional sobre una reserva existente. Suma `amount` al
 * `paid_amount` actual y crea un cash_movement por ese delta. Usado desde el
 * popover de la grilla PMS para cobrar saldos pendientes sin re-editar toda
 * la reserva.
 */
export async function addBookingPayment(
  bookingId: string,
  amount: number,
  accountId: string
): Promise<Booking> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "create")) {
    throw new Error("No tenés permisos para registrar pagos");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El importe del pago debe ser mayor a 0");
  }
  if (!accountId) {
    throw new Error("Tenés que elegir una cuenta de caja");
  }
  const admin = createAdminClient();
  const { data: current, error: readErr } = await admin
    .from("bookings")
    .select("id, paid_amount, total_amount, currency, unit_id")
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("Reserva no encontrada");

  const previousPaid = Number(current.paid_amount ?? 0);
  const newPaid = Number((previousPaid + Number(amount)).toFixed(2));

  const { data, error } = await admin
    .from("bookings")
    .update({ paid_amount: newPaid })
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await syncBookingPaymentToCash({
    bookingId,
    organizationId: organization.id,
    unitId: current.unit_id,
    currency: current.currency,
    delta: Number(amount),
    accountId,
  });

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${bookingId}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  return data as Booking;
}

/**
 * Registra un COBRO EXTRA sobre una reserva (cochera, late check-out, daños).
 * A diferencia de addBookingPayment, NO toca total_amount ni paid_amount: es un
 * ingreso aparte, vinculado a la reserva (ref_type='booking'), que aparece en
 * Caja y en el historial de pagos de la reserva. `billable_to` define a quién
 * corresponde la plata (organización o propietario). Si es del propietario y la
 * unidad tiene dueño principal, se imputa a ese owner para el filtrado en Caja.
 */
const extraChargeSchema = z.object({
  booking_id: z.string().uuid(),
  amount: z.coerce.number().positive("El importe debe ser mayor a 0"),
  account_id: z.string().uuid("Elegí una cuenta de caja"),
  concept: z.string().trim().min(2, "Describí el concepto").max(200),
  billable_to: z.enum(["apartcba", "owner"]).default("apartcba"),
  occurred_at: z.string().optional(),
});

export type ExtraChargeInput = z.input<typeof extraChargeSchema>;

export async function addBookingExtraCharge(input: ExtraChargeInput) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "create")) {
    throw new Error("No tenés permisos para registrar cobros");
  }
  const v = extraChargeSchema.parse(input);
  const admin = createAdminClient();

  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .select("id, currency, unit_id, status")
    .eq("id", v.booking_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (bkErr) throw new Error(bkErr.message);
  if (!booking) throw new Error("Reserva no encontrada");
  if (booking.status === "cancelada" || booking.status === "no_show") {
    throw new Error("No se puede cobrar un extra sobre una reserva cancelada");
  }

  const { data: account } = await admin
    .from("cash_accounts")
    .select("id, currency, active, name")
    .eq("id", v.account_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!account) throw new Error("Cuenta de caja no encontrada");
  if (!account.active) throw new Error("La cuenta de caja está inactiva");
  if (account.currency !== booking.currency) {
    throw new Error(
      `La cuenta es ${account.currency} pero la reserva es en ${booking.currency}`,
    );
  }

  // Si el extra es del propietario, lo imputamos al dueño principal de la unidad
  // (si lo hay) para que aparezca en el filtro por propietario de Caja.
  let ownerId: string | null = null;
  if (v.billable_to === "owner") {
    // Resolución robusta del dueño a imputar (1 dueño / principal / mayor %):
    // no depender de is_primary, que en la base suele venir sin flaguear.
    const { data: uOwners } = await admin
      .from("unit_owners")
      .select("owner_id, is_primary, ownership_pct")
      .eq("unit_id", booking.unit_id);
    ownerId = pickChargeOwner((uOwners ?? []) as UnitOwnerLite[]);
  }

  const { data, error } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: account.id,
      direction: "in",
      amount: v.amount,
      currency: booking.currency,
      category: "extra_charge",
      ref_type: "booking",
      ref_id: booking.id,
      unit_id: booking.unit_id,
      owner_id: ownerId,
      billable_to: v.billable_to,
      description: `Cobro extra: ${v.concept}`,
      occurred_at: v.occurred_at ?? new Date().toISOString(),
      created_by: session.userId,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${v.booking_id}`);
  revalidatePath("/dashboard/caja");
  revalidatePath(`/dashboard/caja/${account.id}`);
  revalidatePath("/dashboard");
  return data as CashMovement;
}

export async function changeBookingStatus(
  id: string,
  newStatus: BookingStatus,
  reason?: string,
  options?: { force_checkout?: boolean }
) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Cancelar una reserva equivale a editarla — requiere bookings.update.
  // Los cambios operativos (check-in / check-out) los puede ejecutar cualquier
  // rol con `bookings.view` para no bloquear la operación diaria.
  if (newStatus === "cancelada" && !can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para cancelar reservas");
  }
  const admin = createAdminClient();

  // ── Bloqueo de check-out con saldo pendiente ──────────────────────────────
  // Regla de negocio: no se puede dar check_out sin antes haber cobrado todo.
  // Excepción: admin puede forzar (force_checkout=true) sólo si pasa una razón
  // explícita; queda registrada en `internal_notes` para auditoría posterior.
  if (newStatus === "check_out") {
    const { data: bk, error: bkErr } = await admin
      .from("bookings")
      .select("id, total_amount, paid_amount, currency, internal_notes")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (bkErr) throw new Error(bkErr.message);
    if (!bk) throw new Error("Reserva no encontrada");

    const total = Number(bk.total_amount ?? 0);
    const paid = Number(bk.paid_amount ?? 0);
    const pending = Number((total - paid).toFixed(2));

    if (pending > 0.01) {
      if (!options?.force_checkout) {
        // Mensaje cierra con un código machine-readable que la UI usa para
        // ofrecer la opción de cobrar el saldo o forzar (sólo admin).
        throw new Error(
          `CHECKOUT_PENDING_BALANCE: La reserva tiene un saldo pendiente de ${pending.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${bk.currency}. Cobrá el saldo antes de hacer check-out.`
        );
      }
      // Forzado: requiere razón explícita y rol admin-level
      if (!isAdminLevel(role)) {
        throw new Error("Solo un administrador puede forzar un check-out con saldo pendiente.");
      }
      const trimmedReason = reason?.trim();
      if (!trimmedReason || trimmedReason.length < 5) {
        throw new Error("Necesitamos una razón (mínimo 5 caracteres) para forzar el check-out con saldo.");
      }
      // Anotar en internal_notes (append) para que quede el rastro
      const stamp = new Date().toISOString();
      const note = `[${stamp}] Check-out forzado con saldo pendiente de ${pending} ${bk.currency}. Razón: ${trimmedReason}`;
      const newNotes = bk.internal_notes ? `${bk.internal_notes}\n${note}` : note;
      await admin
        .from("bookings")
        .update({ internal_notes: newNotes })
        .eq("id", id)
        .eq("organization_id", organization.id);
    }
  }

  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "cancelada" && reason) update.cancelled_reason = reason;
  if (newStatus === "check_in") update.checked_in_at = new Date().toISOString();
  if (newStatus === "check_out") update.checked_out_at = new Date().toISOString();
  const { error } = await admin
    .from("bookings")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${id}`);
  revalidatePath("/dashboard/unidades/kanban");

  // CRM event publisher
  try {
    const { publishCrmEvent } = await import("@/lib/crm/events");
    const eventMap: Record<string, string> = {
      confirmada: "booking.confirmed",
      check_in: "booking.checkin_today",
      check_out: "booking.checkout_today",
      cancelada: "booking.cancelled",
      no_show: "booking.cancelled",
    };
    const eventType = eventMap[newStatus];
    if (eventType) {
      const { data: bookingFull } = await admin
        .from("bookings")
        .select("unit_id,guest_id")
        .eq("id", id)
        .single();
      await publishCrmEvent({
        organizationId: organization.id,
        eventType,
        payload: {
          booking_id: id,
          unit_id: bookingFull?.unit_id,
          guest_id: bookingFull?.guest_id,
          status: newStatus,
        },
        refType: "booking",
        refId: id,
      });
    }
  } catch (e) {
    console.warn("[bookings/changeBookingStatus] crm publish failed", e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Movimiento / extensión / preview con confirmación (PR3)
// ════════════════════════════════════════════════════════════════════════════

export interface BookingChangePreview {
  delta_days: number; // total absoluto de noches sumadas/quitadas
  conflicts: Array<{
    booking_id: string;
    guest_name: string | null;
    range: string; // "12 abr → 16 abr"
    unit_code: string | null;
  }>;
  cleaning_tasks_affected: Array<{ id: string; scheduled_for: string }>;
  open_tickets_in_dest: Array<{ id: string; title: string; priority: string }>;
  in_closed_settlement_period: boolean; // si toca un período revisado/enviado/pagado
  price_diff: {
    previous_total: number;
    suggested_total: number;
    basis: "nightly" | "monthly_prorated" | "unchanged";
    delta_amount: number;
  };
  warnings: Array<{ kind: "blocking" | "info"; message: string }>;
}

/**
 * Calcula los efectos de un cambio de fechas/unit SIN escribir.
 * Alimenta el modal MoveConfirmDialog para que el usuario apruebe con info real.
 */
export async function previewBookingChange(input: {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
}): Promise<BookingChangePreview> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // Reserva original
  const { data: original, error: errOrig } = await admin
    .from("bookings")
    .select("*, unit:units(id, code, name), guest:guests(id, full_name)")
    .eq("id", input.id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (errOrig) throw new Error(errOrig.message);
  if (!original) throw new Error("Reserva no encontrada");

  const warnings: BookingChangePreview["warnings"] = [];

  // ── Validación: check_out > check_in
  if (input.check_out_date <= input.check_in_date) {
    warnings.push({
      kind: "blocking",
      message: "El check-out debe ser posterior al check-in",
    });
  }

  // ── Validación: no podés mover al pasado una reserva ya in-house o cerrada
  const todayISO = new Date().toISOString().slice(0, 10);
  if (
    (original.status === "check_in" || original.status === "check_out") &&
    input.check_in_date < original.check_in_date &&
    original.check_in_date < todayISO
  ) {
    warnings.push({
      kind: "blocking",
      message: "No se puede adelantar el check-in de una reserva ya activa al pasado",
    });
  }

  // ── Conflicto con otras reservas en la unidad destino
  const { data: conflicts } = await admin
    .from("bookings")
    .select("id, check_in_date, check_out_date, unit:units(code), guest:guests(full_name)")
    .eq("organization_id", organization.id)
    .eq("unit_id", input.unit_id)
    .neq("id", input.id)
    .not("status", "in", "(cancelada,no_show)")
    .lt("check_in_date", input.check_out_date)
    .gt("check_out_date", input.check_in_date);

  const conflictsList = (conflicts ?? []).map((c) => {
    const unit = c.unit as unknown as { code?: string } | null;
    const guest = c.guest as unknown as { full_name?: string } | null;
    return {
      booking_id: c.id,
      guest_name: guest?.full_name ?? null,
      range: `${c.check_in_date} → ${c.check_out_date}`,
      unit_code: unit?.code ?? null,
    };
  });

  if (conflictsList.length > 0) {
    warnings.push({
      kind: "blocking",
      message: `Se solapa con ${conflictsList.length} reserva${conflictsList.length === 1 ? "" : "s"} existente${conflictsList.length === 1 ? "" : "s"}`,
    });
  }

  // ── Cleaning tasks afectadas (programadas en torno al check_out original)
  const { data: cleaningTasks } = await admin
    .from("cleaning_tasks")
    .select("id, scheduled_for")
    .eq("organization_id", organization.id)
    .eq("booking_out_id", input.id)
    .not("status", "in", "(completada,verificada,cancelada)");

  // ── Tickets abiertos en la unidad destino (si cambia)
  let openTicketsInDest: BookingChangePreview["open_tickets_in_dest"] = [];
  if (input.unit_id !== original.unit_id) {
    const { data: tickets } = await admin
      .from("maintenance_tickets")
      .select("id, title, priority")
      .eq("organization_id", organization.id)
      .eq("unit_id", input.unit_id)
      .not("status", "in", "(resuelto,cerrado)");
    openTicketsInDest = (tickets ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
    }));
    if (openTicketsInDest.length > 0) {
      const prio = openTicketsInDest[0].priority;
      if (prio === "alta" || prio === "urgente") {
        warnings.push({
          kind: "info",
          message: `Hay un ticket ${prio} abierto en la unidad destino`,
        });
      }
    }
  }

  // ── Período de liquidación cerrado
  // Si la reserva pertenece a un owner cuya liquidación del mes ya está revisada/enviada/pagada,
  // el movimiento puede romper la liquidación. Bloqueamos.
  const periodYear = parseInt(original.check_out_date.slice(0, 4), 10);
  const periodMonth = parseInt(original.check_out_date.slice(5, 7), 10);
  const newPeriodYear = parseInt(input.check_out_date.slice(0, 4), 10);
  const newPeriodMonth = parseInt(input.check_out_date.slice(5, 7), 10);
  let inClosedPeriod = false;
  if (periodYear !== newPeriodYear || periodMonth !== newPeriodMonth) {
    const { data: closed } = await admin
      .from("owner_settlements")
      .select("id, status, period_year, period_month")
      .eq("organization_id", organization.id)
      .in("period_year", [periodYear, newPeriodYear])
      .in("period_month", [periodMonth, newPeriodMonth])
      .in("status", ["revisada", "enviada", "pagada"]);
    if (closed && closed.length > 0) {
      inClosedPeriod = true;
      warnings.push({
        kind: "blocking",
        message: "El cambio cruza un período de liquidación ya cerrado",
      });
    }
  }

  // ── Recálculo de precio sugerido
  const oldNights = nightsBetween(original.check_in_date, original.check_out_date);
  const newNights = nightsBetween(input.check_in_date, input.check_out_date);
  const previousTotal = Number(original.total_amount ?? 0);
  let suggestedTotal = previousTotal;
  let basis: BookingChangePreview["price_diff"]["basis"] = "unchanged";

  if (newNights !== oldNights && oldNights > 0) {
    if (original.mode === "mensual" && original.monthly_rent) {
      // Prorrateo: total = (renta/30) × noches
      const dailyRate = Number(original.monthly_rent) / 30;
      suggestedTotal = Math.round(dailyRate * newNights * 100) / 100;
      basis = "monthly_prorated";
    } else {
      // Tarifa por noche derivada del total original
      const nightlyRate = previousTotal / oldNights;
      suggestedTotal = Math.round(nightlyRate * newNights * 100) / 100;
      basis = "nightly";
    }
  }

  return {
    delta_days: Math.abs(newNights - oldNights) + Math.abs(input.check_in_date < original.check_in_date ? 0 : 0),
    conflicts: conflictsList,
    cleaning_tasks_affected: (cleaningTasks ?? []).map((c) => ({
      id: c.id,
      scheduled_for: c.scheduled_for,
    })),
    open_tickets_in_dest: openTicketsInDest,
    in_closed_settlement_period: inClosedPeriod,
    price_diff: {
      previous_total: previousTotal,
      suggested_total: suggestedTotal,
      basis,
      delta_amount: Math.round((suggestedTotal - previousTotal) * 100) / 100,
    },
    warnings,
  };
}

/**
 * Aplica un cambio de fechas/unit a una reserva tras pasar por el modal de
 * confirmación. A diferencia de la versión legacy `moveBooking`, ésta:
 *   • valida permisos por delta_days (recepción cap 60d)
 *   • acepta un total_amount sugerido (o lo deja igual)
 *   • acepta un reason que se persiste en booking_extensions
 */
export async function moveBookingTransaction(input: {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
  total_amount?: number | null;
  reason?: string | null;
}): Promise<Booking> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para mover reservas");
  }
  const admin = createAdminClient();

  // Lee la reserva original para calcular delta_days y validar permisos
  const { data: original, error: errOrig } = await admin
    .from("bookings")
    .select("id, unit_id, check_in_date, check_out_date, status, mode, monthly_rent, total_amount")
    .eq("id", input.id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (errOrig) throw new Error(errOrig.message);
  if (!original) throw new Error("Reserva no encontrada");

  // No permitimos mover canceladas / no_show por drag
  if (original.status === "cancelada" || original.status === "no_show") {
    throw new Error("No se puede mover una reserva cancelada o no-show");
  }

  // NOTA: existía un tope de 60 días para mover reservas con rol "recepcion".
  // Se quitó porque recepción opera con acceso equivalente a admin. Si más
  // adelante se rebaja recepción, reponer el cap (delta de check-in + check-out).

  const update: Record<string, unknown> = {
    unit_id: input.unit_id,
    check_in_date: input.check_in_date,
    check_out_date: input.check_out_date,
  };
  if (
    input.total_amount !== undefined &&
    input.total_amount !== null &&
    input.total_amount !== Number(original.total_amount)
  ) {
    update.total_amount = input.total_amount;
  }

  const { data, error } = await admin
    .from("bookings")
    .update(update)
    .eq("id", input.id)
    .eq("organization_id", organization.id)
    .select()
    .single();

  if (error) {
    if (error.message.includes("bookings_no_overlap")) {
      throw new Error(
        "Conflicto: ya hay otra reserva en esa unidad para ese rango de fechas"
      );
    }
    if (error.message.includes("bookings_dates_valid")) {
      throw new Error("El check-out debe ser posterior al check-in");
    }
    throw new Error(error.message);
  }

  // Persistir reason en la última fila de booking_extensions (que el trigger acaba de insertar)
  if (input.reason && input.reason.trim().length > 0) {
    const { data: lastExt } = await admin
      .from("booking_extensions")
      .select("id")
      .eq("booking_id", input.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastExt) {
      await admin
        .from("booking_extensions")
        .update({ reason: input.reason.trim().slice(0, 500) })
        .eq("id", lastExt.id);
    }
  }

  // Si el move/extend dejó la reserva con > MAX_BOOKING_NIGHTS, partirla.
  // Idempotente: si ya cabe, no hace nada.
  await enforceLeaseSplitOnExisting({
    bookingId: input.id,
    organizationId: organization.id,
    userId: session.userId,
  });

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${input.id}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/limpieza");
  revalidatePath("/dashboard/liquidaciones");
  return data as Booking;
}

/**
 * Atajo para extender el check-out solamente (resize derecho del PMS).
 * Usa la misma transacción que moveBookingTransaction.
 */
export async function extendBooking(input: {
  id: string;
  new_check_out_date: string;
  total_amount?: number | null;
  reason?: string | null;
}): Promise<Booking> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: orig, error } = await admin
    .from("bookings")
    .select("unit_id, check_in_date")
    .eq("id", input.id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!orig) throw new Error("Reserva no encontrada");

  return moveBookingTransaction({
    id: input.id,
    unit_id: orig.unit_id,
    check_in_date: orig.check_in_date,
    check_out_date: input.new_check_out_date,
    total_amount: input.total_amount,
    reason: input.reason,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Vista mensual (PR4): bookings agrupados por mes para inquilinos largos
// ════════════════════════════════════════════════════════════════════════════

/**
 * Proyección liviana de booking para la grilla mensual: SOLO las columnas que
 * la action y `pms-monthly-board` leen (la vista trae una ventana de 7 meses,
 * así que evitar `select("*")` sobre la tabla ancha de bookings importa). El
 * tipo angosto hace que tsc verifique que el cliente no lea un campo fuera del
 * select — si alguien agrega un acceso nuevo, falla en compilación y se suma
 * la columna acá y en el `.select()`.
 */
export type MonthlyViewBooking = Pick<
  Booking,
  | "id"
  | "organization_id"
  | "unit_id"
  | "guest_id"
  | "source"
  | "status"
  | "is_block"
  | "mode"
  | "check_in_date"
  | "check_out_date"
  | "guests_count"
  | "currency"
  | "total_amount"
  | "paid_amount"
  | "monthly_rent"
  | "monthly_expenses"
> & {
  unit?: { id: string; code: string; name: string } | null;
  guest?: { id: string; full_name: string; phone: string | null; email: string | null } | null;
};

export interface MonthlyViewCell {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  year: number;
  month: number;
  bookings: MonthlyViewBooking[];
  /** Total cobrado (suma de paid_amount prorrateado al mes ocupado) */
  total_collected: number;
  /** Total esperado (renta + expensas prorrateado al mes ocupado) */
  total_expected: number;
  /** Días ocupados del mes (0..days_in_month) */
  occupied_days: number;
  days_in_month: number;
}

export async function listBookingsMonthlyView(
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number
): Promise<MonthlyViewCell[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const fromISO = `${fromYear}-${String(fromMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(toYear, toMonth, 0).getDate();
  const toISO = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [unitsRes, bookingsRes] = await Promise.all([
    admin
      .from("units")
      .select("id, code, name, position")
      .eq("organization_id", organization.id)
      .eq("active", true)
      .order("position"),
    admin
      .from("bookings")
      .select(
        `id, organization_id, unit_id, guest_id, source, status, is_block, mode, check_in_date, check_out_date, guests_count, currency, total_amount, paid_amount, monthly_rent, monthly_expenses, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`
      )
      .eq("organization_id", organization.id)
      .not("status", "in", "(cancelada,no_show)")
      .lt("check_in_date", toISO)
      .gt("check_out_date", fromISO)
      .order("check_in_date"),
  ]);

  if (unitsRes.error) throw new Error(unitsRes.error.message);
  if (bookingsRes.error) throw new Error(bookingsRes.error.message);

  const units = unitsRes.data ?? [];
  const bookings = (bookingsRes.data ?? []) as unknown as MonthlyViewBooking[];

  const cells: MonthlyViewCell[] = [];

  // Iterar mes por mes en el rango
  let yy = fromYear;
  let mm = fromMonth;
  while (yy < toYear || (yy === toYear && mm <= toMonth)) {
    const periodStart = `${yy}-${String(mm).padStart(2, "0")}-01`;
    const periodEnd = `${yy}-${String(mm).padStart(2, "0")}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
    const daysInMonth = new Date(yy, mm, 0).getDate();

    for (const u of units) {
      const cellBookings = bookings.filter(
        (b) =>
          b.unit_id === u.id &&
          b.check_in_date <= periodEnd &&
          b.check_out_date >= periodStart
      );
      let occupiedDays = 0;
      let totalExpected = 0;
      let totalCollected = 0;
      for (const b of cellBookings) {
        const startISO = b.check_in_date > periodStart ? b.check_in_date : periodStart;
        const endISO = b.check_out_date < periodEnd ? b.check_out_date : periodEnd;
        const days = Math.max(
          0,
          nightsBetween(startISO, endISO) + (endISO === b.check_out_date ? 0 : 1)
        );
        occupiedDays += days;
        if ((b.mode ?? "temporario") === "mensual") {
          const dailyRent =
            (Number(b.monthly_rent ?? 0) + Number(b.monthly_expenses ?? 0)) / 30;
          totalExpected += dailyRent * days;
        } else {
          const totalNights = nightsBetween(b.check_in_date, b.check_out_date) || 1;
          totalExpected += (Number(b.total_amount) * days) / totalNights;
        }
        const paidShare =
          nightsBetween(b.check_in_date, b.check_out_date) > 0
            ? (Number(b.paid_amount) * days) /
              nightsBetween(b.check_in_date, b.check_out_date)
            : 0;
        totalCollected += paidShare;
      }
      cells.push({
        unit_id: u.id,
        unit_code: u.code,
        unit_name: u.name,
        year: yy,
        month: mm,
        bookings: cellBookings,
        total_collected: Math.round(totalCollected * 100) / 100,
        total_expected: Math.round(totalExpected * 100) / 100,
        occupied_days: Math.min(occupiedDays, daysInMonth),
        days_in_month: daysInMonth,
      });
    }
    mm += 1;
    if (mm > 12) {
      mm = 1;
      yy += 1;
    }
  }

  return cells;
}

/**
 * Lista las extensiones de una reserva (audit log).
 */
export async function listBookingExtensions(
  bookingId: string
): Promise<BookingExtension[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_extensions")
    .select("*")
    .eq("booking_id", bookingId)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BookingExtension[]) ?? [];
}

/**
 * Mueve (y/o redimensiona) una reserva: cambia unit_id y/o fechas.
 * @deprecated Usar moveBookingTransaction para tener permisos + audit con razón.
 * Mantenida temporalmente por callers que aún no migraron.
 */
export async function moveBooking(input: {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
}): Promise<Booking> {
  return moveBookingTransaction(input);
}

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Confirmación de reserva multi-canal
// ════════════════════════════════════════════════════════════════════════

const confirmWithMessagesSchema = z.object({
  bookingId: z.string().uuid(),
  channels: z.array(z.enum(["email", "whatsapp"])).min(1),
  emailOverride: z
    .object({
      subject: z.string().optional().nullable(),
      body: z.string(),
    })
    .optional()
    .nullable(),
});

export async function confirmBookingWithMessages(
  input: z.infer<typeof confirmWithMessagesSchema>
): Promise<
  | {
      ok: true;
      channels_sent: string[];
      channels_failed: { channel: string; error: string }[];
    }
  | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = confirmWithMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };
  }

  // WhatsApp es deshabilitado en Spec 2 (defensa server-side aunque la UI también lo bloquea).
  const allowedChannels = parsed.data.channels.filter((c) => c === "email");
  if (allowedChannels.length === 0) {
    return { ok: false, error: "Solo email está disponible. WhatsApp llega en una versión futura." };
  }

  const admin = createAdminClient();

  // Status enum es en español: confirmada (NO "confirmed").
  const { error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "confirmada" as BookingStatus,
      confirmation_sent_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", organization.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  // Audit log de bookings está fuera de scope para Spec 2.

  const ctx = await buildBookingContext(parsed.data.bookingId);
  if (!ctx) return { ok: false, error: "No se pudo cargar el contexto del booking" };

  const channelsSent: string[] = [];
  const channelsFailed: { channel: string; error: string }[] = [];

  if (allowedChannels.includes("email")) {
    if (!ctx.guestEmail) {
      channelsFailed.push({ channel: "email", error: "Huésped sin email registrado" });
    } else {
      let subject: string | null;
      let body: string;
      if (parsed.data.emailOverride) {
        subject = parsed.data.emailOverride.subject ?? null;
        body = parsed.data.emailOverride.body;
      } else {
        const draft = await buildOwnerConfirmationDraft(parsed.data.bookingId);
        if (!draft) {
          channelsFailed.push({ channel: "email", error: "No se pudo armar el mensaje" });
          subject = null;
          body = "";
        } else {
          subject = draft.subject;
          body = draft.body;
        }
      }
      if (body) {
        const html = plainTextToHtml(body);
        const result = await sendGuestMail({
          organizationId: ctx.organizationId,
          to: ctx.guestEmail,
          subject: subject ?? "Confirmación de reserva",
          html,
          text: body,
          replyTo: ctx.orgContactEmail ?? undefined,
        });
        if (result.ok) channelsSent.push("email");
        else channelsFailed.push({ channel: "email", error: result.error });
      }
    }
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${parsed.data.bookingId}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades", "layout");

  return { ok: true, channels_sent: channelsSent, channels_failed: channelsFailed };
}

const resendSchema = z.object({
  bookingId: z.string().uuid(),
  channels: z.array(z.enum(["email", "whatsapp"])).min(1),
  emailOverride: z
    .object({
      subject: z.string().optional().nullable(),
      body: z.string(),
    })
    .optional()
    .nullable(),
});

export async function resendBookingConfirmation(
  input: z.infer<typeof resendSchema>
): Promise<
  | { ok: true; channels_sent: string[]; channels_failed: { channel: string; error: string }[] }
  | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };
  }

  const allowedChannels = parsed.data.channels.filter((c) => c === "email");
  if (allowedChannels.length === 0) return { ok: false, error: "Solo email disponible" };

  const ctx = await buildBookingContext(parsed.data.bookingId);
  if (!ctx) return { ok: false, error: "Booking no encontrado" };
  if (!ctx.guestEmail) return { ok: false, error: "Huésped sin email" };

  let subject: string | null;
  let body: string;
  if (parsed.data.emailOverride) {
    subject = parsed.data.emailOverride.subject ?? null;
    body = parsed.data.emailOverride.body;
  } else {
    const draft = await buildOwnerConfirmationDraft(parsed.data.bookingId);
    if (!draft) return { ok: false, error: "No se pudo armar el mensaje" };
    subject = draft.subject;
    body = draft.body;
  }

  const result = await sendGuestMail({
    organizationId: ctx.organizationId,
    to: ctx.guestEmail,
    subject: subject ?? "Confirmación de reserva",
    html: plainTextToHtml(body),
    text: body,
    replyTo: ctx.orgContactEmail ?? undefined,
  });

  const admin = createAdminClient();
  await admin
    .from("bookings")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", organization.id);

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${parsed.data.bookingId}`);

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, channels_sent: ["email"], channels_failed: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// Merge / Split manual de lease groups (reservas largas)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Reunifica todos los segmentos de un lease group en una sola reserva.
 * - Extiende el primer segmento (el más antiguo) desde su check_in hasta el
 *   check_out del último segmento.
 * - Suma total_amount, paid_amount de todos los segmentos.
 * - Recalcula commission_amount.
 * - Elimina los segmentos restantes (N-1).
 * - Regenera payment schedule si es mensual.
 */
export async function mergeLeaseGroup(
  leaseGroupId: string
): Promise<Booking> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para editar reservas");
  }

  const admin = createAdminClient();
  const { data: segments, error } = await admin
    .from("bookings")
    .select("*")
    .eq("lease_group_id", leaseGroupId)
    .eq("organization_id", organization.id)
    .order("check_in_date", { ascending: true });

  if (error) throw new Error(error.message);
  if (!segments || segments.length < 2) {
    throw new Error("No hay segmentos suficientes para reunificar");
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const totalAmount = segments.reduce(
    (sum, s) => sum + (Number(s.total_amount) || 0),
    0
  );
  const totalPaid = segments.reduce(
    (sum, s) => sum + (Number(s.paid_amount) || 0),
    0
  );
  const totalCleaning = segments.reduce(
    (sum, s) => sum + (Number(s.cleaning_fee) || 0),
    0
  );
  const commissionPct = Number(first.commission_pct) || 0;
  const commissionAmount =
    Math.round((totalAmount * commissionPct) / 100 * 100) / 100;

  // Extender el primer segmento para cubrir todo el rango
  const { data: merged, error: errUpd } = await admin
    .from("bookings")
    .update({
      check_out_date: last.check_out_date,
      check_out_time: last.check_out_time,
      total_amount: Math.round(totalAmount * 100) / 100,
      paid_amount: Math.round(totalPaid * 100) / 100,
      commission_amount: commissionAmount,
      cleaning_fee: Math.round(totalCleaning * 100) / 100,
      lease_group_id: null, // ya no es un grupo
    })
    .eq("id", first.id)
    .eq("organization_id", organization.id)
    .select()
    .single();

  if (errUpd) throw new Error(errUpd.message);

  // Eliminar los segmentos restantes
  const otherIds = segments.slice(1).map((s) => s.id);
  // Cancelar cuotas de payment_schedule de los segmentos a eliminar
  await admin
    .from("booking_payment_schedule")
    .delete()
    .in("booking_id", otherIds)
    .eq("organization_id", organization.id);
  const { error: errDel } = await admin
    .from("bookings")
    .delete()
    .in("id", otherIds)
    .eq("organization_id", organization.id);
  if (errDel) throw new Error(errDel.message);

  // Regenerar payment schedule si es mensual
  if (first.mode === "mensual") {
    const { error: schedErr } = await admin.rpc(
      "generate_payment_schedule_for_booking",
      { p_booking_id: first.id }
    );
    if (schedErr) {
      console.error("generate_payment_schedule_for_booking failed", schedErr);
    }
  }

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/alertas");
  return merged as Booking;
}

/**
 * Divide una reserva existente (standalone, sin lease_group_id) en segmentos
 * de MAX_BOOKING_NIGHTS. Esencialmente lo mismo que enforceLeaseSplitOnExisting
 * pero gatillado manualmente por el usuario.
 */
export async function splitBookingIntoSegments(
  bookingId: string
): Promise<void> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para editar reservas");
  }

  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!booking) throw new Error("Reserva no encontrada");

  const totalNights = nightsBetween(booking.check_in_date, booking.check_out_date);
  if (totalNights <= MAX_BOOKING_NIGHTS) {
    throw new Error(
      `La reserva tiene ${totalNights} noches, no necesita ser dividida (máx ${MAX_BOOKING_NIGHTS})`
    );
  }

  if (booking.lease_group_id) {
    throw new Error("La reserva ya pertenece a un grupo — no se puede volver a dividir");
  }

  // Forzamos el lease_group_id para que enforceLeaseSplitOnExisting lo procese
  const leaseGroupId = crypto.randomUUID();
  await admin
    .from("bookings")
    .update({ lease_group_id: leaseGroupId })
    .eq("id", bookingId)
    .eq("organization_id", organization.id);

  await enforceLeaseSplitOnExisting({
    bookingId,
    organizationId: organization.id,
    userId: session.userId,
  });

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/alertas");
}
