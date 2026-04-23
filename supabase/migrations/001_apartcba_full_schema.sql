-- ════════════════════════════════════════════════════════════════════════════
-- APART CBA — Schema completo (Fases 0-6)
-- Schema dedicado: apartcba (aislado del schema public donde vive TextOS)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Extensiones requeridas ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- para EXCLUDE de overlap de fechas

-- ─── Schema raíz ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS apartcba;
COMMENT ON SCHEMA apartcba IS 'Apart Cba PMS — gestión de departamentos temporales';

-- Permitir que los roles de Supabase usen el schema
GRANT USAGE ON SCHEMA apartcba TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Multi-tenancy y auth
-- ════════════════════════════════════════════════════════════════════════════

-- Organizations (multi-tenant root)
CREATE TABLE IF NOT EXISTS apartcba.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  legal_name text,
  tax_id text,
  timezone text NOT NULL DEFAULT 'America/Argentina/Cordoba',
  default_currency text NOT NULL DEFAULT 'ARS',
  default_commission_pct numeric(5,2) DEFAULT 20.00,
  logo_url text,
  primary_color text DEFAULT '#0F766E',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- User profiles (1:1 con auth.users; presencia de fila = es usuario de Apart Cba)
CREATE TABLE IF NOT EXISTS apartcba.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  avatar_url text,
  phone text,
  is_superadmin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  preferred_locale text DEFAULT 'es-AR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Organization members (N:M user × organization con rol)
CREATE TABLE IF NOT EXISTS apartcba.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','recepcion','mantenimiento','limpieza','owner_view')),
  invited_by uuid REFERENCES auth.users(id),
  invited_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON apartcba.organization_members(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_org_members_org ON apartcba.organization_members(organization_id) WHERE active;

-- Role-resource-action permissions matrix (override por org)
CREATE TABLE IF NOT EXISTS apartcba.role_permissions (
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  resource text NOT NULL,
  actions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (organization_id, role, resource)
);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Monedas y cotizaciones
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  decimals smallint NOT NULL DEFAULT 2,
  is_crypto boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  display_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apartcba.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  from_currency text NOT NULL REFERENCES apartcba.currencies(code),
  to_currency text NOT NULL REFERENCES apartcba.currencies(code),
  rate numeric(20,8) NOT NULL CHECK (rate > 0),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (organization_id, from_currency, to_currency, effective_date, source)
);

