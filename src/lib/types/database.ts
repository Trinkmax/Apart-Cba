/**
 * rentOS — Tipos TypeScript del schema apartcba.
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
  | "other"
  | "extra_charge"
  /** Cobro a un inquilino de alquiler tradicional (ref_type 'rental_payment'). Migración 068. */
  | "rent_collection"
  /** Pago de una rendición al propietario (ref_type 'rental_statement_payment'). Migración 068. */
  | "rent_owner_payout"
  /** Depósito en garantía (devolución al inquilino). Migración 068. */
  | "security_deposit"
  /** Honorarios inmobiliarios cobrados aparte. Migración 068. */
  | "agency_fee";

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
  | "inbound_booking_pending"
  | "inbound_booking_cancelled"
  | "inbound_booking_unmatched_unit"
  | "inbound_booking_conflict"
  | "channel_feed_error"
  | "channel_cancellation_pending"
  | "channel_request_pending"
  | "channel_request_auto_confirmed"
  | "rental_overdue"
  | "rental_adjustment"
  | "rental_expiring"
  | "rental_proof"
  | "rental_payment_report"
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
  /** false = en el sidebar se muestra solo el logo (sin el nombre). */
  brand_show_name: boolean;
  /** Override de colores por status de reserva (hex). Si null o falta una clave, se usa el default. */
  booking_status_colors: BookingStatusColors | null;
  /**
   * % que cobra cada canal de venta (la plataforma), p. ej. {"booking": 15,
   * "airbnb": 3}. Default que se snapshotea en `bookings.channel_commission_pct`
   * al crear una reserva según su `source`. Migración 058.
   */
  channel_commissions: Partial<Record<BookingSource, number>>;
  /**
   * Sobre qué se calcula la comisión de administración: 'gross' (total del
   * huésped, default desde la migración 060) o 'net_of_channel' (total −
   * comisión del canal). Ver src/lib/finance/booking-economics.ts.
   */
  commission_base: "gross" | "net_of_channel";
  /**
   * % que cobra LA ADMINISTRACIÓN según el canal de venta, p. ej.
   * {"directo": 27.5}. Gana sobre el % de la unidad, pero no sobre el acuerdo
   * con el propietario. Vacío = se usa el de la unidad. Migración 059.
   */
  commission_by_source: Partial<Record<BookingSource, number>>;
  /**
   * Plantilla de la checklist de limpieza (array de textos). Vacío = la lista
   * por defecto. Se copia a cada limpieza al crearla. Migración 062.
   */
  cleaning_checklist: string[];
  description: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  email_domain: string | null;
  email_sender_name: string | null;
  email_sender_local_part: string | null;
  email_domain_verified_at: string | null;
  email_domain_dns_records: ResendDnsRecord[] | null;
  inbound_email_token: string;
  active: boolean;
  /** La org nació de un alta self-serve desde la landing de rentOS. */
  is_trial: boolean;
  /**
   * La org vende en la web pública (www.apartcba.com). Toda lectura pública
   * (búsqueda, ficha, checkout, sitemap) filtra por esto además de
   * `units.marketplace_published`. Migración 067.
   */
  marketplace_enabled: boolean;
  /**
   * Muestra la sección Alquileres (tradicionales): contratos de 2-3 años con
   * ajuste por índice, cobranzas, comprobantes y rendiciones. Migración 068.
   */
  rentals_enabled: boolean;
  /** NOT NULL mientras conserve los datos de ejemplo del alta. NULL una vez vaciados. */
  demo_data_seeded_at: string | null;
  trial_expires_at: string | null;
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
  dni_front_path: string | null;
  dni_back_path: string | null;
  dni_updated_at: string | null;
  // Información personal del staff (la cargan admins desde /configuracion/equipo)
  job_title: string | null;
  dni_number: string | null;
  cuit_cuil: string | null;
  address: string | null;
  birth_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
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
  /** Sólo role = owner_view: el propietario que representa (migración 064). Sin él no ve nada. */
  owner_id?: string | null;
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

export type CancellationPolicy = "flexible" | "moderada" | "estricta";

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
  /** Precio por noche. */
  base_price: number | null;
  /**
   * Precio de un mes completo, en la misma moneda que base_price. Sólo para
   * default_mode 'mensual' o 'mixto' (NULL en temporario). Leelo con
   * `unitMonthlyPrice()` de `@/lib/units/pricing`. Migraciones 063 y 066.
   */
  monthly_price: number | null;
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
  // ─── Marketplace (migration 016) ──────────────────────────────────────────
  latitude: number | null;
  longitude: number | null;
  slug: string | null;
  marketplace_published: boolean;
  marketplace_title: string | null;
  marketplace_description: string | null;
  marketplace_property_type: string | null;
  marketplace_currency: string | null;
  instant_book: boolean;
  min_nights: number;
  max_nights: number | null;
  cancellation_policy: CancellationPolicy | null;
  house_rules: string | null;
  check_in_window_start: string | null;
  check_in_window_end: string | null;
  marketplace_rating_avg: number;
  marketplace_rating_count: number;
}

/**
 * Subconjunto de `Unit` embebido en los tickets de mantenimiento y en las
 * tareas de limpieza: los datos que el personal de campo necesita para llegar
 * e ingresar a la unidad sin consultar a administración. Lo hidrata el join
 * `unit:units(...)` con las columnas de `UNIT_REF_SELECT` (ver `constants.ts`).
 */
export type UnitRef = Pick<
  Unit,
  | "id"
  | "code"
  | "name"
  | "address"
  | "neighborhood"
  | "tower"
  | "floor"
  | "apartment"
  | "internal_extra"
