import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/app-url";
import { sendApartEmail } from "@/lib/email/apart/send";
import { firstName, fmtStayRange, money, nightsLabel, reservationCode } from "@/lib/email/apart/format";
import {
  renderDepositRegisteredEmail,
  renderPaymentReportedGuestEmail,
  renderRequestExpiredEmail,
  renderRequestReceivedEmail,
  renderRequestRejectedEmail,
  renderReservationConfirmedEmail,
  renderStaffNewRequestEmail,
  renderStaffPaymentReportedEmail,
  renderStaffRequestReminderEmail,
  type EmailMoney,
  type StaffGuestInfo,
} from "@/lib/email/apart/templates";
import type { ContactInfo, StayBlock } from "@/lib/email/apart/blocks";
import { reservationPath } from "./access-token";
import { getResolvedWebSettingsFresh } from "./web-settings-server";
import { hoursLabel, type ResolvedWebSettings } from "./web-settings";
import { computeSena, depositRuleLabel, isSenaCovered, resolveBookingSena, senaDueAt } from "./sena";
import {
  canonicalNeighborhood,
  cancellationFollowUpCopy,
  checkInWindowLabel,
  displayTitle,
  formatPhoneAR,
  whatsappLink,
} from "./display";
import { countNights, todayIsoAR } from "./pricing";
import type {
  BookingRequestStatus,
  BookingStatus,
  CancellationPolicy,
  NotificationSeverity,
  NotificationType,
} from "@/lib/types/database";

/**
 * Avisos de la web de apart: mails de marca al huésped y al equipo, y
 * notificaciones in-app del panel. Todo best-effort: ninguna función lanza
 * (loguean y siguen), porque se llaman después de que la reserva ya quedó
 * guardada y un mail caído no puede deshacerla.
 *
 * Cada función lee lo que necesita (solicitud, unidad, organización, reserva y
 * la configuración de la web SIN caché) a partir de un id, así quien la llama
 * no tiene que armar nada.
 */

// ─── Lecturas ────────────────────────────────────────────────────────────────

interface UnitRow {
  id: string;
  name: string;
  marketplace_title: string | null;
  slug: string | null;
  neighborhood: string | null;
  address: string | null;
  check_in_window_start: string | null;
  check_in_window_end: string | null;
  cancellation_policy: CancellationPolicy | null;
}

interface OrgRow {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
}

interface RequestRow {
  id: string;
  organization_id: string;
  unit_id: string;
  guest_full_name: string;
  guest_email: string;
  guest_phone: string | null;
  guest_document: string | null;
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  currency: string;
  total_amount: number;
  cleaning_fee: number | null;
  nights: number;
  special_requests: string | null;
  status: BookingRequestStatus;
  expires_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  resulting_booking_id: string | null;
  deposit_estimate: number | null;
  access_token_hash: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  organization_id: string;
  unit_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  guests_count: number | null;
  currency: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  deposit_amount: number | null;
  created_at: string;
  guest: { full_name: string | null; email: string | null; phone: string | null } | null;
}

const UNIT_COLS =
  "id, name, marketplace_title, slug, neighborhood, address, check_in_window_start, check_in_window_end, cancellation_policy";
const REQUEST_COLS =
  "id, organization_id, unit_id, guest_full_name, guest_email, guest_phone, guest_document, check_in_date, check_out_date, guests_count, currency, total_amount, cleaning_fee, nights, special_requests, status, expires_at, approved_at, approved_by, rejection_reason, resulting_booking_id, deposit_estimate, access_token_hash, created_at";
const BOOKING_COLS =
  "id, organization_id, unit_id, status, check_in_date, check_out_date, guests_count, currency, total_amount, paid_amount, deposit_amount, created_at, guest:guests(full_name, email, phone)";

interface Ctx {
  request: RequestRow | null;
  booking: BookingRow | null;
  unit: UnitRow | null;
  org: OrgRow | null;
  settings: ResolvedWebSettings;
}

function one<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

const num = (v: unknown): number => (v != null && Number.isFinite(Number(v)) ? Number(v) : 0);
const optNum = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Lee solicitud + reserva + unidad + organización + configuración de la web.
 * Con sólo `bookingId`, busca la solicitud que la originó (si hay).
 */
