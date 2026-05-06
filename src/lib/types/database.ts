/**
 * Apart Cba — Tipos TypeScript del schema apartcba.
 * Mantener en sync con supabase/migrations/.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────
export type UserRole = "admin" | "recepcion" | "mantenimiento" | "limpieza" | "owner_view";

export type UnitStatus =
  | "disponible"
  | "reservado"
  | "ocupado"
  | "limpieza"
  | "mantenimiento"
  | "bloqueado";

export type BookingStatus =
  | "pendiente"
  | "confirmada"
  | "check_in"
  | "check_out"
  | "cancelada"
  | "no_show";

export type BookingSource =
  | "directo"
  | "airbnb"
  | "booking"
  | "expedia"
  | "vrbo"
  | "whatsapp"
  | "instagram"
  | "otro";

export type TicketStatus =
  | "abierto"
  | "en_progreso"
  | "esperando_repuesto"
  | "resuelto"
  | "cerrado";

export type TicketPriority = "baja" | "media" | "alta" | "urgente";
export type TicketBillableTo = "owner" | "apartcba" | "guest";

export type CleaningStatus =
  | "pendiente"
  | "en_progreso"
  | "completada"
  | "verificada"
  | "cancelada";

export type AccountType = "efectivo" | "banco" | "mp" | "crypto" | "tarjeta" | "otro";
export type MovementDirection = "in" | "out";
export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "mp"
  | "stripe"
  | "crypto"
  | "tarjeta"
  | "otro";

export type MovementCategory =
  | "booking_payment"
  | "maintenance"
  | "cleaning"
  | "owner_settlement"
  | "transfer"
  | "adjustment"
  | "salary"
  | "utilities"
  | "tax"
  | "supplies"
  | "commission"
  | "refund"
  | "other";

export type SettlementStatus =
  | "borrador"
  | "revisada"
  | "enviada"
  | "pagada"
  | "disputada"
  | "anulada";

export type ConciergeStatus =
  | "pendiente"
  | "en_progreso"
  | "completada"
  | "rechazada"
  | "cancelada";
export type ConciergePriority = "baja" | "normal" | "alta" | "urgente";

// Modo de estadía: temporario (Airbnb-style) vs mensual (inquilino largo).
export type BookingMode = "temporario" | "mensual";
// Vocación de la unidad: una unidad puede ser exclusivamente temporaria,
// exclusivamente mensual, o "mixto" (acepta ambos según el momento).
export type UnitDefaultMode = "temporario" | "mensual" | "mixto";

// Tipo de operación registrada en booking_extensions.
export type BookingExtensionOperation =
  | "move"
  | "extend_right"
  | "shorten_right"
  | "extend_left"
  | "shorten_left"
  | "change_unit";

// Estado de una cuota mensual (booking_payment_schedule).
export type PaymentScheduleStatus =
  | "pending"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled";

// Tipo de notificación in-app.
export type NotificationType =
  | "payment_due"
  | "payment_overdue"
  | "payment_received"
  | "lease_ending_soon"
  | "lease_split_created"
  | "task_reminder"
  | "manual"
  | "other";

export type NotificationSeverity =
  | "info"
  | "warning"
  | "critical"
  | "success";

// ─── Tablas ─────────────────────────────────────────────────────────────────

export type BookingStatusColors = Partial<Record<BookingStatus, string>>;

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  timezone: string;
  default_currency: string;
  default_commission_pct: number | null;
  logo_url: string | null;
  primary_color: string | null;
  /** Override de colores por status de reserva (hex). Si null o falta una clave, se usa el default. */
  booking_status_colors: BookingStatusColors | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  is_superadmin: boolean;
  active: boolean;
  preferred_locale: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  active: boolean;
}

export interface RolePermission {
  organization_id: string;
  role: UserRole;
  resource: string;
  actions: string[];
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  is_crypto: boolean;
  active: boolean;
  display_order: number;
}

