"use server";

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getGuestSession, type GuestSession } from "./guest-auth";
import { cancelReservationRequest } from "./reservation-status";
import { checkUnitAvailability } from "@/lib/marketplace/availability";
import { computePricing, countNights, todayIsoAR, type PricingBreakdown } from "@/lib/marketplace/pricing";
import { getStorefrontListingById } from "@/lib/marketplace/storefront";
import { getResolvedWebSettings } from "@/lib/marketplace/web-settings-server";
import { deriveAccessToken, hashAccessToken, reservationPath } from "@/lib/marketplace/access-token";
import { computeSena } from "@/lib/marketplace/sena";
import { isMonthlyStay } from "@/lib/marketplace/stay";
import { emailIlikePattern, GUEST_MATCH_CANDIDATES, pickReusableGuest } from "@/lib/marketplace/guest-match";
import {
  notifyRequestExpired,
  notifyRequestReceived,
  notifyReservationConfirmed,
} from "@/lib/marketplace/notifications";
import {
  DATES_TAKEN_MESSAGE,
  effectiveMinNights,
  isOverlapError,
  isValidIsoDate,
  MAX_PENDING_REQUESTS_PER_CONTACT,
  MONTHLY_STAY_MESSAGE,
  normalizeEmail,
  normalizeWhatsapp,
  reservationCode,
} from "@/lib/marketplace/reservation-view";
import type {
  CheckoutField,
  CheckoutInput as ContractCheckoutInput,
  CheckoutResult as ContractCheckoutResult,
  StorefrontListingDetail,
} from "@/lib/marketplace/contracts";
import type { UnitPricingRule } from "@/lib/types/database";
import {
  channelCommissionAmount,
  channelCommissionPctFor,
  DEFAULT_COMMISSION_BASE,
  managementCommissionAmount,
  type ChannelCommissionMap,
  type CommissionBase,
} from "@/lib/finance/booking-economics";

/**
 * Pedido de reserva desde la web (lead-first, SPEC 20 · D4/D5).
 *
 * No hace falta cuenta: con nombre, email y WhatsApp alcanza. Con sesión se
 * vincula al usuario (`guest_user_id` / `marketplace_user_id`) y se usa el
 * email de la cuenta; sin sesión el pedido queda sin usuario y su llave es el
 * link `/reserva/<token>` que ve al terminar y que va en todos los mails.
 * NUNCA se vincula un pedido a una cuenta por coincidencia de email.
 *
 * Todo lo que importa se recalcula acá (precio, seña, disponibilidad): del
 * cliente sólo se toman fechas, huéspedes y los datos de contacto.
 */

// Tipos del contrato (alias locales: un archivo "use server" sólo exporta
// funciones async en runtime; los tipos se borran al compilar).
export type CheckoutInput = ContractCheckoutInput;
export type CheckoutResult = ContractCheckoutResult;

/**
 * Techo absoluto de noches, aun cuando la unidad no tenga `max_nights` (casi
 * ninguna lo tiene). Sin esto se podía crear una reserva confirmada de años
 * (reserva inmediata) que bloquea el calendario gratis.
 */
const HARD_MAX_NIGHTS = 365;