async function loadCtx(ids: { requestId?: string | null; bookingId?: string | null }): Promise<Ctx | null> {
  const admin = createAdminClient();

  let request: RequestRow | null = null;
  if (ids.requestId) {
    const { data, error } = await admin.from("booking_requests").select(REQUEST_COLS).eq("id", ids.requestId).maybeSingle();
    if (error) console.warn("[notifications] solicitud:", ids.requestId, error.message);
    request = (data as unknown as RequestRow | null) ?? null;
  }

  let booking: BookingRow | null = null;
  const bookingId = ids.bookingId || request?.resulting_booking_id || null;
  if (bookingId) {
    const { data, error } = await admin.from("bookings").select(BOOKING_COLS).eq("id", bookingId).maybeSingle();
    if (error) console.warn("[notifications] reserva:", bookingId, error.message);
    if (data) {
      const raw = data as unknown as BookingRow & { guest: unknown };
      booking = { ...raw, guest: one<BookingRow["guest"]>(raw.guest) };
    }
  }

  if (!request && booking) {
    const { data } = await admin
      .from("booking_requests")
      .select(REQUEST_COLS)
      .eq("resulting_booking_id", booking.id)
      .eq("organization_id", booking.organization_id)
      .order("created_at", { ascending: false })
      .limit(1);
    request = ((data as unknown as RequestRow[] | null) ?? [])[0] ?? null;
  }

  if (request && booking && request.organization_id !== booking.organization_id) {
    console.warn("[notifications] solicitud y reserva de organizaciones distintas:", request.id, booking.id);
    booking = null;
  }

  const orgId = request?.organization_id ?? booking?.organization_id;
  const unitId = booking?.unit_id ?? request?.unit_id;
  if (!orgId || !unitId) return null;

  const [unitRes, orgRes, settings] = await Promise.all([
    admin.from("units").select(UNIT_COLS).eq("id", unitId).eq("organization_id", orgId).maybeSingle(),
    admin.from("organizations").select("id, name, contact_email, contact_phone").eq("id", orgId).maybeSingle(),
    getResolvedWebSettingsFresh(orgId),
  ]);

  return {
    request,
    booking,
    unit: (unitRes.data as unknown as UnitRow | null) ?? null,
    org: (orgRes.data as unknown as OrgRow | null) ?? null,
    settings,
  };
}

// ─── Datos derivados ─────────────────────────────────────────────────────────

function unitTitleOf(ctx: Ctx): string {
  const u = ctx.unit;
  if (!u) return "tu departamento";
  return displayTitle(u.marketplace_title || u.name).title;
}

function guestNameOf(ctx: Ctx): string {
  return (ctx.request?.guest_full_name || ctx.booking?.guest?.full_name || "").trim();
}

function guestEmailOf(ctx: Ctx): string | null {
  const e = (ctx.request?.guest_email || ctx.booking?.guest?.email || "").trim();
  return e.includes("@") ? e : null;
}

function guestPhoneOf(ctx: Ctx): string | null {
  return (ctx.request?.guest_phone || ctx.booking?.guest?.phone || "").trim() || null;
}

function codeOf(ctx: Ctx): string {
  return reservationCode(ctx.request?.id ?? ctx.booking?.id ?? "");
}

/** Link de seguimiento absoluto (/reserva/<token>); sin solicitud, /mi-cuenta. */
function statusUrlOf(ctx: Ctx): string {
  // Sólo las solicitudes con hash guardado se encuentran desde /reserva/<token>
  // (las del checkout viejo no lo tienen: el link daría "no encontrada").
  if (ctx.request?.access_token_hash) {
    try {
      return absoluteUrl(reservationPath(ctx.request.id));
    } catch (e) {
      console.warn("[notifications] no se pudo firmar el link de la reserva:", e);
    }
  }
  return ctx.booking ? absoluteUrl(`/mi-cuenta/reservas/${ctx.booking.id}`) : absoluteUrl("/mi-cuenta");
}

function stayOf(ctx: Ctx, opts?: { withAddress?: boolean }): StayBlock {
  const b = ctx.booking;
  const r = ctx.request;
  const checkIn = b?.check_in_date ?? r?.check_in_date ?? "";
  const checkOut = b?.check_out_date ?? r?.check_out_date ?? "";
  const nights = checkIn && checkOut ? countNights(checkIn, checkOut) : num(r?.nights);
  const u = ctx.unit;
  return {
    unitTitle: unitTitleOf(ctx),
    hood: canonicalNeighborhood(u?.neighborhood),
    checkIn,
    checkOut,
    nights,
    guests: num(b?.guests_count ?? r?.guests_count) || 1,
    checkInWindow: opts?.withAddress ? checkInWindowLabel(u?.check_in_window_start, u?.check_in_window_end) : null,
    address: opts?.withAddress ? (u?.address?.trim() || null) : null,
  };
}