export interface ExchangeRate {
  id: string;
  organization_id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  source: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Owner {
  id: string;
  organization_id: string;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  cbu: string | null;
  alias_cbu: string | null;
  bank_name: string | null;
  preferred_currency: string | null;
  avatar_url: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Unit {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  floor: string | null;
  apartment: string | null;
  tower: string | null;
  internal_extra: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  size_m2: number | null;
  base_price_currency: string | null;
  base_price: number | null;
  cleaning_fee: number | null;
  default_commission_pct: number | null;
  default_mode: UnitDefaultMode;
  status: UnitStatus;
  status_changed_at: string;
  status_changed_by: string | null;
  position: number;
  cover_image_url: string | null;
  amenities_summary: string | null;
  description: string | null;
  notes: string | null;
  active: boolean;
  ical_export_token: string;
  created_at: string;
  updated_at: string;
}

export interface UnitOwner {
  id: string;
  unit_id: string;
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
  commission_pct_override: number | null;
  notes: string | null;
  created_at: string;
}

export interface UnitStatusHistoryEntry {
  id: number;
  unit_id: string;
  organization_id: string;
  from_status: UnitStatus | null;
  to_status: UnitStatus;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface Guest {
  id: string;
  organization_id: string;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  state_or_province: string | null;
  city: string | null;
  birth_date: string | null;
  notes: string | null;
  blacklisted: boolean;
  blacklist_reason: string | null;
  total_bookings: number;
  total_revenue: number | null;
  last_stay_at: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  organization_id: string;
  unit_id: string;
  guest_id: string | null;
  source: BookingSource;
  external_id: string | null;
  external_url: string | null;
  status: BookingStatus;
  mode: BookingMode;
  check_in_date: string;
  check_in_time: string;
  check_out_date: string;
  check_out_time: string;
  guests_count: number;
  currency: string;
  total_amount: number;
  paid_amount: number;
  commission_pct: number | null;
  commission_amount: number | null;
  cleaning_fee: number | null;
  monthly_rent: number | null;
  monthly_expenses: number | null;
  security_deposit: number | null;
  monthly_inflation_adjustment_pct: number | null;
  rent_billing_day: number | null;
  lease_group_id: string | null;
  notes: string | null;
  internal_notes: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface BookingPayment {
  id: string;
  organization_id: string;
  booking_id: string;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  account_id: string | null;
  cash_movement_id: string | null;
  paid_at: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface MaintenanceTicket {
  id: string;
  organization_id: string;
  unit_id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  opened_by: string | null;
  assigned_to: string | null;
  opened_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  cost_currency: string | null;
  billable_to: TicketBillableTo;
  related_owner_id: string | null;
  charged_to_owner_at: string | null;
  charged_to_settlement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type TicketEventType =
  | "created"
  | "status_changed"
  | "updated"
  | "cost_updated"
  | "assigned"
  | "note_added";

export interface TicketEvent {
  id: string;
  ticket_id: string;
  organization_id: string;
  actor_id: string | null;
  event_type: TicketEventType;
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type CleaningEventType =
  | "created"
  | "status_changed"
  | "updated"
  | "assigned"
  | "checklist_updated"
  | "cost_updated";

export interface CleaningEvent {
  id: string;
  cleaning_task_id: string;
  organization_id: string;
  actor_id: string | null;
  event_type: CleaningEventType;
  from_status: CleaningStatus | null;
  to_status: CleaningStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ConciergeEventType =
  | "created"
  | "status_changed"
  | "updated"
  | "assigned"
  | "cost_updated"
  | "alert_updated";

export interface ConciergeEvent {
  id: string;
  concierge_request_id: string;
  organization_id: string;
  actor_id: string | null;
  event_type: ConciergeEventType;
  from_status: ConciergeStatus | null;
  to_status: ConciergeStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  file_url: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface CleaningTask {
  id: string;
  organization_id: string;
  unit_id: string;
  booking_out_id: string | null;
  booking_in_id: string | null;
  scheduled_for: string;
  assigned_to: string | null;
  status: CleaningStatus;
  checklist: { item: string; done: boolean; note?: string }[];
  cost: number | null;
  cost_currency: string | null;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashAccount {
  id: string;
  organization_id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: number;
  account_number: string | null;
  bank_name: string | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
  active: boolean;
  display_order: number | null;
  created_at: string;
}

export type CashBillableTo = "apartcba" | "owner" | "guest";

export interface CashMovement {
  id: string;
  organization_id: string;
  account_id: string;
  direction: MovementDirection;
  amount: number;
  currency: string;
  category: MovementCategory;
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  owner_id: string | null;
  description: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
  billable_to: CashBillableTo;
}

export interface CashTransfer {
  id: string;
  organization_id: string;
  from_movement_id: string;
  to_movement_id: string;
  exchange_rate: number | null;
  fee: number | null;
  notes: string | null;
  created_at: string;
}

export interface OwnerSettlement {
  id: string;
  organization_id: string;
  owner_id: string;
  period_year: number;
  period_month: number;
  status: SettlementStatus;
  currency: string;
  gross_revenue: number;
  commission_amount: number;
  deductions_amount: number;
  net_payable: number;
  generated_at: string;
  generated_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  sent_at: string | null;
  paid_at: string | null;
  paid_movement_id: string | null;
  notes: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementLine {
  id: string;
  settlement_id: string;
  line_type:
    | "booking_revenue"
    | "commission"
    | "maintenance_charge"
    | "cleaning_charge"
    | "adjustment"
    | "monthly_rent_fraction"
    | "expenses_fraction";
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  display_order: number;
  created_at: string;
}

export interface BookingExtension {
  id: string;
  organization_id: string;
  booking_id: string;
  operation: BookingExtensionOperation;
  previous_unit_id: string;
  new_unit_id: string;
  previous_check_in_date: string;
  new_check_in_date: string;
  previous_check_out_date: string;
  new_check_out_date: string;
  delta_days: number;
  previous_total_amount: number | null;
  new_total_amount: number | null;
  reason: string | null;
  actor_user_id: string | null;
  created_at: string;
}

export interface IcalFeed {
  id: string;
  organization_id: string;
  unit_id: string;
  source: "airbnb" | "booking" | "expedia" | "vrbo" | "otro";
  label: string | null;
  feed_url: string;
  active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  events_imported_count: number;
  created_at: string;
}

export interface Amenity {
  id: string;
  organization_id: string;
  name: string;
  category: string | null;
  icon: string | null;
  consumable: boolean;
  unit_label: string | null;
  default_par_level: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface UnitAmenity {
  id: string;
  unit_id: string;
  amenity_id: string;
  current_quantity: number;
  par_level: number | null;
  last_restocked_at: string | null;
  notes: string | null;
}

export type InventoryMovementType = "restock" | "consume" | "adjust" | "initial";

export interface InventoryMovement {
  id: string;
  organization_id: string;
  unit_id: string;
  amenity_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  quantity_after: number | null;
  performed_by: string | null;
  notes: string | null;
  performed_at: string;
}

export interface ConciergeRequest {
  id: string;
  organization_id: string;
  unit_id: string | null;
  booking_id: string | null;
  guest_id: string | null;
  request_type: string | null;
  description: string;
  status: ConciergeStatus;
  priority: ConciergePriority;
  assigned_to: string | null;
  cost: number | null;
  cost_currency: string | null;
  charge_to_guest: boolean;
  scheduled_for: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface Invoice {
  id: string;
  organization_id: string;
  invoice_type: "factura_a" | "factura_b" | "factura_c" | "recibo" | "nota_credito" | "nota_debito";
  number: string | null;
  point_of_sale: number | null;
  ref_type: string | null;
  ref_id: string | null;
  amount: number;
  currency: string;
  issued_at: string;
  cae: string | null;
  cae_due_date: string | null;
  pdf_url: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

// ─── Tipos enriquecidos para joins ───────────────────────────────────────────

export interface UnitWithRelations extends Unit {
  primary_owner?: Owner | null;
  next_booking?: Pick<Booking, "id" | "guest_id" | "check_in_date" | "check_out_date" | "guests_count"> & {
    guest?: Pick<Guest, "id" | "full_name"> | null;
  } | null;
  open_ticket?: Pick<MaintenanceTicket, "id" | "title" | "priority" | "status"> | null;
}

export interface BookingWithRelations extends Booking {
  unit?: Pick<Unit, "id" | "code" | "name"> | null;
  guest?: Pick<Guest, "id" | "full_name" | "phone" | "email"> | null;
}

export interface BookingPaymentSchedule {
  id: string;
  organization_id: string;
  booking_id: string;
  lease_group_id: string | null;
  sequence_number: number;
  total_count: number;
  due_date: string;
  expected_amount: number;
  paid_amount: number;
  currency: string;
  status: PaymentScheduleStatus;
  paid_at: string | null;
  cash_movement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingPaymentScheduleWithBooking extends BookingPaymentSchedule {
  booking?:
    | (Pick<
        Booking,
        | "id"
        | "unit_id"
        | "mode"
        | "status"
        | "currency"
        | "monthly_rent"
        | "monthly_expenses"
        | "total_amount"
        | "paid_amount"
        | "lease_group_id"
      > & {
        guest?: Pick<Guest, "id" | "full_name" | "phone" | "email"> | null;
        unit?: Pick<Unit, "id" | "code" | "name"> | null;
      })
    | null;
}

export interface Notification {
  id: string;
  organization_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  target_user_id: string | null;
  target_role: UserRole | null;
  action_url: string | null;
  due_at: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  dedup_key: string | null;
  created_at: string;
  created_by: string | null;
}

export interface OwnerMember {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  avatar_url: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Messaging (legacy stack — usado por /api/webhooks/meta/[channel]/route.ts)
// Coexiste con CRM (más abajo). Ambos stacks viven en paralelo.
// ════════════════════════════════════════════════════════════════════════════

export type MessagingChannelType = "whatsapp" | "instagram";

export type MessagingContentType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "contacts"
  | "sticker"
  | "system"
  | "unsupported";

// ════════════════════════════════════════════════════════════════════════════
// CRM (migration 010)
// ════════════════════════════════════════════════════════════════════════════

export type CrmChannelProvider = "meta_cloud" | "meta_instagram";
export type CrmChannelStatus = "pending" | "active" | "disabled" | "error";

export interface CrmChannel {
  id: string;
  organization_id: string;
  provider: CrmChannelProvider;
  display_name: string;
  // WA fields (null si provider = meta_instagram)
  phone_number: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  // IG fields (null si provider = meta_cloud)
  instagram_business_account_id: string | null;
  page_id: string | null;
  instagram_username: string | null;
  // Comunes
  app_id: string | null;
  access_token_secret_id: string | null;
  app_secret_secret_id: string | null;
  webhook_verify_token_secret_id: string | null;
  status: CrmChannelStatus;
  last_error: string | null;
  last_health_check_at: string | null;
  webhook_subscribed_fields: string[];
  provider_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CrmContactKind = "lead" | "guest" | "owner" | "staff" | "other";
export type CrmContactExternalKind = "phone" | "igsid" | "fb_psid";

export interface CrmContact {
  id: string;
  organization_id: string;
  external_id: string;             // E.164 phone OR IGSID
  external_kind: CrmContactExternalKind;
  phone: string | null;            // null si external_kind != 'phone'
  instagram_username: string | null;
  name: string | null;
  avatar_url: string | null;
  guest_id: string | null;
  owner_id: string | null;
  contact_kind: CrmContactKind;
  preferred_locale: string | null;
  metadata: Record<string, unknown>;
  blocked: boolean;
  last_message_at: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
}

export type CrmConversationStatus = "open" | "closed" | "archived" | "snoozed";
export type CrmConversationClosedReason =
  | "auto_24h"
  | "manual"
  | "workflow"
  | null;

export interface CrmConversation {
  id: string;
  organization_id: string;
  contact_id: string;
  channel_id: string;
  status: CrmConversationStatus;
  assigned_to: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_customer_message_at: string | null;
  last_outbound_message_at: string | null;
  closed_at: string | null;
  closed_reason: CrmConversationClosedReason;
  snoozed_until: string | null;
  ai_summary: string | null;
  ai_summary_generated_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CrmMessageDirection = "in" | "out";
export type CrmMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "contacts"
  | "sticker"
  | "template"
  | "interactive_buttons"
  | "interactive_list"
  | "reaction"
  | "system"
  | "unsupported"
  | "story_reply"
  | "story_mention"
  | "share"
  | "postback"
  | "quick_reply";
export type CrmMessageStatus =
  | "received"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "deleted";
export type CrmMessageSenderKind = "human" | "workflow" | "ai" | "contact" | "system";

export interface CrmMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  contact_id: string;
  channel_id: string;
  direction: CrmMessageDirection;
  type: CrmMessageType;
  body: string | null;
  media_storage_path: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_size_bytes: number | null;
  media_duration_ms: number | null;
  media_filename: string | null;
  media_thumbnail_path: string | null;
  transcription_text: string | null;
  transcription_language: string | null;
  payload: Record<string, unknown> | null;
  template_name: string | null;
  template_variables: Record<string, unknown> | null;
  reply_to_message_id: string | null;
  sender_user_id: string | null;
  sender_kind: CrmMessageSenderKind | null;
  workflow_run_id: string | null;
  wa_message_id: string | null;
  status: CrmMessageStatus;
  status_updated_at: string | null;
  error_code: string | null;
  error_message: string | null;
  starred: boolean;
  ai_classified_tags: string[] | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface CrmTag {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  color: string;
  description: string | null;
  is_system: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type CrmConversationTagAddedVia = "manual" | "ai" | "workflow" | "system";

export interface CrmConversationTag {
  conversation_id: string;
  tag_id: string;
  added_via: CrmConversationTagAddedVia;
  added_by: string | null;
  added_at: string;
}

export interface CrmQuickReply {
  id: string;
  organization_id: string;
  shortcut: string;
  title: string;
  body: string;
  variables: string[];
  visible_to_roles: UserRole[];
  usage_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmWorkflowStatus = "inactive" | "active" | "draft" | "archived";
export type CrmWorkflowTriggerType =
  | "message_received"
  | "conversation_closed"
  | "pms_event"
  | "scheduled"
  | "manual";

export interface CrmWorkflowGraph {
  nodes: CrmWorkflowNode[];
  edges: CrmWorkflowEdge[];
}

export interface CrmWorkflowNode {
  id: string;
  type: string; // matches NodeDefinition.type, e.g. "send_message", "condition"
  position: { x: number; y: number };
  data: {
    label?: string;
    config: Record<string, unknown>;
  };
}

export interface CrmWorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  data?: Record<string, unknown>;
}

export interface CrmWorkflow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: CrmWorkflowStatus;
  trigger_type: CrmWorkflowTriggerType;
  trigger_config: Record<string, unknown>;
  graph: CrmWorkflowGraph;
  variables: Record<string, unknown>;
  version: number;
  active_version: number | null;
  validation_errors: Record<string, unknown> | null;
  last_executed_at: string | null;
  runs_count: number;
  success_count: number;
  failure_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmWorkflowRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "suspended";

export interface CrmWorkflowRun {
  id: string;
  organization_id: string;
  workflow_id: string;
  workflow_version: number;
  status: CrmWorkflowRunStatus;
  trigger_payload: Record<string, unknown>;
  conversation_id: string | null;
  contact_id: string | null;
  current_node_id: string | null;
  variables: Record<string, unknown>;
  steps_executed: number;
  resume_at: string | null;
  resume_reason: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export type CrmWorkflowStepLogStatus = "success" | "failed" | "skipped" | "pending";

export interface CrmWorkflowStepLog {
  id: string;
  run_id: string;
  organization_id: string;
  node_id: string;
  node_type: string;
  status: CrmWorkflowStepLogStatus;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface CrmWorkflowSchedule {
  id: string;
  organization_id: string;
  workflow_id: string;
  cron_expression: string;
  timezone: string;
  next_run_at: string;
  last_run_at: string | null;
  active: boolean;
}

export type CrmTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type CrmTemplateHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type CrmTemplateMetaStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled";

export interface CrmTemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
}

export interface CrmWhatsAppTemplate {
  id: string;
  organization_id: string;
  channel_id: string;
  name: string;
  language: string;
  category: CrmTemplateCategory;
  header_type: CrmTemplateHeaderType | null;
  header_text: string | null;
  header_media_url: string | null;
  body: string;
  body_example: Record<string, unknown> | null;
  footer: string | null;
  buttons: CrmTemplateButton[] | null;
  variables_count: number;
  meta_status: CrmTemplateMetaStatus;
  meta_template_id: string | null;
  meta_rejection_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  last_polled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmAiChatProvider = "anthropic" | "openai" | "vercel_gateway";

export interface CrmAiSettings {
  organization_id: string;
  chat_provider: CrmAiChatProvider;
  chat_default_model: string;
  chat_api_key_secret_id: string | null;
  transcription_provider: "openai";
  transcription_api_key_secret_id: string | null;
  transcribe_audio_min_seconds: number;
  transcribe_audio_max_seconds: number;
  monthly_token_budget: number | null;
  tokens_used_this_month: number;
  cost_used_this_month_usd: number;
  budget_period_started_at: string;
  enabled_models: string[];
  updated_at: string;
}

export type CrmOutboxStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";

export interface CrmMessageOutbox {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string;
  channel_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  status: CrmOutboxStatus;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface CrmEvent {
  id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  conversation_id: string | null;
  contact_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  dispatched: boolean;
  dispatched_at: string | null;
  created_at: string;
}

// ─── Composite types para queries con joins ─────────────────────────────────

export interface CrmConversationListItem extends CrmConversation {
  contact: CrmContact;
  channel: Pick<CrmChannel, "id" | "provider" | "display_name">;
  tags: CrmTag[];
  assigned_user?: { id: string; full_name: string; avatar_url: string | null } | null;
}

export interface CrmConversationDetail extends CrmConversationListItem {
  messages: CrmMessage[];
}

export interface CrmContactWithLinks extends CrmContact {
  guest?:
    | (Pick<Guest, "id" | "full_name" | "email" | "phone" | "document_number" | "total_bookings"> & {
        active_booking?: Pick<
          Booking,
          "id" | "unit_id" | "check_in_date" | "check_out_date" | "status" | "total_amount" | "paid_amount"
        > & {
          unit?: Pick<Unit, "id" | "code" | "name"> | null;
        };
      })
    | null;
  owner?:
    | (Pick<Owner, "id" | "full_name" | "email" | "phone" | "preferred_currency"> & {
        units?: Pick<Unit, "id" | "code" | "name">[];
      })
    | null;
}

// ─── Parte Diario ───────────────────────────────────────────────────────────

export type DailyReportStatus = "borrador" | "revisado" | "enviado";
export type DailyReportGeneratedKind = "auto" | "manual";

export interface ParteDiarioSettings {
  organization_id: string;
  enabled: boolean;
  timezone: string;
  /** Hora local (0–23) en la que se genera el borrador para el día siguiente. */
  draft_hour: number;
  /** Hora local opcional para recordar al admin si el parte sigue en borrador. */
  reminder_hour: number | null;
  channel_id: string | null;
  template_name: string;
  template_language: string;
  auto_create_cleaning_tasks: boolean;
  auto_assign_cleaning: boolean;
  organization_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyReport {
  id: string;
  organization_id: string;
  /** Fecha que cubre el parte (typicamente "mañana" cuando se genera a las 20:00). */
  report_date: string;
  status: DailyReportStatus;
  generated_at: string;
  generated_by: string | null;
  generated_kind: DailyReportGeneratedKind;
  reviewed_at: string | null;
  reviewed_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  pdf_url: string | null;
  pdf_storage_path: string | null;
  wa_message_ids: string[];
  payload: ParteDiarioSnapshot | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParteDiarioRecipient {
  id: string;
  organization_id: string;
  contact_id: string | null;
  user_id: string | null;
  phone: string;
  label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Composiciones que arma getParteDiario al vuelo ─────────────────────────

export interface ParteDiarioBookingRow {
  booking_id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  guest_name: string | null;
  mode: BookingMode;
  status: BookingStatus;
  /** "uso prop" cuando el guest_id es null o se marca como uso propietario. */
  is_owner_use: boolean;
  check_in_date: string;
  check_out_date: string;
}

export interface ParteDiarioCleaningRow {
  /** Si task_id es null, es un "ghost" — hay check-out pero todavía no hay tarea creada. */
  task_id: string | null;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  scheduled_for: string;
  status: CleaningStatus | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  /** Source booking que disparó esta limpieza, si la conocemos. */
  booking_out_id: string | null;
  guest_name: string | null;
  /** Hora aproximada de check-out para priorizar la cola de limpieza. */
  check_out_time: string | null;
}

export interface ParteDiarioMaintenanceRow {
  ticket_id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  opened_at: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
}

export interface ParteDiarioCleanerLoad {
  user_id: string;
  full_name: string;
  role: UserRole;
  /** Cantidad de tareas asignadas a este limpiador para report_date. */
  count: number;
}

export interface ParteDiarioSnapshot {
  date: string;
  /** Pretty label en español para el header del PDF. Ej: "Miércoles 7 de mayo". */
  date_label: string;
  organization_name: string;
  check_outs: ParteDiarioBookingRow[];
  check_ins: ParteDiarioBookingRow[];
  sucios: ParteDiarioCleaningRow[];
  tareas_pendientes: ParteDiarioMaintenanceRow[];
  arreglos: ParteDiarioMaintenanceRow[];
  cleaner_loads: ParteDiarioCleanerLoad[];
}

export interface ParteDiarioPayload extends ParteDiarioSnapshot {
  report: DailyReport | null;
  settings: ParteDiarioSettings;
}

export interface MobileParteDiarioPayload {
  date: string;
  date_label: string;
  greeting_name: string;
  cleanings: ParteDiarioCleaningRow[];
  maintenance: ParteDiarioMaintenanceRow[];
  /** Cantidad de cleanings completadas hoy del set asignado. */
  completed_cleanings: number;
  total_cleanings: number;
}
