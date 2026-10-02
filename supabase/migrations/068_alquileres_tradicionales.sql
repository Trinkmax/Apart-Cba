-- 068 — Alquileres tradicionales (contratos de 2-3 años con ajuste por índice)
--
-- Contexto: Apart CBA suma la administración de alquileres tradicionales
-- (inmobiliaria): contratos de vivienda/comercio de 24-36 meses que se
-- actualizan por IPC/ICL cada 3-4 meses, cobranza mensual con punitorios,
-- validación de expensas y servicios, honorarios y rendición al propietario.
--
-- Decisiones de modelo:
--   - Es un módulo APARTE del PMS: las propiedades NO son `units` (29 archivos
--     leen `units` sin filtro y un contrato de 2 años aparecería como ocupación
--     en el calendario, KPIs, limpieza, canales y Resultados).
--   - Reusa `owners` (un mismo propietario puede tener temporarias y
--     tradicionales) y la Caja (`cash_movements`, categorías nuevas).
--   - Índices (IPC, ICL…) en una tabla GLOBAL: son datos públicos iguales para
--     todas las organizaciones. Se guarda el NIVEL, no la variación.
--   - Seguridad como 067c/067d: RLS encendido, sin escritura desde el browser
--     (todo por server actions con service role). Sólo las tablas que una
--     pantalla en vivo necesita tienen SELECT para admin/recepción.
--   - FKs compuestas (organization_id, id) para que la base garantice que un
--     contrato no puede apuntar a la propiedad o al propietario de otra org.
--
-- Esta migración es ADITIVA: el código que hoy corre en producción la ignora.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) Interruptor del módulo por organización + claves compuestas de soporte
-- ─────────────────────────────────────────────────────────────────────────────
alter table apartcba.organizations
  add column if not exists rentals_enabled boolean not null default false;
comment on column apartcba.organizations.rentals_enabled is
  'Muestra la sección Alquileres (tradicionales) en el panel. Migración 068.';

create unique index if not exists owners_org_id_key on apartcba.owners (organization_id, id);
create unique index if not exists cash_accounts_org_id_key on apartcba.cash_accounts (organization_id, id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Configuración por organización
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_settings (
  organization_id uuid primary key references apartcba.organizations(id) on delete cascade,
  payment_window_days smallint not null default 10,
  grace_days smallint not null default 0,
  late_fee_type text not null default 'diario_pct',
  late_fee_value numeric(10,4) not null default 0.5,
  late_fee_payee text not null default 'propietario',
  admin_fee_pct numeric(5,2) not null default 10,
  admin_fee_vat boolean not null default false,
  tenant_commission jsonb not null default '{"basis":"pct_total_contrato","value":5,"vat":false}'::jsonb,
  owner_commission jsonb not null default '{"basis":"ninguna","value":0,"vat":false}'::jsonb,
  default_index text not null default 'ipc',
  default_adjustment_every smallint not null default 3,
  default_lag_months smallint not null default 2,
  default_rounding text not null default 'hundred',
  default_duration_months smallint not null default 24,
  auto_apply_adjustments boolean not null default true,
  stamp_tax_rate_pct numeric(6,3) not null default 0.5,
  stamp_tax_exempt_monthly numeric(14,2),
  stamp_tax_tenant_share_pct numeric(5,2) not null default 50,
  vat_condition text not null default 'monotributo',
  broker_name text,
  broker_license text,
  payment_instructions text,
  receipt_footer text,
  charge_lead_days smallint not null default 7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint rental_settings_window_range check (payment_window_days between 1 and 28),
  constraint rental_settings_grace_range check (grace_days between 0 and 30),
  constraint rental_settings_late_fee_type_valid check (late_fee_type in ('diario_pct','mensual_pct','fijo_diario','ninguno')),
  constraint rental_settings_late_fee_value_positive check (late_fee_value >= 0),
  constraint rental_settings_late_fee_payee_valid check (late_fee_payee in ('propietario','inmobiliaria')),
  constraint rental_settings_admin_fee_range check (admin_fee_pct between 0 and 100),
  constraint rental_settings_index_valid check (default_index in ('ipc','icl','casa_propia','uva','cer','ripte')),
  constraint rental_settings_every_range check (default_adjustment_every between 1 and 12),
  constraint rental_settings_lag_range check (default_lag_months between 0 and 3),
  constraint rental_settings_rounding_valid check (default_rounding in ('none','unit','ten','hundred','thousand')),
  constraint rental_settings_duration_range check (default_duration_months between 1 and 120),
  constraint rental_settings_stamp_rate_range check (stamp_tax_rate_pct between 0 and 10),
  constraint rental_settings_stamp_share_range check (stamp_tax_tenant_share_pct between 0 and 100),
  constraint rental_settings_vat_condition_valid check (vat_condition in ('responsable_inscripto','monotributo','exento')),
  constraint rental_settings_lead_days_range check (charge_lead_days between 0 and 28),
  constraint rental_settings_instructions_len check (payment_instructions is null or char_length(payment_instructions) <= 1000),
  constraint rental_settings_footer_len check (receipt_footer is null or char_length(receipt_footer) <= 1000)
);
comment on table apartcba.rental_settings is
  'Valores por defecto del módulo Alquileres de cada organización (los copia el alta de contrato). Migración 068.';
comment on column apartcba.rental_settings.payment_window_days is 'Plazo para pagar, en días desde el inicio del período (10 = "del 1 al 10").';
comment on column apartcba.rental_settings.admin_fee_pct is 'Honorarios de administración (% de lo cobrado, a cargo del propietario). Ley 9445 Córdoba art. 25 e): 10 % de plaza.';
comment on column apartcba.rental_settings.tenant_commission is 'Honorario de locación a cargo del inquilino {basis,value,vat}. Ley 9445 art. 25 c): 5 % del monto del contrato.';
comment on column apartcba.rental_settings.default_lag_months is 'Índices mensuales: 2 = el último dato publicado al momento del ajuste (convención de las calculadoras).';
comment on column apartcba.rental_settings.stamp_tax_exempt_monthly is 'Impuesto de Sellos Córdoba: exento si el alquiler promedio mensual no supera este monto (Ley Impositiva 2026: 1.230.000).';
comment on column apartcba.rental_settings.charge_lead_days is 'Cuántos días antes del inicio de cada período se genera el cargo del mes.';
drop trigger if exists trg_set_updated_at on apartcba.rental_settings;
create trigger trg_set_updated_at before update on apartcba.rental_settings
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Numeración correlativa por organización (contratos, recibos, rendiciones)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_counters (
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  kind text not null,
  last_value integer not null default 0,
  primary key (organization_id, kind),
  constraint rental_counters_kind_valid check (kind in ('contrato','recibo','rendicion')),
  constraint rental_counters_value_positive check (last_value >= 0)
);
comment on table apartcba.rental_counters is
  'Último número usado por organización y tipo de documento. Lo incrementa rental_next_number() (068b). Migración 068.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Propiedades en administración
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  code text not null,
  property_type text not null default 'departamento',
  street text not null,
  street_number text,
  floor text,
  apartment text,
  tower text,
  neighborhood text,
  city text not null default 'Córdoba',
  province text not null default 'Córdoba',
  postal_code text,
  rooms smallint,
  bedrooms smallint,
  bathrooms smallint,
  covered_m2 numeric(8,2),
  total_m2 numeric(8,2),
  furnished boolean not null default false,
  has_garage boolean not null default false,
  consortium_name text,
  consortium_phone text,
  consortium_email text,
  functional_unit text,
  cadastral_id text,
  services jsonb not null default '[]'::jsonb,
  listing_rent numeric(14,2),
  listing_currency text references apartcba.currencies(code),
  availability text not null default 'disponible',
  mandate_signed_at date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint rental_properties_org_code_key unique (organization_id, code),
  constraint rental_properties_org_id_key unique (organization_id, id),
  constraint rental_properties_type_valid check (property_type in ('departamento','casa','ph','duplex','local','oficina','cochera','deposito','terreno','otro')),
  constraint rental_properties_availability_valid check (availability in ('disponible','reservada','en_refaccion','retirada')),
  constraint rental_properties_code_len check (char_length(code) between 1 and 40),
  constraint rental_properties_services_array check (jsonb_typeof(services) = 'array'),
  constraint rental_properties_listing_positive check (listing_rent is null or listing_rent > 0)
);
comment on table apartcba.rental_properties is
  'Propiedades administradas en alquiler tradicional (no son unidades del PMS). Migración 068.';