/** Seña vigente: la fijada por el equipo, la estimada al pedir o la de la política. */
function senaOf(ctx: Ctx): number | null {
  const r = ctx.request;
  const b = ctx.booking;
  const total = num(b?.total_amount ?? r?.total_amount);
  const currency = (b?.currency ?? r?.currency ?? "ARS") || "ARS";
  const nights = r ? num(r.nights) || stayOf(ctx).nights : stayOf(ctx).nights;
  const subtotal = r ? total - num(r.cleaning_fee) : total;
  const fallback = computeSena({ policy: ctx.settings.deposit, nights, subtotal, total, currency });
  return resolveBookingSena({
    depositAmount: b ? optNum(b.deposit_amount) : null,
    estimate: r ? optNum(r.deposit_estimate) : null,
    fallback,
  });
}

function moneyOf(ctx: Ctx, sena: number | null, paid: number = 0): EmailMoney {
  const total = num(ctx.booking?.total_amount ?? ctx.request?.total_amount);
  const currency = (ctx.booking?.currency ?? ctx.request?.currency ?? "ARS") || "ARS";
  const already = Math.max(num(paid), sena ?? 0);
  return { currency, total, sena, resto: Math.max(0, total - already) };
}

/** Contacto de apart para el pie de los mails al huésped (WhatsApp con el código). */
function contactOf(ctx: Ctx): ContactInfo {
  const s = ctx.settings;
  const name = guestNameOf(ctx);
  const waText = `Hola, soy ${name || "un huésped"}. Te escribo por mi reserva ${codeOf(ctx)} en ${unitTitleOf(ctx)}.`;
  return {
    whatsappUrl: whatsappLink(s.whatsappNumber, waText),
    whatsappLabel: s.whatsappNumber ? formatPhoneAR(s.whatsappNumber) : null,
    email: s.publicEmail,
    instagram: s.instagramHandle,
  };
}

/** Datos del huésped para los mails al equipo (con wa.me para responderle). */
function staffGuestOf(ctx: Ctx): StaffGuestInfo {
  const name = guestNameOf(ctx);
  const phone = guestPhoneOf(ctx);
  const hello = `Hola, ${firstName(name) || "¿cómo estás?"}. Te escribimos de apart por tu pedido ${codeOf(ctx)} en ${unitTitleOf(ctx)}.`;
  return {
    fullName: name || "Huésped sin nombre",
    email: guestEmailOf(ctx),
    phone: phone ? (formatPhoneAR(phone) ?? phone) : null,
    phoneWaUrl: phone ? whatsappLink(phone, hello) : null,
    document: ctx.request?.guest_document?.trim() || null,
    message: ctx.request?.special_requests?.trim() || null,
  };
}

/** Casillas del equipo: el contact_email de la organización y el email público si difiere. */
function staffRecipientsOf(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const raw of [ctx.org?.contact_email, ctx.settings.publicEmail]) {
    const e = (raw ?? "").trim();
    if (e.includes("@") && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

async function sendToStaff(ctx: Ctx, mail: { subject: string; html: string; text: string }): Promise<void> {
  const orgId = ctx.org?.id ?? ctx.request?.organization_id ?? ctx.booking?.organization_id;
  if (!orgId) return;
  const recipients = staffRecipientsOf(ctx);
  if (!recipients.length) {
    console.warn("[notifications] la organización no tiene mail de contacto:", orgId);
    return;
  }
  // Responder al mail del equipo le escribe directo al huésped.
  const replyTo = guestEmailOf(ctx);
  await Promise.all(recipients.map((to) => sendApartEmail({ organizationId: orgId, to, replyTo, ...mail })));
}

async function sendToGuest(ctx: Ctx, mail: { subject: string; html: string; text: string }): Promise<boolean> {
  const orgId = ctx.request?.organization_id ?? ctx.booking?.organization_id;
  const to = guestEmailOf(ctx);
  if (!orgId || !to) return false;
  return sendApartEmail({ organizationId: orgId, to, replyTo: ctx.settings.publicEmail, ...mail });
}

/** Notificación in-app del panel. La dedup_key (única por organización) evita repetidas. */
async function insertInApp(p: {
  organizationId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  refType: string;
  refId: string;
  actionUrl: string;
  dedupKey: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert({
      organization_id: p.organizationId,
      type: p.type,
      severity: p.severity,
      title: p.title,
      body: p.body,
      ref_type: p.refType,
      ref_id: p.refId,
      target_role: "admin",
      action_url: p.actionUrl,
      dedup_key: p.dedupKey,
    });
    if (error && error.code !== "23505") console.warn("[notifications] in-app:", p.dedupKey, error.message);
  } catch (e) {
    console.warn("[notifications] in-app:", p.dedupKey, e);
  }
}

/**
 * WhatsApp best-effort: si la organización tiene un canal de Meta activo, deja
 * un evento CRM que los workflows pueden tomar. Sin canal, no hace nada.
 */
async function sendWhatsAppIfPossible(params: { organizationId: string; phone: string; message: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: channel } = await admin
      .from("crm_channels")
      .select("id, provider, status")
      .eq("organization_id", params.organizationId)
      .eq("provider", "meta_cloud")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!channel) return;
    await admin.from("crm_events").insert({
      organization_id: params.organizationId,
      event_type: "marketplace.outbound_message",
      payload: { channel_id: channel.id, phone: params.phone, message: params.message },
    });
  } catch (e) {
    console.warn("[notifications] WhatsApp skip:", e);
  }
}

