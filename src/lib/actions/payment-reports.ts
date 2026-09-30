"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import type { PaymentReportStatus } from "@/lib/types/database";
import { reservationPath } from "@/lib/marketplace/access-token";
import { computeSena, isSenaCovered, resolveBookingSena, senaDueAt } from "@/lib/marketplace/sena";
import { getResolvedWebSettingsFresh } from "@/lib/marketplace/web-settings-server";
import { secureDepositIfCovered } from "@/lib/marketplace/deposit-events";

/**
 * Avisos de pago del huésped ("Ya transferí la seña") vistos por el equipo.
 * Un aviso NO es un cobro: la plata entra a Caja cuando una persona la
 * registra (addBookingPayment). Acá sólo se listan, se abre el comprobante
 * (URL firmada del bucket privado) y se marcan registrado/descartado.
 */

const RECEIPTS_BUCKET = "payment-receipts";
const SIGNED_URL_TTL_SECS = 10 * 60;

export interface PaymentReportRow {
  id: string;
  booking_id: string;
  booking_request_id: string | null;
  amount: number | null;
  currency: string;
  note: string | null;
  status: PaymentReportStatus;
  has_receipt: boolean;
  receipt_mime: string | null;
  created_at: string;
  reviewed_at: string | null;
  /** Nombre y teléfono del huésped (del pedido web o de la ficha del PMS). */
  guest_name: string | null;
  guest_phone: string | null;
  unit: { id: string; code: string | null; name: string | null } | null;
  booking: {
    check_in_date: string;
    check_out_date: string;
    total_amount: number;
    paid_amount: number;
    deposit_amount: number | null;
    currency: string;
    status: string;
  } | null;
}

const REPORT_SELECT = `id, booking_id, booking_request_id, amount, currency, note, status, receipt_path, receipt_mime, created_at, reviewed_at,
  booking:bookings(id, check_in_date, check_out_date, total_amount, paid_amount, deposit_amount, currency, status,
    unit:units(id, code, name, marketplace_title), guest:guests(full_name, phone)),
  request:booking_requests(guest_full_name, guest_phone)`;

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function toRow(r: Record<string, unknown>): PaymentReportRow {
  const booking = one(r.booking as Rel<Record<string, unknown>>);
  const unit = one(booking?.unit as Rel<Record<string, unknown>>);
  const guest = one(booking?.guest as Rel<Record<string, unknown>>);
  const request = one(r.request as Rel<Record<string, unknown>>);
  return {
    id: r.id as string,
    booking_id: r.booking_id as string,
    booking_request_id: (r.booking_request_id as string | null) ?? null,
    amount: r.amount != null ? Number(r.amount) : null,
    currency: (r.currency as string) || "ARS",
    note: (r.note as string | null) ?? null,
    status: r.status as PaymentReportStatus,
    has_receipt: Boolean(r.receipt_path),
    receipt_mime: (r.receipt_mime as string | null) ?? null,
    created_at: r.created_at as string,
    reviewed_at: (r.reviewed_at as string | null) ?? null,
    guest_name: ((request?.guest_full_name as string | undefined) || (guest?.full_name as string | undefined)) ?? null,
    guest_phone: ((request?.guest_phone as string | undefined) || (guest?.phone as string | undefined)) ?? null,
    unit: unit
      ? {
          id: unit.id as string,
          code: (unit.code as string | null) ?? null,
          name: ((unit.marketplace_title as string | null) || (unit.name as string | null)) ?? null,
        }
      : null,
    booking: booking
      ? {
          check_in_date: booking.check_in_date as string,
          check_out_date: booking.check_out_date as string,
          total_amount: Number(booking.total_amount ?? 0),
          paid_amount: Number(booking.paid_amount ?? 0),
          deposit_amount: booking.deposit_amount != null ? Number(booking.deposit_amount) : null,
          currency: (booking.currency as string) || "ARS",
          status: booking.status as string,
        }
      : null,
  };
}

