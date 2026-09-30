-- 067 — La web pública de Apart: vidriera propia, cobro de la seña y
-- seguimiento de la solicitud sin cuenta.
--
-- Contexto (relevamiento 28/09/2026 sobre www.apartcba.com):
--   * La web nunca produjo una reserva real. El alta de huésped se cortaba en la
--     confirmación de email y ninguna solicitud llegaba al equipo.
--   * 43 de las 45 unidades publicadas se reservan CON CONFIRMACIÓN. El cobro
--     real es: el equipo confirma, el huésped transfiere una seña (≈ 1 noche) y
--     el resto se paga al llegar. Nada en el sistema le decía al huésped cuánto,
--     a dónde ni hasta cuándo transferir: no había alias/CBU en ningún lado.
--   * La búsqueda pública es cross-org, así que dos unidades de la org demo
--     "rentOS Test" (con reseñas sembradas) aparecían en la web de Apart.
--
-- Esta migración es ADITIVA: el código que hoy corre en producción la ignora.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Vidriera: qué organizaciones venden en la web pública.
--    Default false: ninguna org nueva (ni de prueba) aparece sola en la web.
--    Se habilita a mano por organización (ver nota al pie).
-- ─────────────────────────────────────────────────────────────────────────────
alter table apartcba.organizations
  add column if not exists marketplace_enabled boolean not null default false;

comment on column apartcba.organizations.marketplace_enabled is
  'La org vende en la web pública (www.apartcba.com). Las lecturas públicas (búsqueda, ficha, sitemap, checkout) filtran por esto además de units.marketplace_published.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Configuración de la web y del cobro, por organización.
--    Sin fila = valores por defecto (seña de 1 noche, 24 h para pagarla,
--    respuesta en 24 h, sin datos de transferencia cargados).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.org_web_settings (
  organization_id   uuid primary key references apartcba.organizations(id) on delete cascade,

  -- Contacto público que ve el huésped.
  whatsapp_number   text,   -- sólo dígitos, con código de país (p. ej. 5493511234567)
  public_email      text,
  instagram_handle  text,   -- sin @

  -- Promesa de respuesta a una solicitud (horas). La solicitud vence a las 48 h
  -- igual (booking_requests.expires_at); esto es lo que se le promete al huésped.
  response_hours    smallint not null default 24,

  -- Seña: cómo se calcula el anticipo que pide el equipo al confirmar.
  deposit_rule      text not null default 'one_night',
  deposit_percent   numeric(5,2),
  -- Horas que tiene el huésped para transferir la seña desde que se confirma.
  deposit_due_hours smallint not null default 24,

  -- Datos para transferir la seña. Se muestran SÓLO después de confirmar.
  transfer_holder   text,
  transfer_cuit     text,
  transfer_bank     text,
  transfer_cbu      text,
  transfer_alias    text,
  transfer_notes    text,

  -- Política de cancelación en palabras propias (opcional). Vacío = se usa el
  -- texto de la política de cada unidad.
  cancellation_text text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null,

  constraint org_web_settings_response_hours_range check (response_hours between 1 and 48),
  constraint org_web_settings_deposit_rule_valid check (deposit_rule in ('one_night', 'percent', 'none')),
  constraint org_web_settings_deposit_percent_range check (
    deposit_percent is null or (deposit_percent > 0 and deposit_percent <= 100)
  ),
  constraint org_web_settings_percent_needs_value check (
    deposit_rule <> 'percent' or deposit_percent is not null
  ),
  constraint org_web_settings_due_hours_range check (deposit_due_hours between 1 and 168),
  constraint org_web_settings_whatsapp_digits check (
    whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$'
  ),
  constraint org_web_settings_cbu_digits check (
    transfer_cbu is null or transfer_cbu ~ '^[0-9]{22}$'
  )
);

comment on table apartcba.org_web_settings is
  'Configuración de la web pública y del cobro de la seña por organización (Configuración → Web y cobros). Sin fila = defaults.';

alter table apartcba.org_web_settings enable row level security;

drop policy if exists members_all on apartcba.org_web_settings;
create policy members_all on apartcba.org_web_settings for all
  using (organization_id = any(apartcba.current_user_orgs()) or apartcba.is_superadmin())
  with check (organization_id = any(apartcba.current_user_orgs()) or apartcba.is_superadmin());