>;

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
  country_code: string | null;
  state_code: string | null;
  city_name: string | null;
  phone_e164: string | null;
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
  /**
   * `true` = bloqueo de disponibilidad importado de un OTA (p.ej. "Airbnb (Not
   * available)"), NO una reserva real. Mantiene status='confirmada' para seguir
   * cubierto por `bookings_no_overlap`, pero se excluye de listas de reservas,
   * reportes, liquidaciones, ocupación y de la auto-creación de limpieza/eventos
   * CRM. Lo escribe únicamente el sync de iCal (src/lib/ical/sync.ts).
   */
  is_block: boolean;
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
  /** % que se lleva la plataforma (Booking, Airbnb…). Snapshot del default de la org; editable. Migración 058. */
  channel_commission_pct: number | null;
  /** total_amount × channel_commission_pct / 100, recalculado en cada escritura. */
  channel_commission_amount: number | null;
  /** Incluido en `total_amount`; se descuenta al propietario. Ver src/lib/finance/booking-economics.ts. */
  cleaning_fee: number | null;
  monthly_rent: number | null;
  monthly_expenses: number | null;
  security_deposit: number | null;
  /** Seña informada al huésped (anticipo). NO es dinero cobrado —eso es paid_amount/caja—; alimenta el mensaje/email de confirmación. Distinta de security_deposit (garantía). */
  deposit_amount: number | null;
  monthly_inflation_adjustment_pct: number | null;
  rent_billing_day: number | null;
  lease_group_id: string | null;
  notes: string | null;
  internal_notes: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  /** Quién la canceló, cuando la decidió una persona. */
  cancelled_by: string | null;
  /**
   * Por qué camino se canceló: manual · channel_decision (una persona aprobó
   * una propuesta de la OTA) · ota_email · system_legacy (cancelación
   * automática, camino eliminado en la migración 053).
   */
  cancelled_source: string | null;
  confirmation_sent_at: string | null;
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
  /** Egreso en Caja que pagó el costo real del ticket (pago al técnico). */
  paid_movement_id: string | null;
  paid_at: string | null;
  notes: string | null;
  // Contacto alternativo para coordinar el arreglo (por si el ocupante no está)
  contact_name: string | null;
  contact_phone: string | null;
  archived_at: string | null;
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
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Consejos del depto (mini-feed colaborativo) ───────────────────────────
export type UnitTipCategory =
  | "general"
  | "cocina"
  | "bano"
  | "dormitorio"
  | "acceso"
  | "electrodomesticos"
  | "importante";

export type UnitTipReactionType = "helpful" | "important" | "love";