comment on column apartcba.rental_properties.services is 'Cuentas de servicios e impuestos: [{kind, provider, account_number, holder, notes}].';
comment on column apartcba.rental_properties.functional_unit is 'Unidad funcional en el consorcio (para las expensas).';
comment on column apartcba.rental_properties.cadastral_id is 'Nomenclatura catastral / cuenta de Rentas.';
comment on column apartcba.rental_properties.mandate_signed_at is 'Fecha del mandato de administración firmado por el propietario (Ley 9445 art. 16 p).';
create index if not exists rental_properties_org_idx on apartcba.rental_properties (organization_id) where active;
drop trigger if exists trg_set_updated_at on apartcba.rental_properties;
create trigger trg_set_updated_at before update on apartcba.rental_properties
  for each row execute function apartcba.tg_set_updated_at();

create table if not exists apartcba.rental_property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  property_id uuid not null,
  owner_id uuid not null,
  ownership_pct numeric(5,2) not null default 100,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rental_property_owners_unique unique (property_id, owner_id),
  constraint rental_property_owners_property_fk foreign key (organization_id, property_id)
    references apartcba.rental_properties (organization_id, id) on delete cascade,
  constraint rental_property_owners_owner_fk foreign key (organization_id, owner_id)
    references apartcba.owners (organization_id, id) on delete restrict,
  constraint rental_property_owners_pct_range check (ownership_pct > 0 and ownership_pct <= 100)
);
comment on table apartcba.rental_property_owners is
  'Titulares de cada propiedad con su % (la rendición reparte lo cobrado por %). Migración 068.';
create index if not exists rental_property_owners_owner_idx on apartcba.rental_property_owners (owner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Personas: inquilinos y garantes
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  person_type text not null default 'fisica',
  full_name text not null,
  doc_type text,
  doc_number text,
  tax_id text,
  birth_date date,
  nationality text,
  email text,
  phone text,
  phone_alt text,
  address text,
  city text,
  province text,
  occupation text,
  employer text,
  employer_phone text,
  monthly_income numeric(14,2),
  income_currency text references apartcba.currencies(code),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint rental_people_org_id_key unique (organization_id, id),
  constraint rental_people_type_valid check (person_type in ('fisica','juridica')),
  constraint rental_people_doc_type_valid check (doc_type is null or doc_type in ('DNI','CUIT','CUIL','PASAPORTE','OTRO')),
  constraint rental_people_name_len check (char_length(full_name) between 1 and 160),
  constraint rental_people_income_positive check (monthly_income is null or monthly_income >= 0)
);
comment on table apartcba.rental_people is
  'Inquilinos y garantes de alquileres tradicionales (una persona puede ser inquilina en un contrato y garante en otro). Migración 068.';
create index if not exists rental_people_org_idx on apartcba.rental_people (organization_id) where active;
create index if not exists rental_people_search_idx on apartcba.rental_people
  using gin ((coalesce(full_name,'') || ' ' || coalesce(doc_number,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,'')) public.gin_trgm_ops);
