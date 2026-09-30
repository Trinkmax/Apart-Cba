import type {
  BookingRequestStatus,
  BookingStatus,
  CancellationPolicy,
  PaymentReportStatus,
  UnitPricingRule,
} from "@/lib/types/database";
import type { ReservationListItem, ReservationView } from "./contracts";
import {
  canReportPayment,
  deriveGuestStage,
  isActiveStage,
  STAGE_COPY,
  stageTimeline,
  type GuestStage,
} from "./guest-stage";
import {
  canonicalNeighborhood,
  cancellationFollowUpCopy,
  checkInWindowLabel,
  digitsOnly,
  displayTitle,
  listingSummaryLine,
  whatsappLink,
} from "./display";
import { countNights, type PricingNight } from "./pricing";
import { computeSena, isSenaCovered, resolveBookingSena, restoAlLlegar, senaDueAt } from "./sena";
import type { ResolvedWebSettings } from "./web-settings";

/**
 * Lógica pura del pedido web y de su seguimiento (`/reserva/<token>`,
 * "Mis reservas"). Las acciones (`marketplace-bookings.ts`,
 * `reservation-status.ts`) leen la base y le pasan las filas; acá se decide
 * TODO lo que ve el huésped: etapa, seña, qué datos se muestran y qué puede
 * hacer. Así la página, la lista y los tests dicen exactamente lo mismo.
 */

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Máximo de avisos de pago sin revisar por reserva (anti-spam del formulario). */
export const MAX_PENDING_PAYMENT_REPORTS = 5;

/** Pedidos pendientes vigentes por email y por teléfono (SPEC 20 · D4). */
export const MAX_PENDING_REQUESTS_PER_CONTACT = 2;

export const RECEIPT_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

// ─── Pequeños helpers ────────────────────────────────────────────────────────