export interface UnitTip {
  id: string;
  organization_id: string;
  unit_id: string;
  author_id: string;
  content: string;
  category: UnitTipCategory;
  photo_url: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface UnitTipReaction {
  id: string;
  tip_id: string;
  organization_id: string;
  user_id: string;
  reaction: UnitTipReactionType;
  created_at: string;
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
  /** Cuenta por defecto del botón rápido "Registrar gasto" (gastos corrientes). Máx. una por org. */
  is_expense_default: boolean;
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
  /**
   * Posición del mes liquidado dentro del ciclo de ajuste por IPC (1-based).
   * Los alquileres se actualizan cada N meses; el propietario necesita saber
   * si este pago es el 1º, 2º o 3º del ciclo. `null` = sin período cargado.
   * Ver migración 046.
   */
  period_index: number | null;
  /** Meses que dura el ciclo de ajuste (3 = trimestral). `null` → "Período N". */
  period_cycle: number | null;
  /** Aclaración corta opcional del período, impresa en el documento (≤160). */
  period_note: string | null;
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
  /** Token aleatorio para el link público de solo lectura /liquidacion/[token]. */
  public_token: string;
  /** Email al que se envió la liquidación (audit trail). */
  sent_to: string | null;
  /** Último usuario que modificó la liquidación. */
  last_edited_by: string | null;
  last_edited_at: string | null;
  /**
   * Array de unit_ids con el orden personalizado de bloques de unidad en el
   * documento. [] = sin override → la UI ordena alfabéticamente por unit.code.
   */
  unit_order: string[];
  /**
   * Tasas de cambio contra la moneda base (`currency`). Formato:
   *   `{ "USD": 1300, "EUR": 1450 }`
   * Editable por el usuario en el detalle. Líneas en una moneda sin tasa se
   * tratan como `0` al sumar el total — la UI debe avisar.
   */
  exchange_rates: Record<string, number>;
  created_at: string;
  updated_at: string;
}

/** Entrada del historial inmutable de cambios de una liquidación. */
export interface SettlementAuditEntry {
  id: string;
  settlement_id: string | null;
  action:
    | "line_add"
    | "row_add"
    | "line_update"
    | "line_delete"
    | "row_update"
    | "status_change"
    | "payment"
    /** «Anular el pago» (migración 069): fuera de la pila de deshacer. */
    | "payment_undo"
    | "regenerate"
    | "undo"
    | "redo";
  actor_user_id: string | null;
  actor_name: string;
  changes: Record<string, { from: unknown; to: unknown } | unknown>;
  side_effects: string[];
  occurred_at: string;
  /**
   * Cuándo se deshizo este cambio (migración 047). `null` = aplicado.
   * El historial es inmutable: una entrada deshecha se muestra tachada, no
   * se borra.
   */
  undone_at?: string | null;
}

/**
 * Snapshot que viaja en settlement_lines.meta (jsonb). Se llena sobre la línea
 * de ingreso (booking_revenue / monthly_rent_fraction) en el momento de generar
 * la liquidación, para reconstruir la planilla por unidad sin re-derivar de
 * bookings que pueden haber cambiado.
 */
export interface SettlementLineMeta {
  guest_name?: string | null;
  nights?: number | null;
  check_in?: string | null;
  check_out?: string | null;
  source?: string | null;
  mode?: "temporario" | "mensual" | null;
  commission_pct?: number | null;
  /** De dónde salió `commission_pct` (migración 059). */
  commission_origin?: "propietario" | "canal" | "unidad" | "organizacion" | "default" | null;
  /** % de la plataforma aplicado a esta reserva (migración 058). */
  channel_commission_pct?: number | null;
  /** Sobre qué base se calculó la comisión de administración (migración 058). */
  commission_base?: "gross" | "net_of_channel" | null;
  /** Días ocupados del mes (prorrateo mensual). */
  prorate_days?: number | null;
  /** Días totales del mes (prorrateo mensual). */
  prorate_of?: number | null;
  /**
   * Huella de la reserva cuando se armó la fila (total y limpieza tal como
   * estaban en `bookings`). Sobrevive a la edición manual: si la reserva cambia
   * después, la liquidación avisa "la reserva cambió". Filas viejas no la tienen.
   */
  booking_total?: number | null;
  booking_cleaning_fee?: number | null;
}

export interface SettlementLine {
  id: string;
  settlement_id: string;
  line_type:
    | "booking_revenue"
    | "commission"
    /** Comisión de la plataforma (Booking, Airbnb…), descontada al propietario. Migración 058. */
    | "channel_commission"
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
  /**
   * Moneda de la línea. Si difiere de la moneda base de
   * `owner_settlements.currency`, se convierte vía `exchange_rates` al calcular
   * totales. Default 'ARS' (consistente con la BD).
   */
  currency: string;
  /** true = ajuste manual; se preserva al regenerar. */
  is_manual: boolean;
  /** Snapshot para la planilla (ver SettlementLineMeta). */
  meta: SettlementLineMeta | null;
  display_order: number;
  /** Usuario que creó la línea (NULL = autogenerada por el sistema). */
  created_by: string | null;
  /** Último usuario que editó la línea manualmente. */
  updated_by: string | null;
  updated_at: string;
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

export interface IcalSyncRun {
  id: string;
  feed_id: string;
  organization_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error";
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  conflict_count: number;
  error_message: string | null;
  trigger_source: "cron" | "manual" | "create_feed";
}

export type IcalFeedHealthStatus = "ok" | "warning" | "broken";

export interface IcalFeedHealth {
  feed_id: string;
  organization_id: string;
  errors_24h: number;
  last_ok_at: string | null;
  health: IcalFeedHealthStatus;
}

export type IcalFeedWithHealth = IcalFeed & {
  unit: Pick<Unit, "id" | "code" | "name">;
  health: IcalFeedHealthStatus;
  errors_24h: number;
  last_ok_at: string | null;
};

// ─── Canales de venta v2 (channel_*) ────────────────────────────────────────
// Los row-types canónicos viven en src/lib/channels/types.ts; acá se re-exportan
// para mantener database.ts como índice único de tipos del schema.
export type {
  Channel,
  ChannelTransport,
  ChannelLinkStatus,
  ChannelEventStatus,
  ChannelLinkHealth,
  ChannelLinkRow as ChannelLink,
  ChannelReservationRow as ChannelReservation,
  ChannelIssueRow as ChannelIssue,
  ChannelIssueType,
} from "@/lib/channels/types";

export interface ChannelSettings {
  id: string;
  organization_id: string;
  operating_mode: "active" | "paused";
  email_ingest_enabled: boolean;
  email_verified_at: string | null;
  last_email_at: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChannelSyncRun {
  id: string;
  run_type: "dispatch" | "reconcile" | "manual" | "backfill";
  organization_id: string | null;
  claimed_count: number;
  processed_count: number;
  results: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

export type OtaProvider = "airbnb" | "booking" | "expedia" | "vrbo" | "otro";

export interface OtaListing {
  id: string;
  organization_id: string;
  unit_id: string;
  provider: OtaProvider;
  external_listing_id: string;
  external_listing_url: string | null;
  external_account_email: string | null;
  label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type OtaListingWithUnit = OtaListing & {
  unit: Pick<Unit, "id" | "code" | "name">;
};

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
  archived_at: string | null;
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

/**
 * % de comisión que va a usar la liquidación, resuelto EN VIVO al leer
 * (migración 059/060).
 *
 * `bookings.commission_pct` es un snapshot del momento en que se creó la
 * reserva. Si después cambia el % de la unidad o se configura uno por canal,
 * ese snapshot queda viejo y la pantalla muestra una plata que la liquidación
 * no va a pagar — pasó con Habitana: la reserva decía 27% cuando la unidad ya
 * estaba en 20%. Las pantallas muestran esto; el snapshot queda como historia.
 */
export interface EffectiveCommission {
  pct: number;
  origin: "propietario" | "canal" | "unidad" | "organizacion" | "default";
}

export interface BookingWithRelations extends Booking {
  unit?: Pick<Unit, "id" | "code" | "name"> | null;
  guest?: Pick<Guest, "id" | "full_name" | "phone" | "email"> | null;
  commission_effective?: EffectiveCommission | null;
}

/**
 * Fila liviana para la lista paginada de /dashboard/reservas: solo las columnas
 * que la lista pinta. Evita serializar el row completo de `bookings` en el
 * payload RSC. La produce `listBookingsPaged`.
 */
export type BookingListRow = Pick<
  Booking,
  | "id"
  | "status"
  | "source"
  | "check_in_date"
  | "check_out_date"
  | "guests_count"
  | "currency"
  | "total_amount"
  | "paid_amount"
> & {
  unit: { id: string; code: string; name: string } | null;
  guest: { id: string; full_name: string } | null;
};

/**
 * Resultado de la búsqueda global de reservas (input del topbar PMS).
 * No restringe por fecha — busca en toda la tabla `bookings` de la org.
 */
export interface BookingSearchResult {
  id: string;
  check_in_date: string;
  check_out_date: string;
  status: BookingStatus;
  source: BookingSource;
  external_id: string | null;
  unit: { id: string; code: string; name: string } | null;
  guest: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  } | null;
  /** Pista para resaltar qué campo matcheó: "guest" | "unit" | "external". */
  match_field: "guest" | "unit" | "external";
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

export type CrmChannelProvider = "meta_cloud" | "meta_instagram" | "baileys";
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

export type CrmBaileysSessionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "pairing"
  | "connected"
  | "logged_out"
  | "conflict"
  | "error"
  | "banned";

export interface CrmBaileysSession {
  id: string;
  organization_id: string;
  channel_id: string;
  status: CrmBaileysSessionStatus;
  phone: string | null;
  device_name: string | null;
  qr: string | null;
  qr_expires_at: string | null;
  pairing_code: string | null;
  last_error: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_seen_at: string | null;
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
  /** Hora "HH:MM:SS" del check-in / check-out según se haya configurado en el booking. */
  check_in_time: string | null;
  check_out_time: string | null;
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

// Tareas pendientes vienen del módulo "Tareas" (concierge_requests). Mantienen
// la misma forma estructural que la fila de mantenimiento para reusar UI, pero
// usan la enum de status y priority de concierge.
export interface ParteDiarioConciergeRow {
  request_id: string;
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  description: string;
  request_type: string | null;
  status: ConciergeStatus;
  priority: ConciergePriority;
  scheduled_for: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: string;
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
  /** Branding extra para el PDF (logo, color, info fiscal). Opcional para retrocompatibilidad. */
  organization_logo_url?: string | null;
  organization_primary_color?: string | null;
  organization_legal_name?: string | null;
  organization_tax_id?: string | null;
  check_outs: ParteDiarioBookingRow[];
  check_ins: ParteDiarioBookingRow[];
  sucios: ParteDiarioCleaningRow[];
  /** "Tareas pendientes" del parte = concierge_requests abiertas. */
  tareas_pendientes: ParteDiarioConciergeRow[];
  /** "Arreglos" del parte = maintenance_tickets abiertos sin filtrar prioridad. */
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
  tareas: ParteDiarioConciergeRow[];
  /** Cantidad de cleanings completadas hoy del set asignado. */
  completed_cleanings: number;
  total_cleanings: number;
}

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Tipos para tablas nuevas y dominio Resend
// ════════════════════════════════════════════════════════════════════════

export interface ResendDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface User2FARecoveryCode {
  id: string;
  user_id: string;
  code_hash: string;
  used_at: string | null;
  created_at: string;
}

export interface EmailChangeRequest {
  id: string;
  user_id: string;
  old_email: string;
  new_email: string;
  confirm_token_hash: string;
  cancel_token_hash: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  notified_old_at: string | null;
  created_at: string;
}

export type MessageChannel = "email" | "whatsapp";
export type MessageEventType = "booking_confirmed";  // futuro: 'booking_reminder', 'review_request', etc.

export interface OrgMessageTemplate {
  id: string;
  organization_id: string;
  event_type: MessageEventType | string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type SecurityEventType =
  | "password_changed"
  | "email_change_requested"
  | "email_change_confirmed"
  | "email_change_cancelled"
  | "2fa_enabled"
  | "2fa_disabled"
  | "2fa_recovery_codes_regenerated"
  | "login_with_recovery_code";

export interface SecurityAuditLog {
  id: string;
  user_id: string;
  event_type: SecurityEventType;
  metadata: Record<string, unknown> | null;
  ip: string | null;  // inet en DB; treat as string en TS
  user_agent: string | null;
  occurred_at: string;
}

export interface OrgDateMark {
  id: string;
  organization_id: string;
  date: string; // YYYY-MM-DD
  color: string; // #RRGGBB
  label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Marketplace rentOS (migration 016)
// ════════════════════════════════════════════════════════════════════════════

export interface UnitPhoto {
  id: string;
  unit_id: string;
  organization_id: string;
  storage_path: string;
  public_url: string;
  sort_order: number;
  is_cover: boolean;
  /** "image" | "video" — el bucket unit-photos aloja ambos. */
  media_type: "image" | "video";
  /** Thumbnail (primer frame) del video; null para imágenes. */
  poster_url: string | null;
  /** Duración del video en ms; null para imágenes. */
  duration_ms: number | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export type MarketplaceAmenityCategory =
  | "esencial"
  | "comodidad"
  | "exterior"
  | "familia"
  | "seguridad"
  | "accesibilidad";

export interface MarketplaceAmenity {
  code: string;
  name: string;
  icon: string;
  category: MarketplaceAmenityCategory;
  display_order: number;
  active: boolean;
}

export interface UnitMarketplaceAmenity {
  unit_id: string;
  amenity_code: string;
}

export type PricingRuleType = "date_range" | "weekday";

export interface UnitPricingRule {
  id: string;
  unit_id: string;
  organization_id: string;
  name: string;
  rule_type: PricingRuleType;
  start_date: string | null;
  end_date: string | null;
  days_of_week: number[] | null;
  price_multiplier: number | null;
  price_override: number | null;
  min_nights_override: number | null;
  priority: number;
  active: boolean;
  created_at: string;
}

export interface GuestProfile {
  user_id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  document_type: string | null;
  document_number: string | null;
  country: string | null;
  city: string | null;
  birth_date: string | null;
  preferred_currency: string | null;
  preferred_locale: string | null;
  marketing_consent: boolean;
  created_at: string;
  updated_at: string;
}

export type BookingRequestStatus =
  | "pendiente"
  | "aprobada"
  | "rechazada"
  | "expirada"
  | "cancelada";

export interface BookingRequest {
  id: string;
  organization_id: string;
  unit_id: string;
  guest_user_id: string | null;
  guest_full_name: string;
  guest_email: string;
  guest_phone: string | null;
  guest_document: string | null;
  check_in_date: string;
  check_in_time: string;
  check_out_date: string;
  check_out_time: string;
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
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  resulting_booking_id: string | null;
  notes: string | null;
  /**
   * sha256 (hex) del token del link de seguimiento `/reserva/<token>`. El
   * huésped puede pedir sin cuenta; el token en claro nunca se guarda. Mig 067.
   */
  access_token_hash: string | null;
  /** Seña estimada que se le mostró al huésped al pedir. Mig 067. */
  deposit_estimate: number | null;
  /** Cuándo se le recordó al equipo que la solicitud sigue sin respuesta. */
  staff_reminded_at: string | null;
  /** Cuándo se le avisó al huésped que su solicitud venció. */
  guest_notified_at: string | null;
  /** Cuándo se le avisó que la seña quedó cubierta (reserva asegurada). Mig 067b. */
  deposit_secured_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cómo se calcula la seña que pide el equipo al confirmar una reserva de la web.
 * - one_night: el valor de una noche (subtotal ÷ noches, sin limpieza).
 * - percent:   un % del total.
 * - none:      no se pide seña.
 */
export type DepositRule = "one_night" | "percent" | "none";

/**
 * Configuración de la web pública y del cobro de la seña por organización
 * (Configuración → Web y cobros). Sin fila = defaults. Migración 067.
 */
export interface OrgWebSettings {
  organization_id: string;
  /** Sólo dígitos con código de país (wa.me). */
  whatsapp_number: string | null;
  public_email: string | null;
  /** Sin @. */
  instagram_handle: string | null;
  /** Promesa de respuesta a una solicitud, en horas (1–48). */
  response_hours: number;
  deposit_rule: DepositRule;
  deposit_percent: number | null;
  /** Horas para transferir la seña desde la confirmación (1–168). */
  deposit_due_hours: number;
  transfer_holder: string | null;
  transfer_cuit: string | null;
  transfer_bank: string | null;
  /** 22 dígitos. */
  transfer_cbu: string | null;
  transfer_alias: string | null;
  transfer_notes: string | null;
  cancellation_text: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type PaymentReportStatus = "pendiente" | "registrado" | "descartado";

/**
 * Aviso del huésped de que transfirió la seña (con comprobante opcional). NO es
 * un cobro: la plata entra a Caja cuando una persona la registra. Mig 067.
 */
export interface BookingPaymentReport {
  id: string;
  organization_id: string;
  booking_id: string;
  booking_request_id: string | null;
  amount: number | null;
  currency: string;
  /** Ruta en el bucket privado `payment-receipts`. */
  receipt_path: string | null;
  receipt_mime: string | null;
  note: string | null;
  status: PaymentReportStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface BookingRequestWithRelations extends BookingRequest {
  unit?: Pick<Unit, "id" | "code" | "name" | "slug" | "marketplace_title"> | null;
  organization?: Pick<Organization, "id" | "name"> | null;
}

export interface Review {
  id: string;
  organization_id: string;
  unit_id: string;
  booking_id: string;
  guest_user_id: string | null;
  guest_name_snapshot: string;
  guest_avatar_snapshot: string | null;
  rating: number;
  cleanliness_rating: number | null;
  communication_rating: number | null;
  location_rating: number | null;
  value_rating: number | null;
  comment: string | null;
  host_response: string | null;
  host_responded_at: string | null;
  host_responded_by: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface Wishlist {
  user_id: string;
  unit_id: string;
  added_at: string;
}

// ─── Composiciones para vistas del marketplace ──────────────────────────────

export interface MarketplaceListingSummary {
  id: string;
  organization_id: string;
  slug: string;
  marketplace_title: string;
  marketplace_property_type: string;
  neighborhood: string | null;
  city: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  size_m2: number | null;
  latitude: number | null;
  longitude: number | null;
  base_price: number;
  /**
   * Precio de lista por MES (units.monthly_price, migraciones 063/066) ya
   * resuelto con `unitMonthlyPrice()`: null para unidades 'temporario' o si no
   * está cargado. La web NUNCA inventa un mensual (nada de noche × 30): sin
   * este valor, una estadía de 28+ noches se consulta.
   */
  monthly_price: number | null;
  marketplace_currency: string;
  cleaning_fee: number | null;
  instant_book: boolean;
  /**
   * Vocación de la unidad (units.default_mode): temporario | mensual | mixto.
   * El marketplace filtra por ella (tabs Temporales/Mensuales).
   */
  default_mode: UnitDefaultMode;
  /** Estadía mínima/máxima en noches. Se muestra como badge en las cards. */
  min_nights: number;
  max_nights: number | null;
  rating_avg: number;
  rating_count: number;
  cover_url: string | null;
  /** URLs adicionales para preview en cards (hasta 4). */
  photo_urls: string[];
  amenities: string[];
}

export interface MarketplaceListingDetail extends MarketplaceListingSummary {
  marketplace_description: string | null;
  house_rules: string | null;
  cancellation_policy: CancellationPolicy;
  check_in_window_start: string;
  check_in_window_end: string;
  photos: UnitPhoto[];
  pricing_rules: UnitPricingRule[];
  organization_name: string;
  organization_logo_url: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Alquileres tradicionales (migraciones 068 / 068b)
// Contratos de 2-3 años con ajuste por índice, cobranza mensual, comprobantes
// de expensas/servicios y rendición al propietario. Módulo aparte del PMS: las
// propiedades NO son `units`. Lógica pura en src/lib/rentals/.
// ════════════════════════════════════════════════════════════════════════════

export type RentalIndexCode = "ipc" | "icl" | "casa_propia" | "uva" | "cer" | "ripte";
export type RentalAdjustmentMethod = "indice" | "porcentaje_fijo" | "escalonado" | "manual" | "sin_ajuste";
export type RentalRounding = "none" | "unit" | "ten" | "hundred" | "thousand";
export type RentalLateFeeType = "diario_pct" | "mensual_pct" | "fijo_diario" | "ninguno";
export type RentalMoneyOwner = "propietario" | "inmobiliaria";
export type RentalVatCondition = "responsable_inscripto" | "monotributo" | "exento";
export type RentalCommissionBasis = "pct_total_contrato" | "meses" | "monto_fijo" | "ninguna";

/** Honorario {base, valor, IVA}: 5 % del total del contrato, 1 mes, $X… */
export interface RentalCommissionRule {
  basis: RentalCommissionBasis;
  value: number;
  vat: boolean;
}

/** Valores por defecto del módulo por organización. Sin fila = defaults de la 068. */
export interface RentalSettings {
  organization_id: string;
  /** Plazo para pagar, en días desde el inicio del período (10 = "del 1 al 10"). */
  payment_window_days: number;
  grace_days: number;
  late_fee_type: RentalLateFeeType;
  late_fee_value: number;
  late_fee_payee: RentalMoneyOwner;
  /** % de lo cobrado, a cargo del propietario (Ley 9445 art. 25 e: 10 %). */
  admin_fee_pct: number;
  admin_fee_vat: boolean;
  tenant_commission: RentalCommissionRule;
  owner_commission: RentalCommissionRule;
  default_index: RentalIndexCode;
  default_adjustment_every: number;
  default_lag_months: number;
  default_rounding: RentalRounding;
  default_duration_months: number;
  auto_apply_adjustments: boolean;
  stamp_tax_rate_pct: number;
  /** Exento de Sellos si el alquiler promedio mensual no supera esto (Córdoba 2026: 1.230.000). */
  stamp_tax_exempt_monthly: number | null;
  stamp_tax_tenant_share_pct: number;
  vat_condition: RentalVatCondition;
  /** Corredor responsable y su matrícula (CPI Córdoba, Ley 9445 art. 21). */
  broker_name: string | null;
  broker_license: string | null;
  /** Datos para transferir (CBU/alias) que ven los inquilinos. */
  payment_instructions: string | null;
  receipt_footer: string | null;
  /** Días antes del inicio de cada período en que se genera el cargo. */
  charge_lead_days: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type RentalPropertyType =
  | "departamento" | "casa" | "ph" | "duplex" | "local" | "oficina" | "cochera" | "deposito" | "terreno" | "otro";
export type RentalPropertyAvailability = "disponible" | "reservada" | "en_refaccion" | "retirada";
export type RentalServiceKind =
  | "expensas" | "luz" | "gas" | "agua" | "municipal" | "inmobiliario" | "internet" | "seguro" | "otro";

/** Cuenta de un servicio o impuesto de la propiedad (EPEC, Ecogas, Aguas Cordobesas, Rentas…). */
export interface RentalPropertyServiceAccount {
  kind: RentalServiceKind;
  provider: string | null;
  account_number: string | null;
  holder: string | null;
  notes: string | null;
}

export interface RentalProperty {
  id: string;
  organization_id: string;
  code: string;
  property_type: RentalPropertyType;
  street: string;
  street_number: string | null;
  floor: string | null;
  apartment: string | null;
  tower: string | null;
  neighborhood: string | null;
  city: string;
  province: string;
  postal_code: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  covered_m2: number | null;
  total_m2: number | null;
  furnished: boolean;
  has_garage: boolean;
  consortium_name: string | null;
  consortium_phone: string | null;
  consortium_email: string | null;
  /** Unidad funcional en el consorcio. */
  functional_unit: string | null;
  /** Nomenclatura catastral / cuenta de Rentas. */
  cadastral_id: string | null;
  services: RentalPropertyServiceAccount[];
  /** Precio pretendido mientras está vacante. */
  listing_rent: number | null;
  listing_currency: string | null;
  availability: RentalPropertyAvailability;
  /** Mandato de administración firmado (Ley 9445 art. 16 p). */
  mandate_signed_at: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface RentalPropertyOwner {
  id: string;
  organization_id: string;
  property_id: string;
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
  created_at: string;
}

export type RentalPersonType = "fisica" | "juridica";
export type RentalDocType = "DNI" | "CUIT" | "CUIL" | "PASAPORTE" | "OTRO";

/** Inquilino o garante (la misma persona puede ser las dos cosas en contratos distintos). */
export interface RentalPerson {
  id: string;
  organization_id: string;
  person_type: RentalPersonType;
  full_name: string;
  doc_type: RentalDocType | null;
  doc_number: string | null;
  /** CUIT/CUIL. */
  tax_id: string | null;
  birth_date: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  phone_alt: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  occupation: string | null;
  employer: string | null;
  employer_phone: string | null;
  monthly_income: number | null;
  income_currency: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type RentalContractStatus = "borrador" | "vigente" | "finalizado" | "rescindido";
export type RentalUsage = "vivienda" | "comercial" | "mixto" | "cochera" | "otro";
export type RentalLegalRegime = "ccyc_2015" | "ley_27551" | "ley_27737" | "dnu_70_2023";
export type RentalDepositStatus = "pendiente" | "retenido" | "devuelto" | "aplicado" | "trasladado" | "no_aplica";
export type RentalStampTaxStatus = "pendiente" | "pagado" | "exento" | "no_aplica";
export type RentalExpensasPayer = "inquilino" | "propietario" | "no_aplica";
export type RentalExpensasMode = "paga_inquilino" | "cobra_inmobiliaria" | "no_aplica";
export type RentalEarlyTerminationRule = "dnu_10pct" | "ley_27551" | "pactada" | "sin_penalidad";
export type RentalPayer = "inquilino" | "propietario";

/** Servicio o impuesto cuyo comprobante se controla cada mes. */
export interface RentalContractService {
  kind: RentalServiceKind;
  payer: RentalPayer;
  proof_required: boolean;
  frequency: "mensual" | "bimestral";
}

export interface RentalContract {
  id: string;
  organization_id: string;
  /** Correlativo por organización ("C-0007"). */
  number: number;
  property_id: string;
  status: RentalContractStatus;
  usage: RentalUsage;
  legal_regime: RentalLegalRegime;
  start_date: string;
  duration_months: number;
  /** start_date + duration_months − 1 día. */
  end_date: string;
  signed_at: string | null;
  currency: string;
  initial_rent: number;
  /** Alquiler vigente HOY (cache que mantienen el aplicar ajuste y el cron). */
  current_rent: number;
  adjustment_method: RentalAdjustmentMethod;
  index_code: RentalIndexCode | null;
  adjustment_every_months: number | null;
  /** Índices mensuales: 1 = meses del ciclo; 2 = último dato publicado al ajustar. */
  index_lag_months: number;
  fixed_pct: number | null;
  /** Escalonado: montos pactados de cada ajuste. */
  steps: number[] | null;
  rounding: RentalRounding;
  cap_pct: number | null;
  allow_decrease: boolean;
  payment_window_days: number;
  grace_days: number;
  late_fee_type: RentalLateFeeType;
  late_fee_value: number;
  late_fee_payee: RentalMoneyOwner;
  /** Quién cobra el alquiler: la inmobiliaria (entra a Caja y se rinde) o el propietario directo. */
  collector: RentalMoneyOwner;
  /** Contratos que ya venían corriendo: se cobra desde el período que contiene esta fecha. */
  billing_starts_on: string | null;
  admin_fee_pct: number;
  admin_fee_vat: boolean;
  tenant_commission: RentalCommissionRule | null;
  owner_commission: RentalCommissionRule | null;
  deposit_amount: number;
  deposit_currency: string | null;
  deposit_holder: RentalMoneyOwner;
  deposit_status: RentalDepositStatus;
  deposit_returned_amount: number | null;
  deposit_returned_at: string | null;
  /** 068h: registro del depósito {received, settlement, inherited}; lo leen las funciones de la base para deshacer. */
  deposit_meta: Record<string, unknown>;
  stamp_tax_status: RentalStampTaxStatus;
  stamp_tax_amount: number | null;
  expensas_payer: RentalExpensasPayer;
  expensas_mode: RentalExpensasMode;
  expensas_extra_payer: RentalPayer;
  services: RentalContractService[];
  insurance_required: boolean;
  insurance_company: string | null;
  insurance_policy: string | null;
  insurance_expires_at: string | null;
  early_termination_rule: RentalEarlyTerminationRule;
  early_termination_notes: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  termination_notice_date: string | null;
  termination_penalty: number | null;
  /** Vencido y el inquilino sigue (art. 1218): se cobran los meses de continuación. Lo enciende una persona (068f). */
  continuation_billing: boolean;
  renewed_from_id: string | null;
  portal_token_hash: string | null;
  portal_token_version: number;
  portal_enabled: boolean;
  reli_code: string | null;
  special_clauses: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type RentalPartyRole = "inquilino" | "garante";
export type RentalGuaranteeType =
  | "propietaria" | "recibo_sueldo" | "seguro_caucion" | "fianza" | "aval_bancario" | "pagare" | "otra";

export interface RentalContractParty {
  id: string;
  organization_id: string;
  contract_id: string;
  person_id: string;
  role: RentalPartyRole;
  /** Inquilino principal: titular de los recibos. */
  is_primary: boolean;
  guarantee_type: RentalGuaranteeType | null;
  /** Detalle libre de la garantía (inmueble, aseguradora y póliza, empleador…). */
  guarantee_details: Record<string, string | number | null>;
  /** Conformidad del garante para renovar (art. 1225 CCyC). */
  guarantor_consent_at: string | null;
  sort_order: number;
  created_at: string;
}

export type RentalAdjustmentStatus =
  | "programado" | "pendiente_indice" | "pendiente_manual" | "calculado" | "aplicado" | "omitido";

export interface RentalAdjustment {
  id: string;
  organization_id: string;
  contract_id: string;
  sequence: number;
  period_index: number;
  effective_date: string;
  status: RentalAdjustmentStatus;
  method: RentalAdjustmentMethod;
  index_code: RentalIndexCode | null;
  /** Mes base (YYYY-MM-01) o día base del índice. */
  from_key: string | null;
  to_key: string | null;
  from_value: number | null;
  to_value: number | null;
  coefficient: number | null;
  variation_pct: number | null;
  base_amount: number | null;
  computed_amount: number | null;
  /** Lo que rige desde effective_date (puede diferir del cálculo: override_reason). */
  applied_amount: number | null;
  override_reason: string | null;
  computed_at: string | null;
  applied_at: string | null;
  applied_by: string | null;
  notified_at: string | null;
  notified_via: string | null;
  created_at: string;
  updated_at: string;
}

export type RentalChargeKind = "mensual" | "ingreso" | "extra" | "salida";
/** Estado guardado; "vencido" se deriva (due_date < hoy con saldo). */
export type RentalChargeStatus = "pendiente" | "parcial" | "pagado" | "anulado";
export type RentalChargeItemKind =
  | "alquiler" | "diferencia_ajuste" | "expensas" | "servicio" | "punitorio" | "honorarios"
  | "deposito" | "sellado" | "reparacion" | "rescision" | "otro";
export type RentalPayee = "propietario" | "inmobiliaria" | "consorcio" | "tercero";

export interface RentalCharge {
  id: string;
  organization_id: string;
  contract_id: string;
  kind: RentalChargeKind;
  period_index: number | null;
  period_start: string | null;
  period_end: string | null;
  cycle: number | null;
  index_in_cycle: number | null;
  cycle_length: number | null;
  /** "Octubre 2026 · Período 2/3" */
  label: string;
  issue_date: string;
  due_date: string;
  currency: string;
  subtotal: number;
  paid_amount: number;
  status: RentalChargeStatus;
  /** Salió con el precio anterior porque el ajuste del período no tenía índice. */
  pending_adjustment_seq: number | null;
  notified_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface RentalChargeItem {
  id: string;
  organization_id: string;
  charge_id: string;
  kind: RentalChargeItemKind;
  /** De quién es la plata cuando se cobra. */
  payee: RentalPayee;
  description: string;
  amount: number;
  /** Importe antes de bonificar. */
  original_amount: number | null;
  discount_reason: string | null;
  paid_amount: number;
  ref_type: string | null;
  ref_id: string | null;
  meta: Record<string, unknown>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type RentalPaymentMethod = "efectivo" | "transferencia" | "mp" | "cheque" | "deposito" | "otro";

export interface RentalPayment {
  id: string;
  organization_id: string;
  contract_id: string;
  paid_at: string;
  amount: number;
  currency: string;
  method: RentalPaymentMethod;
  /** Cuenta de Caja (null si cobró el propietario directo). */
  account_id: string | null;
  cash_movement_id: string | null;
  reference: string | null;
  payer_name: string | null;
  /** Recibo correlativo por organización. */
  receipt_number: number | null;
  /** Saldo a favor del inquilino que todavía no se imputó. */
  unallocated_amount: number;
  report_id: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  created_at: string;
  created_by: string | null;
  /** Cobro con reparto (070): cuenta de Caja donde entró la parte de la inmobiliaria. */
  agency_account_id: string | null;
  /** Cobro con reparto (070): lo que le tocó a la inmobiliaria (honorarios + lo que recibe para pagarle a otro); el resto lo cobró el propietario directo. */
  agency_amount: number | null;
  /** Cobro con reparto (070): ingreso en Caja de lo que es plata de la inmobiliaria (honorarios + IVA + conceptos propios; categoría agency_fee). */
  agency_movement_id: string | null;
  /** Cobro con reparto (070): ingreso en Caja de lo que la inmobiliaria recibe para pagarle al consorcio o a terceros (categoría rent_collection). */
  pass_through_movement_id: string | null;
  /** Cobro con reparto (070): foto del reparto. No nulo = el propietario cobró directo: nunca se le rinde. */
  split: RentalPaymentSplitSnapshot | null;
}

/**
 * Foto del reparto de un cobro que el inquilino le pagó directo al propietario
 * (`rental_payments.split`, migración 070). Se guarda al registrar y no cambia:
 * lleva los datos bancarios de cada titular de ese momento.
 */
export interface RentalPaymentSplitSnapshot {
  v: 1;
  /**
   * Cómo le llegó la plata a cada uno: a cada uno su parte (lo esperado), todo
   * al propietario (que le pasó a la inmobiliaria la suya) o todo a la
   * inmobiliaria (que le pasa al propietario la suya). Sin el dato: 'cada_uno'.
   */
  route?: "cada_uno" | "todo_propietario" | "todo_inmobiliaria";
  /** Lo que pagó el inquilino (= amount del cobro). */
  total: number;
  owner: {
    /** Lo que transfirió directo a los propietarios (no entró a Caja). */
    total: number;
    shares: {
      owner_id: string;
      name: string;
      /** 0..100 */
      pct: number;
      amount: number;
      bank_name: string | null;
      cbu: string | null;
      alias: string | null;
    }[];
  };
  agency: {
    /** Lo que entró a Caja (= agency_amount). */
    total: number;
    fee_base: number;
    fee_pct: number;
    fee: number;
    vat: number;
    own: number;
    pass_through: number;
    /** "honorarios 8 % + IVA", tal como se mostró al cobrar. */
    label: string;
  };
  /** Saldo a favor que quedó (está en la parte del propietario). */
  remainder: number;
}

export interface RentalPaymentAllocation {
  id: string;
  organization_id: string;
  payment_id: string;
  charge_id: string;
  charge_item_id: string;
  amount: number;
  /** 'payment' = se imputó al registrar el cobro; 'credit' = saldo a favor aplicado después (068f). */
  source: "payment" | "credit";
  voided: boolean;
  created_at: string;
}

export type RentalProofStatus = "pendiente" | "en_revision" | "validado" | "rechazado" | "no_corresponde";

/** Comprobante mensual que presenta el inquilino (expensas, luz, gas…) y su validación. */
export interface RentalProof {
  id: string;
  organization_id: string;
  contract_id: string;
  kind: RentalServiceKind;
  /** Primer día del mes al que corresponde. */
  period: string;
  status: RentalProofStatus;
  amount: number | null;
  currency: string | null;
  due_date: string | null;
  /** Ruta en el bucket privado `rental-docs`. */
  file_path: string | null;
  file_mime: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string | null;
  uploaded_via: "staff" | "portal" | null;
  uploaded_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Aviso de pago del inquilino desde su link. NO es un cobro: staff lo registra. */
export interface RentalPaymentReport {
  id: string;
  organization_id: string;
  contract_id: string;
  amount: number | null;
  currency: string | null;
  paid_on: string | null;
  receipt_path: string | null;
  receipt_mime: string | null;
  note: string | null;
  status: PaymentReportStatus;
  payment_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type RentalExpenseCategory =
  | "reparacion" | "mantenimiento" | "expensas_extraordinarias" | "impuesto" | "servicio"
  | "seguro" | "honorarios_terceros" | "otro";
export type RentalExpenseChargedTo = "propietario" | "inquilino" | "inmobiliaria";
export type RentalExpensePaidBy = "inmobiliaria" | "propietario" | "inquilino" | "pendiente";
export type RentalExpenseStatus = "pendiente" | "aplicado" | "anulado";

export interface RentalExpense {
  id: string;
  organization_id: string;
  property_id: string;
  contract_id: string | null;
  occurred_on: string;
  category: RentalExpenseCategory;
  description: string;
  provider: string | null;
  amount: number;
  currency: string;
  /** A cargo de quién: propietario (rendición), inquilino (cargo) o inmobiliaria. */
  charged_to: RentalExpenseChargedTo;
  paid_by: RentalExpensePaidBy;
  /** pendiente = todavía no se pasó a una rendición o a un cargo. */
  status: RentalExpenseStatus;
  account_id: string | null;
  cash_movement_id: string | null;
  statement_id: string | null;
  charge_item_id: string | null;
  file_path: string | null;
  file_mime: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type RentalStatementStatus = "borrador" | "emitida" | "pagada" | "anulada";
export type RentalStatementLineType =
  | "cobro_alquiler" | "cobro_punitorio" | "cobro_otro" | "honorarios_administracion"
  | "iva_honorarios" | "comision_locacion" | "gasto" | "ajuste";

/** Rendición al propietario: lo cobrado menos honorarios, IVA y gastos a su cargo. */
export interface RentalOwnerStatement {
  id: string;
  organization_id: string;
  owner_id: string;
  number: number;
  period_year: number;
  period_month: number;
  /** Incluye cobros hasta esta fecha. */
  cutoff_date: string;
  currency: string;
  status: RentalStatementStatus;
  collected_amount: number;
  fees_amount: number;
  vat_amount: number;
  expenses_amount: number;
  other_amount: number;
  net_amount: number;
  public_token_hash: string | null;
  public_token_version: number;
  sent_at: string | null;
  sent_to: string | null;
  paid_at: string | null;
  paid_movement_ids: string[];
  notes: string | null;
  generated_at: string;
  generated_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  updated_at: string;
}

export interface RentalOwnerStatementLine {
  id: string;
  organization_id: string;
  statement_id: string;
  owner_id: string;
  line_type: RentalStatementLineType;
  sign: 1 | -1;
  amount: number;
  description: string;
  contract_id: string | null;
  property_id: string | null;
  ref_type: "allocation" | "expense" | "contract_commission" | "manual" | null;
  ref_id: string | null;
  share_pct: number;
  voided: boolean;
  sort_order: number;
  created_at: string;
}

export type RentalDocumentKind =
  | "contrato" | "garantia" | "inventario" | "acta_entrega" | "mandato" | "dni"
  | "recibo_sueldo" | "poliza" | "foto" | "otro";

export interface RentalDocument {
  id: string;
  organization_id: string;
  contract_id: string | null;
  property_id: string | null;
  person_id: string | null;
  kind: RentalDocumentKind;
  title: string;
  /** Ruta en el bucket privado `rental-docs`. */
  file_path: string;
  file_mime: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface RentalEvent {
  id: string;
  organization_id: string;
  contract_id: string | null;
  property_id: string | null;
  event_type: string;
  summary: string;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
}

/** Nivel de un índice público (tabla GLOBAL, sin organization_id). */
export interface EconomicIndexValue {
  index_code: RentalIndexCode;
  /** Mensual → primer día del mes; diario → el día. */
  period: string;
  value: number;
  source: "indec" | "bcra" | "datos_gob" | "argentinadatos" | "manual";
  fetched_at: string;
}