drop trigger if exists trg_set_updated_at on apartcba.org_web_settings;
create trigger trg_set_updated_at
  before update on apartcba.org_web_settings
  for each row execute function apartcba.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Solicitudes: seguimiento sin cuenta y seña estimada.
--    access_token_hash = sha256 (hex) del token que va en el link
--    /reserva/<token>. El token en claro nunca se guarda.
-- ─────────────────────────────────────────────────────────────────────────────
alter table apartcba.booking_requests
  add column if not exists access_token_hash text,
  add column if not exists deposit_estimate  numeric(12,2),
  add column if not exists staff_reminded_at timestamptz,
  add column if not exists guest_notified_at timestamptz;

comment on column apartcba.booking_requests.access_token_hash is
  'sha256 hex del token del link de seguimiento /reserva/<token> (el huésped puede no tener cuenta). Nunca se guarda el token en claro.';
comment on column apartcba.booking_requests.deposit_estimate is
  'Seña estimada que se le mostró al huésped al pedir (regla de org_web_settings). El monto definitivo lo fija el equipo al confirmar (bookings.deposit_amount).';
comment on column apartcba.booking_requests.staff_reminded_at is
  'Cuándo se le recordó al equipo que la solicitud sigue sin respuesta.';
comment on column apartcba.booking_requests.guest_notified_at is
  'Cuándo se le avisó al huésped que su solicitud venció sin respuesta.';

create unique index if not exists booking_requests_access_token_hash_key
  on apartcba.booking_requests (access_token_hash)
  where access_token_hash is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Avisos de pago del huésped ("Ya transferí la seña").
--    NO es un cobro: la plata sigue entrando a Caja cuando una persona la
--    registra (addBookingPayment). Esto es el aviso, con el comprobante.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists apartcba.booking_payment_reports (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references apartcba.organizations(id) on delete cascade,
  booking_id         uuid not null references apartcba.bookings(id) on delete cascade,
  booking_request_id uuid references apartcba.booking_requests(id) on delete set null,
  amount             numeric(12,2),
  currency           text not null default 'ARS',
  receipt_path       text,   -- ruta en el bucket privado payment-receipts
  receipt_mime       text,
  note               text,
  status             text not null default 'pendiente',
  reviewed_by        uuid references auth.users(id) on delete set null,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),

  constraint booking_payment_reports_amount_positive check (amount is null or amount > 0),
  constraint booking_payment_reports_status_valid check (status in ('pendiente', 'registrado', 'descartado')),
  constraint booking_payment_reports_note_length check (note is null or length(note) <= 1000)
);

comment on table apartcba.booking_payment_reports is
  'Avisos del huésped de que transfirió la seña (con comprobante opcional). El cobro real se registra en Caja; al hacerlo el aviso pasa a registrado.';

create index if not exists booking_payment_reports_org_status_idx
  on apartcba.booking_payment_reports (organization_id, status, created_at desc);
create index if not exists booking_payment_reports_booking_idx
  on apartcba.booking_payment_reports (booking_id);
create index if not exists booking_payment_reports_request_idx
  on apartcba.booking_payment_reports (booking_request_id);

alter table apartcba.booking_payment_reports enable row level security;

drop policy if exists members_all on apartcba.booking_payment_reports;
create policy members_all on apartcba.booking_payment_reports for all
  using (organization_id = any(apartcba.current_user_orgs()) or apartcba.is_superadmin())
  with check (organization_id = any(apartcba.current_user_orgs()) or apartcba.is_superadmin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Bucket privado para comprobantes. Sin policies de storage: sólo el
--    service role (server actions) sube y firma URLs para el equipo.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Reseñas: sólo se crean/editan por server action (submitReview valida que
--    la estadía exista, sea del huésped y esté completada). Las policies de
--    INSERT/UPDATE directo dejaban a cualquier sesión de huésped publicar una
--    reseña sobre cualquier unidad vía PostgREST.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists guest_insert_own on apartcba.reviews;
drop policy if exists guest_update_own on apartcba.reviews;

commit;

-- Habilitar la vidriera (dato, no esquema — se corre aparte por organización):
--   update apartcba.organizations set marketplace_enabled = true where id = '<org>';