drop trigger if exists trg_set_updated_at on apartcba.rental_people;
create trigger trg_set_updated_at before update on apartcba.rental_people
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Contratos
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  number integer not null,
  property_id uuid not null,
  status text not null default 'borrador',
  usage text not null default 'vivienda',
  legal_regime text not null default 'dnu_70_2023',
  start_date date not null,
  duration_months smallint not null,
  end_date date not null,
  signed_at date,
  currency text not null default 'ARS' references apartcba.currencies(code),
  initial_rent numeric(14,2) not null,
  current_rent numeric(14,2) not null,
  -- actualización del precio
  adjustment_method text not null default 'indice',
  index_code text,
  adjustment_every_months smallint,
  index_lag_months smallint not null default 2,
  fixed_pct numeric(7,3),
  steps jsonb,
  rounding text not null default 'hundred',
  cap_pct numeric(7,3),
  allow_decrease boolean not null default false,
  -- cobro
  payment_window_days smallint not null default 10,
  grace_days smallint not null default 0,
  late_fee_type text not null default 'diario_pct',
  late_fee_value numeric(10,4) not null default 0,
  late_fee_payee text not null default 'propietario',
  collector text not null default 'inmobiliaria',
  billing_starts_on date,
  -- honorarios
  admin_fee_pct numeric(5,2) not null default 0,
  admin_fee_vat boolean not null default false,
  tenant_commission jsonb,
  owner_commission jsonb,
  -- depósito en garantía
  deposit_amount numeric(14,2) not null default 0,
  deposit_currency text references apartcba.currencies(code),
  deposit_holder text not null default 'inmobiliaria',
  deposit_status text not null default 'pendiente',
  deposit_returned_amount numeric(14,2),
  deposit_returned_at date,
  -- sellado
  stamp_tax_status text not null default 'pendiente',
  stamp_tax_amount numeric(14,2),
  -- expensas y servicios
  expensas_payer text not null default 'inquilino',
  expensas_mode text not null default 'paga_inquilino',
  expensas_extra_payer text not null default 'propietario',
  services jsonb not null default '[]'::jsonb,
  -- seguro
  insurance_required boolean not null default false,
  insurance_company text,
  insurance_policy text,
  insurance_expires_at date,
  -- fin anticipado / cierre
  early_termination_rule text not null default 'dnu_10pct',
  early_termination_notes text,
  terminated_at date,
  termination_reason text,
  termination_notice_date date,
  termination_penalty numeric(14,2),
  renewed_from_id uuid references apartcba.rental_contracts(id) on delete set null,
  -- portal del inquilino (token HMAC; sólo se guarda el hash)
  portal_token_hash text,
  portal_token_version smallint not null default 1,
  portal_enabled boolean not null default true,
  reli_code text,
  special_clauses text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint rental_contracts_org_number_key unique (organization_id, number),
  constraint rental_contracts_org_id_key unique (organization_id, id),
  constraint rental_contracts_property_fk foreign key (organization_id, property_id)
    references apartcba.rental_properties (organization_id, id) on delete restrict,
  constraint rental_contracts_status_valid check (status in ('borrador','vigente','finalizado','rescindido')),
  constraint rental_contracts_usage_valid check (usage in ('vivienda','comercial','mixto','cochera','otro')),
  constraint rental_contracts_regime_valid check (legal_regime in ('ccyc_2015','ley_27551','ley_27737','dnu_70_2023')),
  constraint rental_contracts_duration_range check (duration_months between 1 and 120),
  constraint rental_contracts_dates_valid check (end_date >= start_date),
  constraint rental_contracts_rent_positive check (initial_rent > 0 and current_rent > 0),
  constraint rental_contracts_method_valid check (adjustment_method in ('indice','porcentaje_fijo','escalonado','manual','sin_ajuste')),
  constraint rental_contracts_index_valid check (index_code is null or index_code in ('ipc','icl','casa_propia','uva','cer','ripte')),
  constraint rental_contracts_every_range check (adjustment_every_months is null or adjustment_every_months between 1 and 12),
  constraint rental_contracts_lag_range check (index_lag_months between 0 and 3),
  constraint rental_contracts_index_needs_code check (adjustment_method <> 'indice' or (index_code is not null and adjustment_every_months is not null)),
  constraint rental_contracts_pct_needs_value check (adjustment_method <> 'porcentaje_fijo' or (fixed_pct is not null and adjustment_every_months is not null)),
  constraint rental_contracts_steps_need_every check (adjustment_method not in ('escalonado','manual') or adjustment_every_months is not null),
  constraint rental_contracts_steps_array check (steps is null or jsonb_typeof(steps) = 'array'),
  constraint rental_contracts_rounding_valid check (rounding in ('none','unit','ten','hundred','thousand')),
  constraint rental_contracts_window_range check (payment_window_days between 1 and 28),
  constraint rental_contracts_grace_range check (grace_days between 0 and 30),
  constraint rental_contracts_late_fee_type_valid check (late_fee_type in ('diario_pct','mensual_pct','fijo_diario','ninguno')),
  constraint rental_contracts_late_fee_value_positive check (late_fee_value >= 0),
  constraint rental_contracts_late_fee_payee_valid check (late_fee_payee in ('propietario','inmobiliaria')),
  constraint rental_contracts_collector_valid check (collector in ('inmobiliaria','propietario')),
  constraint rental_contracts_admin_fee_range check (admin_fee_pct between 0 and 100),
  constraint rental_contracts_deposit_positive check (deposit_amount >= 0),
  constraint rental_contracts_deposit_holder_valid check (deposit_holder in ('inmobiliaria','propietario')),
  constraint rental_contracts_deposit_status_valid check (deposit_status in ('pendiente','retenido','devuelto','aplicado','no_aplica')),
  constraint rental_contracts_stamp_status_valid check (stamp_tax_status in ('pendiente','pagado','exento','no_aplica')),
  constraint rental_contracts_expensas_payer_valid check (expensas_payer in ('inquilino','propietario','no_aplica')),
  constraint rental_contracts_expensas_mode_valid check (expensas_mode in ('paga_inquilino','cobra_inmobiliaria','no_aplica')),
  constraint rental_contracts_expensas_extra_valid check (expensas_extra_payer in ('inquilino','propietario')),
  constraint rental_contracts_services_array check (jsonb_typeof(services) = 'array'),
  constraint rental_contracts_termination_rule_valid check (early_termination_rule in ('dnu_10pct','ley_27551','pactada','sin_penalidad')),
  constraint rental_contracts_notes_len check (notes is null or char_length(notes) <= 4000),
  constraint rental_contracts_clauses_len check (special_clauses is null or char_length(special_clauses) <= 8000)
);
comment on table apartcba.rental_contracts is
  'Contratos de alquiler tradicional. El cronograma (períodos, ciclos de ajuste) se deriva de start_date + duration_months + adjustment_every_months. Migración 068.';
