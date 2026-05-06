"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type {
  BookingPaymentSchedule,
  BookingPaymentScheduleWithBooking,
  PaymentScheduleStatus,
} from "@/lib/types/database";

// ════════════════════════════════════════════════════════════════════════════
// Genera/regenera cuotas de una booking mensual (delegado al RPC SQL).
// Usado al crear booking mensual y al editar fechas/renta.
// ════════════════════════════════════════════════════════════════════════════
export async function generateScheduleForBooking(
  bookingId: string
): Promise<number> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: bk, error: bkErr } = await admin
    .from("bookings")
    .select("id")
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (bkErr) throw new Error(bkErr.message);
  if (!bk) throw new Error("Reserva no encontrada");

  const { data, error } = await admin.rpc(
    "generate_payment_schedule_for_booking",
    { p_booking_id: bookingId }
  );
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Lista cuotas de una booking (o de un lease group entero).
// ════════════════════════════════════════════════════════════════════════════
export async function listScheduleForBooking(
  bookingId: string
): Promise<BookingPaymentSchedule[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_schedule")
    .select("*")
    .eq("booking_id", bookingId)
    .eq("organization_id", organization.id)
    .order("sequence_number");
  if (error) throw new Error(error.message);
  return (data as BookingPaymentSchedule[]) ?? [];
}