const checkoutSchema = z.object({
  unit_id: z.string().uuid("No encontramos el departamento."),
  check_in_date: z.string().refine(isValidIsoDate, "Elegí la fecha de llegada."),
  check_out_date: z.string().refine(isValidIsoDate, "Elegí la fecha de salida."),
  guests_count: z.coerce
    .number({ invalid_type_error: "Indicá cuántos huéspedes son." })
    .int("Indicá cuántos huéspedes son.")
    .min(1, "Tiene que haber al menos 1 huésped.")
    .max(30, "Indicá cuántos huéspedes son."),
  full_name: z
    .string({ required_error: "Escribí tu nombre y apellido." })
    .trim()
    .min(2, "Escribí tu nombre y apellido.")
    .max(120, "El nombre es demasiado largo."),
  email: z
    .string({ required_error: "Escribí tu email." })
    .trim()
    .min(1, "Escribí tu email.")
    .max(200, "Revisá el email: es demasiado largo.")
    .email("Revisá el email: parece que falta algo."),
  phone: z
    .string({ required_error: "Dejanos tu WhatsApp para poder confirmarte." })
    .trim()
    .min(1, "Dejanos tu WhatsApp para poder confirmarte.")
    .max(40, "Revisá el número de WhatsApp."),
  document: z.string().trim().max(40, "El documento es demasiado largo.").optional().nullable(),
  special_requests: z
    .string()
    .trim()
    .max(1000, "El mensaje puede tener hasta 1000 caracteres.")
    .optional()
    .nullable(),
  agreed_to_rules: z.literal(true, {
    errorMap: () => ({ message: "Para seguir, confirmá que leíste las reglas y la política de cancelación." }),
  }),
  website: z.string().optional().nullable(),
});

type ParsedCheckout = z.infer<typeof checkoutSchema>;

const FIELD_BY_PATH: Record<string, CheckoutField | undefined> = {
  check_in_date: "dates",
  check_out_date: "dates",
  guests_count: "guests_count",
  full_name: "full_name",
  email: "email",
  phone: "phone",
  document: "document",
  special_requests: "special_requests",
  agreed_to_rules: "agreed_to_rules",
};

const GENERIC_ERROR = "No pudimos enviar tu pedido. Probá de nuevo en un momento.";
const RATE_LIMITED = "Recibimos varios pedidos seguidos desde tu conexión. Esperá un rato o escribinos por WhatsApp.";
const RATE_LIMITED_CONTACT = "Hoy ya recibimos varios pedidos con estos datos. Escribinos por WhatsApp y lo vemos juntos.";

type Fail = Extract<CheckoutResult, { ok: false }>;
const fail = (error: string, field?: CheckoutField): Fail => (field ? { ok: false, error, field } : { ok: false, error });

// ─── Helpers internos ────────────────────────────────────────────────────────

/** IP real del cliente (Vercel la pone en x-forwarded-for). */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Rate limit best-effort y FAIL-OPEN (como `allowAuthAttempt` de guest-auth). */
/** Hash corto (sha256, 24 hex) para usar un email/teléfono como clave del limitador. */
function contactKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex").slice(0, 24);
}

async function allowAttempt(bucket: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_auth_rate_limit", {
      p_bucket: bucket,
      p_max: max,
      p_window_secs: windowSecs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/**
 * ¿Ya hay demasiados pedidos esperando respuesta con este email o teléfono?
 * (en cualquier unidad; un pedido vencido sin barrer no cuenta). Fail-open.
 */
async function tooManyPendingRequests(email: string, phone: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const count = (column: "guest_email" | "guest_phone", value: string) =>
      admin
        .from("booking_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendiente")
        .gt("expires_at", nowIso)
        .eq(column, value);
    const [byEmail, byPhone] = await Promise.all([count("guest_email", email), count("guest_phone", phone)]);
    return (
      (byEmail.count ?? 0) >= MAX_PENDING_REQUESTS_PER_CONTACT ||
      (byPhone.count ?? 0) >= MAX_PENDING_REQUESTS_PER_CONTACT
    );
  } catch {
    return false;
  }
}

/**
 * Defaults de dinero de la org dueña de la unidad (no hay `getCurrentOrg()`:
 * quien reserva es un huésped). Un fallo de lectura cae a los defaults del
 * modelo: la reserva se confirma igual y el snapshot se corrige editándola.
 */
