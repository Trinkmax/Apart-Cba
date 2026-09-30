/**
 * Contratos compartidos de la web pública (tipos). Los módulos de servidor los
 * implementan y las pantallas los consumen; viven acá para que ambos lados
 * hablen el mismo idioma sin importarse entre sí.
 *
 *   Catálogo      → src/lib/marketplace/storefront.ts, src/lib/actions/storefront.ts
 *   Checkout      → src/lib/actions/marketplace-bookings.ts
 *   Seguimiento   → src/lib/actions/reservation-status.ts
 */
import type {
  MarketplaceListingDetail,
  MarketplaceListingSummary,
  PaymentReportStatus,
  UnitPricingRule,
} from "@/lib/types/database";
import type { GuestStage, StageCopy, StageTone, TimelineStep } from "./guest-stage";
import type { TransferDetails } from "./web-settings";

// ─── Catálogo ────────────────────────────────────────────────────────────────

/** Unidad de la vidriera con los datos ya listos para mostrar. */
export interface CatalogListing extends MarketplaceListingSummary {
  /** displayTitle(): "Paraná", "Rondeau II". */
  display_title: string;
  /** Sufijo del PMS que no es un barrio ("Complejo", "Futura Pilay"). */
  display_tagline: string | null;
  /** Barrio canónico ("Nueva Córdoba") y su slug ("nueva-cordoba"). */
  hood: string | null;
  hood_slug: string | null;
  /** listingSummaryLine(): "Depto de 1 dormitorio en Nueva Córdoba". */
  summary_line: string;
  /** offersShortStays / offersMonthlyStays (pestañas Por noche / Por mes). */
  offers_short: boolean;
  offers_monthly: boolean;
  /**
   * Reglas de precio activas (fines de semana, temporada): con ellas el total
   * de la tarjeta para unas fechas coincide con el del checkout.
   */
  pricing_rules?: UnitPricingRule[];
}

export interface StorefrontCatalog {
  listings: CatalogListing[];
  /** Barrios con unidades publicadas, de más a menos. */
  hoods: { name: string; slug: string; count: number }[];
  /** ISO del armado (para depurar la caché). */
  generated_at: string;
}

/** Ficha de una unidad de la vidriera (página /u/[slug]). */
export interface StorefrontListingDetail extends MarketplaceListingDetail {
  display_title: string;
  display_tagline: string | null;
  hood: string | null;
  hood_slug: string | null;
  summary_line: string;
  offers_short: boolean;
  offers_monthly: boolean;
}

export type AvailabilityResult =
  | { ok: true; unavailable: string[] }
  | { ok: false; error: string };

export type BlockedDatesResult =
  | { ok: true; blocked: string[]; from: string; to: string }
  | { ok: false; error: string };

// ─── Checkout ────────────────────────────────────────────────────────────────

/** Lo que manda el formulario de checkout. El huésped puede no tener cuenta. */
export interface CheckoutInput {
  unit_id: string;
  /** YYYY-MM-DD */
  check_in_date: string;
  check_out_date: string;
  guests_count: number;
  full_name: string;
  /** Con sesión, manda el email de la cuenta (el tipeado se ignora). */
  email: string;
  /** WhatsApp: el equipo confirma y coordina por ahí. */
  phone: string;
  document?: string | null;
  special_requests?: string | null;
  agreed_to_rules: boolean;
  /** Honeypot anti-bots: tiene que llegar vacío. */
  website?: string | null;
}

export type CheckoutField =
  | "full_name"
  | "email"
  | "phone"
  | "document"
  | "special_requests"
  | "agreed_to_rules"
  | "guests_count"
  | "dates";

export type CheckoutResult =
  | {
      ok: true;
      /** request = pedido que el equipo confirma; booking = reserva inmediata. */
      kind: "request" | "booking";
      request_id: string;
      /** Path del link de seguimiento: /reserva/<token>. */
      status_path: string;
    }
  | { ok: false; error: string; field?: CheckoutField };

// ─── Seguimiento de la reserva ───────────────────────────────────────────────

export interface ReservationPaymentReport {
  id: string;
  created_at: string;
  amount: number | null;
  status: PaymentReportStatus;
  has_receipt: boolean;
}

/** Todo lo que necesita la página /reserva/[token] (y el detalle en /mi-cuenta). */
export interface ReservationView {
  request_id: string | null;
  booking_id: string | null;
  /** Path del link de seguimiento (/reserva/<token>); null en reservas viejas sin solicitud. */
  status_path: string | null;
  /** Código corto para hablar con el equipo ("AP-7F3K2Q"). */
  code: string;
  stage: GuestStage;
  copy: StageCopy;
  timeline: TimelineStep[];
  created_at: string;
  /** Vencimiento del pedido mientras está pendiente. */
  expires_at: string | null;
  rejection_reason: string | null;
  instant: boolean;
  unit: {
    id: string;
    slug: string;
    title: string;
    tagline: string | null;
    hood: string | null;
    summary_line: string;
    cover_url: string | null;
    /** Dirección exacta: sólo cuando la reserva está confirmada. */
    address: string | null;
    /** "de 14 a 22 h". */
    check_in_window: string | null;
  };
  stay: {
    check_in: string;
    check_out: string;
    nights: number;
    guests: number;
  };
  money: {
    currency: string;
    total: number;
    /** Seña vigente (resolveBookingSena); null = sin seña. */
    sena: number | null;
    /** true si la seña es la estimada al pedir (todavía no la fijó el equipo). */
    sena_is_estimate: boolean;
    resto: number;
    /** Lo cobrado y registrado en Caja (bookings.paid_amount). */
    paid: number;
    /** Vencimiento para transferir la seña (confirmación + horas). */
    sena_due_at: string | null;
    sena_covered: boolean;
  };
  /** Datos para transferir: sólo mientras hay una seña que pagar. */
  transfer: TransferDetails | null;
  can_cancel: boolean;
  can_report_payment: boolean;
  payment_reports: ReservationPaymentReport[];
  contact: {
    /** wa.me con un mensaje precargado que incluye el código (sin emojis). */
    whatsapp_url: string | null;
    email: string | null;
    instagram: string | null;
  };
  response_hours: number;
  /**
   * Política de cancelación dicha para esta etapa (cancellationFollowUpCopy):
   * con el pedido pendiente, o con la reserva confirmada antes de la llegada.
   * null cuando ya no hay nada que cancelar (cerrada, en curso o terminada).
   */
  cancellation: { title: string; body: string } | null;
  guest: { first_name: string; email: string; phone: string | null };
}

/** Fila de "Mis reservas" (/mi-cuenta). */
export interface ReservationListItem {
  key: string;
  /** /reserva/<token> o /mi-cuenta/reservas/<bookingId> para reservas viejas. */
  href: string;
  title: string;
  hood: string | null;
  cover_url: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  total: number;
  currency: string;
  stage: GuestStage;
  pill: string;
  tone: StageTone;
  created_at: string;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
