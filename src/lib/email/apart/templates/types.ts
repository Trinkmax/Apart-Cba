import type { TransferDetails } from "@/lib/marketplace/web-settings";
import type { ContactInfo, StayBlock } from "../blocks";

/**
 * Datos que reciben las plantillas de mails de apart. Todo ya resuelto por
 * `src/lib/marketplace/notifications.ts` (que es el que lee la base): las
 * plantillas son puras y se testean con datos de ejemplo.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMoney {
  currency: string;
  total: number;
  /** Seña vigente; null = sin seña. */
  sena: number | null;
  /** Total − seña. */
  resto: number;
}

/** Base de todos los mails al huésped. */
export interface GuestEmailBase {
  guestFirstName: string;
  /** "AP-7F3K2Q". */
  code: string;
  /** URL absoluta del seguimiento (/reserva/<token>). */
  statusUrl: string;
  stay: StayBlock;
  money: EmailMoney;
  contact: ContactInfo;
}

export interface RequestReceivedEmail extends GuestEmailBase {
  /** Promesa de respuesta en horas. */
  responseHours: number;
  /** "1 noche", "30 %" (depositRuleLabel) o null si no se pide seña. */
  senaRuleLabel: string | null;
}

export interface ReservationConfirmedEmail extends GuestEmailBase {
  /** Reserva inmediata (sin confirmación del equipo). */
  instant: boolean;
  /** Vencimiento para transferir la seña (timestamp ISO). */
  senaDueAt: string | null;
  /** Datos de transferencia; null = "te los pasamos por WhatsApp". */
  transfer: TransferDetails | null;
  cancellation: { title: string; body: string } | null;
  /**
   * Lo ya registrado en Caja al confirmar (p. ej. la seña entró antes de que
   * el equipo aprobara). Con `money.sena = null` y paid > 0, el mail dice
   * "asegurada" en vez de "no hace falta seña".
   */
  paid?: number;
}

export interface RequestRejectedEmail extends GuestEmailBase {
  reason: string | null;
  /** URL absoluta para buscar otras fechas/unidades. */
  searchUrl: string;
}

export interface RequestExpiredEmail extends GuestEmailBase {
  searchUrl: string;
}

export interface PaymentReportedGuestEmail extends GuestEmailBase {
  /** Monto que el huésped dice haber transferido. */
  reportedAmount: number | null;
  hasReceipt: boolean;
}

export interface DepositRegisteredEmail extends GuestEmailBase {
  /** Lo registrado en Caja (bookings.paid_amount). */
  paid: number;
}

/** Datos del huésped para los mails al equipo. */
export interface StaffGuestInfo {
  fullName: string;
  email: string | null;
  phone: string | null;
  /** wa.me al huésped (link directo para responderle). */
  phoneWaUrl: string | null;
  document: string | null;
  message: string | null;
}

export interface StaffEmailBase {
  guest: StaffGuestInfo;
  code: string;
  stay: StayBlock;
  money: EmailMoney;
  /** URL absoluta al panel. */
  panelUrl: string;
  /** URL absoluta del seguimiento del huésped (para reenviárselo). */
  statusUrl: string | null;
}

export interface StaffNewRequestEmail extends StaffEmailBase {
  /** true = reserva inmediata (ya confirmada); false = pedido a confirmar. */
  instant: boolean;
  /** Vencimiento del pedido (timestamp ISO). */
  expiresAt: string | null;
  responseHours: number;
}

export interface StaffPaymentReportedEmail extends StaffEmailBase {
  reportedAmount: number | null;
  note: string | null;
  hasReceipt: boolean;
  /** Lo ya registrado en Caja. */
  paid: number;
}

export interface StaffRequestReminderEmail extends StaffEmailBase {
  /** Timestamp ISO de cuando entró el pedido. */
  createdAt: string;
  expiresAt: string | null;
  responseHours: number;
}