comment on column apartcba.rental_contracts.end_date is 'Último día del contrato = start_date + duration_months − 1 día (lo fija el server).';
comment on column apartcba.rental_contracts.current_rent is 'Alquiler vigente HOY (cache: lo mantienen el aplicar ajuste y el cron diario).';
comment on column apartcba.rental_contracts.index_lag_months is 'Índices mensuales: 1 = meses del ciclo; 2 = último dato publicado al ajustar.';
comment on column apartcba.rental_contracts.steps is 'Ajuste escalonado: montos pactados de cada ajuste, en orden.';
comment on column apartcba.rental_contracts.billing_starts_on is 'Contratos que ya venían corriendo: se generan cargos desde el período que contiene esta fecha.';
comment on column apartcba.rental_contracts.collector is 'Quién cobra el alquiler: la inmobiliaria (entra a Caja y se rinde) o el propietario directo.';
comment on column apartcba.rental_contracts.services is 'Servicios e impuestos a controlar: [{kind, payer, proof_required, frequency}].';
comment on column apartcba.rental_contracts.legal_regime is 'Régimen con el que se firmó: CCyC 2015, Ley 27.551, Ley 27.737 o DNU 70/2023.';
comment on column apartcba.rental_contracts.early_termination_rule is 'Rescisión anticipada: dnu_10pct (art. 1221 vigente), ley_27551 (1,5/1 mes), pactada, sin_penalidad.';

create index if not exists rental_contracts_org_status_idx on apartcba.rental_contracts (organization_id, status);
create index if not exists rental_contracts_property_idx on apartcba.rental_contracts (property_id);
create index if not exists rental_contracts_end_idx on apartcba.rental_contracts (organization_id, end_date) where status = 'vigente';
create unique index if not exists rental_contracts_portal_hash_key on apartcba.rental_contracts (portal_token_hash) where portal_token_hash is not null;
-- Dos contratos vigentes no pueden pisarse en la misma propiedad (btree_gist, como bookings_no_overlap).
alter table apartcba.rental_contracts drop constraint if exists rental_contracts_no_overlap;
alter table apartcba.rental_contracts add constraint rental_contracts_no_overlap
  exclude using gist (property_id with =, daterange(start_date, end_date, '[]') with &&)
  where (status = 'vigente');
drop trigger if exists trg_set_updated_at on apartcba.rental_contracts;
create trigger trg_set_updated_at before update on apartcba.rental_contracts
  for each row execute function apartcba.tg_set_updated_at();

create table if not exists apartcba.rental_contract_parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  person_id uuid not null,
  role text not null,
  is_primary boolean not null default false,
  guarantee_type text,
  guarantee_details jsonb not null default '{}'::jsonb,
  guarantor_consent_at date,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint rental_contract_parties_unique unique (contract_id, person_id, role),
  constraint rental_contract_parties_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_contract_parties_person_fk foreign key (organization_id, person_id)
    references apartcba.rental_people (organization_id, id) on delete restrict,
  constraint rental_contract_parties_role_valid check (role in ('inquilino','garante')),
  constraint rental_contract_parties_guarantee_valid check (guarantee_type is null or guarantee_type in ('propietaria','recibo_sueldo','seguro_caucion','fianza','aval_bancario','pagare','otra')),
  constraint rental_contract_parties_details_object check (jsonb_typeof(guarantee_details) = 'object')
);
comment on table apartcba.rental_contract_parties is
  'Inquilinos (uno principal, titular de los recibos) y garantes de cada contrato. Migración 068.';
comment on column apartcba.rental_contract_parties.guarantor_consent_at is 'Conformidad del garante para una renovación/prórroga (art. 1225 CCyC: la fianza no se extiende sola).';
create index if not exists rental_contract_parties_person_idx on apartcba.rental_contract_parties (person_id);
create index if not exists rental_contract_parties_contract_idx on apartcba.rental_contract_parties (contract_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Ajustes (uno por ventana del cronograma; se recalculan hasta aplicarse)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  sequence smallint not null,
  period_index smallint not null,
  effective_date date not null,
  status text not null default 'programado',
  method text not null,
  index_code text,
  from_key date,
  to_key date,
  from_value numeric(24,10),
  to_value numeric(24,10),
  coefficient numeric(16,10),
  variation_pct numeric(9,3),
  base_amount numeric(14,2),
  computed_amount numeric(14,2),
  applied_amount numeric(14,2),
  override_reason text,
  computed_at timestamptz,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  notified_at timestamptz,
  notified_via text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_adjustments_unique unique (contract_id, sequence),
  constraint rental_adjustments_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_adjustments_status_valid check (status in ('programado','pendiente_indice','pendiente_manual','calculado','aplicado','omitido')),
  constraint rental_adjustments_method_valid check (method in ('indice','porcentaje_fijo','escalonado','manual','sin_ajuste')),
  constraint rental_adjustments_applied_needs_amount check (status <> 'aplicado' or applied_amount is not null),
  constraint rental_adjustments_amounts_positive check ((applied_amount is null or applied_amount > 0) and (computed_amount is null or computed_amount > 0))
);
comment on table apartcba.rental_adjustments is
  'Ajustes de precio de cada contrato. programado → (pendiente_indice | pendiente_manual) → calculado → aplicado. Migración 068.';