async function readOrgMoneyDefaults(organizationId: string): Promise<{
  channelCommissions: ChannelCommissionMap;
  commissionBase: CommissionBase;
  defaultCommissionPct: number | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("channel_commissions, commission_base, default_commission_pct")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    console.error("[marketplace-bookings] no se pudo leer los defaults de comisión:", error.message);
  }
  const base = data?.commission_base;
  return {
    channelCommissions:
      data?.channel_commissions && typeof data.channel_commissions === "object"
        ? (data.channel_commissions as ChannelCommissionMap)
        : {},
    commissionBase: base === "gross" || base === "net_of_channel" ? base : DEFAULT_COMMISSION_BASE,
    defaultCommissionPct:
      data?.default_commission_pct === null || data?.default_commission_pct === undefined
        ? null
        : Number(data.default_commission_pct),
  };
}

/**
 * Ficha del huésped en el PMS (para la reserva inmediata). El email del
 * pedido web NO está verificado, así que una ficha existente se reusa sólo si
 * coinciden el email (sin mayúsculas) Y el WhatsApp (últimos 8 dígitos), y
 * NUNCA se le pisan datos con lo que vino de la web (`guest-match.ts`). Si no,
 * ficha nueva. `guests` NO tiene unique(org, email) —la operación usa emails
 * de relleno compartidos—: se miran varias candidatas, la más vieja primero.
 * La identidad real del huésped de la web viaja por `marketplace_user_id` /
 * el token, no por acá. Nunca lanza: null si no se pudo.
 */
async function findOrCreateGuestForOrg(params: {
  organizationId: string;
  guest: { full_name: string; email: string; phone: string; document?: string | null };
}): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data: candidates, error: findErr } = await admin
      .from("guests")
      .select("id, email, phone")
      .eq("organization_id", params.organizationId)
      .ilike("email", emailIlikePattern(params.guest.email))
      .order("created_at", { ascending: true })
      .limit(GUEST_MATCH_CANDIDATES);
    if (findErr) console.error("[marketplace-bookings] buscar huésped:", findErr.message);

    const existing = pickReusableGuest(candidates, params.guest);
    if (existing) return existing.id;

    const { data: created, error } = await admin
      .from("guests")
      .insert({
        organization_id: params.organizationId,
        full_name: params.guest.full_name,
        email: params.guest.email,
        phone: params.guest.phone,
        document_number: params.guest.document || null,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[marketplace-bookings] crear huésped:", error?.message);
      return null;
    }
    return created.id as string;
  } catch (e) {
    console.error("[marketplace-bookings] huésped:", e);
    return null;
  }
}

// ─── Checkout ────────────────────────────────────────────────────────────────

interface CheckoutContext {
  /** Id generado acá para derivar el token del link en el mismo insert. */
  id: string;
  token: string;
  data: ParsedCheckout;
  listing: StorefrontListingDetail;
  session: GuestSession | null;
  email: string;
  phone: string;
  nights: number;
  breakdown: PricingBreakdown;
  currency: string;
  sena: number | null;
}

/** Hasta dónde se aceptan pedidos (evita fechas tipeadas mal, "2062"). */
const MAX_DAYS_AHEAD = 730;

/**
 * Punto de entrada del checkout de la web. Sesión OPCIONAL.
 * - Con confirmación (instant_book = false): crea el pedido `pendiente`.
 * - Inmediata: crea la solicitud ya `aprobada` + la reserva confirmada.
 * En los dos casos devuelve el link de seguimiento `/reserva/<token>`.
 */