/** "Ana Pérez · Paraná · 3 al 6 de octubre" para cuerpos in-app. */
function inAppSummary(ctx: Ctx): string {
  const stay = stayOf(ctx);
  const range = stay.checkIn && stay.checkOut ? fmtStayRange(stay.checkIn, stay.checkOut) : "";
  return [guestNameOf(ctx) || "Huésped", stay.unitTitle, range].filter(Boolean).join(" · ");
}

/** Base común de los mails al huésped. */
function guestBase(ctx: Ctx, opts: { sena: number | null; paid?: number; withAddress?: boolean }) {
  return {
    guestFirstName: firstName(guestNameOf(ctx)),
    code: codeOf(ctx),
    statusUrl: statusUrlOf(ctx),
    stay: stayOf(ctx, { withAddress: opts.withAddress }),
    money: moneyOf(ctx, opts.sena, opts.paid ?? 0),
    contact: contactOf(ctx),
  };
}

/** /buscar con las mismas fechas (si siguen en el futuro) y huéspedes. */
function searchUrlOf(ctx: Ctx): string {
  const stay = stayOf(ctx);
  const qs = new URLSearchParams();
  if (stay.checkIn && stay.checkOut && stay.checkIn > todayIsoAR()) {
    qs.set("checkin", stay.checkIn);
    qs.set("checkout", stay.checkOut);
  }
  qs.set("huespedes", String(stay.guests));
  return absoluteUrl(`/buscar?${qs.toString()}`);
}

// ─── Pedido nuevo ────────────────────────────────────────────────────────────

/** Equipo: in-app + mail "Nuevo pedido web" (o "Nueva reserva web" si fue inmediata). */
async function notifyStaffNew(ctx: Ctx, opts: { instant: boolean }): Promise<void> {
  const r = ctx.request;
  const b = ctx.booking;
  const orgId = r?.organization_id ?? b?.organization_id;
  if (!orgId || (!r && !b)) return;
  const asBooking = opts.instant && b != null;
  const stay = stayOf(ctx);
  const m = moneyOf(ctx, senaOf(ctx));
  const panelPath = asBooking ? `/dashboard/reservas/${b!.id}` : `/dashboard/reservas-pendientes/${r?.id ?? ""}`;
  const totalLabel = money(m.total, m.currency);

  await Promise.all([
    insertInApp({
      organizationId: orgId,
      type: "other",
      severity: asBooking ? "success" : "warning",
      title: asBooking ? `Nueva reserva web: ${stay.unitTitle}` : `Nuevo pedido web: ${stay.unitTitle}`,
      body: asBooking
        ? `${inAppSummary(ctx)} · ${nightsLabel(stay.nights)} · ${totalLabel}. Reserva inmediata: falta que transfiera la seña.`
        : `${inAppSummary(ctx)} · ${nightsLabel(stay.nights)} · ${totalLabel}. Respondé en menos de ${hoursLabel(ctx.settings.responseHours)}.`,
      refType: asBooking ? "booking" : "booking_request",
      refId: asBooking ? b!.id : r!.id,
      actionUrl: panelPath,
      dedupKey: asBooking ? `web:bk:new:${b!.id}` : `web:req:new:${r!.id}`,
    }),
    sendToStaff(
      ctx,
      renderStaffNewRequestEmail({
        guest: staffGuestOf(ctx),
        code: codeOf(ctx),
        stay,
        money: m,
        panelUrl: absoluteUrl(panelPath),
        statusUrl: r ? statusUrlOf(ctx) : null,
        instant: asBooking,
        expiresAt: !asBooking && r?.status === "pendiente" ? r.expires_at : null,
        responseHours: ctx.settings.responseHours,
      }),
    ),
  ]);
}

