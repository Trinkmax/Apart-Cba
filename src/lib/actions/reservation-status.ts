"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getGuestSession } from "./guest-auth";
import { parseAmountInput } from "@/lib/format";
import {
  hashAccessToken,
  isWellFormedAccessToken,
  reservationPath,
  tokenMatchesRequest,
} from "@/lib/marketplace/access-token";
import { getResolvedWebSettings } from "@/lib/marketplace/web-settings-server";
import { canReportPayment } from "@/lib/marketplace/guest-stage";
import { notifyPaymentReported, notifyRequestCancelledByGuest } from "@/lib/marketplace/notifications";
import {
  buildReservationView,
  MAX_PENDING_PAYMENT_REPORTS,
  RECEIPT_MIME_EXT,
  sniffReceiptMime,
  sortReservationItems,
  toReservationListItem,
  type ViewBookingRow,
  type ViewReportRow,
  type ViewRequestRow,
  type ViewUnitRow,
} from "@/lib/marketplace/reservation-view";
import type { ActionResult, ReservationListItem, ReservationView } from "@/lib/marketplace/contracts";

/**
 * Seguimiento de una reserva de la web, visto por el huésped.
 *
 * Dos llaves, nunca una tercera:
 *   - el link `/reserva/<token>` (el huésped puede no tener cuenta): el token se
 *     busca por su hash y se verifica contra el id con el HMAC del servidor;
 *   - la sesión del huésped: sólo filas con `guest_user_id` / `marketplace_user_id`
 *     = su usuario. NUNCA por coincidencia de email (el PMS reutiliza emails).
 *
 * La vista la arma `buildReservationView()` (pura, testeada); acá sólo se lee
 * la base con service role y se escribe lo que el huésped puede hacer: cancelar
 * un pedido pendiente y avisar que transfirió la seña.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUEST_COLUMNS =
  "id, organization_id, unit_id, guest_user_id, status, created_at, expires_at, approved_at, approved_by, " +
  "rejection_reason, guest_full_name, guest_email, guest_phone, check_in_date, check_out_date, guests_count, " +
  "currency, total_amount, cleaning_fee, deposit_estimate, resulting_booking_id";

const BOOKING_COLUMNS =
  "id, organization_id, unit_id, guest_id, marketplace_user_id, status, created_at, check_in_date, " +
  "check_out_date, guests_count, currency, total_amount, paid_amount, cleaning_fee, deposit_amount";

const UNIT_COLUMNS =
  "id, slug, name, marketplace_title, neighborhood, bedrooms, address, cover_image_url, " +
  "check_in_window_start, check_in_window_end, cancellation_policy";

const REPORT_COLUMNS = "id, booking_id, created_at, amount, status, receipt_path";

type RequestRow = ViewRequestRow & {
  organization_id: string;
  unit_id: string;
  guest_user_id: string | null;
  resulting_booking_id: string | null;
};

type BookingRow = ViewBookingRow & {
  organization_id: string;
  unit_id: string;
  guest_id: string | null;
  marketplace_user_id: string | null;
};

type UnitDbRow = Omit<ViewUnitRow, "cover_url"> & { cover_image_url: string | null };

type ReportRow = ViewReportRow & { booking_id: string };

/** Lo que identifica una reserva del huésped (antes de leer unidad, avisos, etc.). */
interface ResolvedReservation {
  request: RequestRow | null;
  booking: BookingRow | null;
  guestFallback: { full_name: string; email: string; phone: string | null } | null;
}

type Admin = ReturnType<typeof createAdminClient>;

const GENERIC_ERROR = "No pudimos procesar tu pedido. Probá de nuevo en un momento.";

/** Error de lectura que no es "no existe": se loguea y corta (lo ve error.tsx). */
function failRead(where: string, error: { message: string } | null): never {
  console.error(`[reservation-status] ${where}:`, error?.message);
  throw new Error("No se pudo leer la reserva");
}

// ─── Lecturas ────────────────────────────────────────────────────────────────

async function findRequestByToken(admin: Admin, token: string): Promise<RequestRow | null> {
  if (!isWellFormedAccessToken(token)) return null;
  const { data, error } = await admin
    .from("booking_requests")
    .select(REQUEST_COLUMNS)
    .eq("access_token_hash", hashAccessToken(token))
    .maybeSingle();
  if (error) failRead("buscar por token", error);
  if (!data) return null;
  const row = data as unknown as RequestRow;
  // El hash encontró la fila; el HMAC confirma que el token es de ESTE id.
  return tokenMatchesRequest(token, row.id) ? row : null;
}