export async function submitCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  // Con sesión manda el email de la cuenta: el tipeado se ignora.
  const session = await getGuestSession();
  const raw = input && typeof input === "object" ? input : ({} as CheckoutInput);
  const parsed = checkoutSchema.safeParse(session ? { ...raw, email: session.email } : raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.message ?? GENERIC_ERROR, FIELD_BY_PATH[String(issue?.path?.[0] ?? "")]);
  }
  const data = parsed.data;

  // Honeypot: una persona nunca ve ni completa este campo.
  if (data.website && data.website.trim() !== "") {
    console.warn("[marketplace-bookings] honeypot completado: pedido descartado");
    return fail(GENERIC_ERROR);
  }

  // ── Fechas ──
  const today = todayIsoAR();
  if (data.check_out_date <= data.check_in_date) {
    return fail("La salida tiene que ser después de la llegada.", "dates");
  }
  if (data.check_in_date < today) return fail("Esa fecha de llegada ya pasó. Elegí otra.", "dates");
  if (countNights(today, data.check_in_date) > MAX_DAYS_AHEAD) {
    return fail("Todavía no tomamos pedidos con tanta anticipación. Escribinos y lo vemos.", "dates");
  }
  const nights = countNights(data.check_in_date, data.check_out_date);
  if (!Number.isFinite(nights) || nights < 1) return fail("Elegí al menos 1 noche.", "dates");
  // 28+ noches se consultan (y eso cubre también el techo de 365).
  if (isMonthlyStay(nights)) return fail(MONTHLY_STAY_MESSAGE, "dates");
  if (nights > HARD_MAX_NIGHTS) return fail(`La estadía no puede superar ${HARD_MAX_NIGHTS} noches.`, "dates");

  // ── Contacto ──
  const email = normalizeEmail(data.email);
  const phone = normalizeWhatsapp(data.phone);
  if (!phone) {
    return fail("Revisá el WhatsApp: escribilo con código de área, por ejemplo 351 555 1234.", "phone");
  }

  // ── Anti-abuso por conexión (fail-open). El cupo por contacto va más abajo. ──
  const ip = await clientIp();
  if (ip !== "unknown" && !(await allowAttempt(`checkout:ip:${ip}`, 8, 60 * 60))) {
    return fail(RATE_LIMITED);
  }

  // ── Unidad de la vidriera ──
  let listing: StorefrontListingDetail | null;
  try {
    listing = await getStorefrontListingById(data.unit_id);
  } catch (e) {
    console.error("[marketplace-bookings] leer la unidad:", e);
    return fail(GENERIC_ERROR);
  }
  if (!listing) return fail("Este departamento ya no está disponible en la web.");
  if (!listing.offers_short) {
    return fail("Este departamento se alquila por mes: escribinos y te pasamos el precio.", "dates");
  }
  if (listing.max_guests && data.guests_count > listing.max_guests) {
    const max = listing.max_guests;
    return fail(`Este departamento es para hasta ${max} ${max === 1 ? "huésped" : "huéspedes"}.`, "guests_count");
  }

  // ── Precio (siempre en el server) y estadía mínima/máxima ──
  const rules = ((listing.pricing_rules ?? []) as UnitPricingRule[]).filter((r) => r.active);
  const breakdown = computePricing({
    checkInIso: data.check_in_date,
    checkOutIso: data.check_out_date,
    basePrice: Number(listing.base_price ?? 0),
    cleaningFee: listing.cleaning_fee != null ? Number(listing.cleaning_fee) : null,
    rules,
  });
  if (!(Number(listing.base_price) > 0) || !(breakdown.total > 0)) {
    return fail("Este departamento todavía no tiene precio para esas fechas. Escribinos y te pasamos uno.");
  }
  const minNights = effectiveMinNights({ unitMinNights: listing.min_nights, rules, pricedNights: breakdown.nights });
  if (nights < minNights) return fail(`Para esas fechas la estadía mínima es de ${minNights} noches.`, "dates");
  if (listing.max_nights && nights > listing.max_nights) {
    return fail(`En este departamento la estadía máxima es de ${listing.max_nights} noches.`, "dates");
  }

  // ── Disponibilidad, política de seña y pedidos abiertos del contacto ──
  let avail: Awaited<ReturnType<typeof checkUnitAvailability>>;
  let settings: Awaited<ReturnType<typeof getResolvedWebSettings>>;
  let busyContact: boolean;
  try {
    [avail, settings, busyContact] = await Promise.all([
      checkUnitAvailability({ unitId: listing.id, checkInIso: data.check_in_date, checkOutIso: data.check_out_date }),
      getResolvedWebSettings(listing.organization_id),
      listing.instant_book ? Promise.resolve(false) : tooManyPendingRequests(email, phone),
    ]);
  } catch (e) {
    console.error("[marketplace-bookings] verificar disponibilidad:", e);
    return fail(GENERIC_ERROR);
  }
  if (!avail.available) {
    // Los errores de lectura ("Error verificando…") no son para el huésped.
    if (!avail.reason || avail.reason.startsWith("Error")) return fail(GENERIC_ERROR);
    return fail(avail.reason, "dates");
  }
  if (busyContact) {
    return fail(
      `Ya tenés ${MAX_PENDING_REQUESTS_PER_CONTACT} pedidos esperando respuesta. Te contestamos enseguida; si querés cambiar algo, escribinos.`,
    );
  }

  // Cupo diario por contacto (fail-open). Recién acá: sólo cuentan los pedidos
  // que pasaron todas las validaciones, así probar fechas no gasta el cupo.
  const [emailOk, phoneOk] = await Promise.all([
    // Las claves del limitador no guardan PII en claro: hash corto del contacto.
    allowAttempt(`checkout:contact:${contactKey(email)}`, 5, 24 * 60 * 60),
    allowAttempt(`checkout:contact:${contactKey(phone.slice(1))}`, 5, 24 * 60 * 60),
  ]);
  if (!emailOk || !phoneOk) return fail(RATE_LIMITED_CONTACT);

  const currency = listing.marketplace_currency || "ARS";
  const sena = computeSena({
    policy: settings.deposit,
    nights,
    subtotal: breakdown.subtotal,
    total: breakdown.total,
    currency,
  });

  let id: string;
  let token: string;
  try {
    id = randomUUID();
    token = deriveAccessToken(id);
  } catch (e) {
    // Sólo falla si falta el secreto de los links (configuración del server).
    console.error("[marketplace-bookings] no se pudo firmar el link de seguimiento:", e);
    return fail(GENERIC_ERROR);
  }

  const ctx: CheckoutContext = { id, token, data, listing, session, email, phone, nights, breakdown, currency, sena };
  return listing.instant_book ? createInstantBooking(ctx) : createRequest(ctx);
}