/**
 * Pedido web nuevo (con confirmación). Huésped: "Recibimos tu pedido".
 * Equipo: in-app + mail "Nuevo pedido web".
 */
export async function notifyRequestReceived(p: { requestId: string }): Promise<void> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId });
    if (!ctx?.request) {
      console.warn("[notifications] notifyRequestReceived: no existe la solicitud", p.requestId);
      return;
    }
    const sena = senaOf(ctx);
    const mail = renderRequestReceivedEmail({
      ...guestBase(ctx, { sena }),
      responseHours: ctx.settings.responseHours,
      senaRuleLabel: sena != null ? depositRuleLabel(ctx.settings.deposit) : null,
    });
    await Promise.all([sendToGuest(ctx, mail), notifyStaffNew(ctx, { instant: false })]);
  } catch (e) {
    console.warn("[notifications] notifyRequestReceived:", p.requestId, e);
  }
}

// ─── Confirmación ────────────────────────────────────────────────────────────

/** Mail de reserva confirmada al huésped (+ WhatsApp best-effort). */
async function sendConfirmedToGuest(ctx: Ctx, opts: { instant: boolean }): Promise<boolean> {
  const b = ctx.booking;
  if (!b) return false;
  const sena = senaOf(ctx);
  const paid = num(b.paid_amount);
  const covered = isSenaCovered(paid, sena);
  const pendingSena = covered ? null : sena;
  const confirmedAt = ctx.request?.approved_at ?? ctx.request?.created_at ?? b.created_at;
  const base = guestBase(ctx, { sena: pendingSena, paid, withAddress: covered });

  const mail = renderReservationConfirmedEmail({
    ...base,
    instant: opts.instant,
    senaDueAt: pendingSena ? senaDueAt(confirmedAt, ctx.settings.deposit.dueHours) : null,
    transfer: pendingSena ? ctx.settings.transfer : null,
    // Ya confirmada: la regla de la política y cómo cancelar (el texto de la
    // ficha habla de "antes de pedirla").
    cancellation: cancellationFollowUpCopy(ctx.unit?.cancellation_policy, ctx.settings.cancellationText, "confirmed"),
    paid,
  });
  const sent = await sendToGuest(ctx, mail);

  const phone = guestPhoneOf(ctx);
  if (phone) {
    const hola = base.guestFirstName ? `Hola, ${base.guestFirstName}.` : "Hola.";
    const senaNote = pendingSena
      ? ` Para asegurarla, transferí la seña de ${money(pendingSena, base.money.currency)}.`
      : "";
    await sendWhatsAppIfPossible({
      organizationId: b.organization_id,
      phone,
      message: `${hola} Tu reserva en ${base.stay.unitTitle} del ${fmtStayRange(base.stay.checkIn, base.stay.checkOut)} está confirmada.${senaNote} Todos los detalles: ${base.statusUrl}`,
    });
  }
  return sent;
}

/**
 * Reserva confirmada (el equipo aprobó el pedido, o fue una reserva
 * inmediata). Huésped: confirmado + seña + datos para transferir +
 * vencimiento. Si fue inmediata, además avisa al equipo (in-app + mail).
 */
export async function notifyReservationConfirmed(p: {
  requestId: string;
  bookingId: string;
}): Promise<{ emailSent: boolean }> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId || null, bookingId: p.bookingId });
    if (!ctx?.booking) {
      console.warn("[notifications] notifyReservationConfirmed: no existe la reserva", p.bookingId);
      return { emailSent: false };
    }
    // Inmediata = solicitud aprobada sin una persona que la apruebe.
    const instant = ctx.request ? ctx.request.status === "aprobada" && !ctx.request.approved_by : true;
    const [emailSent] = await Promise.all([
      sendConfirmedToGuest(ctx, { instant }),
      instant ? notifyStaffNew(ctx, { instant: true }) : Promise.resolve(),
    ]);
    return { emailSent };
  } catch (e) {
    console.warn("[notifications] notifyReservationConfirmed:", p.bookingId, e);
    return { emailSent: false };
  }
}

// ─── Pedidos que no llegan a reserva ─────────────────────────────────────────