/** Código corto para hablar con el equipo: "AP-" + 6 caracteres del id. */
export function reservationCode(id: string): string {
  return `AP-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Primer nombre para saludar ("María José Pérez" → "María"). */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** "YYYY-MM-DD" que existe en el calendario ("2026-02-30" no: JS lo corre a marzo). */
export function isValidIsoDate(raw: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? "");
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === raw;
}

/** Email para comparar y guardar: sin espacios y en minúsculas. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * WhatsApp del huésped como "+<dígitos>" (lo que usa wa.me), o null si no
 * parece un número. Casi todos los huéspedes son argentinos y lo tipean sin
 * código de país: "351 555-1234" → "+5493515551234". Con "+" o "00" adelante
 * se respeta el código de país que pusieron (salvo el 9 de los celulares de
 * Argentina, que WhatsApp necesita: "+54 351…" → "+54 9 351…").
 */
export function normalizeWhatsapp(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let international = text.startsWith("+");
  let d = digitsOnly(text);
  if (!international && d.startsWith("00")) {
    international = true;
    d = d.slice(2);
  }
  if (!international) {
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 10) d = `549${d}`;
  }
  if (d.length === 12 && d.startsWith("54") && !d.startsWith("549")) d = `549${d.slice(2)}`;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

/**
 * Estadía mínima efectiva: la de la unidad o, si una regla de precio que
 * tarifa alguna noche de la estadía pide más (p. ej. "Fin de año: mínimo 5
 * noches"), la de esa regla.
 */
export function effectiveMinNights(params: {
  unitMinNights: number | null | undefined;
  rules: Pick<UnitPricingRule, "id" | "min_nights_override">[];
  pricedNights: Pick<PricingNight, "rule_id">[];
}): number {
  const base = Math.max(1, Number(params.unitMinNights ?? 1) || 1);
  const used = new Set(params.pricedNights.map((n) => n.rule_id).filter(Boolean));
  let min = base;
  for (const rule of params.rules) {
    const override = Number(rule.min_nights_override ?? 0);
    if (used.has(rule.id) && Number.isFinite(override) && override > min) min = override;
  }
  return min;
}

/** ¿El error de Postgres es el de fechas superpuestas? */
export function isOverlapError(message: string | null | undefined): boolean {
  const m = message ?? "";
  return m.includes("bookings_no_overlap") || m.includes("booking_requests_no_overlap");
}

export const DATES_TAKEN_MESSAGE = "Justo se ocuparon esas fechas. Probá con otras.";

export const MONTHLY_STAY_MESSAGE =
  "Las estadías de 28 noches o más se consultan: escribinos y te pasamos el precio por mes.";

// ─── Filas que arman la vista ────────────────────────────────────────────────

export interface ViewRequestRow {
  id: string;
  status: BookingRequestStatus;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  guest_full_name: string;
  guest_email: string;
  guest_phone: string | null;
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  currency: string;
  total_amount: number;
  cleaning_fee: number | null;
  deposit_estimate: number | null;
}

export interface ViewBookingRow {
  id: string;
  status: BookingStatus;
  created_at: string;
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  currency: string;
  total_amount: number;
  paid_amount: number | null;
  cleaning_fee: number | null;
  deposit_amount: number | null;
}

export interface ViewUnitRow {
  id: string;
  slug: string | null;
  name: string | null;
  marketplace_title: string | null;
  neighborhood: string | null;
  bedrooms: number | null;
  address: string | null;
  cover_url: string | null;
  check_in_window_start: string | null;
  check_in_window_end: string | null;
  cancellation_policy: CancellationPolicy | null;
}

export interface ViewReportRow {
  id: string;
  created_at: string;
  amount: number | null;
  status: PaymentReportStatus;
  receipt_path: string | null;
}

export interface BuildReservationViewInput {
  /** Solicitud web (null en reservas viejas creadas sin solicitud). */
  request: ViewRequestRow | null;
  /** Reserva real (null mientras es un pedido o si se borró). */
  booking: ViewBookingRow | null;
  unit: ViewUnitRow;
  reports: ViewReportRow[];
  settings: ResolvedWebSettings;
  /** /reserva/<token> (lo arma el server con el secreto); null sin solicitud. */
  statusPath: string | null;
  /** Datos del huésped cuando no hay solicitud (reservas viejas). */
  guestFallback?: { full_name: string; email: string; phone: string | null } | null;
  now?: Date;
}

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const optNum = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Qué pasa con la dirección exacta: sólo con una reserva confirmada y viva. */
export function showsExactAddress(stage: GuestStage, hasBooking: boolean): boolean {
  return hasBooking && isActiveStage(stage);
}

/** Los datos para transferir se muestran sólo mientras hay una seña que pagar. */
export function showsTransferDetails(stage: GuestStage): boolean {
  return stage === "sena_pendiente" || stage === "sena_informada";
}

/**
 * La política de cancelación del seguimiento, sólo mientras hay algo que
 * cancelar: el pedido pendiente (se cancela gratis desde el link) o la reserva
 * confirmada que todavía no empezó (se cancela escribiéndonos). En curso,
 * terminada o cerrada, no se muestra.
 */
export function cancellationForStage(
  stage: GuestStage,
  policy: CancellationPolicy | null | undefined,
  customText: string | null | undefined,
): { title: string; body: string } | null {
  if (stage === "pedido_enviado") return cancellationFollowUpCopy(policy, customText, "pending");
  if (stage === "sena_pendiente" || stage === "sena_informada" || stage === "reserva_asegurada") {
    return cancellationFollowUpCopy(policy, customText, "confirmed");
  }
  return null;
}

// ─── La vista ────────────────────────────────────────────────────────────────

/**
 * Arma la vista completa de una reserva web a partir de sus filas.
 * `request` o `booking` tiene que venir (si no hay ninguno, no hay vista).
 */
export function buildReservationView(input: BuildReservationViewInput): ReservationView {
  const { request, booking, unit, settings } = input;
  if (!request && !booking) throw new Error("buildReservationView: falta la solicitud y la reserva");
  const now = input.now ?? new Date();

  // Las fechas y el dinero de la reserva mandan: el equipo puede editarla.
  const checkIn = booking?.check_in_date ?? request!.check_in_date;
  const checkOut = booking?.check_out_date ?? request!.check_out_date;
  const nights = Math.max(0, countNights(checkIn, checkOut));
  const guests = booking?.guests_count ?? request!.guests_count;
  const currency = booking?.currency ?? request?.currency ?? "ARS";
  const total = num(booking ? booking.total_amount : request!.total_amount);
  const cleaning = num(booking ? booking.cleaning_fee : request!.cleaning_fee);
  const paid = booking ? num(booking.paid_amount) : 0;

  const policySena = computeSena({
    policy: settings.deposit,
    nights,
    subtotal: Math.max(0, total - cleaning),
    total,
    currency,
  });
  const sena = resolveBookingSena({
    depositAmount: booking ? optNum(booking.deposit_amount) : null,
    estimate: request ? optNum(request.deposit_estimate) : null,
    fallback: policySena,
  });
  const senaFixed = Boolean(booking && optNum(booking.deposit_amount) != null);

  const pendingReports = input.reports.filter((r) => r.status === "pendiente").length;
  const stage = deriveGuestStage({
    request: request ? { status: request.status, expires_at: request.expires_at } : null,
    booking: booking ? { status: booking.status, paid_amount: paid } : null,
    sena,
    hasPendingPaymentReport: pendingReports > 0,
    stay: { checkIn, checkOut },
    now,
  });
  const copy = STAGE_COPY[stage];
  const hasSena = sena != null && sena > 0;

  const code = reservationCode(request?.id ?? booking!.id);
  const { title, tagline } = displayTitle(unit.marketplace_title || unit.name);
  const guestName = request?.guest_full_name ?? input.guestFallback?.full_name ?? "";
  const waText = `Hola, soy ${guestName.trim() || "un huésped"}. Te escribo por mi reserva ${code} en ${title}.`;

  const confirmedAt = request?.approved_at ?? request?.created_at ?? booking?.created_at ?? null;

  return {
    request_id: request?.id ?? null,
    booking_id: booking?.id ?? null,
    status_path: request ? input.statusPath : null,
    code,
    stage,
    copy,
    timeline: stageTimeline(stage, hasSena),
    created_at: request?.created_at ?? booking!.created_at,
    expires_at: stage === "pedido_enviado" && request ? request.expires_at : null,
    rejection_reason: request?.status === "rechazada" ? request.rejection_reason?.trim() || null : null,
    // Inmediata = solicitud aprobada sin una persona que la apruebe. Las
    // reservas viejas sin solicitud salieron todas por reserva inmediata.
    instant: request ? request.status === "aprobada" && !request.approved_by : true,
    unit: {
      id: unit.id,
      slug: unit.slug ?? unit.id,
      title,
      tagline,
      hood: canonicalNeighborhood(unit.neighborhood),
      summary_line: listingSummaryLine({ bedrooms: unit.bedrooms, neighborhood: unit.neighborhood }),
      cover_url: unit.cover_url,
      address: showsExactAddress(stage, Boolean(booking)) ? unit.address?.trim() || null : null,
      check_in_window: checkInWindowLabel(unit.check_in_window_start, unit.check_in_window_end),
    },
    stay: { check_in: checkIn, check_out: checkOut, nights, guests },
    money: {
      currency,
      total,
      sena: hasSena ? sena : null,
      sena_is_estimate: !senaFixed,
      // Al llegar: lo que falta después de la seña (o de lo ya cobrado, si es más).
      resto: restoAlLlegar(total, Math.max(paid, sena ?? 0)),
      paid,
      sena_due_at: booking && hasSena && confirmedAt ? senaDueAt(confirmedAt, settings.deposit.dueHours) : null,
      sena_covered: Boolean(booking) && isSenaCovered(paid, sena),
    },
    transfer: showsTransferDetails(stage) ? settings.transfer : null,
    can_cancel: stage === "pedido_enviado" && request?.status === "pendiente",
    can_report_payment:
      Boolean(booking) && canReportPayment(stage) && pendingReports < MAX_PENDING_PAYMENT_REPORTS,
    payment_reports: [...input.reports]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((r) => ({
        id: r.id,
        created_at: r.created_at,
        amount: optNum(r.amount),
        status: r.status,
        has_receipt: Boolean(r.receipt_path),
      })),
    contact: {
      whatsapp_url: whatsappLink(settings.whatsappNumber, waText),
      email: settings.publicEmail,
      instagram: settings.instagramHandle,
    },
    response_hours: settings.responseHours,
    cancellation: cancellationForStage(stage, unit.cancellation_policy, settings.cancellationText),
    guest: {
      first_name: firstNameOf(guestName),
      email: request?.guest_email ?? input.guestFallback?.email ?? "",
      phone: request?.guest_phone ?? input.guestFallback?.phone ?? null,
    },
  };
}

// ─── "Mis reservas" ──────────────────────────────────────────────────────────

/** Fila de la lista a partir de la vista completa. */
export function toReservationListItem(view: ReservationView): ReservationListItem {
  return {
    key: view.request_id ?? view.booking_id ?? view.code,
    href: view.status_path ?? `/mi-cuenta/reservas/${view.booking_id ?? view.request_id}`,
    title: view.unit.title,
    hood: view.unit.hood,
    cover_url: view.unit.cover_url,
    check_in: view.stay.check_in,
    check_out: view.stay.check_out,
    nights: view.stay.nights,
    guests: view.stay.guests,
    total: view.money.total,
    currency: view.money.currency,
    stage: view.stage,
    pill: view.copy.pill,
    tone: view.copy.tone,
    created_at: view.created_at,
  };
}

/**
 * Orden de "Mis reservas": primero las vivas (la próxima llegada arriba),
 * después el historial (lo más reciente arriba).
 */
export function sortReservationItems(items: ReservationListItem[]): ReservationListItem[] {
  return [...items].sort((a, b) => {
    const aActive = isActiveStage(a.stage);
    const bActive = isActiveStage(b.stage);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (a.check_in !== b.check_in) {
      return aActive ? a.check_in.localeCompare(b.check_in) : b.check_in.localeCompare(a.check_in);
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

// ─── Comprobantes ────────────────────────────────────────────────────────────

/**
 * Tipo real de un comprobante mirando sus primeros bytes: no se confía en el
 * nombre ni en lo que dice el navegador (Safari manda las fotos HEIC con tipo
 * vacío). Devuelve un tipo aceptado por el bucket `payment-receipts` o null.
 */
export function sniffReceiptMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, len: number) =>
    bytes.length >= start + len ? String.fromCharCode(...bytes.subarray(start, start + len)) : "";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (brand === "mif1" || brand === "msf1") return "image/heif";
  }
  // Un PDF puede traer basura antes de la firma (la norma tolera hasta 1 KB).
  if (ascii(0, Math.min(bytes.length, 1024)).includes("%PDF-")) return "application/pdf";
  return null;
}