/** Snapshot del pedido: lo mismo en la solicitud pendiente y en la inmediata. */
function requestSnapshot(ctx: CheckoutContext) {
  const { data, listing } = ctx;
  return {
    id: ctx.id,
    organization_id: listing.organization_id,
    unit_id: listing.id,
    // Sólo la sesión vincula el pedido a una cuenta (nunca el email tipeado).
    guest_user_id: ctx.session?.userId ?? null,
    guest_full_name: data.full_name,
    guest_email: ctx.email,
    guest_phone: ctx.phone,
    guest_document: data.document || null,
    check_in_date: data.check_in_date,
    check_in_time: listing.check_in_window_start || "15:00",
    check_out_date: data.check_out_date,
    check_out_time: "11:00",
    guests_count: data.guests_count,
    currency: ctx.currency,
    total_amount: ctx.breakdown.total,
    cleaning_fee: ctx.breakdown.cleaning_fee,
    nights: ctx.nights,
    special_requests: data.special_requests || null,
    access_token_hash: hashAccessToken(ctx.token),
    // 0 = "sin seña" explícito; NULL haría que después se recalcule con la política vigente.
    deposit_estimate: ctx.sena ?? 0,
  };
}

function revalidateAfterCheckout(slug: string) {
  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades/calendario/mensual");
  revalidatePath("/dashboard/resultados");
  revalidatePath("/mi-cuenta");
  revalidatePath(`/u/${slug}`);
}