async function sendRejectedToGuest(ctx: Ctx, reasonOverride?: string | null): Promise<boolean> {
  const r = ctx.request;
  if (!r) return false;
  const base = guestBase(ctx, { sena: senaOf(ctx) });
  const searchUrl = searchUrlOf(ctx);
  const reason = (reasonOverride ?? r.rejection_reason ?? "").trim() || null;
  const sent = await sendToGuest(ctx, renderRequestRejectedEmail({ ...base, reason, searchUrl }));
  const phone = guestPhoneOf(ctx);
  if (phone) {
    const hola = base.guestFirstName ? `Hola, ${base.guestFirstName}.` : "Hola.";
    await sendWhatsAppIfPossible({
      organizationId: r.organization_id,
      phone,
      message: `${hola} No pudimos confirmar tu pedido en ${base.stay.unitTitle} del ${fmtStayRange(base.stay.checkIn, base.stay.checkOut)}. No se te cobró nada. Mirá otras opciones: ${searchUrl}`,
    });
  }
  return sent;
}

/** Pedido rechazado por el equipo. Huésped: "No pudimos confirmar tu pedido". */
export async function notifyRequestRejected(p: { requestId: string }): Promise<{ emailSent: boolean }> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId });
    if (!ctx?.request) {
      console.warn("[notifications] notifyRequestRejected: no existe la solicitud", p.requestId);
      return { emailSent: false };
    }
    return { emailSent: await sendRejectedToGuest(ctx) };
  } catch (e) {
    console.warn("[notifications] notifyRequestRejected:", p.requestId, e);
    return { emailSent: false };
  }
}

/**
 * Pedido vencido sin respuesta. Huésped: "Tu pedido venció" (una sola vez:
 * reclama `guest_notified_at` con un update condicional antes de mandar).
 * Equipo: in-app.
 */
export async function notifyRequestExpired(p: { requestId: string }): Promise<void> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId });
    const r = ctx?.request;
    if (!ctx || !r) return;
    // Sólo el flujo web nuevo avisa: los pedidos del checkout viejo (y los de la
    // cuenta demo) no tienen link de seguimiento, igual que en el barrido.
    if (!r.access_token_hash) return;
    const expired = r.status === "expirada" || (r.status === "pendiente" && Date.parse(r.expires_at) <= Date.now());
    if (!expired) {
      console.warn("[notifications] notifyRequestExpired: la solicitud no está vencida", r.id, r.status);
      return;
    }

    const admin = createAdminClient();
    const { data: claimed, error } = await admin
      .from("booking_requests")
      .update({ guest_notified_at: new Date().toISOString() })
      .eq("id", r.id)
      .is("guest_notified_at", null)
      .select("id");
    if (error) {
      console.warn("[notifications] notifyRequestExpired: no se pudo marcar", r.id, error.message);
      return;
    }
    if (!claimed || claimed.length === 0) return; // ya se le avisó

    const stay = stayOf(ctx);
    await Promise.all([
      sendToGuest(ctx, renderRequestExpiredEmail({ ...guestBase(ctx, { sena: senaOf(ctx) }), searchUrl: searchUrlOf(ctx) })),
      insertInApp({
        organizationId: r.organization_id,
        type: "other",
        severity: "warning",
        title: `Venció un pedido web: ${stay.unitTitle}`,
        body: `${inAppSummary(ctx)}. Nadie lo respondió a tiempo; le avisamos al huésped que no pudimos confirmarle.`,
        refType: "booking_request",
        refId: r.id,
        actionUrl: `/dashboard/reservas-pendientes/${r.id}`,
        dedupKey: `web:req:expired:${r.id}`,
      }),
    ]);
  } catch (e) {
    console.warn("[notifications] notifyRequestExpired:", p.requestId, e);
  }
}

/** El huésped canceló su pedido desde el link de seguimiento. Equipo: in-app. */
export async function notifyRequestCancelledByGuest(p: { requestId: string }): Promise<void> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId });
    const r = ctx?.request;
    if (!ctx || !r) return;
    await insertInApp({
      organizationId: r.organization_id,
      type: "other",
      severity: "info",
      title: `Un huésped canceló su pedido: ${unitTitleOf(ctx)}`,
      body: `${inAppSummary(ctx)}. Lo canceló desde su link de seguimiento; esas fechas quedan libres.`,
      refType: "booking_request",
      refId: r.id,
      actionUrl: `/dashboard/reservas-pendientes/${r.id}`,
      dedupKey: `web:req:cancel:${r.id}`,
    });
  } catch (e) {
    console.warn("[notifications] notifyRequestCancelledByGuest:", p.requestId, e);
  }
}

