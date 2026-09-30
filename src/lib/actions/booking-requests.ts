"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import type { BookingRequest, BookingRequestWithRelations, UnitPricingRule } from "@/lib/types/database";
import { can } from "@/lib/permissions";
import { todayYmdInTz } from "@/lib/dates";
import { absoluteUrl } from "@/lib/app-url";
import { deriveAccessToken, hashAccessToken, reservationPath } from "@/lib/marketplace/access-token";
import { OCCUPYING_BOOKING_STATUSES } from "@/lib/marketplace/availability";
import { displayTitle, whatsappLink } from "@/lib/marketplace/display";
import { emailIlikePattern, GUEST_MATCH_CANDIDATES, pickReusableGuest } from "@/lib/marketplace/guest-match";
import { computePricing, type PricingNight } from "@/lib/marketplace/pricing";
import type { TransferDetails } from "@/lib/marketplace/web-settings";
import { getResolvedWebSettingsFresh } from "@/lib/marketplace/web-settings-server";
import {
  buildConfirmationMessage,
  buildSenaOptions,
  clampSena,
  suggestedSena,
  toWhatsappDigits,
  type SenaOption,
} from "@/lib/marketplace/staff-helpers";
import { notifyRequestRejected, notifyReservationConfirmed } from "@/lib/marketplace/notifications";
import {
  channelCommissionAmount,
  channelCommissionPctFor,
  DEFAULT_COMMISSION_BASE,
  managementCommissionAmount,
} from "@/lib/finance/booking-economics";

/**
 * Pedidos de la web (booking_requests) vistos por el equipo: listar, confirmar
 * (crea la reserva con la seña elegida y avisa al huésped) y rechazar.
 * Seguridad: sesión + organización + can() adentro de cada acción (el panel
 * corre con service role; la RLS no es el borde).
 */

const REQUEST_SELECT = `*, unit:units(id, code, name, slug, marketplace_title), organization:organizations(id, name)`;

export async function listBookingRequestsForOrg(opts?: {
  status?: "pendiente" | "aprobada" | "rechazada" | "expirada" | "cancelada";
}): Promise<BookingRequestWithRelations[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return [];
  const admin = createAdminClient();

  let q = admin
    .from("booking_requests")
    .select(REQUEST_SELECT)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(300);

  if (opts?.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as BookingRequestWithRelations[];
}

export async function getBookingRequest(id: string): Promise<BookingRequestWithRelations | null> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_requests")
    .select(REQUEST_SELECT)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BookingRequestWithRelations | null) ?? null;
}

const STATUS_WORD: Record<string, string> = {
  aprobada: "ya fue confirmado",
  rechazada: "ya fue rechazado",
  expirada: "venció",
  cancelada: "lo canceló el huésped",
};

/** "Este pedido ya fue confirmado." — para cuando otra persona se adelantó. */
function notPendingMessage(status: string | null | undefined): string {
  const w = status ? STATUS_WORD[status] : null;
  return w ? `Este pedido ${w}. Actualizá la pantalla.` : "Este pedido ya no está pendiente. Actualizá la pantalla.";
}

/**
 * Huésped del PMS para la reserva. El email del pedido web NO está verificado
 * (lead-first), así que una ficha existente se reusa sólo si coinciden el
 * email (sin mayúsculas) Y el WhatsApp (últimos 8 dígitos), y NUNCA se le
 * pisan datos con lo que vino de la web (`guest-match.ts`); si no, ficha
 * nueva. `guests` NO es único por (org, email) —la operación comparte emails
 * de relleno—: se miran varias candidatas, la más vieja primero. La identidad
 * web viaja por `marketplace_user_id`.
 */