export async function listPaymentReports(opts?: {
  status?: PaymentReportStatus;
  bookingId?: string;
}): Promise<PaymentReportRow[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "view")) return [];
  const admin = createAdminClient();
  let q = admin
    .from("booking_payment_reports")
    .select(REPORT_SELECT)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.bookingId) q = q.eq("booking_id", opts.bookingId);
  const { data, error } = await q;
  if (error) {
    console.error("[payment-reports] listado falló:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

export async function getPaymentReceiptUrl(
  reportId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "view")) return { ok: false, error: "No tenés permiso para ver comprobantes." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_payment_reports")
    .select("receipt_path")
    .eq("id", reportId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "No encontramos el aviso." };
  const raw = (data.receipt_path as string | null)?.trim();
  if (!raw) return { ok: false, error: "Este aviso no tiene comprobante adjunto." };
  // La fila ya está filtrada por organización (la escribe el server). Por si
  // alguien guardó la ruta con el nombre del bucket adelante, se lo sacamos.
  const path = raw.replace(new RegExp(`^/?${RECEIPTS_BUCKET}/`), "");
  const { data: signed, error: signErr } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECS);
  if (signErr || !signed?.signedUrl) {
    console.error("[payment-reports] no se pudo firmar el comprobante:", signErr?.message);
    return { ok: false, error: "No pudimos abrir el comprobante. Probá de nuevo." };
  }
  return { ok: true, url: signed.signedUrl };
}

type Admin = ReturnType<typeof createAdminClient>;

interface BookingSenaState {
  bookingId: string;
  requestId: string | null;
  currency: string;
  total: number;
  paid: number;
  /** Seña vigente (resolveBookingSena); null = sin seña. */
  sena: number | null;
  /** true si el equipo todavía no fijó la seña (es la estimada al pedir). */
  senaIsEstimate: boolean;
  dueAt: string | null;
  covered: boolean;
  missing: number;
}