comment on column apartcba.rental_adjustments.from_key is 'Mes base (índice mensual, YYYY-MM-01) o día base (índice diario).';
comment on column apartcba.rental_adjustments.applied_amount is 'Monto que rige desde effective_date (puede diferir del cálculo si alguien lo corrigió: override_reason).';
create index if not exists rental_adjustments_org_effective_idx on apartcba.rental_adjustments (organization_id, effective_date) where status <> 'aplicado' and status <> 'omitido';
create index if not exists rental_adjustments_contract_idx on apartcba.rental_adjustments (contract_id, sequence);
drop trigger if exists trg_set_updated_at on apartcba.rental_adjustments;
create trigger trg_set_updated_at before update on apartcba.rental_adjustments
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Cargos al inquilino (cuenta corriente) e ítems
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  kind text not null default 'mensual',
  period_index smallint,
  period_start date,
  period_end date,
  cycle smallint,
  index_in_cycle smallint,
  cycle_length smallint,
  label text not null,
  issue_date date not null default current_date,
  due_date date not null,
  currency text not null references apartcba.currencies(code),
  subtotal numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'pendiente',
  pending_adjustment_seq smallint,
  notified_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint rental_charges_org_id_key unique (organization_id, id),
  constraint rental_charges_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_charges_kind_valid check (kind in ('mensual','ingreso','extra','salida')),
  constraint rental_charges_status_valid check (status in ('pendiente','parcial','pagado','anulado')),
  constraint rental_charges_amounts_valid check (subtotal >= 0 and paid_amount >= 0 and paid_amount <= subtotal + 0.005),
  constraint rental_charges_monthly_needs_period check (kind <> 'mensual' or period_index is not null),
  constraint rental_charges_label_len check (char_length(label) between 1 and 200)
);
comment on table apartcba.rental_charges is
  'Lo que el inquilino debe: un cargo mensual por período + cargos de ingreso/extra/salida. "Vencido" se deriva (due_date < hoy con saldo). Migración 068.';
comment on column apartcba.rental_charges.pending_adjustment_seq is 'El cargo salió con el precio anterior porque el ajuste de este período no tenía índice todavía.';
create unique index if not exists rental_charges_monthly_key on apartcba.rental_charges (contract_id, period_index)
  where kind = 'mensual' and voided_at is null;
create index if not exists rental_charges_org_due_idx on apartcba.rental_charges (organization_id, due_date) where status in ('pendiente','parcial');
create index if not exists rental_charges_contract_idx on apartcba.rental_charges (contract_id, due_date);
drop trigger if exists trg_set_updated_at on apartcba.rental_charges;
create trigger trg_set_updated_at before update on apartcba.rental_charges
  for each row execute function apartcba.tg_set_updated_at();

create table if not exists apartcba.rental_charge_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  charge_id uuid not null,
  kind text not null,
  payee text not null,
  description text not null,
  amount numeric(14,2) not null,
  original_amount numeric(14,2),
  discount_reason text,
  paid_amount numeric(14,2) not null default 0,
  ref_type text,
  ref_id uuid,
  meta jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_charge_items_charge_fk foreign key (organization_id, charge_id)
    references apartcba.rental_charges (organization_id, id) on delete cascade,
  constraint rental_charge_items_kind_valid check (kind in ('alquiler','diferencia_ajuste','expensas','servicio','punitorio','honorarios','deposito','sellado','reparacion','rescision','otro')),
  constraint rental_charge_items_payee_valid check (payee in ('propietario','inmobiliaria','consorcio','tercero')),
  constraint rental_charge_items_amounts_valid check (amount >= 0 and paid_amount >= 0 and paid_amount <= amount + 0.005),
  constraint rental_charge_items_desc_len check (char_length(description) between 1 and 200)
);
comment on table apartcba.rental_charge_items is
  'Conceptos de un cargo. payee = de quién es la plata cuando se cobra (propietario → se rinde; inmobiliaria → honorarios; consorcio/tercero → pasamanos). Migración 068.';
create index if not exists rental_charge_items_charge_idx on apartcba.rental_charge_items (charge_id);
create index if not exists rental_charge_items_ref_idx on apartcba.rental_charge_items (ref_type, ref_id) where ref_id is not null;
drop trigger if exists trg_set_updated_at on apartcba.rental_charge_items;
create trigger trg_set_updated_at before update on apartcba.rental_charge_items
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Cobros e imputaciones
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  paid_at date not null,
  amount numeric(14,2) not null,
  currency text not null references apartcba.currencies(code),
  method text not null default 'transferencia',
  account_id uuid,
  cash_movement_id uuid references apartcba.cash_movements(id) on delete set null,
  reference text,
  payer_name text,
  receipt_number integer,
  unallocated_amount numeric(14,2) not null default 0,
  report_id uuid,
  notes text,
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint rental_payments_org_id_key unique (organization_id, id),
  constraint rental_payments_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete restrict,
  constraint rental_payments_account_fk foreign key (organization_id, account_id)
    references apartcba.cash_accounts (organization_id, id) on delete restrict,
  constraint rental_payments_amount_positive check (amount > 0),
  constraint rental_payments_unallocated_valid check (unallocated_amount >= 0 and unallocated_amount <= amount),
  constraint rental_payments_method_valid check (method in ('efectivo','transferencia','mp','cheque','deposito','otro'))
);
comment on table apartcba.rental_payments is
  'Pagos del inquilino. Cada uno lleva recibo correlativo y (si cobra la inmobiliaria) un ingreso en Caja. unallocated_amount = saldo a favor. Migración 068.';