async function findOrCreateGuest(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  req: Pick<BookingRequest, "guest_full_name" | "guest_email" | "guest_phone" | "guest_document">,
): Promise<{ id: string } | { error: string }> {
  const { data: candidates, error: findErr } = await admin
    .from("guests")
    .select("id, email, phone")
    .eq("organization_id", orgId)
    .ilike("email", emailIlikePattern(req.guest_email))
    .order("created_at", { ascending: true })
    .limit(GUEST_MATCH_CANDIDATES);
  if (findErr) console.error("[booking-requests] buscar huésped:", findErr.message);
  const existing = pickReusableGuest(candidates, { email: req.guest_email, phone: req.guest_phone });
  if (existing) return { id: existing.id };
  const { data: created, error } = await admin
    .from("guests")
    .insert({
      organization_id: orgId,
      full_name: req.guest_full_name,
      email: req.guest_email,
      phone: req.guest_phone,
      document_number: req.guest_document,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[booking-requests] alta de huésped falló:", error?.message);
    return { error: "No pudimos cargar al huésped. Probá de nuevo." };
  }
  return { id: created.id as string };
}

export type ApproveBookingRequestResult =
  | {
      ok: true;
      bookingId: string;
      /** Si salió el mail de confirmación al huésped. */
      emailSent: boolean;
      /** Link absoluto de seguimiento (/reserva/<token>). */
      statusUrl: string;
      /** Mismo contenido que el mail, listo para pegar en WhatsApp (sin emojis). */
      guestMessage: string;
      /** wa.me al huésped con el mensaje precargado; null sin teléfono usable. */
      guestWhatsappUrl: string | null;
    }
  | { ok: false; error: string };

/**
 * Confirma un pedido: crea la reserva con la seña elegida y avisa al huésped
 * (mail con seña, datos para transferir, plazo y link de seguimiento).
 *
 * `deposit`: monto de la seña (0 = sin seña; se guarda 0 y no null, porque un
 * null haría caer la seña a la estimada). Sin `deposit` → la que propone
 * getApprovalDefaults. La seña NO toca Caja: el cobro se registra cuando entra.
 *
 * Orden: primero se "reclama" el pedido con un update condicional (sólo si
 * sigue pendiente y vigente) — si dos personas confirman a la vez, una sola
 * pasa —, después se crea la reserva; si eso falla, el pedido vuelve a pendiente.
 */
export async function approveBookingRequest(
  id: string,
  options?: { deposit?: number | null; internal_note?: string | null },
): Promise<ApproveBookingRequestResult> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "create")) {
    return { ok: false, error: "No tenés permiso para confirmar reservas." };
  }
  const admin = createAdminClient();

  const { data: row, error: reqErr } = await admin
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (reqErr) {
    console.error("[booking-requests] lectura falló:", reqErr.message);
    return { ok: false, error: "No pudimos leer el pedido. Probá de nuevo." };
  }
  if (!row) return { ok: false, error: "No encontramos el pedido." };
  const req = row as BookingRequest;
  if (req.status !== "pendiente") return { ok: false, error: notPendingMessage(req.status) };
  if (Date.parse(req.expires_at) <= Date.now()) {
    return {
      ok: false,
      error: "El pedido venció sin respuesta. Escribile al huésped: si sigue interesado, cargá la reserva a mano.",
    };
  }

  const totalAmount = Number(req.total_amount ?? 0);
  const settings = await getResolvedWebSettingsFresh(organization.id);
  const stay = {
    nights: Number(req.nights),
    total: totalAmount,
    cleaningFee: req.cleaning_fee,
    currency: req.currency,
  };
  const deposit =
    options?.deposit === undefined
      ? suggestedSena({ ...stay, estimate: req.deposit_estimate, policy: settings.deposit }) ?? 0
      : clampSena(options.deposit, totalAmount, req.currency);
  if (deposit == null) return { ok: false, error: "Revisá el monto de la seña." };

  // 1) Reclamar el pedido. De paso le damos link de seguimiento a los pedidos
  //    viejos que no lo tenían (el token se deriva del id).
  const nowIso = new Date().toISOString();
  const claim: Record<string, unknown> = {
    status: "aprobada",
    approved_at: nowIso,
    approved_by: session.userId,
  };
  if (!req.access_token_hash) claim.access_token_hash = hashAccessToken(deriveAccessToken(id));
  const { data: claimed, error: claimErr } = await admin
    .from("booking_requests")
    .update(claim)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .eq("status", "pendiente")
    .gt("expires_at", nowIso)
    .select("id");
  if (claimErr) {
    console.error("[booking-requests] no se pudo reclamar el pedido:", claimErr.message);
    return { ok: false, error: "No pudimos confirmar el pedido. Probá de nuevo." };
  }
  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await admin.from("booking_requests").select("status").eq("id", id).maybeSingle();
    return { ok: false, error: notPendingMessage((fresh?.status as string | undefined) ?? null) };
  }

  const revertClaim = async () => {
    const { error } = await admin
      .from("booking_requests")
      .update({ status: "pendiente", approved_at: null, approved_by: null })
      .eq("id", id)
      .eq("status", "aprobada")
      .is("resulting_booking_id", null);
    if (error) console.error("[booking-requests] no se pudo devolver el pedido a pendiente:", id, error.message);
  };

  // 2) Huésped del PMS.
  const guest = await findOrCreateGuest(admin, organization.id, req);
  if ("error" in guest) {
    await revertClaim();
    return { ok: false, error: guest.error };
  }

  // 3) Reserva. Mismo snapshot de plata que una reserva cargada a mano:
  //    comisión de administración con el default de la unidad y comisión del
  //    canal 'directo' (null si la org no la configuró: el default aplica
  //    después). `req.total_amount` ya incluye la limpieza (pricing.ts).
  const { data: unit } = await admin
    .from("units")
    .select("name, marketplace_title, default_commission_pct")
    .eq("id", req.unit_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  const commissionPct = Number(unit?.default_commission_pct ?? organization.default_commission_pct ?? 20);
  const channelMap = organization.channel_commissions ?? {};
  const channelPct =
    channelMap.directo === null || channelMap.directo === undefined
      ? null
      : channelCommissionPctFor(channelMap, "directo");
  const commissionAmount = managementCommissionAmount({
    total: totalAmount,
    commissionPct,
    channelPct,
    commissionBase: organization.commission_base ?? DEFAULT_COMMISSION_BASE,
  });
  const note = options?.internal_note?.trim();

  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .insert({
      organization_id: organization.id,
      unit_id: req.unit_id,
      guest_id: guest.id,
      // Identidad web del huésped: sin esto no ve la reserva en /mi-cuenta.
      marketplace_user_id: req.guest_user_id ?? null,
      source: "directo",
      status: "confirmada",
      mode: "temporario",
      check_in_date: req.check_in_date,
      check_in_time: req.check_in_time,
      check_out_date: req.check_out_date,
      check_out_time: req.check_out_time,
      guests_count: req.guests_count,
      currency: req.currency,
      total_amount: req.total_amount,
      paid_amount: 0,
      deposit_amount: deposit,
      cleaning_fee: req.cleaning_fee ?? 0,
      commission_pct: commissionPct,
      commission_amount: commissionAmount,
      channel_commission_pct: channelPct,
      channel_commission_amount: channelCommissionAmount(totalAmount, channelPct),
      notes: req.special_requests,
      internal_notes: note ? `Pedido web ${id}. ${note}` : `Pedido web ${id}`,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (bkErr || !booking) {
    await revertClaim();
    const msg = bkErr?.message ?? "";
    if (msg.includes("bookings_no_overlap")) {
      return {
        ok: false,
        error:
          "Esas fechas ya están ocupadas por otra reserva. Rechazá el pedido (\"Esas fechas ya no están disponibles\") o escribile al huésped para ofrecerle otras.",
      };
    }
    if (msg.includes("bookings_dates_valid")) {
      return { ok: false, error: "Las fechas del pedido no son válidas: revisalas con el huésped." };
    }
    console.error("[booking-requests] alta de reserva falló:", msg);
    return { ok: false, error: "No pudimos crear la reserva. Probá de nuevo." };
  }
  const bookingId = booking.id as string;

  // 4) Vincular el pedido con la reserva.
  const { error: linkErr } = await admin
    .from("booking_requests")
    .update({ resulting_booking_id: bookingId })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (linkErr) console.error("[booking-requests] no se pudo vincular la reserva:", id, linkErr.message);

  // 5) Avisar al huésped (best-effort: la reserva ya existe pase lo que pase).
  let emailSent = false;
  try {
    const r = await notifyReservationConfirmed({ requestId: id, bookingId });
    emailSent = Boolean(r?.emailSent);
  } catch (e) {
    console.warn("[booking-requests] aviso de confirmación falló:", e);
  }

  // Plan B si el mail no sale: el mismo texto para mandar por WhatsApp.
  const statusPath = reservationPath(id);
  const statusUrl = absoluteUrl(statusPath);
  const guestMessage = buildConfirmationMessage({
    guestName: req.guest_full_name,
    unitTitle: displayTitle(unit?.marketplace_title ?? unit?.name ?? null).title,
    checkIn: req.check_in_date,
    checkOut: req.check_out_date,
    nights: Number(req.nights),
    guests: Number(req.guests_count),
    total: totalAmount,
    currency: req.currency,
    sena: deposit > 0 ? deposit : null,
    dueHours: settings.deposit.dueHours,
    transfer: settings.transfer,
    trackingUrl: statusUrl,
  });

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath(`/dashboard/reservas-pendientes/${id}`);
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${bookingId}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/resultados");
  revalidatePath("/mi-cuenta");
  revalidatePath(statusPath);

  return {
    ok: true,
    bookingId,
    emailSent,
    statusUrl,
    guestMessage,
    guestWhatsappUrl: whatsappLink(toWhatsappDigits(req.guest_phone), guestMessage),
  };
}

/**
 * Rechaza un pedido pendiente y le manda al huésped el mail de "no
 * disponible" con el motivo. Update condicional: si otra persona ya lo
 * resolvió, no se pisa.
 */
export async function rejectBookingRequest(
  id: string,
  reason: string,
): Promise<{ ok: true; emailSent: boolean } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "update")) {
    return { ok: false, error: "No tenés permiso para responder pedidos." };
  }
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 5) return { ok: false, error: "Contale al huésped el motivo (al menos unas palabras)." };
  if (trimmed.length > 1000) return { ok: false, error: "El motivo es muy largo (máximo 1000 caracteres)." };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("booking_requests")
    .update({
      status: "rechazada",
      rejected_at: new Date().toISOString(),
      rejected_by: session.userId,
      rejection_reason: trimmed,
    })
    .eq("id", id)
    .eq("organization_id", organization.id)
    .eq("status", "pendiente")
    .select("id");
  if (error) {
    console.error("[booking-requests] rechazo falló:", error.message);
    return { ok: false, error: "No pudimos rechazar el pedido. Probá de nuevo." };
  }
  if (!updated || updated.length === 0) {
    const { data: fresh } = await admin
      .from("booking_requests")
      .select("status")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!fresh) return { ok: false, error: "No encontramos el pedido." };
    return { ok: false, error: notPendingMessage(fresh.status as string) };
  }

  let emailSent = false;
  try {
    const r = await notifyRequestRejected({ requestId: id });
    emailSent = Boolean(r?.emailSent);
  } catch (e) {
    console.warn("[booking-requests] aviso de rechazo falló:", e);
  }

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath(`/dashboard/reservas-pendientes/${id}`);
  revalidatePath("/mi-cuenta");
  return { ok: true, emailSent };
}