/** Seña de una reserva calculada igual que la ve el huésped en /reserva/<token>. */
async function loadBookingSena(admin: Admin, orgId: string, bookingId: string): Promise<BookingSenaState | null> {
  const [bookingRes, requestRes, settings] = await Promise.all([
    admin
      .from("bookings")
      .select("id, total_amount, paid_amount, deposit_amount, cleaning_fee, currency, check_in_date, check_out_date")
      .eq("id", bookingId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("booking_requests")
      .select("id, deposit_estimate, approved_at, created_at, nights")
      .eq("organization_id", orgId)
      .eq("resulting_booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getResolvedWebSettingsFresh(orgId),
  ]);
  const b = bookingRes.data;
  if (!b) return null;
  const req = requestRes.data;
  const total = Number(b.total_amount ?? 0);
  const paid = Number(b.paid_amount ?? 0);
  const currency = (b.currency as string) || "ARS";
  const nights =
    Number(req?.nights ?? 0) ||
    Math.max(1, Math.round((Date.parse(`${b.check_out_date}T00:00:00Z`) - Date.parse(`${b.check_in_date}T00:00:00Z`)) / 86_400_000));
  const fallback = computeSena({
    policy: settings.deposit,
    nights,
    subtotal: Math.max(0, total - Number(b.cleaning_fee ?? 0)),
    total,
    currency,
  });
  const sena = resolveBookingSena({
    depositAmount: b.deposit_amount != null ? Number(b.deposit_amount) : null,
    estimate: req?.deposit_estimate != null ? Number(req.deposit_estimate) : null,
    fallback,
  });
  const covered = isSenaCovered(paid, sena);
  const confirmedAt = (req?.approved_at as string | null) ?? (req?.created_at as string | null) ?? null;
  return {
    bookingId,
    requestId: (req?.id as string | undefined) ?? null,
    currency,
    total,
    paid,
    sena,
    senaIsEstimate: b.deposit_amount == null,
    dueAt: sena != null && confirmedAt ? senaDueAt(confirmedAt, settings.deposit.dueHours) : null,
    covered,
    missing: covered || sena == null ? 0 : Math.max(0, sena - paid),
  };
}

export type ResolvePaymentReportResult =
  | { ok: true; senaCovered: boolean; missing: number; emailSent: boolean }
  | { ok: false; error: string };

/**
 * Cierra un aviso de pago. "registrado" = el equipo ya cargó el cobro en Caja
 * (la seña cubierta dispara el mail "Reserva asegurada", una sola vez);
 * "descartado" = no corresponde (duplicado, monto equivocado, prueba).
 */
export async function resolvePaymentReport(input: {
  reportId: string;
  status: "registrado" | "descartado";
}): Promise<ResolvePaymentReportResult> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "update")) return { ok: false, error: "No tenés permiso para resolver avisos de pago." };
  if (input.status !== "registrado" && input.status !== "descartado") return { ok: false, error: "Acción inválida." };
  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("booking_payment_reports")
    .update({ status: input.status, reviewed_by: session.userId, reviewed_at: new Date().toISOString() })
    .eq("id", input.reportId)
    .eq("organization_id", organization.id)
    .eq("status", "pendiente")
    .select("id, booking_id, booking_request_id, amount");
  if (error) {
    console.error("[payment-reports] resolver falló:", error.message);
    return { ok: false, error: "No pudimos actualizar el aviso. Probá de nuevo." };
  }
  const report = updated?.[0];
  if (!report) return { ok: false, error: "Este aviso ya fue resuelto. Actualizá la pantalla." };
  const bookingId = report.booking_id as string;

  let senaCovered = false;
  let missing = 0;
  let emailSent = false;
  let requestId = (report.booking_request_id as string | null) ?? null;
  const state = await loadBookingSena(admin, organization.id, bookingId);
  if (state) {
    senaCovered = state.covered;
    missing = state.missing;
    requestId = requestId ?? state.requestId;
  }

  if (input.status === "registrado" && state && state.sena != null && senaCovered) {
    // Mismo cierre que al registrar un cobro en Caja: marca los demás avisos y
    // manda "Reserva asegurada" una sola vez (reclamo de deposit_secured_at).
    const r = await secureDepositIfCovered({
      bookingId,
      organizationId: organization.id,
      actorUserId: session.userId,
    });
    emailSent = r.emailSent;
  }

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath(`/dashboard/reservas/${bookingId}`);
  revalidatePath("/mi-cuenta");
  if (requestId) {
    revalidatePath(`/dashboard/reservas-pendientes/${requestId}`);
    revalidatePath(reservationPath(requestId));
  }
  return { ok: true, senaCovered, missing, emailSent };
}

export interface BookingSenaSummary {
  /** Seña vigente (null = sin seña). */
  amount: number | null;
  /** true si todavía es la estimada al pedir (el equipo no fijó una). */
  isEstimate: boolean;
  paid: number;
  covered: boolean;
  missing: number;
  dueAt: string | null;
  currency: string;
}

export interface BookingPaymentPanel {
  /** La reserva salió de un pedido de la web. */
  isWeb: boolean;
  requestId: string | null;
  reports: PaymentReportRow[];
  /** Resumen de la seña (sólo reservas de la web). */
  sena: BookingSenaSummary | null;
  /** Puede marcar avisos como registrado/descartado. */
  canResolve: boolean;
}

/**
 * Datos de la tarjeta "Avisos de pago del huésped" del detalle de reserva.
 * null cuando no corresponde mostrarla (sin permiso, o reserva que no viene
 * de la web y no tiene avisos).
 */
export async function getBookingPaymentPanel(bookingId: string): Promise<BookingPaymentPanel | null> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "payments", "view")) return null;
  const admin = createAdminClient();

  const [reports, state] = await Promise.all([
    listPaymentReports({ bookingId }),
    loadBookingSena(admin, organization.id, bookingId),
  ]);
  if (!state) return null;
  const isWeb = state.requestId != null;
  if (!isWeb && reports.length === 0) return null;

  return {
    isWeb,
    requestId: state.requestId,
    reports,
    sena: isWeb
      ? {
          amount: state.sena,
          isEstimate: state.senaIsEstimate,
          paid: state.paid,
          covered: state.covered,
          missing: state.missing,
          dueAt: state.dueAt,
          currency: state.currency,
        }
      : null,
    canResolve: can(role, "payments", "update"),
  };
}