create unique index if not exists rental_payments_receipt_key on apartcba.rental_payments (organization_id, receipt_number) where receipt_number is not null;
create index if not exists rental_payments_contract_idx on apartcba.rental_payments (contract_id, paid_at desc);
create index if not exists rental_payments_org_paid_idx on apartcba.rental_payments (organization_id, paid_at desc) where voided_at is null;

create table if not exists apartcba.rental_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  payment_id uuid not null,
  charge_id uuid not null,
  charge_item_id uuid not null references apartcba.rental_charge_items(id) on delete restrict,
  amount numeric(14,2) not null,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rental_payment_allocations_payment_fk foreign key (organization_id, payment_id)
    references apartcba.rental_payments (organization_id, id) on delete cascade,
  constraint rental_payment_allocations_charge_fk foreign key (organization_id, charge_id)
    references apartcba.rental_charges (organization_id, id) on delete restrict,
  constraint rental_payment_allocations_amount_positive check (amount > 0)
);
comment on table apartcba.rental_payment_allocations is
  'Imputación de cada pago a los ítems que cancela (arts. 900-903 CCyC). La rendición al propietario se arma con estas filas. Migración 068.';
create index if not exists rental_payment_allocations_payment_idx on apartcba.rental_payment_allocations (payment_id);
create index if not exists rental_payment_allocations_item_idx on apartcba.rental_payment_allocations (charge_item_id);
create index if not exists rental_payment_allocations_charge_idx on apartcba.rental_payment_allocations (charge_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Comprobantes de expensas y servicios + avisos de pago del portal
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_proofs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  kind text not null,
  period date not null,
  status text not null default 'pendiente',
  amount numeric(14,2),
  currency text references apartcba.currencies(code),
  due_date date,
  file_path text,
  file_mime text,
  file_name text,
  file_size integer,
  uploaded_at timestamptz,
  uploaded_via text,
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_proofs_unique unique (contract_id, kind, period),
  constraint rental_proofs_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_proofs_kind_valid check (kind in ('expensas','luz','gas','agua','municipal','inmobiliario','internet','seguro','otro')),
  constraint rental_proofs_status_valid check (status in ('pendiente','en_revision','validado','rechazado','no_corresponde')),
  constraint rental_proofs_period_first_day check (extract(day from period) = 1),
  constraint rental_proofs_via_valid check (uploaded_via is null or uploaded_via in ('staff','portal')),
  constraint rental_proofs_amount_positive check (amount is null or amount >= 0),
  constraint rental_proofs_reason_len check (rejection_reason is null or char_length(rejection_reason) <= 500)
);
comment on table apartcba.rental_proofs is
  'Comprobantes que el inquilino tiene que presentar cada mes (expensas, luz, gas…) y su validación. Migración 068.';
create index if not exists rental_proofs_org_status_idx on apartcba.rental_proofs (organization_id, status, period);
drop trigger if exists trg_set_updated_at on apartcba.rental_proofs;
create trigger trg_set_updated_at before update on apartcba.rental_proofs
  for each row execute function apartcba.tg_set_updated_at();

create table if not exists apartcba.rental_payment_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid not null,
  amount numeric(14,2),
  currency text references apartcba.currencies(code),
  paid_on date,
  receipt_path text,
  receipt_mime text,
  note text,
  status text not null default 'pendiente',
  payment_id uuid references apartcba.rental_payments(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rental_payment_reports_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_payment_reports_status_valid check (status in ('pendiente','registrado','descartado')),
  constraint rental_payment_reports_amount_positive check (amount is null or amount > 0),
  constraint rental_payment_reports_note_len check (note is null or char_length(note) <= 1000)
);
comment on table apartcba.rental_payment_reports is
  'Avisos de pago que el inquilino sube desde su link: NO son cobros; staff los revisa y registra el pago. Migración 068.';
create index if not exists rental_payment_reports_org_status_idx on apartcba.rental_payment_reports (organization_id, status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Gastos y arreglos de las propiedades
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  property_id uuid not null,
  contract_id uuid,
  occurred_on date not null,
  category text not null,
  description text not null,
  provider text,
  amount numeric(14,2) not null,
  currency text not null references apartcba.currencies(code),
  charged_to text not null,
  paid_by text not null default 'inmobiliaria',
  status text not null default 'pendiente',
  account_id uuid,
  cash_movement_id uuid references apartcba.cash_movements(id) on delete set null,
  statement_id uuid,
  charge_item_id uuid references apartcba.rental_charge_items(id) on delete set null,
  file_path text,
  file_mime text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint rental_expenses_property_fk foreign key (organization_id, property_id)
    references apartcba.rental_properties (organization_id, id) on delete restrict,
  constraint rental_expenses_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete set null (contract_id),
  constraint rental_expenses_account_fk foreign key (organization_id, account_id)
    references apartcba.cash_accounts (organization_id, id) on delete restrict,
  constraint rental_expenses_category_valid check (category in ('reparacion','mantenimiento','expensas_extraordinarias','impuesto','servicio','seguro','honorarios_terceros','otro')),
  constraint rental_expenses_charged_to_valid check (charged_to in ('propietario','inquilino','inmobiliaria')),
  constraint rental_expenses_paid_by_valid check (paid_by in ('inmobiliaria','propietario','inquilino','pendiente')),
  constraint rental_expenses_status_valid check (status in ('pendiente','aplicado','anulado')),
  constraint rental_expenses_amount_positive check (amount > 0),
  constraint rental_expenses_desc_len check (char_length(description) between 1 and 200)
);
comment on table apartcba.rental_expenses is
  'Gastos de una propiedad y a cargo de quién: propietario (se descuenta en la rendición), inquilino (se le cobra en un cargo) o inmobiliaria. Migración 068.';
