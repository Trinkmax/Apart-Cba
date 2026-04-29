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

// ─── Tablas ─────────────────────────────────────────────────────────────────

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
  line_type: "booking_revenue" | "commission" | "maintenance_charge" | "cleaning_charge" | "adjustment";
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  display_order: number;
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

export interface OwnerMember {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  avatar_url: string | null;
}

// ─── Mensajería ─────────────────────────────────────────────────────────────

export type MessagingChannelType = "whatsapp" | "instagram";

export type MessagingChannelStatus = "connected" | "disconnected" | "error";

export type MessagingConversationStatus = "open" | "snoozed" | "closed" | "archived";

export type MessagingMessageDirection = "inbound" | "outbound";

export type MessagingContentType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "template"
  | "reaction"
  | "system";

export type MessagingMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export type MessagingWorkflowTrigger =
  | "booking_confirmed"
  | "pre_check_in"
  | "on_check_in"
  | "during_stay"
  | "pre_check_out"
  | "on_check_out"
  | "post_stay_review"
  | "inbound_first_message";

export type MessagingBroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type MessagingBroadcastAudience =
  | "all"
  | "active_guests"
  | "past_guests"
  | "upcoming_arrivals"
  | "custom_tag";

export type MessagingAlertType =
  | "unanswered"
  | "vip"
  | "negative_sentiment"
  | "sla_breach"
  | "workflow_failure"
  | "channel_error";

export type MessagingAlertSeverity = "info" | "warning" | "urgent";

export interface MessagingChannel {
  id: string;
  organization_id: string;
  channel_type: MessagingChannelType;
  display_name: string | null;
  access_token: string | null;
  app_id: string | null;
  app_secret: string | null;
  business_account_id: string | null;
  phone_number_id: string | null;
  instagram_account_id: string | null;
  webhook_verify_token: string;
  graph_api_version: string;
  status: MessagingChannelStatus;
  status_detail: string | null;
  last_verified_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessagingTag {
  id: string;
  organization_id: string;
  label: string;
  color: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface MessagingContact {
  id: string;
  organization_id: string;
  channel_type: MessagingChannelType;
  external_id: string;
  display_name: string | null;
  profile_pic_url: string | null;
  guest_id: string | null;
  notes: string | null;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessagingConversation {
  id: string;
  organization_id: string;
  channel_id: string;
  contact_id: string;
  status: MessagingConversationStatus;
  assigned_to: string | null;
  tag_ids: string[];
  related_booking_id: string | null;
  related_unit_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: MessagingMessageDirection | null;
  snoozed_until: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagingMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  channel_id: string;
  direction: MessagingMessageDirection;
  external_message_id: string | null;
  content_type: MessagingContentType;
  text: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_caption: string | null;
  media_filename: string | null;
  reply_to_message_id: string | null;
  status: MessagingMessageStatus;
  error_message: string | null;
  sender_user_id: string | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
}

export interface MessagingTemplate {
  id: string;
  organization_id: string;
  shortcut: string;
  title: string;
  body: string;
  category: string | null;
  attachments: { url: string; mime: string; name?: string }[];
  active: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagingWorkflow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  trigger: MessagingWorkflowTrigger;
  delay_minutes: number;
  channel_type: MessagingChannelType;
  message_body: string;
  active: boolean;
  filters: Record<string, unknown>;
  last_run_at: string | null;
  runs_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagingBroadcast {
  id: string;
  organization_id: string;
  name: string;
  channel_id: string;
  audience: MessagingBroadcastAudience;
  audience_filter: Record<string, unknown>;
  message_body: string;
  attachments: { url: string; mime: string; name?: string }[];
  status: MessagingBroadcastStatus;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  recipients_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagingAlert {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  alert_type: MessagingAlertType;
  severity: MessagingAlertSeverity;
  title: string;
  body: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

// Tipos enriquecidos

export interface MessagingConversationWithRelations extends MessagingConversation {
  contact: MessagingContact;
  channel: Pick<MessagingChannel, "id" | "channel_type" | "display_name" | "status">;
  guest?: Pick<Guest, "id" | "full_name" | "phone" | "email"> | null;
  related_booking?: Pick<
    Booking,
    "id" | "check_in_date" | "check_out_date" | "status" | "unit_id"
  > | null;
}