async function loadBooking(admin: Admin, bookingId: string, orgId: string): Promise<BookingRow | null> {
  const { data, error } = await admin
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", bookingId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) failRead("leer la reserva", error);
  return (data as unknown as BookingRow | null) ?? null;
}

async function resolveByToken(admin: Admin, token: string): Promise<ResolvedReservation | null> {
  const request = await findRequestByToken(admin, token);
  if (!request) return null;
  const booking = request.resulting_booking_id
    ? await loadBooking(admin, request.resulting_booking_id, request.organization_id)
    : null;
  return { request, booking, guestFallback: null };
}

type SessionLike = { userId: string; email: string; profile: { full_name: string; phone: string | null } };

/** `id` puede ser el de la solicitud o el de la reserva; siempre del usuario de la sesión. */
async function resolveForSession(admin: Admin, id: string, session: SessionLike): Promise<ResolvedReservation | null> {
  if (!UUID_RE.test(id)) return null;
  const [reqRes, bkRes] = await Promise.all([
    admin.from("booking_requests").select(REQUEST_COLUMNS).eq("id", id).eq("guest_user_id", session.userId).maybeSingle(),
    admin.from("bookings").select(BOOKING_COLUMNS).eq("id", id).eq("marketplace_user_id", session.userId).maybeSingle(),
  ]);
  if (reqRes.error) failRead("leer la solicitud", reqRes.error);
  if (bkRes.error) failRead("leer la reserva", bkRes.error);

  const request = (reqRes.data as unknown as RequestRow | null) ?? null;
  if (request) {
    const booking = request.resulting_booking_id
      ? await loadBooking(admin, request.resulting_booking_id, request.organization_id)
      : null;
    return { request, booking, guestFallback: null };
  }

  const booking = (bkRes.data as unknown as BookingRow | null) ?? null;
  if (!booking) return null;
  // Si la reserva salió de una solicitud, el seguimiento es el de la solicitud.
  const { data: linked, error } = await admin
    .from("booking_requests")
    .select(REQUEST_COLUMNS)
    .eq("resulting_booking_id", booking.id)
    .eq("organization_id", booking.organization_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) failRead("buscar la solicitud de la reserva", error);
  return {
    request: (linked as unknown as RequestRow | null) ?? null,
    booking,
    guestFallback: linked ? null : sessionGuest(session),
  };
}

function sessionGuest(session: SessionLike) {
  return { full_name: session.profile.full_name, email: session.email, phone: session.profile.phone ?? null };
}

/** Unidades con su portada (primera imagen: la marcada como portada, si no la primera del orden). */
async function loadUnits(admin: Admin, unitIds: string[]): Promise<Map<string, ViewUnitRow>> {
  const ids = [...new Set(unitIds)];
  const out = new Map<string, ViewUnitRow>();
  if (ids.length === 0) return out;
  const [unitsRes, photosRes] = await Promise.all([
    admin.from("units").select(UNIT_COLUMNS).in("id", ids),
    admin
      .from("unit_photos")
      .select("unit_id, public_url")
      .in("unit_id", ids)
      .eq("media_type", "image")
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
  ]);
  if (unitsRes.error) failRead("leer la unidad", unitsRes.error);
  if (photosRes.error) console.error("[reservation-status] fotos:", photosRes.error.message);

  const cover = new Map<string, string>();
  for (const p of (photosRes.data ?? []) as { unit_id: string; public_url: string }[]) {
    if (!cover.has(p.unit_id) && p.public_url) cover.set(p.unit_id, p.public_url);
  }
  for (const u of (unitsRes.data ?? []) as unknown as UnitDbRow[]) {
    const { cover_image_url, ...rest } = u;
    out.set(u.id, { ...rest, cover_url: cover.get(u.id) ?? cover_image_url ?? null });
  }
  return out;
}

/** Unidad borrada: la reserva se sigue viendo, con un nombre genérico. */
function missingUnit(id: string): ViewUnitRow {
  return {
    id,
    slug: null,
    name: null,
    marketplace_title: null,
    neighborhood: null,
    bedrooms: null,
    address: null,
    cover_url: null,
    check_in_window_start: null,
    check_in_window_end: null,
    cancellation_policy: null,
  };
}