/** Pedido con confirmación: queda `pendiente` hasta que el equipo responda. */
async function createRequest(ctx: CheckoutContext): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const { data, listing, id } = ctx;

  // La disponibilidad ignora las pendientes vencidas, pero el constraint
  // booking_requests_no_overlap no mira expires_at: si el barrido todavía no
  // pasó, una fecha que se ve libre rechazaría el insert. Se vencen acá las que
  // se superponen (y se le avisa a ese huésped, como haría el barrido).
  const { data: expired } = await admin
    .from("booking_requests")
    .update({ status: "expirada" })
    .eq("unit_id", listing.id)
    .eq("status", "pendiente")
    .lt("expires_at", new Date().toISOString())
    .lt("check_in_date", data.check_out_date)
    .gt("check_out_date", data.check_in_date)
    .select("id");
  if (expired && expired.length > 0) {
    await Promise.allSettled(expired.map((r) => notifyRequestExpired({ requestId: r.id as string })));
  }

  const { error } = await admin
    .from("booking_requests")
    .insert({ ...requestSnapshot(ctx), status: "pendiente" });
  if (error) {
    if (isOverlapError(error.message)) return fail(DATES_TAKEN_MESSAGE, "dates");
    console.error("[marketplace-bookings] insert pedido:", error.message);
    return fail(GENERIC_ERROR);
  }

  try {
    await notifyRequestReceived({ requestId: id });
  } catch (e) {
    console.warn("[marketplace-bookings] avisos del pedido fallaron:", e);
  }
  revalidateAfterCheckout(listing.slug);
  return { ok: true, kind: "request", request_id: id, status_path: reservationPath(id) };
}

/**
 * Reserva inmediata, en este orden (SPEC 30 · B):
 *   1. solicitud ya `aprobada` con su token (una aprobada no choca con
 *      booking_requests_no_overlap) → mismo seguimiento que un pedido;
 *   2. la reserva confirmada, con la seña de la política en `deposit_amount`;
 *   3. se vinculan (`resulting_booking_id`).
 * Si (2) falla (p. ej. se ocuparon las fechas), la solicitud queda `cancelada`.
 */
