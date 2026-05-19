"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import {
  MAX_BOOKING_NIGHTS,
  nightsBetween,
  splitBookingSegments,
} from "@/lib/booking-split";
import type {
  Booking,
  BookingExtension,
  BookingWithRelations,
  BookingStatus,
} from "@/lib/types/database";
import { sendGuestMail } from "@/lib/email/guest";
import { plainTextToHtml } from "@/lib/email/render";
import { buildBookingContext, getRenderedBookingTemplate } from "@/lib/email/booking-templates";

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
export type BookingInputWithAccount = BookingInput & {
  account_id?: string | null;
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

export async function createBooking(
  input: BookingInputWithAccount
): Promise<Booking> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "create")) {
    throw new Error("No tenés permisos para crear reservas");
  }
  const { account_id: accountId, ...rest } = input;
  const validated = bookingSchema.parse(rest);

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

  // ─── Split universal: ninguna reserva puede exceder MAX_BOOKING_NIGHTS ───
  // Aplica a cualquier modo (temporario, mensual, etc). Si excede el cap, se
  // divide en chunks consecutivos de MAX noches + remanente.
  const segments = splitBookingSegments(
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
      // Forzado: requiere razón explícita y rol admin
      if (role !== "admin") {
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

  // Cap de delta para recepción: 60 días
  const deltaCheckOut = Math.abs(
    nightsBetween(original.check_out_date, input.check_out_date)
  );
  const deltaCheckIn = Math.abs(
    nightsBetween(original.check_in_date, input.check_in_date)
  );
  const totalDelta = deltaCheckOut + deltaCheckIn;
  if (role === "recepcion" && totalDelta > 60) {
    throw new Error(
      "Solo un administrador puede mover reservas más de 60 días. Pedí aprobación."
    );
  }

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

export interface MonthlyViewCell {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  year: number;
  month: number;
  bookings: BookingWithRelations[];
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
        `*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)`
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
  const bookings = (bookingsRes.data ?? []) as BookingWithRelations[];

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
        const tpl = await getRenderedBookingTemplate({
          organizationId: ctx.organizationId,
          eventType: "booking_confirmed",
          channel: "email",
          variables: ctx.variables,
        });
        if (!tpl) {
          channelsFailed.push({ channel: "email", error: "Template no encontrado" });
          subject = null;
          body = "";
        } else {
          subject = tpl.subject;
          body = tpl.body;
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
    const tpl = await getRenderedBookingTemplate({
      organizationId: ctx.organizationId,
      eventType: "booking_confirmed",
      channel: "email",
      variables: ctx.variables,
    });
    if (!tpl) return { ok: false, error: "Template no encontrado" };
    subject = tpl.subject;
    body = tpl.body;
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
