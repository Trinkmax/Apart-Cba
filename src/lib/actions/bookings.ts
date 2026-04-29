"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type {
  Booking,
  BookingExtension,
  BookingWithRelations,
  BookingStatus,
} from "@/lib/types/database";

const bookingSchema = z
  .object({
    unit_id: z.string().uuid("Unidad requerida"),
    guest_id: z.string().uuid().optional().nullable(),
    source: z.enum([
      "directo", "airbnb", "booking", "expedia", "vrbo", "whatsapp", "instagram", "otro",
    ]).default("directo"),
    external_id: z.string().optional().nullable(),
    status: z.enum(["pendiente","confirmada","check_in","check_out","cancelada","no_show"]).default("confirmada"),
    mode: z.enum(["temporario", "mensual"]).default("temporario"),
    check_in_date: z.string().min(10, "Fecha check-in requerida"),
    check_in_time: z.string().default("15:00"),
    check_out_date: z.string().min(10, "Fecha check-out requerida"),
    check_out_time: z.string().default("11:00"),
    guests_count: z.coerce.number().int().min(1).default(1),
    currency: z.string().default("ARS"),
    total_amount: z.coerce.number().min(0).default(0),
    paid_amount: z.coerce.number().min(0).default(0),
    commission_pct: z.coerce.number().min(0).max(100).optional().nullable(),
    cleaning_fee: z.coerce.number().min(0).optional().nullable(),
    // Mensual
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
  })
  .refine(
    (data) =>
      data.mode !== "mensual" ||
      (data.monthly_rent !== null &&
        data.monthly_rent !== undefined &&
        data.monthly_rent > 0),
    {
      message: "Las reservas mensuales requieren una renta mensual mayor a 0",
      path: ["monthly_rent"],
    }
  );

export type BookingInput = z.infer<typeof bookingSchema>;

// Input extendido con account_id para imputar el cobro a una cuenta de caja.
// account_id no se persiste en bookings — sólo dispara la creación de un
// cash_movement equivalente al delta de paid_amount.
export type BookingInputWithAccount = BookingInput & {
  account_id?: string | null;
};

// ════════════════════════════════════════════════════════════════════════════
// Lease groups: split de reservas mensuales largas en N períodos mensuales
// ════════════════════════════════════════════════════════════════════════════

/** Suma 1 mes calendario clamping al fin de mes destino para evitar 31→3 mar. */
function addOneCalendarMonth(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== day) {
    // El mes destino es más corto (ej. 31 ene → habría rolado a 3 mar)
    d.setDate(0); // último día del mes anterior = último día del mes destino real
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export interface LeaseSegment {
  from: string;
  to: string;
  nights: number;
  /** Es el último segmento (puede ser parcial) */
  isLast: boolean;
}

/**
 * Divide un rango de fechas en segmentos mensuales (1 mes calendario c/u).
 * Si el último segmento es < 1 mes completo, queda como segmento parcial.
 * Para rangos <= 30 días, retorna [] (no hay split).
 *
 * Ejemplo: 2026-05-15 → 2026-08-15
 *   [{ from: 2026-05-15, to: 2026-06-15, nights: 31 },
 *    { from: 2026-06-15, to: 2026-07-15, nights: 30 },
 *    { from: 2026-07-15, to: 2026-08-15, nights: 31, isLast: true }]
 */
export function splitMonthlySegments(
  checkIn: string,
  checkOut: string
): LeaseSegment[] {
  const totalNights = nightsBetween(checkIn, checkOut);
  if (totalNights <= 30) return [];

  const segments: LeaseSegment[] = [];
  let cursor = checkIn;
  // Hard cap defensivo: 60 segmentos = 5 años. Si pasa, hay un bug arriba.
  for (let i = 0; i < 60; i++) {
    if (cursor >= checkOut) break;
    let next = addOneCalendarMonth(cursor);
    if (next > checkOut) next = checkOut;
    segments.push({
      from: cursor,
      to: next,
      nights: nightsBetween(cursor, next),
      isLast: next === checkOut,
    });
    cursor = next;
  }

  // Si quedó un solo segmento (puede pasar si por algún edge addOneCalendarMonth
  // lo dejó completo en el primer salto), abortamos el split.
  if (segments.length < 2) return [];
  return segments;
}

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
    description:
      params.delta > 0
        ? `Cobro de reserva ${params.bookingId.slice(0, 8)}`
        : `Devolución de reserva ${params.bookingId.slice(0, 8)}`,
    occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Error al registrar movimiento de caja: ${error.message}`);
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
  const { organization } = await getCurrentOrg();
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

  // ─── ¿Es una mensual larga? Split automático en períodos mensuales ───
  const shouldSplit =
    validated.mode === "mensual" &&
    nightsBetween(validated.check_in_date, validated.check_out_date) > 30;
  const segments = shouldSplit
    ? splitMonthlySegments(validated.check_in_date, validated.check_out_date)
    : [];

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
              : `Período ${i + 1}/${segments.length} del contrato (mes ${i + 1}).`,
          internal_notes:
            i === 0 ? validated.internal_notes : validated.internal_notes,
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

    revalidatePath("/dashboard/reservas");
    revalidatePath("/dashboard/unidades/kanban");
    revalidatePath("/dashboard/unidades/calendario/mensual");
    revalidatePath("/dashboard/caja");
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
    if (error.message.includes("bookings_no_overlap")) {
      throw new Error("Ya hay una reserva en esa unidad para esas fechas");
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

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  return data as Booking;
}

export async function updateBooking(
  id: string,
  input: BookingInputWithAccount
): Promise<Booking> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const { account_id: accountId, ...rest } = input;
  const validated = bookingSchema.parse(rest);
  const commission_amount =
    validated.commission_pct !== null && validated.commission_pct !== undefined
      ? validated.total_amount * (validated.commission_pct / 100)
      : null;

  const admin = createAdminClient();
  // Leemos paid_amount actual para calcular delta antes de update
  const { data: current } = await admin
    .from("bookings")
    .select("paid_amount, currency, unit_id")
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

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${id}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  return data as Booking;
}

export async function changeBookingStatus(id: string, newStatus: BookingStatus, reason?: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
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

function nightsBetween(ciISO: string, coISO: string): number {
  const ci = new Date(ciISO + "T12:00:00");
  const co = new Date(coISO + "T12:00:00");
  return Math.round((co.getTime() - ci.getTime()) / 86_400_000);
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
  await requireSession();
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