export interface ApprovalConflict {
  booking_id: string;
  check_in: string;
  check_out: string;
  status: string;
  source: string | null;
  guest_name: string | null;
  is_block: boolean;
}

export interface ChannelRequestConflict {
  id: string;
  channel: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
}

export interface ApprovalDefaults {
  /** Seña que propone el modal (la estimada que vio el huésped o la de la política). */
  senaSuggested: number | null;
  senaOptions: SenaOption[];
  /** Datos para transferir que se van a mandar (null = no están cargados). */
  transfer: TransferDetails | null;
  /** Horas que tiene el huésped para transferir la seña. */
  dueHours: number;
  /** Reservas que ocupan esas fechas (si hay, confirmar va a fallar). */
  conflicts: ApprovalConflict[];
  /** Solicitudes de OTA sin confirmar en esas fechas (no ocupan, pero avisan). */
  requestConflicts: ChannelRequestConflict[];
  /** Desglose por noche con las tarifas actuales de la unidad. */
  nightly: {
    nights: PricingNight[];
    subtotal: number;
    cleaning_fee: number;
    total: number;
    /** Las tarifas cambiaron desde el pedido (manda el total del pedido). */
    differs: boolean;
  } | null;
}

/**
 * Lo que necesita el modal "Confirmar reserva" y el detalle del pedido:
 * opciones de seña, datos de transferencia, plazo, chequeo de ocupación y
 * desglose por noche. null si el pedido no existe en la organización.
 */