async function loadReports(admin: Admin, bookingIds: string[]): Promise<ReportRow[]> {
  if (bookingIds.length === 0) return [];
  const { data, error } = await admin
    .from("booking_payment_reports")
    .select(REPORT_COLUMNS)
    .in("booking_id", [...new Set(bookingIds)])
    .order("created_at", { ascending: false });
  if (error) failRead("leer los avisos de pago", error);
  return (data ?? []) as unknown as ReportRow[];
}

async function loadView(admin: Admin, r: ResolvedReservation): Promise<ReservationView> {
  const orgId = (r.booking?.organization_id ?? r.request?.organization_id)!;
  const unitId = (r.booking?.unit_id ?? r.request?.unit_id)!;
  const [units, reports, settings] = await Promise.all([
    loadUnits(admin, [unitId]),
    r.booking ? loadReports(admin, [r.booking.id]) : Promise.resolve([] as ReportRow[]),
    getResolvedWebSettings(orgId),
  ]);
  return buildReservationView({
    request: r.request,
    booking: r.booking,
    unit: units.get(unitId) ?? missingUnit(unitId),
    reports,
    settings,
    statusPath: r.request ? reservationPath(r.request.id) : null,
    guestFallback: r.guestFallback,
  });
}

// ─── Lecturas públicas ───────────────────────────────────────────────────────

/** Seguimiento por link (`/reserva/<token>`). Sin sesión. null = link inválido. */
export async function getReservationByToken(token: string): Promise<ReservationView | null> {
  if (!isWellFormedAccessToken(token)) return null;
  const admin = createAdminClient();
  const resolved = await resolveByToken(admin, token);
  return resolved ? loadView(admin, resolved) : null;
}

/**
 * Detalle en "Mis reservas" (`/mi-cuenta/reservas/<id>`). `id` = solicitud o
 * reserva del usuario. Las reservas viejas sin solicitud vuelven con
 * `status_path: null` (se muestran ahí mismo).
 */
export async function getReservationForGuest(id: string): Promise<ReservationView | null> {
  const session = await getGuestSession();
  if (!session) return null;
  const admin = createAdminClient();
  const resolved = await resolveForSession(admin, id, session);
  return resolved ? loadView(admin, resolved) : null;
}