// ─── Pagos ───────────────────────────────────────────────────────────────────

interface ReportRow {
  id: string;
  organization_id: string;
  booking_id: string;
  booking_request_id: string | null;
  amount: number | null;
  currency: string;
  receipt_path: string | null;
  note: string | null;
}

/**
 * El huésped avisó que transfirió la seña. Equipo: in-app + mail (registrar
 * en Caja). Huésped: acuse "Recibimos tu aviso de pago".
 */
export async function notifyPaymentReported(p: { reportId: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("booking_payment_reports")
      .select("id, organization_id, booking_id, booking_request_id, amount, currency, receipt_path, note")
      .eq("id", p.reportId)
      .maybeSingle();
    const report = (data as unknown as ReportRow | null) ?? null;
    if (!report) {
      console.warn("[notifications] notifyPaymentReported: no existe el aviso", p.reportId);
      return;
    }
    const ctx = await loadCtx({ requestId: report.booking_request_id, bookingId: report.booking_id });
    const b = ctx?.booking;
    if (!ctx || !b || b.organization_id !== report.organization_id) return;

    const sena = senaOf(ctx);
    const paid = num(b.paid_amount);
    const amount = optNum(report.amount);
    const hasReceipt = Boolean(report.receipt_path);
    const m = moneyOf(ctx, sena, paid);
    const panelPath = `/dashboard/reservas/${b.id}`;
    const amountLabel = amount != null && amount > 0 ? money(amount, m.currency) : "la seña";

    await Promise.all([
      insertInApp({
        organizationId: b.organization_id,
        type: "payment_received",
        severity: "warning",
        title: `Aviso de pago: ${guestNameOf(ctx) || "huésped"}`,
        body: `${inAppSummary(ctx)}. Avisó que transfirió ${amountLabel}${hasReceipt ? " (con comprobante)" : ""}. Registrá el cobro en Caja y después marcá el aviso como registrado.`,
        refType: "booking",
        refId: b.id,
        actionUrl: panelPath,
        dedupKey: `web:pay:${report.id}`,
      }),
      sendToStaff(
        ctx,
        renderStaffPaymentReportedEmail({
          guest: staffGuestOf(ctx),
          code: codeOf(ctx),
          stay: stayOf(ctx),
          money: m,
          panelUrl: absoluteUrl(panelPath),
          statusUrl: ctx.request ? statusUrlOf(ctx) : null,
          reportedAmount: amount,
          note: report.note,
          hasReceipt,
          paid,
        }),
      ),
      sendToGuest(
        ctx,
        renderPaymentReportedGuestEmail({ ...guestBase(ctx, { sena, paid }), reportedAmount: amount, hasReceipt }),
      ),
    ]);
  } catch (e) {
    console.warn("[notifications] notifyPaymentReported:", p.reportId, e);
  }
}

/**
 * El equipo registró la seña en Caja y quedó cubierta. Huésped: "Reserva
 * asegurada" (con dirección y horario de check-in).
 */
export async function notifyDepositRegistered(p: {
  requestId: string;
  bookingId: string;
}): Promise<{ emailSent: boolean }> {
  try {
    const ctx = await loadCtx({ requestId: p.requestId || null, bookingId: p.bookingId });
    const b = ctx?.booking;
    if (!ctx || !b) {
      console.warn("[notifications] notifyDepositRegistered: no existe la reserva", p.bookingId);
      return { emailSent: false };
    }
    const sena = senaOf(ctx);
    const paid = num(b.paid_amount);
    const base = guestBase(ctx, { sena, paid, withAddress: true });
    // Lo que falta es exactamente total − pagado (isSenaCovered tolera $1 de
    // redondeo: no hay que "completar" la seña en la cuenta del saldo).
    const mail = renderDepositRegisteredEmail({
      ...base,
      money: { ...base.money, resto: Math.max(0, base.money.total - paid) },
      paid,
    });
    return { emailSent: await sendToGuest(ctx, mail) };
  } catch (e) {
    console.warn("[notifications] notifyDepositRegistered:", p.bookingId, e);
    return { emailSent: false };
  }
}

// ─── Recordatorio al equipo ──────────────────────────────────────────────────

/**
 * Pedido que sigue sin respuesta pasado el plazo prometido. Equipo: in-app +
 * mail. Una sola vez: reclama `staff_reminded_at` con un update condicional.
 */
