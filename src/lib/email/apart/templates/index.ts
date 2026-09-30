/**
 * Plantillas de mails de apart. Puras: reciben los datos ya resueltos (ver
 * types.ts) y devuelven { subject, html, text }. Quien lee la base y manda es
 * src/lib/marketplace/notifications.ts.
 */
export * from "./types";
export { renderRequestReceivedEmail } from "./request-received";
export { renderReservationConfirmedEmail } from "./reservation-confirmed";
export { renderRequestRejectedEmail, renderRequestExpiredEmail } from "./request-closed";
export { renderPaymentReportedGuestEmail, renderDepositRegisteredEmail } from "./payment";
export {
  renderStaffNewRequestEmail,
  renderStaffPaymentReportedEmail,
  renderStaffRequestReminderEmail,
} from "./staff";