/** "Mis reservas": pedidos y reservas del usuario, las vivas primero. */
export async function listGuestReservations(): Promise<ReservationListItem[]> {
  const session = await getGuestSession();
  if (!session) return [];
  const admin = createAdminClient();

  const [reqRes, bkRes] = await Promise.all([
    admin
      .from("booking_requests")
      .select(REQUEST_COLUMNS)
      .eq("guest_user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("marketplace_user_id", session.userId)
      .order("check_in_date", { ascending: false })
      .limit(100),
  ]);
  if (reqRes.error) failRead("listar solicitudes", reqRes.error);
  if (bkRes.error) failRead("listar reservas", bkRes.error);

  const requests = (reqRes.data ?? []) as unknown as RequestRow[];
  const bookings = new Map<string, BookingRow>();
  for (const b of (bkRes.data ?? []) as unknown as BookingRow[]) bookings.set(b.id, b);

  // Reservas de solicitudes propias que no quedaron vinculadas al usuario.
  const missing = requests
    .map((r) => r.resulting_booking_id)
    .filter((id): id is string => Boolean(id) && !bookings.has(id!));
  if (missing.length > 0) {
    const { data, error } = await admin.from("bookings").select(BOOKING_COLUMNS).in("id", missing);
    if (error) failRead("leer reservas de solicitudes", error);
    const byId = new Map(requests.map((r) => [r.resulting_booking_id, r]));
    for (const b of (data ?? []) as unknown as BookingRow[]) {
      // Misma organización que la solicitud: nunca cruzar datos de otra org.
      if (byId.get(b.id)?.organization_id === b.organization_id) bookings.set(b.id, b);
    }
  }

  const linkedBookingIds = new Set(requests.map((r) => r.resulting_booking_id).filter(Boolean));
  const entries: ResolvedReservation[] = [
    ...requests.map((r) => ({
      request: r,
      booking: r.resulting_booking_id ? (bookings.get(r.resulting_booking_id) ?? null) : null,
      guestFallback: null,
    })),
    ...[...bookings.values()]
      .filter((b) => !linkedBookingIds.has(b.id))
      .map((b) => ({ request: null, booking: b, guestFallback: sessionGuest(session) })),
  ];
  if (entries.length === 0) return [];

  const unitIds = entries.map((e) => (e.booking?.unit_id ?? e.request?.unit_id)!);
  const orgIds = [...new Set(entries.map((e) => (e.booking?.organization_id ?? e.request?.organization_id)!))];
  const [units, reports, settingsList] = await Promise.all([
    loadUnits(admin, unitIds),
    loadReports(admin, entries.flatMap((e) => (e.booking ? [e.booking.id] : []))),
    Promise.all(orgIds.map((id) => getResolvedWebSettings(id))),
  ]);
  const settingsByOrg = new Map(orgIds.map((id, i) => [id, settingsList[i]]));

  const items = entries.map((e) => {
    const unitId = (e.booking?.unit_id ?? e.request?.unit_id)!;
    const orgId = (e.booking?.organization_id ?? e.request?.organization_id)!;
    const view = buildReservationView({
      request: e.request,
      booking: e.booking,
      unit: units.get(unitId) ?? missingUnit(unitId),
      reports: e.booking ? reports.filter((r) => r.booking_id === e.booking!.id) : [],
      settings: settingsByOrg.get(orgId)!,
      statusPath: e.request ? reservationPath(e.request.id) : null,
      guestFallback: e.guestFallback,
    });
    return toReservationListItem(view);
  });
  return sortReservationItems(items);
}

// ─── Lo que puede hacer el huésped ───────────────────────────────────────────

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

/** Por link (sin sesión) o por id con la sesión del huésped. */
async function resolveAccess(
  admin: Admin,
  input: { token?: string | null; requestId?: string | null },
): Promise<ResolvedReservation | null> {
  const token = input.token?.trim();
  if (token) return resolveByToken(admin, token);
  const id = input.requestId?.trim();
  if (!id) return null;
  const session = await getGuestSession();
  if (!session) return null;
  return resolveForSession(admin, id, session);
}

function revalidateReservation(requestId: string | null, bookingId: string | null) {
  if (requestId) {
    revalidatePath(reservationPath(requestId));
    revalidatePath(`/dashboard/reservas-pendientes/${requestId}`);
  }
  if (bookingId) {
    revalidatePath(`/mi-cuenta/reservas/${bookingId}`);
    revalidatePath(`/dashboard/reservas/${bookingId}`);
  }
  revalidatePath("/mi-cuenta");
  revalidatePath("/dashboard/reservas-pendientes");
}

const NOT_FOUND = "No encontramos tu reserva. Revisá el link o escribinos.";

/** El huésped cancela su pedido mientras sigue pendiente (update condicional). */
export async function cancelReservationRequest(input: {
  token?: string;
  requestId?: string;
}): Promise<ActionResult> {
  const admin = createAdminClient();
  let resolved: ResolvedReservation | null;
  try {
    resolved = await resolveAccess(admin, input ?? {});
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
  const request = resolved?.request ?? null;
  if (!request) return { ok: false, error: NOT_FOUND };

  if (request.status !== "pendiente") {
    return {
      ok: false,
      error:
        request.status === "aprobada"
          ? "Tu reserva ya está confirmada. Si necesitás cancelarla, escribinos."
          : "Este pedido ya no está pendiente.",
    };
  }
  if (Date.parse(request.expires_at) <= Date.now()) {
    return { ok: false, error: "Este pedido ya venció: no hace falta cancelarlo." };
  }

  const { data, error } = await admin
    .from("booking_requests")
    .update({ status: "cancelada" })
    .eq("id", request.id)
    .eq("organization_id", request.organization_id)
    .eq("status", "pendiente")
    .select("id");
  if (error) {
    console.error("[reservation-status] cancelar pedido:", error.message);
    return { ok: false, error: GENERIC_ERROR };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Tu pedido cambió de estado recién. Actualizá la página para verlo." };
  }

  try {
    await notifyRequestCancelledByGuest({ requestId: request.id });
  } catch (e) {
    console.warn("[reservation-status] aviso de cancelación falló:", e);
  }
  revalidateReservation(request.id, null);
  return { ok: true };
}

const formText = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

function isUploadedFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && (v as Blob).size > 0;
}

/**
 * Tope del comprobante: 4 MB. Vercel rechaza cualquier cuerpo de Server Action
 * de más de 4,5 MB antes de que llegue acá (el huésped vería un error genérico),
 * aunque el bucket admita 10 MB. El formulario frena lo mismo antes de mandar.
 */
const RECEIPT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const RECEIPT_TOO_BIG = "El archivo pesa más de 4 MB. Mandá una captura o comprimilo.";

/**
 * "Ya transferí": el huésped avisa la seña (monto + comprobante opcional +
 * nota). NO es un cobro: queda un aviso `pendiente` que el equipo revisa y,
 * si la plata entró, registra en Caja. El monto que tipea el huésped es lo
 * único que se toma del cliente, y sólo como dato del aviso.
 *
 * FormData: `token` o `requestId` (id de solicitud o reserva, con sesión),
 * `amount` (texto es-AR), `note`, `receipt` (imagen o PDF, opcional, ≤ 4 MB).
 */
export async function reportDepositPayment(formData: FormData): Promise<ActionResult> {
  if (!(formData instanceof FormData)) return { ok: false, error: GENERIC_ERROR };
  const ip = await clientIp();
  if (ip !== "unknown" && !(await allowAttempt(`payment-report:ip:${ip}`, 10, 60 * 60))) {
    return { ok: false, error: "Demasiados intentos. Esperá unos minutos y probá de nuevo." };
  }

  const admin = createAdminClient();
  let resolved: ResolvedReservation | null;
  let view: ReservationView;
  try {
    resolved = await resolveAccess(admin, {
      token: formText(formData.get("token")),
      requestId: formText(formData.get("requestId")),
    });
    if (!resolved) return { ok: false, error: NOT_FOUND };
    if (!resolved.booking) {
      return {
        ok: false,
        error: "Todavía no confirmamos tu reserva. La seña se transfiere después de que te confirmemos.",
      };
    }
    view = await loadView(admin, resolved);
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
  const booking = resolved.booking;
  const request = resolved.request;

  if (!canReportPayment(view.stage)) {
    return { ok: false, error: "Esta reserva no tiene una seña pendiente de pago." };
  }
  if (!view.can_report_payment) {
    return {
      ok: false,
      error: `Ya tenemos ${MAX_PENDING_PAYMENT_REPORTS} avisos tuyos sin revisar. Esperá a que los veamos o escribinos.`,
    };
  }

  const amount = parseAmountInput(formText(formData.get("amount")));
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Indicá el monto que transferiste." };
  }
  if (view.money.total > 0 && amount > view.money.total) {
    return { ok: false, error: "El monto supera el total de la reserva. Revisalo, por favor." };
  }
  const note = formText(formData.get("note")).trim();
  if (note.length > 1000) {
    return { ok: false, error: "La nota puede tener hasta 1000 caracteres." };
  }

  let receiptPath: string | null = null;
  let receiptMime: string | null = null;
  const receipt = formData.get("receipt");
  if (isUploadedFile(receipt)) {
    if (receipt.size > RECEIPT_UPLOAD_MAX_BYTES) {
      return { ok: false, error: RECEIPT_TOO_BIG };
    }
    const bytes = new Uint8Array(await receipt.arrayBuffer());
    const mime = sniffReceiptMime(bytes);
    if (!mime) {
      return { ok: false, error: "El comprobante tiene que ser una imagen (JPG, PNG, WEBP o HEIC) o un PDF." };
    }
    const path = `${booking.organization_id}/${booking.id}/${randomUUID()}.${RECEIPT_MIME_EXT[mime]}`;
    const { error: upErr } = await admin.storage
      .from("payment-receipts")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      console.error("[reservation-status] subir comprobante:", upErr.message);
      return { ok: false, error: "No pudimos subir el comprobante. Probá de nuevo o mandalo por WhatsApp." };
    }
    receiptPath = path;
    receiptMime = mime;
  }

  const { data: report, error } = await admin
    .from("booking_payment_reports")
    .insert({
      organization_id: booking.organization_id,
      booking_id: booking.id,
      booking_request_id: request?.id ?? null,
      amount: Math.round(amount * 100) / 100,
      currency: booking.currency || "ARS",
      receipt_path: receiptPath,
      receipt_mime: receiptMime,
      note: note || null,
      status: "pendiente",
    })
    .select("id")
    .single();
  if (error || !report) {
    console.error("[reservation-status] guardar aviso de pago:", error?.message);
    if (receiptPath) await admin.storage.from("payment-receipts").remove([receiptPath]).catch(() => undefined);
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    await notifyPaymentReported({ reportId: report.id });
  } catch (e) {
    console.warn("[reservation-status] aviso de pago al equipo falló:", e);
  }
  revalidateReservation(request?.id ?? null, booking.id);
  return { ok: true };
}