export async function notifyStaffRequestReminder(p: { requestId: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: claimed, error } = await admin
      .from("booking_requests")
      .update({ staff_reminded_at: new Date().toISOString() })
      .eq("id", p.requestId)
      .eq("status", "pendiente")
      .is("staff_reminded_at", null)
      .select("id");
    if (error) {
      console.warn("[notifications] notifyStaffRequestReminder: no se pudo marcar", p.requestId, error.message);
      return;
    }
    if (!claimed || claimed.length === 0) return; // ya recordado o ya respondido

    const ctx = await loadCtx({ requestId: p.requestId });
    const r = ctx?.request;
    if (!ctx || !r) return;
    const stay = stayOf(ctx);
    const panelPath = `/dashboard/reservas-pendientes/${r.id}`;

    await Promise.all([
      insertInApp({
        organizationId: r.organization_id,
        type: "task_reminder",
        severity: "warning",
        title: `Pedido sin responder: ${stay.unitTitle}`,
        body: `${inAppSummary(ctx)}. Le prometimos respuesta en menos de ${hoursLabel(ctx.settings.responseHours)}.`,
        refType: "booking_request",
        refId: r.id,
        actionUrl: panelPath,
        dedupKey: `web:req:remind:${r.id}`,
      }),
      sendToStaff(
        ctx,
        renderStaffRequestReminderEmail({
          guest: staffGuestOf(ctx),
          code: codeOf(ctx),
          stay,
          money: moneyOf(ctx, senaOf(ctx)),
          panelUrl: absoluteUrl(panelPath),
          statusUrl: statusUrlOf(ctx),
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          responseHours: ctx.settings.responseHours,
        }),
      ),
    ]);
  } catch (e) {
    console.warn("[notifications] notifyStaffRequestReminder:", p.requestId, e);
  }
}

// ─── Compatibilidad (firmas viejas) ──────────────────────────────────────────
// Los flujos viejos del checkout y de la aprobación llaman estas funciones.
// Delegan en las nuevas para que todo salga con la misma marca y el mismo link.

/** @deprecated Usá notifyRequestReceived / notifyReservationConfirmed. */
export async function notifyHostNewBooking(params: {
  organizationId: string;
  bookingId: string;
  unitId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  total: number;
  currency: string;
  isRequest?: boolean;
}): Promise<void> {
  try {
    const ctx = params.isRequest
      ? await loadCtx({ requestId: params.bookingId })
      : await loadCtx({ bookingId: params.bookingId });
    const orgId = ctx?.request?.organization_id ?? ctx?.booking?.organization_id;
    if (!ctx || orgId !== params.organizationId) {
      console.warn("[notifications] notifyHostNewBooking: no se encontró", params.bookingId);
      return;
    }
    await notifyStaffNew(ctx, { instant: !params.isRequest });
  } catch (e) {
    console.warn("[notifications] notifyHostNewBooking:", params.bookingId, e);
  }
}

/**
 * Mail de reserva confirmada al huésped a partir de la reserva (busca la
 * solicitud que la originó para el link de seguimiento).
 * @deprecated Usá notifyReservationConfirmed.
 */
export async function sendBookingConfirmation(params: { bookingId: string }): Promise<void> {
  try {
    const ctx = await loadCtx({ bookingId: params.bookingId });
    if (!ctx?.booking) return;
    const instant = ctx.request ? ctx.request.status === "aprobada" && !ctx.request.approved_by : true;
    await sendConfirmedToGuest(ctx, { instant });
  } catch (e) {
    console.warn("[notifications] sendBookingConfirmation:", params.bookingId, e);
  }
}

/** @deprecated Usá notifyReservationConfirmed. */
export async function notifyGuestBookingConfirmed(params: { bookingId: string }): Promise<void> {
  await sendBookingConfirmation({ bookingId: params.bookingId });
}

/** @deprecated Usá notifyReservationConfirmed. */
export async function notifyGuestRequestApproved(params: { bookingId: string }): Promise<void> {
  await sendBookingConfirmation({ bookingId: params.bookingId });
}

/** @deprecated Usá notifyRequestRejected (lee el motivo de la solicitud). */
export async function notifyGuestRequestRejected(params: {
  requestId: string;
  guestEmail: string;
  guestPhone: string | null;
  guestName: string;
  reason: string;
}): Promise<void> {
  try {
    const ctx = await loadCtx({ requestId: params.requestId });
    if (!ctx?.request) return;
    await sendRejectedToGuest(ctx, params.reason);
  } catch (e) {
    console.warn("[notifications] notifyGuestRequestRejected:", params.requestId, e);
  }
}