comment on column apartcba.rental_expenses.status is 'pendiente = todavía no se pasó a una rendición o a un cargo; aplicado = ya se descontó/cobró.';
create index if not exists rental_expenses_property_idx on apartcba.rental_expenses (property_id, occurred_on desc);
create index if not exists rental_expenses_org_pending_idx on apartcba.rental_expenses (organization_id, charged_to) where status = 'pendiente';
drop trigger if exists trg_set_updated_at on apartcba.rental_expenses;
create trigger trg_set_updated_at before update on apartcba.rental_expenses
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) Rendiciones al propietario (liquidación de lo cobrado)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_owner_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  owner_id uuid not null,
  number integer not null,
  period_year smallint not null,
  period_month smallint not null,
  cutoff_date date not null,
  currency text not null references apartcba.currencies(code),
  status text not null default 'borrador',
  collected_amount numeric(14,2) not null default 0,
  fees_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  expenses_amount numeric(14,2) not null default 0,
  other_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  public_token_hash text,
  public_token_version smallint not null default 1,
  sent_at timestamptz,
  sent_to text,
  paid_at timestamptz,
  paid_movement_ids uuid[] not null default '{}',
  notes text,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz not null default now(),
  constraint rental_owner_statements_org_id_key unique (organization_id, id),
  constraint rental_owner_statements_org_number_key unique (organization_id, number),
  constraint rental_owner_statements_owner_fk foreign key (organization_id, owner_id)
    references apartcba.owners (organization_id, id) on delete restrict,
  constraint rental_owner_statements_status_valid check (status in ('borrador','emitida','pagada','anulada')),
  constraint rental_owner_statements_month_range check (period_month between 1 and 12),
  constraint rental_owner_statements_notes_len check (notes is null or char_length(notes) <= 2000)
);
comment on table apartcba.rental_owner_statements is
  'Rendición al propietario: lo cobrado de sus contratos menos honorarios, IVA y gastos a su cargo. Se rinde lo cobrado, no lo facturado. Migración 068.';
create index if not exists rental_owner_statements_owner_idx on apartcba.rental_owner_statements (owner_id, generated_at desc);
create index if not exists rental_owner_statements_org_status_idx on apartcba.rental_owner_statements (organization_id, status);
create unique index if not exists rental_owner_statements_token_key on apartcba.rental_owner_statements (public_token_hash) where public_token_hash is not null;
drop trigger if exists trg_set_updated_at on apartcba.rental_owner_statements;
create trigger trg_set_updated_at before update on apartcba.rental_owner_statements
  for each row execute function apartcba.tg_set_updated_at();

alter table apartcba.rental_expenses drop constraint if exists rental_expenses_statement_fk;
alter table apartcba.rental_expenses add constraint rental_expenses_statement_fk
  foreign key (statement_id) references apartcba.rental_owner_statements(id) on delete set null;

create table if not exists apartcba.rental_owner_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  statement_id uuid not null,
  owner_id uuid not null,
  line_type text not null,
  sign smallint not null,
  amount numeric(14,2) not null,
  description text not null,
  contract_id uuid,
  property_id uuid,
  ref_type text,
  ref_id uuid,
  share_pct numeric(5,2) not null default 100,
  voided boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint rental_owner_statement_lines_statement_fk foreign key (organization_id, statement_id)
    references apartcba.rental_owner_statements (organization_id, id) on delete cascade,
  constraint rental_owner_statement_lines_type_valid check (line_type in ('cobro_alquiler','cobro_punitorio','cobro_otro','honorarios_administracion','iva_honorarios','comision_locacion','gasto','ajuste')),
  constraint rental_owner_statement_lines_sign_valid check (sign in (1,-1)),
  constraint rental_owner_statement_lines_amount_positive check (amount >= 0),
  constraint rental_owner_statement_lines_ref_valid check (ref_type is null or ref_type in ('allocation','expense','contract_commission','manual')),
  constraint rental_owner_statement_lines_desc_len check (char_length(description) between 1 and 300)
);
comment on table apartcba.rental_owner_statement_lines is
  'Renglones de una rendición. Una imputación/gasto/comisión se rinde UNA vez por propietario (índice único parcial). Al anular la rendición, voided = true y se liberan. Migración 068.';
create index if not exists rental_owner_statement_lines_statement_idx on apartcba.rental_owner_statement_lines (statement_id, sort_order);
create unique index if not exists rental_owner_statement_lines_once_key on apartcba.rental_owner_statement_lines (owner_id, ref_type, ref_id)
  where voided = false and ref_id is not null and ref_type in ('allocation','expense','contract_commission');