export async function listScheduleForLeaseGroup(
  leaseGroupId: string
): Promise<BookingPaymentSchedule[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_schedule")
    .select("*")
    .eq("lease_group_id", leaseGroupId)
    .eq("organization_id", organization.id)
    .order("sequence_number");
  if (error) throw new Error(error.message);
  return (data as BookingPaymentSchedule[]) ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// Lista cuotas próximas (para badge en sidebar y dashboard cards).
// ════════════════════════════════════════════════════════════════════════════
export async function listUpcomingSchedule(
  daysAhead = 14
): Promise<BookingPaymentScheduleWithBooking[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + daysAhead);
  const todayISO = today.toISOString().slice(0, 10);
  const horizonISO = horizon.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("booking_payment_schedule")
    .select(
      `*, booking:bookings(id, unit_id, mode, status, currency, monthly_rent, monthly_expenses, total_amount, paid_amount, lease_group_id, guest:guests(id, full_name, phone, email), unit:units(id, code, name))`
    )
    .eq("organization_id", organization.id)
    .in("status", ["pending", "partial", "overdue"])
    .lte("due_date", horizonISO)
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (
    (data as BookingPaymentScheduleWithBooking[])?.filter(
      (r) =>
        r.status === "overdue" ||
        r.due_date >= todayISO ||
        Number(r.paid_amount) < Number(r.expected_amount)
    ) ?? []
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cuotas vencidas (para filtro "Cuotas vencidas" en calendario).
// Devuelve mapa booking_id → cuotas vencidas.
// ════════════════════════════════════════════════════════════════════════════
export async function listOverdueScheduleByBooking(): Promise<
  Record<string, BookingPaymentSchedule[]>
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_schedule")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("status", "overdue")
    .order("due_date");
  if (error) throw new Error(error.message);
  const map: Record<string, BookingPaymentSchedule[]> = {};
  ((data as BookingPaymentSchedule[]) ?? []).forEach((s) => {
    (map[s.booking_id] ??= []).push(s);
  });
  return map;
}

// ════════════════════════════════════════════════════════════════════════════
// Mapa schedule por booking — para overlay de badges en calendario.
// Se invoca server-side y se pasa como prop al PMS Grid / Monthly Board.
// ════════════════════════════════════════════════════════════════════════════
export async function listScheduleInRange(
  fromISO: string,
  toISO: string
): Promise<BookingPaymentSchedule[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_schedule")
    .select("*")
    .eq("organization_id", organization.id)
    .gte("due_date", fromISO)
    .lte("due_date", toISO)
    .order("due_date");
  if (error) throw new Error(error.message);
  return (data as BookingPaymentSchedule[]) ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// Marcar cuota como pagada → genera cash_movement + actualiza booking.paid_amount
// ════════════════════════════════════════════════════════════════════════════
const markPaidSchema = z.object({
  schedule_id: z.string().uuid(),
  amount: z.coerce.number().positive("El importe debe ser mayor a 0"),
  account_id: z.string().uuid("Cuenta de caja requerida"),
  paid_at: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type MarkScheduleAsPaidInput = z.infer<typeof markPaidSchema>;

export async function markScheduleAsPaid(
  input: MarkScheduleAsPaidInput
): Promise<BookingPaymentSchedule> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "create")) {
    throw new Error("No tenés permisos para registrar pagos");
  }
  const validated = markPaidSchema.parse(input);
  const admin = createAdminClient();

  const { data: schedule, error: scheduleErr } = await admin
    .from("booking_payment_schedule")
    .select(
      "id, booking_id, organization_id, expected_amount, paid_amount, currency, sequence_number, total_count, due_date"
    )
    .eq("id", validated.schedule_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (scheduleErr) throw new Error(scheduleErr.message);
  if (!schedule) throw new Error("Cuota no encontrada");

  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .select("id, unit_id, currency, paid_amount, total_amount")
    .eq("id", schedule.booking_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (bkErr) throw new Error(bkErr.message);
  if (!booking) throw new Error("Reserva asociada no encontrada");

  const { data: account } = await admin
    .from("cash_accounts")
    .select("id, currency")
    .eq("id", validated.account_id)
    .eq("organization_id", organization.id)
    .eq("active", true)
    .maybeSingle();
  if (!account) throw new Error("Cuenta de caja no encontrada o inactiva");
  if (account.currency !== schedule.currency) {
    throw new Error(
      `Moneda incompatible: cuenta en ${account.currency}, cuota en ${schedule.currency}`
    );
  }

  const occurredAt = validated.paid_at ?? new Date().toISOString();

  // 1. cash_movement (ledger source of truth)
  const { data: movement, error: movErr } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: validated.account_id,
      direction: "in",
      amount: validated.amount,
      currency: schedule.currency,
      category: "booking_payment",
      ref_type: "payment_schedule",
      ref_id: schedule.id,
      unit_id: booking.unit_id,
      billable_to: "owner",
      description:
        validated.notes ??
        `Cuota ${schedule.sequence_number}/${schedule.total_count} · vencía ${schedule.due_date}`,
      occurred_at: occurredAt,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (movErr)
    throw new Error(`Error al registrar movimiento de caja: ${movErr.message}`);

  // 2. Actualizar schedule
  const newPaid = Number(schedule.paid_amount) + Number(validated.amount);
  const expected = Number(schedule.expected_amount);
  const newStatus: PaymentScheduleStatus =
    newPaid >= expected - 0.01 ? "paid" : "partial";

  const { data: updated, error: updErr } = await admin
    .from("booking_payment_schedule")
    .update({
      paid_amount: newPaid,
      status: newStatus,
      paid_at: newStatus === "paid" ? occurredAt : null,
      cash_movement_id: movement.id,
      notes: validated.notes ?? undefined,
    })
    .eq("id", schedule.id)
    .eq("organization_id", organization.id)
    .select()
    .single();
  if (updErr) throw new Error(updErr.message);

  // 3. Actualizar bookings.paid_amount (mantiene consistencia con vista PMS)
  const newBookingPaid =
    Number(booking.paid_amount ?? 0) + Number(validated.amount);
  await admin
    .from("bookings")
    .update({ paid_amount: newBookingPaid })
    .eq("id", booking.id)
    .eq("organization_id", organization.id);

  // 4. Dismiss notificaciones asociadas a esta cuota
  await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("organization_id", organization.id)
    .eq("ref_type", "booking_payment_schedule")
    .eq("ref_id", schedule.id)
    .is("dismissed_at", null);

  // 5. Notificación de éxito (informativa, opcional)
  await admin.from("notifications").insert({
    organization_id: organization.id,
    type: "payment_received",
    severity: "success",
    title: `Cobro registrado · cuota ${schedule.sequence_number}/${schedule.total_count}`,
    body: `${schedule.currency} ${Number(validated.amount).toLocaleString("es-AR", { maximumFractionDigits: 2 })}${newStatus === "partial" ? " (parcial)" : ""}`,
    ref_type: "booking_payment_schedule",
    ref_id: schedule.id,
    action_url: `/dashboard/reservas/${booking.id}`,
    created_by: session.userId,
  });

  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${booking.id}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/caja");
  revalidatePath("/dashboard/alertas");
  revalidatePath("/dashboard");

  try {
    const { publishCrmEvent } = await import("@/lib/crm/events");
    await publishCrmEvent({
      organizationId: organization.id,
      eventType: "payment.received",
      payload: { schedule_id: schedule.id, booking_id: booking.id, amount: validated.amount, status: newStatus },
      refType: "booking_payment_schedule",
      refId: schedule.id,
    });
  } catch (e) {
    console.warn("[payment-schedule/markScheduleAsPaid] crm publish failed", e);
  }

  return updated as BookingPaymentSchedule;
}

// ════════════════════════════════════════════════════════════════════════════
// Posponer cuota (cambiar due_date)
// ════════════════════════════════════════════════════════════════════════════
const postponeSchema = z.object({
  schedule_id: z.string().uuid(),
  new_due_date: z.string().min(10, "Fecha requerida"),
  reason: z.string().optional().nullable(),
});

export async function postponeSchedule(
  input: z.infer<typeof postponeSchema>
): Promise<BookingPaymentSchedule> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos para mover cuotas");
  }
  const validated = postponeSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_schedule")
    .update({
      due_date: validated.new_due_date,
      status: "pending",
      notes: validated.reason
        ? `Pospuesta: ${validated.reason}`
        : undefined,
    })
    .eq("id", validated.schedule_id)
    .eq("organization_id", organization.id)
    .in("status", ["pending", "overdue", "partial"])
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Refresh notificaciones asociadas
  await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("organization_id", organization.id)
    .eq("ref_type", "booking_payment_schedule")
    .eq("ref_id", validated.schedule_id)
    .is("dismissed_at", null);

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/alertas");
  return data as BookingPaymentSchedule;
}

// ════════════════════════════════════════════════════════════════════════════
// Cancelar cuota (ej. el inquilino se va antes)
// ════════════════════════════════════════════════════════════════════════════
export async function cancelSchedule(scheduleId: string, reason?: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    throw new Error("No tenés permisos");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("booking_payment_schedule")
    .update({
      status: "cancelled",
      notes: reason ? `Cancelada: ${reason}` : undefined,
    })
    .eq("id", scheduleId)
    .eq("organization_id", organization.id)
    .in("status", ["pending", "overdue"]);
  if (error) throw new Error(error.message);

  await admin
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("organization_id", organization.id)
    .eq("ref_type", "booking_payment_schedule")
    .eq("ref_id", scheduleId)
    .is("dismissed_at", null);

  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/alertas");
}