CREATE INDEX IF NOT EXISTS idx_rates_lookup ON apartcba.exchange_rates(organization_id, from_currency, to_currency, effective_date DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Propietarios y unidades
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  document_type text,
  document_number text,
  email text,
  phone text,
  address text,
  city text,
  cbu text,
  alias_cbu text,
  bank_name text,
  preferred_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  avatar_url text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owners_org ON apartcba.owners(organization_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_owners_search ON apartcba.owners USING gin(full_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS apartcba.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  neighborhood text,
  floor text,
  apartment text,
  bedrooms smallint,
  bathrooms smallint,
  max_guests smallint DEFAULT 2,
  size_m2 numeric(6,2),
  base_price_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  base_price numeric(14,2),
  cleaning_fee numeric(14,2),
  default_commission_pct numeric(5,2) DEFAULT 20.00,
  status text NOT NULL DEFAULT 'disponible'
    CHECK (status IN ('disponible','reservado','ocupado','limpieza','mantenimiento','bloqueado')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid REFERENCES auth.users(id),
  position integer NOT NULL DEFAULT 0,
  cover_image_url text,
  amenities_summary text,
  description text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_units_status ON apartcba.units(organization_id, status) WHERE active;
CREATE INDEX IF NOT EXISTS idx_units_search ON apartcba.units USING gin((coalesce(name,'') || ' ' || coalesce(code,'') || ' ' || coalesce(neighborhood,'')) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS apartcba.unit_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES apartcba.owners(id) ON DELETE CASCADE,
  ownership_pct numeric(5,2) NOT NULL CHECK (ownership_pct >= 0 AND ownership_pct <= 100),
  is_primary boolean NOT NULL DEFAULT false,
  commission_pct_override numeric(5,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_owners_owner ON apartcba.unit_owners(owner_id);

CREATE TABLE IF NOT EXISTS apartcba.unit_status_history (
  id bigserial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_hist_unit ON apartcba.unit_status_history(unit_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Huéspedes y reservas
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  document_type text,
  document_number text,
  email text,
  phone text,
  country text DEFAULT 'AR',
  city text,
  birth_date date,
  notes text,
  blacklisted boolean NOT NULL DEFAULT false,
  blacklist_reason text,
  total_bookings integer NOT NULL DEFAULT 0,
  total_revenue numeric(14,2) DEFAULT 0,
  last_stay_at timestamptz,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guests_org ON apartcba.guests(organization_id);
CREATE INDEX IF NOT EXISTS idx_guests_search ON apartcba.guests USING gin((coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'') || ' ' || coalesce(document_number,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_guests_phone ON apartcba.guests(organization_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS apartcba.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE RESTRICT,
  guest_id uuid REFERENCES apartcba.guests(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'directo'
    CHECK (source IN ('directo','airbnb','booking','expedia','vrbo','whatsapp','instagram','otro')),
  external_id text,
  external_url text,
  status text NOT NULL DEFAULT 'confirmada'
    CHECK (status IN ('pendiente','confirmada','check_in','check_out','cancelada','no_show')),
  check_in_date date NOT NULL,
  check_in_time time NOT NULL DEFAULT '15:00',
  check_out_date date NOT NULL,
  check_out_time time NOT NULL DEFAULT '11:00',
  stay_range daterange GENERATED ALWAYS AS (daterange(check_in_date, check_out_date, '[)')) STORED,
  guests_count smallint NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'ARS' REFERENCES apartcba.currencies(code),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2),
  commission_amount numeric(14,2),
  cleaning_fee numeric(14,2) DEFAULT 0,
  notes text,
  internal_notes text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT bookings_dates_valid CHECK (check_out_date > check_in_date),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    unit_id WITH =,
    stay_range WITH &&
  ) WHERE (status IN ('confirmada','check_in'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_unit_dates ON apartcba.bookings(unit_id, check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_org_status ON apartcba.bookings(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON apartcba.bookings(guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_external ON apartcba.bookings(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS apartcba.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL REFERENCES apartcba.currencies(code),
  payment_method text NOT NULL
    CHECK (payment_method IN ('efectivo','transferencia','mp','stripe','crypto','tarjeta','otro')),
  account_id uuid,  -- FK a cash_accounts (se agrega luego de crear esa tabla)
  cash_movement_id uuid,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON apartcba.booking_payments(booking_id);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Mantenimiento y limpieza
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text,
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baja','media','alta','urgente')),
  status text NOT NULL DEFAULT 'abierto'
    CHECK (status IN ('abierto','en_progreso','esperando_repuesto','resuelto','cerrado')),
  opened_by uuid REFERENCES auth.users(id),
  assigned_to uuid REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  estimated_cost numeric(14,2),
  actual_cost numeric(14,2),
  cost_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  billable_to text NOT NULL DEFAULT 'apartcba'
    CHECK (billable_to IN ('owner','apartcba','guest')),
  related_owner_id uuid REFERENCES apartcba.owners(id),
  charged_to_owner_at timestamptz,
  charged_to_settlement_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_unit_status ON apartcba.maintenance_tickets(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_org_status ON apartcba.maintenance_tickets(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON apartcba.maintenance_tickets(assigned_to) WHERE status NOT IN ('resuelto','cerrado');

CREATE TABLE IF NOT EXISTS apartcba.ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES apartcba.maintenance_tickets(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apartcba.cleaning_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  booking_out_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  booking_in_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','completada','verificada','cancelada')),
  checklist jsonb NOT NULL DEFAULT '[]',
  cost numeric(14,2),
  cost_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  started_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_org_scheduled ON apartcba.cleaning_tasks(organization_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_cleaning_assigned_status ON apartcba.cleaning_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_cleaning_unit ON apartcba.cleaning_tasks(unit_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Caja y liquidaciones
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('efectivo','banco','mp','crypto','tarjeta','otro')),
  currency text NOT NULL REFERENCES apartcba.currencies(code),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  account_number text,
  bank_name text,
  notes text,
  color text DEFAULT '#0F766E',
  icon text DEFAULT 'wallet',
  active boolean NOT NULL DEFAULT true,
  display_order smallint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_org ON apartcba.cash_accounts(organization_id) WHERE active;

CREATE TABLE IF NOT EXISTS apartcba.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES apartcba.cash_accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL REFERENCES apartcba.currencies(code),
  category text NOT NULL
    CHECK (category IN (
      'booking_payment','maintenance','cleaning','owner_settlement','transfer',
      'adjustment','salary','utilities','tax','supplies','commission','refund','other'
    )),
  ref_type text,
  ref_id uuid,
  unit_id uuid REFERENCES apartcba.units(id),
  owner_id uuid REFERENCES apartcba.owners(id),
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_movements_org_date ON apartcba.cash_movements(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_account_date ON apartcba.cash_movements(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_unit ON apartcba.cash_movements(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_owner ON apartcba.cash_movements(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_ref ON apartcba.cash_movements(ref_type, ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS apartcba.cash_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  from_movement_id uuid NOT NULL UNIQUE REFERENCES apartcba.cash_movements(id) ON DELETE CASCADE,
  to_movement_id uuid NOT NULL UNIQUE REFERENCES apartcba.cash_movements(id) ON DELETE CASCADE,
  exchange_rate numeric(20,8),
  fee numeric(14,2) DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apartcba.owner_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES apartcba.owners(id) ON DELETE RESTRICT,
  period_year smallint NOT NULL,
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador','revisada','enviada','pagada','disputada','anulada')),
  currency text NOT NULL DEFAULT 'ARS' REFERENCES apartcba.currencies(code),
  gross_revenue numeric(14,2) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  deductions_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_payable numeric(14,2) NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  sent_at timestamptz,
  paid_at timestamptz,
  paid_movement_id uuid REFERENCES apartcba.cash_movements(id),
  notes text,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, owner_id, period_year, period_month, currency)
);

CREATE INDEX IF NOT EXISTS idx_settlements_owner ON apartcba.owner_settlements(owner_id, period_year DESC, period_month DESC);

CREATE TABLE IF NOT EXISTS apartcba.settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES apartcba.owner_settlements(id) ON DELETE CASCADE,
  line_type text NOT NULL
    CHECK (line_type IN ('booking_revenue','commission','maintenance_charge','cleaning_charge','adjustment')),
  ref_type text,
  ref_id uuid,
  unit_id uuid REFERENCES apartcba.units(id),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  sign text NOT NULL CHECK (sign IN ('+','-')),
  display_order smallint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settle_lines_settlement ON apartcba.settlement_lines(settlement_id, display_order);

-- Backref de booking_payments → cash_accounts (deferred FK)
ALTER TABLE apartcba.booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_account_fk;
ALTER TABLE apartcba.booking_payments
  ADD CONSTRAINT booking_payments_account_fk
  FOREIGN KEY (account_id) REFERENCES apartcba.cash_accounts(id) ON DELETE SET NULL;

ALTER TABLE apartcba.booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_movement_fk;
ALTER TABLE apartcba.booking_payments
  ADD CONSTRAINT booking_payments_movement_fk
  FOREIGN KEY (cash_movement_id) REFERENCES apartcba.cash_movements(id) ON DELETE SET NULL;

ALTER TABLE apartcba.maintenance_tickets
  DROP CONSTRAINT IF EXISTS tickets_settlement_fk;
ALTER TABLE apartcba.maintenance_tickets
  ADD CONSTRAINT tickets_settlement_fk
  FOREIGN KEY (charged_to_settlement_id) REFERENCES apartcba.owner_settlements(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Channel Manager (iCal)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.ical_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('airbnb','booking','expedia','vrbo','otro')),
  label text,
  feed_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  events_imported_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, feed_url)
);

CREATE INDEX IF NOT EXISTS idx_ical_active ON apartcba.ical_feeds(organization_id) WHERE active;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Inventario / Amenities
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  icon text,
  consumable boolean NOT NULL DEFAULT false,
  unit_label text,
  default_par_level smallint DEFAULT 1,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS apartcba.unit_amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  amenity_id uuid NOT NULL REFERENCES apartcba.amenities(id) ON DELETE CASCADE,
  current_quantity smallint NOT NULL DEFAULT 0,
  par_level smallint,
  last_restocked_at timestamptz,
  notes text,
  UNIQUE (unit_id, amenity_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_amenities_unit ON apartcba.unit_amenities(unit_id);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Conserjería (pedidos del huésped)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.concierge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES apartcba.units(id),
  booking_id uuid REFERENCES apartcba.bookings(id),
  guest_id uuid REFERENCES apartcba.guests(id),
  request_type text,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_progreso','completada','rechazada','cancelada')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baja','normal','alta','urgente')),
  assigned_to uuid REFERENCES auth.users(id),
  cost numeric(14,2),
  cost_currency text REFERENCES apartcba.currencies(code),
  charge_to_guest boolean NOT NULL DEFAULT false,
  scheduled_for timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_concierge_org_status ON apartcba.concierge_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_concierge_assigned ON apartcba.concierge_requests(assigned_to) WHERE status NOT IN ('completada','cancelada');

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Facturación (skeleton)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  invoice_type text NOT NULL
    CHECK (invoice_type IN ('factura_a','factura_b','factura_c','recibo','nota_credito','nota_debito')),
  number text,
  point_of_sale smallint,
  ref_type text,
  ref_id uuid,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL REFERENCES apartcba.currencies(code),
  issued_at timestamptz NOT NULL DEFAULT now(),
  cae text,
  cae_due_date date,
  pdf_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS — Auditoría
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.activity_log (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_org_date ON apartcba.activity_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_resource ON apartcba.activity_log(resource_type, resource_id);

-- ════════════════════════════════════════════════════════════════════════════
-- FUNCIONES helper
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apartcba.current_user_orgs()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
  SELECT COALESCE(array_agg(organization_id), ARRAY[]::uuid[])
  FROM apartcba.organization_members
  WHERE user_id = auth.uid() AND active = true
$$;

CREATE OR REPLACE FUNCTION apartcba.is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
  SELECT COALESCE((SELECT is_superadmin FROM apartcba.user_profiles WHERE user_id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION apartcba.current_user_role(p_org_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = apartcba, public AS $$
  SELECT role FROM apartcba.organization_members
  WHERE organization_id = p_org_id AND user_id = auth.uid() AND active = true
  LIMIT 1
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apartcba.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organizations','user_profiles','owners','units','guests','bookings',
    'maintenance_tickets','cleaning_tasks','owner_settlements'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.%I FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- Auto-log de cambios de status en units
CREATE OR REPLACE FUNCTION apartcba.tg_units_status_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO apartcba.unit_status_history (
      unit_id, organization_id, from_status, to_status, changed_by, reason
    ) VALUES (
      NEW.id, NEW.organization_id, OLD.status, NEW.status, NEW.status_changed_by, NULL
    );
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_units_status_history ON apartcba.units;
CREATE TRIGGER trg_units_status_history
  BEFORE UPDATE ON apartcba.units
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_units_status_history();

-- Sync unit status desde bookings (check_in / check_out)
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_sync_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'check_in' THEN
      UPDATE apartcba.units
        SET status = 'ocupado', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    ELSIF NEW.status = 'check_out' THEN
      UPDATE apartcba.units
        SET status = 'limpieza', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id;
      NEW.checked_out_at := COALESCE(NEW.checked_out_at, now());
      INSERT INTO apartcba.cleaning_tasks (
        organization_id, unit_id, booking_out_id, scheduled_for, status
      ) VALUES (
        NEW.organization_id, NEW.unit_id, NEW.id,
        now() + interval '30 minutes', 'pendiente'
      );
    ELSIF NEW.status = 'cancelada' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_sync_unit ON apartcba.bookings;
CREATE TRIGGER trg_bookings_sync_unit
  BEFORE UPDATE ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_bookings_sync_unit();

-- Mark unit como 'reservado' si tiene una reserva confirmada y status era 'disponible'
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_mark_reservado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF NEW.status = 'confirmada' AND NEW.check_in_date <= CURRENT_DATE + interval '7 days' THEN
    UPDATE apartcba.units
      SET status = 'reservado', status_changed_by = auth.uid()
      WHERE id = NEW.unit_id AND status = 'disponible';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_mark_reservado ON apartcba.bookings;
CREATE TRIGGER trg_bookings_mark_reservado
  AFTER INSERT OR UPDATE ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_bookings_mark_reservado();

-- Cleaning task → unit a 'disponible' al verificar
CREATE OR REPLACE FUNCTION apartcba.tg_cleaning_complete_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completada' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSIF NEW.status = 'verificada' THEN
      NEW.verified_at := COALESCE(NEW.verified_at, now());
      UPDATE apartcba.units
        SET status = 'disponible', status_changed_by = auth.uid()
        WHERE id = NEW.unit_id AND status = 'limpieza';
    ELSIF NEW.status = 'en_progreso' THEN
      NEW.started_at := COALESCE(NEW.started_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cleaning_complete_unit ON apartcba.cleaning_tasks;
CREATE TRIGGER trg_cleaning_complete_unit
  BEFORE UPDATE ON apartcba.cleaning_tasks
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_cleaning_complete_unit();

-- Mantener el contador de bookings del guest
CREATE OR REPLACE FUNCTION apartcba.tg_bookings_update_guest_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.guest_id IS NOT NULL THEN
    UPDATE apartcba.guests
      SET total_bookings = total_bookings + 1,
          last_stay_at = NEW.check_in_date::timestamptz
      WHERE id = NEW.guest_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_guest_stats ON apartcba.bookings;
CREATE TRIGGER trg_bookings_guest_stats
  AFTER INSERT ON apartcba.bookings
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_bookings_update_guest_stats();

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organizations','user_profiles','organization_members','role_permissions',
    'currencies','exchange_rates','owners','units','unit_owners','unit_status_history',
    'guests','bookings','booking_payments','maintenance_tickets','ticket_attachments',
    'cleaning_tasks','cash_accounts','cash_movements','cash_transfers',
    'owner_settlements','settlement_lines','ical_feeds','amenities','unit_amenities',
    'concierge_requests','invoices','activity_log'
  ]) LOOP
    EXECUTE format('ALTER TABLE apartcba.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Política universal "members of org": SELECT/UPDATE/INSERT/DELETE permitido
-- a quienes son miembros activos de la organización (filter por organization_id).
-- Las acciones administrativas se hacen vía service_role (admin client) que bypassa RLS.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'owners','units','unit_owners','unit_status_history','guests','bookings',
    'booking_payments','maintenance_tickets','ticket_attachments','cleaning_tasks',
    'cash_accounts','cash_movements','cash_transfers','owner_settlements',
    'settlement_lines','ical_feeds','amenities','unit_amenities',
    'concierge_requests','invoices','activity_log','exchange_rates','role_permissions'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS members_all ON apartcba.%I', t);
    EXECUTE format(
      $POL$ CREATE POLICY members_all ON apartcba.%I FOR ALL
            USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
            WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin()) $POL$,
      t
    );
  END LOOP;
END $$;

-- Tablas con lógica especial (ticket_attachments y unit_owners no tienen organization_id directo)
DROP POLICY IF EXISTS members_all ON apartcba.ticket_attachments;
CREATE POLICY members_all ON apartcba.ticket_attachments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apartcba.maintenance_tickets t
      WHERE t.id = ticket_id
        AND (t.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apartcba.maintenance_tickets t
      WHERE t.id = ticket_id
        AND (t.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  );

DROP POLICY IF EXISTS members_all ON apartcba.unit_owners;
CREATE POLICY members_all ON apartcba.unit_owners FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apartcba.units u
      WHERE u.id = unit_id
        AND (u.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apartcba.units u
      WHERE u.id = unit_id
        AND (u.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  );

DROP POLICY IF EXISTS members_all ON apartcba.settlement_lines;
CREATE POLICY members_all ON apartcba.settlement_lines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM apartcba.owner_settlements s
      WHERE s.id = settlement_id
        AND (s.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM apartcba.owner_settlements s
      WHERE s.id = settlement_id
        AND (s.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
    )
  );

-- organizations: ven los miembros + superadmin
DROP POLICY IF EXISTS org_select ON apartcba.organizations;
CREATE POLICY org_select ON apartcba.organizations FOR SELECT
  USING (id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS org_modify ON apartcba.organizations;
CREATE POLICY org_modify ON apartcba.organizations FOR ALL
  USING (apartcba.is_superadmin())
  WITH CHECK (apartcba.is_superadmin());

-- user_profiles: ven el propio + superadmin
DROP POLICY IF EXISTS profiles_self ON apartcba.user_profiles;
CREATE POLICY profiles_self ON apartcba.user_profiles FOR ALL
  USING (user_id = auth.uid() OR apartcba.is_superadmin())
  WITH CHECK (user_id = auth.uid() OR apartcba.is_superadmin());

-- organization_members: ven todos los de las orgs donde son miembros
DROP POLICY IF EXISTS org_members_view ON apartcba.organization_members;
CREATE POLICY org_members_view ON apartcba.organization_members FOR SELECT
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin() OR user_id = auth.uid());

DROP POLICY IF EXISTS org_members_modify ON apartcba.organization_members;
CREATE POLICY org_members_modify ON apartcba.organization_members FOR ALL
  USING (apartcba.is_superadmin() OR (
    organization_id = ANY(apartcba.current_user_orgs())
    AND apartcba.current_user_role(organization_id) = 'admin'
  ))
  WITH CHECK (apartcba.is_superadmin() OR (
    organization_id = ANY(apartcba.current_user_orgs())
    AND apartcba.current_user_role(organization_id) = 'admin'
  ));

-- currencies: lectura pública dentro de Apart Cba
DROP POLICY IF EXISTS currencies_select ON apartcba.currencies;
CREATE POLICY currencies_select ON apartcba.currencies FOR SELECT USING (true);
DROP POLICY IF EXISTS currencies_modify ON apartcba.currencies;
CREATE POLICY currencies_modify ON apartcba.currencies FOR ALL USING (apartcba.is_superadmin());

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS para que PostgREST pueda exponer las tablas
-- ════════════════════════════════════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA apartcba TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA apartcba TO authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA apartcba TO authenticated, service_role;
GRANT SELECT ON apartcba.currencies TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA apartcba GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA apartcba GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA apartcba GRANT ALL ON FUNCTIONS TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Exponer schema apartcba a PostgREST (importante para Supabase JS client)
-- ════════════════════════════════════════════════════════════════════════════
-- NOTA: en Supabase Cloud el schema debe agregarse en Dashboard → API Settings →
-- "Exposed schemas". Aquí se prepara también vía ALTER SCHEMA.
ALTER SCHEMA apartcba OWNER TO postgres;

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime publication (suscripciones en vivo)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.units;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.bookings;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.maintenance_tickets;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.cleaning_tasks;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.concierge_requests;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SEEDS — Monedas iniciales
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO apartcba.currencies (code, name, symbol, decimals, is_crypto, display_order) VALUES
  ('ARS','Peso Argentino','$', 2, false, 1),
  ('USD','Dólar Estadounidense','US$', 2, false, 2),
  ('EUR','Euro','€', 2, false, 3),
  ('USDT','Tether (USDT)','₮', 6, true, 4),
  ('USDC','USD Coin','USDC', 6, true, 5),
  ('BTC','Bitcoin','₿', 8, true, 6)
ON CONFLICT (code) DO NOTHING;