-- ─────────────────────────────────────────────────────────────────────────────
-- 12) Documentos (contrato firmado, garantías, inventario…) e historial
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.rental_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid,
  property_id uuid,
  person_id uuid,
  kind text not null default 'otro',
  title text not null,
  file_path text not null,
  file_mime text,
  file_size integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rental_documents_contract_fk foreign key (organization_id, contract_id)
    references apartcba.rental_contracts (organization_id, id) on delete cascade,
  constraint rental_documents_property_fk foreign key (organization_id, property_id)
    references apartcba.rental_properties (organization_id, id) on delete cascade,
  constraint rental_documents_person_fk foreign key (organization_id, person_id)
    references apartcba.rental_people (organization_id, id) on delete cascade,
  constraint rental_documents_kind_valid check (kind in ('contrato','garantia','inventario','acta_entrega','mandato','dni','recibo_sueldo','poliza','foto','otro')),
  constraint rental_documents_owner_present check (contract_id is not null or property_id is not null or person_id is not null),
  constraint rental_documents_title_len check (char_length(title) between 1 and 160)
);
comment on table apartcba.rental_documents is
  'Archivos del módulo (bucket privado rental-docs, se sirven con URL firmada). Migración 068.';
create index if not exists rental_documents_contract_idx on apartcba.rental_documents (contract_id) where contract_id is not null;
create index if not exists rental_documents_property_idx on apartcba.rental_documents (property_id) where property_id is not null;
create index if not exists rental_documents_person_idx on apartcba.rental_documents (person_id) where person_id is not null;

create table if not exists apartcba.rental_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  contract_id uuid,
  property_id uuid,
  event_type text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint rental_events_summary_len check (char_length(summary) between 1 and 400)
);
comment on table apartcba.rental_events is
  'Historial legible de cada contrato/propiedad (alta, ajustes, cobros, avisos, validaciones). Inmutable. Migración 068.';
create index if not exists rental_events_contract_idx on apartcba.rental_events (contract_id, created_at desc) where contract_id is not null;
create index if not exists rental_events_property_idx on apartcba.rental_events (property_id, created_at desc) where property_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13) Índices económicos (GLOBAL: IPC, ICL, Casa Propia, UVA, CER, RIPTE)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.economic_indices (
  index_code text not null,
  period date not null,
  value numeric(24,10) not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (index_code, period),
  constraint economic_indices_code_valid check (index_code in ('ipc','icl','casa_propia','uva','cer','ripte')),
  constraint economic_indices_value_positive check (value > 0),
  constraint economic_indices_source_valid check (source in ('indec','bcra','datos_gob','argentinadatos','manual'))
);
comment on table apartcba.economic_indices is
  'Niveles de índices públicos, iguales para todas las orgs. Mensuales → period = primer día del mes; diarios → el día. Los llena el cron diario. Migración 068.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 14) Categorías nuevas de Caja y tipos nuevos de notificación
-- ─────────────────────────────────────────────────────────────────────────────
alter table apartcba.cash_movements drop constraint if exists cash_movements_category_check;
alter table apartcba.cash_movements add constraint cash_movements_category_check check (category in (
  'booking_payment','maintenance','cleaning','owner_settlement','transfer','adjustment','salary',
  'utilities','tax','supplies','commission','refund','other','extra_charge',
  'rent_collection','rent_owner_payout','security_deposit','agency_fee'
));

alter table apartcba.notifications drop constraint if exists notifications_type_check;
alter table apartcba.notifications add constraint notifications_type_check check (type in (
  'payment_due','payment_overdue','payment_received','lease_ending_soon','lease_split_created',
  'task_reminder','inbound_booking_pending','inbound_booking_cancelled','inbound_booking_unmatched_unit',
  'inbound_booking_conflict','channel_feed_error','manual','other','channel_cancellation_pending',
  'channel_request_pending','channel_request_auto_confirmed',
  'rental_overdue','rental_adjustment','rental_expiring','rental_proof','rental_payment_report'
));

-- ─────────────────────────────────────────────────────────────────────────────
-- 15) Seguridad: RLS encendido, sin escritura desde el browser (patrón 067c)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'rental_settings','rental_counters','rental_properties','rental_property_owners','rental_people',
    'rental_contracts','rental_contract_parties','rental_adjustments','rental_charges','rental_charge_items',
    'rental_payments','rental_payment_allocations','rental_proofs','rental_payment_reports','rental_expenses',
    'rental_owner_statements','rental_owner_statement_lines','rental_documents','rental_events','economic_indices'
  ] loop
    execute format('alter table apartcba.%I enable row level security', t);
    execute format('revoke all on table apartcba.%I from anon, authenticated', t);
    execute format('grant all on table apartcba.%I to service_role', t);
  end loop;
end $$;

-- Las pantallas en vivo (cobranzas, comprobantes, contrato) escuchan estas tablas:
-- SELECT sólo para admin/recepción de la org (decide quién recibe eventos de Realtime).
do $$
declare
  t text;
begin
  foreach t in array array[
    'rental_contracts','rental_adjustments','rental_charges','rental_payments','rental_proofs','rental_payment_reports'
  ] loop
    execute format('drop policy if exists staff_select on apartcba.%I', t);
    execute format(
      'create policy staff_select on apartcba.%I for select to authenticated using (apartcba.current_user_role(organization_id) = any (array[''admin'',''recepcion'']))',
      t
    );
    execute format('grant select on table apartcba.%I to authenticated', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'apartcba' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table apartcba.%I', t);
    end if;
  end loop;
end $$;
-- REPLICA IDENTITY queda en DEFAULT a propósito: con FULL, los DELETE viajarían
-- con la fila entera a todos los suscriptores (Realtime no filtra deletes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 16) Bucket privado para documentos y comprobantes (sin políticas: sólo service role)
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rental-docs', 'rental-docs', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17) Activación inicial: Apart CBA (slug admin) y la org demo
-- ─────────────────────────────────────────────────────────────────────────────
update apartcba.organizations set rentals_enabled = true where slug in ('admin', 'rentostest');

commit;

-- Verificación:
--   select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename like 'rental_%';
--   select relname, relrowsecurity from pg_class where relname like 'rental_%' or relname = 'economic_indices';
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'cash_movements_category_check';