async function createInstantBooking(ctx: CheckoutContext): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const { data, listing, id } = ctx;
  const code = reservationCode(id);

  const { error: reqErr } = await admin
    .from("booking_requests")
    .insert({ ...requestSnapshot(ctx), status: "aprobada", approved_at: new Date().toISOString() });
  if (reqErr) {
    console.error("[marketplace-bookings] insert solicitud inmediata:", reqErr.message);
    return fail(GENERIC_ERROR);
  }

  const abandon = async (why: string) => {
    const { error } = await admin
      .from("booking_requests")
      .update({ status: "cancelada", notes: why })
      .eq("id", id)
      .eq("status", "aprobada");
    if (error) console.error("[marketplace-bookings] no se pudo anular la solicitud", id, error.message);
  };

  const guestId = await findOrCreateGuestForOrg({
    organizationId: listing.organization_id,
    guest: { full_name: data.full_name, email: ctx.email, phone: ctx.phone, document: data.document ?? null },
  });
  if (!guestId) {
    await abandon("No se pudo registrar al huésped en el PMS.");
    return fail(GENERIC_ERROR);
  }

  // Snapshot de dinero igual al de una reserva cargada a mano (el total ya
  // incluye la limpieza). null (no 0) si la org no configuró 'directo'.
  const [orgMoney, unitRes] = await Promise.all([
    readOrgMoneyDefaults(listing.organization_id),
    admin
      .from("units")
      .select("default_commission_pct")
      .eq("id", listing.id)
      .eq("organization_id", listing.organization_id)
      .maybeSingle(),
  ]);
  const unitPct = unitRes.data?.default_commission_pct;
  const commissionPct = Number(unitPct ?? orgMoney.defaultCommissionPct ?? 20);
  const channelPct =
    orgMoney.channelCommissions.directo === null || orgMoney.channelCommissions.directo === undefined
      ? null
      : channelCommissionPctFor(orgMoney.channelCommissions, "directo");
  const total = ctx.breakdown.total;

  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .insert({
      organization_id: listing.organization_id,
      unit_id: listing.id,
      guest_id: guestId,
      marketplace_user_id: ctx.session?.userId ?? null,
      source: "directo",
      status: "confirmada",
      mode: "temporario",
      check_in_date: data.check_in_date,
      check_in_time: listing.check_in_window_start || "15:00",
      check_out_date: data.check_out_date,
      check_out_time: "11:00",
      guests_count: data.guests_count,
      currency: ctx.currency,
      total_amount: total,
      paid_amount: 0,
      cleaning_fee: ctx.breakdown.cleaning_fee,
      deposit_amount: ctx.sena ?? 0,
      commission_pct: commissionPct,
      commission_amount: managementCommissionAmount({
        total,
        commissionPct,
        channelPct,
        commissionBase: orgMoney.commissionBase,
      }),
      channel_commission_pct: channelPct,
      channel_commission_amount: channelCommissionAmount(total, channelPct),
      notes: data.special_requests || null,
      internal_notes: `Reserva web inmediata ${code} · ${data.full_name} · ${ctx.email} · ${ctx.phone}`,
    })
    .select("id")
    .single();

  if (bkErr || !booking) {
    const overlap = isOverlapError(bkErr?.message);
    if (!overlap) console.error("[marketplace-bookings] insert reserva inmediata:", bkErr?.message);
    await abandon(overlap ? "Las fechas se ocuparon antes de crear la reserva." : "No se pudo crear la reserva.");
    return overlap ? fail(DATES_TAKEN_MESSAGE, "dates") : fail(GENERIC_ERROR);
  }
  const bookingId = booking.id as string;

  // Sin este vínculo el seguimiento no encuentra la reserva: un reintento.
  const link = () =>
    admin.from("booking_requests").update({ resulting_booking_id: bookingId }).eq("id", id);
  let { error: linkErr } = await link();
  if (linkErr) ({ error: linkErr } = await link());
  if (linkErr) {
    console.error("[marketplace-bookings] CRÍTICO: reserva inmediata sin vincular", { requestId: id, bookingId, error: linkErr.message });
  }

  try {
    await notifyReservationConfirmed({ requestId: id, bookingId });
  } catch (e) {
    console.warn("[marketplace-bookings] avisos de la reserva inmediata fallaron:", e);
  }
  revalidateAfterCheckout(listing.slug);
  revalidatePath(`/dashboard/reservas/${bookingId}`);
  return { ok: true, kind: "booking", request_id: id, status_path: reservationPath(id) };
}

// ─── Compatibilidad ──────────────────────────────────────────────────────────

/**
 * Historial crudo del huésped (bookings + solicitudes). Lo sigue usando la
 * versión anterior de /mi-cuenta; lo nuevo es `listGuestReservations()`
 * (reservation-status.ts), que ya devuelve etapas y links de seguimiento.
 */
export async function listGuestBookings() {
  const session = await getGuestSession();
  if (!session) return { bookings: [], requests: [] };
  const admin = createAdminClient();

  // Identidad = marketplace_user_id / guest_user_id (auth.users), NUNCA match
  // por email: la operación reutiliza emails placeholder para huéspedes
  // distintos, así que un match por email filtraría reservas de terceros.
  const [bookingsRes, requestsRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        `id, organization_id, unit_id, check_in_date, check_out_date, total_amount, currency, status, paid_amount,
         unit:units(id, slug, marketplace_title, name, cover_image_url),
         organization:organizations(name)
        `
      )
      .eq("marketplace_user_id", session.userId)
      .order("check_in_date", { ascending: false }),
    admin
      .from("booking_requests")
      .select(
        `*, unit:units(id, slug, marketplace_title, name, cover_image_url),
         organization:organizations(name)
        `
      )
      .eq("guest_user_id", session.userId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    bookings: bookingsRes.data ?? [],
    requests: requestsRes.data ?? [],
  };
}

/** @deprecated Usá `cancelReservationRequest({ requestId })` (reservation-status.ts). */
export async function cancelGuestBookingRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
  return cancelReservationRequest({ requestId });
}