export async function getApprovalDefaults(requestId: string): Promise<ApprovalDefaults | null> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return null;
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("booking_requests")
    .select("*")
    .eq("id", requestId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!row) return null;
  const req = row as BookingRequest;

  const [settings, bookingsRes, channelRes, unitRes, rulesRes] = await Promise.all([
    getResolvedWebSettingsFresh(organization.id),
    admin
      .from("bookings")
      .select("id, check_in_date, check_out_date, status, source, is_block, guest:guests(full_name)")
      .eq("organization_id", organization.id)
      .eq("unit_id", req.unit_id)
      .in("status", OCCUPYING_BOOKING_STATUSES as unknown as string[])
      .lt("check_in_date", req.check_out_date)
      .gt("check_out_date", req.check_in_date)
      .order("check_in_date")
      .limit(20),
    admin
      .from("channel_reservations")
      .select("id, channel, check_in, check_out, guest")
      .eq("organization_id", organization.id)
      .eq("unit_id", req.unit_id)
      .eq("external_status", "pending")
      .lt("check_in", req.check_out_date)
      .gt("check_out", req.check_in_date)
      .limit(20),
    admin
      .from("units")
      .select("base_price, cleaning_fee")
      .eq("id", req.unit_id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    admin.from("unit_pricing_rules").select("*").eq("unit_id", req.unit_id).eq("active", true),
  ]);

  const total = Number(req.total_amount ?? 0);
  const stay = { nights: Number(req.nights), total, cleaningFee: req.cleaning_fee, currency: req.currency };

  const conflicts: ApprovalConflict[] = (bookingsRes.data ?? [])
    .filter((b) => b.id !== req.resulting_booking_id)
    .map((b) => {
      const g = (Array.isArray(b.guest) ? b.guest[0] : b.guest) as { full_name?: string | null } | null;
      return {
        booking_id: b.id as string,
        check_in: b.check_in_date as string,
        check_out: b.check_out_date as string,
        status: b.status as string,
        source: (b.source as string | null) ?? null,
        guest_name: g?.full_name ?? null,
        is_block: Boolean(b.is_block),
      };
    });
  if (bookingsRes.error) console.error("[booking-requests] chequeo de ocupación falló:", bookingsRes.error.message);

  const requestConflicts: ChannelRequestConflict[] = (channelRes.data ?? []).map((r) => ({
    id: r.id as string,
    channel: r.channel as string,
    check_in: r.check_in as string,
    check_out: r.check_out as string,
    guest_name: ((r.guest as { name?: string } | null)?.name ?? null) || null,
  }));

  let nightly: ApprovalDefaults["nightly"] = null;
  const unit = unitRes.data;
  if (unit && req.check_out_date > req.check_in_date) {
    const b = computePricing({
      checkInIso: req.check_in_date,
      checkOutIso: req.check_out_date,
      basePrice: Number(unit.base_price ?? 0),
      // La limpieza que se cobró en el pedido manda sobre la actual de la unidad.
      cleaningFee: req.cleaning_fee != null ? Number(req.cleaning_fee) : unit.cleaning_fee != null ? Number(unit.cleaning_fee) : null,
      rules: (rulesRes.data ?? []) as UnitPricingRule[],
    });
    nightly = {
      nights: b.nights,
      subtotal: b.subtotal,
      cleaning_fee: b.cleaning_fee,
      total: b.total,
      differs: Math.abs(b.total - total) >= 1,
    };
  }

  return {
    senaSuggested: suggestedSena({ ...stay, estimate: req.deposit_estimate, policy: settings.deposit }),
    senaOptions: buildSenaOptions({ ...stay, policy: settings.deposit }),
    transfer: settings.transfer,
    dueHours: settings.deposit.dueHours,
    conflicts,
    requestConflicts,
    nightly,
  };
}

export async function countPendingRequestsForOrg(): Promise<number> {
  // Es callable desde el cliente (la usa el contador del sidebar) y corre con
  // service_role: sin este gate, cualquier rol podía sondear el volumen de
  // solicitudes de la organización.
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) return 0;
  const admin = createAdminClient();
  // Las dos clases de solicitud viven en la misma pantalla, así que el badge
  // tiene que contar las dos: las del marketplace y las de las OTAs (que
  // tampoco ocupan el calendario hasta confirmarse).
  const [own, ota] = await Promise.all([
    admin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "pendiente")
      .gt("expires_at", new Date().toISOString()),
    can(role, "channels", "view")
      ? admin
          .from("channel_reservations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organization.id)
          .eq("external_status", "pending")
          // Vencidas y huérfanas afuera: sin esto sumaban al badge sin aparecer
          // en ninguna pantalla, y no había forma de bajarlo. (La bandeja filtra
          // por fecha pero no por `link_id`; una fila sin conexión es
          // inalcanzable hoy, y si apareciera conviene verla ahí.)
          .gte("check_out", todayYmdInTz())
          .not("link_id", "is", null)
      : Promise.resolve({ count: 0 }),
  ]);
  return (own.count ?? 0) + (ota.count ?? 0);
}
