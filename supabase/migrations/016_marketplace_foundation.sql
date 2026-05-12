-- ════════════════════════════════════════════════════════════════════════════
-- rentOS Marketplace — Foundation
-- Schema: apartcba (mantenido por compatibilidad; el rebrand a rentOS es solo de UI)
--
-- Agrega:
--   • Columnas marketplace en `units` (lat/lng, slug, publicación, instant_book, etc)
--   • `unit_photos` — galería multi-foto por unidad
--   • `marketplace_amenities` + `unit_marketplace_amenities` — catálogo y join
--   • `unit_pricing_rules` — pricing dinámico por temporada / día de semana
--   • `guest_profiles` — perfil del huésped del marketplace (1:1 con auth.users)
--   • `booking_requests` — solicitudes para unidades non-instant-book
--   • `reviews` — opiniones post-estadía
--   • `wishlists` — favoritos del huésped
--   • Storage bucket `unit-photos` con RLS
--   • RLS público para listings publicadas; service_role bypasea siempre
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Extender units ──────────────────────────────────────────────────────────
ALTER TABLE apartcba.units
  ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS marketplace_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketplace_title text,
  ADD COLUMN IF NOT EXISTS marketplace_description text,
  ADD COLUMN IF NOT EXISTS marketplace_property_type text DEFAULT 'apartamento',
  ADD COLUMN IF NOT EXISTS marketplace_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS instant_book boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_nights smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_nights smallint,
  ADD COLUMN IF NOT EXISTS cancellation_policy text DEFAULT 'flexible'
    CHECK (cancellation_policy IN ('flexible','moderada','estricta')),
  ADD COLUMN IF NOT EXISTS house_rules text,
  ADD COLUMN IF NOT EXISTS check_in_window_start time DEFAULT '15:00',
  ADD COLUMN IF NOT EXISTS check_in_window_end time DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS marketplace_rating_avg numeric(3, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketplace_rating_count integer NOT NULL DEFAULT 0;

-- Slug único cross-org (namespace global)
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_slug_unique
  ON apartcba.units(slug) WHERE slug IS NOT NULL;

-- Index para queries del marketplace público (los más comunes)
CREATE INDEX IF NOT EXISTS idx_units_marketplace_published
  ON apartcba.units(marketplace_published, neighborhood)
  WHERE marketplace_published = true AND active = true;

-- Geo search (búsqueda por bounding box)
CREATE INDEX IF NOT EXISTS idx_units_geo
  ON apartcba.units(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ─── unit_photos: galería del marketplace ────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.unit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  alt_text text,
  width integer,
  height integer,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unit_photos_unit ON apartcba.unit_photos(unit_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_unit_photos_org ON apartcba.unit_photos(organization_id);
-- Solo una cover por unit
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_photos_one_cover
  ON apartcba.unit_photos(unit_id) WHERE is_cover = true;

-- ─── marketplace_amenities catálogo + join ───────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.marketplace_amenities (
  code text PRIMARY KEY,
  name text NOT NULL,
  icon text NOT NULL,
  category text NOT NULL,
  display_order smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS apartcba.unit_marketplace_amenities (
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  amenity_code text NOT NULL REFERENCES apartcba.marketplace_amenities(code),
  PRIMARY KEY (unit_id, amenity_code)
);

CREATE INDEX IF NOT EXISTS idx_unit_amenities_amenity
  ON apartcba.unit_marketplace_amenities(amenity_code);

-- ─── unit_pricing_rules: pricing dinámico ────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.unit_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('date_range', 'weekday')),
  start_date date,
  end_date date,
  days_of_week smallint[],
  price_multiplier numeric(5, 3),
  price_override numeric(14, 2),
  min_nights_override smallint,
  priority smallint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_rule_shape CHECK (
    (rule_type = 'date_range' AND start_date IS NOT NULL AND end_date IS NOT NULL)
    OR (rule_type = 'weekday' AND days_of_week IS NOT NULL)
  ),
  CONSTRAINT pricing_rule_has_value CHECK (
    price_multiplier IS NOT NULL OR price_override IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_unit
  ON apartcba.unit_pricing_rules(unit_id, active, priority DESC);

-- ─── guest_profiles: perfil de huésped del marketplace ───────────────────────
-- Paralelo a user_profiles (staff PMS). 1:1 con auth.users. Cross-org.
CREATE TABLE IF NOT EXISTS apartcba.guest_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  avatar_url text,
  document_type text,
  document_number text,
  country text DEFAULT 'AR',
  city text,
  birth_date date,
  preferred_currency text REFERENCES apartcba.currencies(code) DEFAULT 'ARS',
  preferred_locale text DEFAULT 'es-AR',
  marketing_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_profiles_phone
  ON apartcba.guest_profiles(phone) WHERE phone IS NOT NULL;

-- ─── booking_requests: solicitudes request-to-book ───────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  guest_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_full_name text NOT NULL,
  guest_email text NOT NULL,
  guest_phone text,
  guest_document text,
  check_in_date date NOT NULL,
  check_in_time time DEFAULT '15:00',
  check_out_date date NOT NULL,
  check_out_time time DEFAULT '11:00',
  guests_count smallint NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'ARS' REFERENCES apartcba.currencies(code),
  total_amount numeric(14, 2) NOT NULL,
  cleaning_fee numeric(14, 2) DEFAULT 0,
  nights smallint NOT NULL,
  special_requests text,
  status text NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','aprobada','rechazada','expirada','cancelada')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejection_reason text,
  resulting_booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_requests_dates_valid CHECK (check_out_date > check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_booking_requests_org_status
  ON apartcba.booking_requests(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_requests_guest
  ON apartcba.booking_requests(guest_user_id) WHERE guest_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_requests_unit
  ON apartcba.booking_requests(unit_id, status, check_in_date);
CREATE INDEX IF NOT EXISTS idx_booking_requests_pending_block
  ON apartcba.booking_requests(unit_id, check_in_date, check_out_date)
  WHERE status = 'pendiente';

-- ─── reviews: opiniones post-estadía ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES apartcba.bookings(id) ON DELETE CASCADE,
  guest_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_name_snapshot text NOT NULL,
  guest_avatar_snapshot text,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  cleanliness_rating smallint CHECK (cleanliness_rating BETWEEN 1 AND 5),
  communication_rating smallint CHECK (communication_rating BETWEEN 1 AND 5),
  location_rating smallint CHECK (location_rating BETWEEN 1 AND 5),
  value_rating smallint CHECK (value_rating BETWEEN 1 AND 5),
  comment text,
  host_response text,
  host_responded_at timestamptz,
  host_responded_by uuid REFERENCES auth.users(id),
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_unit
  ON apartcba.reviews(unit_id, published, created_at DESC);

-- Trigger: actualizar rating_avg y rating_count en units cuando se inserta/borra una review
CREATE OR REPLACE FUNCTION apartcba.tg_reviews_update_unit_aggregate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $$
DECLARE
  target_unit uuid;
  new_avg numeric(3, 2);
  new_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_unit := OLD.unit_id;
  ELSE
    target_unit := NEW.unit_id;
  END IF;

  SELECT
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0),
    COUNT(*)
  INTO new_avg, new_count
  FROM apartcba.reviews
  WHERE unit_id = target_unit AND published = true;

  UPDATE apartcba.units
    SET marketplace_rating_avg = new_avg,
        marketplace_rating_count = new_count
    WHERE id = target_unit;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_reviews_aggregate ON apartcba.reviews;
CREATE TRIGGER trg_reviews_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON apartcba.reviews
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_reviews_update_unit_aggregate();

-- ─── wishlists: favoritos del huésped ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.wishlists (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_user
  ON apartcba.wishlists(user_id, added_at DESC);

-- ─── Storage bucket: unit-photos (público) ───────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unit-photos',
  'unit-photos',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path: {organization_id}/{unit_id}/{filename}
DROP POLICY IF EXISTS "unit_photos_public_read" ON storage.objects;
CREATE POLICY "unit_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'unit-photos');

DROP POLICY IF EXISTS "unit_photos_member_write" ON storage.objects;
CREATE POLICY "unit_photos_member_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'unit-photos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "unit_photos_member_update" ON storage.objects;
CREATE POLICY "unit_photos_member_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'unit-photos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "unit_photos_member_delete" ON storage.objects;
CREATE POLICY "unit_photos_member_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'unit-photos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

-- ─── RLS: nuevas tablas ──────────────────────────────────────────────────────
ALTER TABLE apartcba.unit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.marketplace_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.unit_marketplace_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.unit_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.guest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE apartcba.wishlists ENABLE ROW LEVEL SECURITY;

-- unit_photos: members all + public read si la unidad está publicada
DROP POLICY IF EXISTS members_all ON apartcba.unit_photos;
CREATE POLICY members_all ON apartcba.unit_photos FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS public_read_published ON apartcba.unit_photos;
CREATE POLICY public_read_published ON apartcba.unit_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apartcba.units u
      WHERE u.id = unit_id
        AND u.marketplace_published = true
        AND u.active = true
    )
  );

-- marketplace_amenities: lectura pública total, escritura solo superadmin
DROP POLICY IF EXISTS public_read ON apartcba.marketplace_amenities;
CREATE POLICY public_read ON apartcba.marketplace_amenities FOR SELECT USING (true);
DROP POLICY IF EXISTS sa_modify ON apartcba.marketplace_amenities;
CREATE POLICY sa_modify ON apartcba.marketplace_amenities FOR ALL
  USING (apartcba.is_superadmin())
  WITH CHECK (apartcba.is_superadmin());

-- unit_marketplace_amenities: members + public read si listing publicado
DROP POLICY IF EXISTS members_all ON apartcba.unit_marketplace_amenities;
CREATE POLICY members_all ON apartcba.unit_marketplace_amenities FOR ALL
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

DROP POLICY IF EXISTS public_read_published ON apartcba.unit_marketplace_amenities;
CREATE POLICY public_read_published ON apartcba.unit_marketplace_amenities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apartcba.units u
      WHERE u.id = unit_id
        AND u.marketplace_published = true
        AND u.active = true
    )
  );

-- unit_pricing_rules: members + public read si listing publicado
DROP POLICY IF EXISTS members_all ON apartcba.unit_pricing_rules;
CREATE POLICY members_all ON apartcba.unit_pricing_rules FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS public_read_published ON apartcba.unit_pricing_rules;
CREATE POLICY public_read_published ON apartcba.unit_pricing_rules FOR SELECT
  USING (
    active = true
    AND EXISTS (
      SELECT 1 FROM apartcba.units u
      WHERE u.id = unit_id
        AND u.marketplace_published = true
        AND u.active = true
    )
  );

-- guest_profiles: el guest mismo, full access
DROP POLICY IF EXISTS self_all ON apartcba.guest_profiles;
CREATE POLICY self_all ON apartcba.guest_profiles FOR ALL
  USING (user_id = auth.uid() OR apartcba.is_superadmin())
  WITH CHECK (user_id = auth.uid() OR apartcba.is_superadmin());

-- booking_requests: members de la org + el guest dueño
DROP POLICY IF EXISTS members_all ON apartcba.booking_requests;
CREATE POLICY members_all ON apartcba.booking_requests FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS guest_read_own ON apartcba.booking_requests;
CREATE POLICY guest_read_own ON apartcba.booking_requests FOR SELECT
  USING (guest_user_id = auth.uid());

-- reviews: público lee si publicada, members modifican, guest crea/edita la suya
DROP POLICY IF EXISTS public_read_published ON apartcba.reviews;
CREATE POLICY public_read_published ON apartcba.reviews FOR SELECT
  USING (published = true);

DROP POLICY IF EXISTS members_all ON apartcba.reviews;
CREATE POLICY members_all ON apartcba.reviews FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());

DROP POLICY IF EXISTS guest_insert_own ON apartcba.reviews;
CREATE POLICY guest_insert_own ON apartcba.reviews FOR INSERT
  WITH CHECK (guest_user_id = auth.uid());

DROP POLICY IF EXISTS guest_update_own ON apartcba.reviews;
CREATE POLICY guest_update_own ON apartcba.reviews FOR UPDATE
  USING (guest_user_id = auth.uid() AND host_response IS NULL)
  WITH CHECK (guest_user_id = auth.uid());

-- wishlists: solo el dueño
DROP POLICY IF EXISTS self_all ON apartcba.wishlists;
CREATE POLICY self_all ON apartcba.wishlists FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── Updated_at triggers ─────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'guest_profiles','booking_requests','reviews'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.%I FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ─── Slug generator helper ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apartcba.generate_unit_slug(p_seed text, p_unit_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base_slug text;
  candidate text;
  counter integer := 0;
BEGIN
  base_slug := lower(coalesce(p_seed, ''));
  base_slug := translate(base_slug, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  base_slug := substring(base_slug, 1, 60);
  IF length(base_slug) = 0 THEN
    base_slug := 'unidad';
  END IF;

  candidate := base_slug;
  WHILE EXISTS (
    SELECT 1 FROM apartcba.units
    WHERE slug = candidate AND id <> p_unit_id
  ) LOOP
    counter := counter + 1;
    candidate := base_slug || '-' || counter;
  END LOOP;

  RETURN candidate;
END $$;

-- ─── Seeds: marketplace amenities catalog ────────────────────────────────────
INSERT INTO apartcba.marketplace_amenities (code, name, icon, category, display_order) VALUES
  -- esencial
  ('wifi',                'Wi-Fi',                  'Wifi',           'esencial',  10),
  ('aire_acondicionado',  'Aire acondicionado',     'AirVent',        'esencial',  20),
  ('calefaccion',         'Calefacción',            'Flame',          'esencial',  30),
  ('cocina_equipada',     'Cocina equipada',        'ChefHat',        'esencial',  40),
  ('lavarropas',          'Lavarropas',             'WashingMachine', 'esencial',  50),
  ('agua_caliente',       'Agua caliente',          'Droplets',       'esencial',  60),
  ('tv',                  'TV',                     'Tv',             'esencial',  70),
  ('streaming',           'Netflix / streaming',    'PlayCircle',     'esencial',  80),
  ('ropa_cama',           'Ropa de cama',           'Bed',            'esencial',  90),
  ('toallas',             'Toallas',                'Sparkles',       'esencial', 100),
  -- comodidad
  ('estacionamiento',     'Estacionamiento',        'Car',            'comodidad', 200),
  ('ascensor',            'Ascensor',               'ArrowUpDown',    'comodidad', 210),
  ('balcon',              'Balcón',                 'TreePalm',       'comodidad', 220),
  ('escritorio',          'Espacio de trabajo',     'Laptop',         'comodidad', 230),
  ('secador_pelo',        'Secador de pelo',        'Wind',           'comodidad', 240),
  ('plancha',             'Plancha',                'Shirt',          'comodidad', 250),
  ('cafetera',            'Cafetera',               'Coffee',         'comodidad', 260),
  -- exterior
  ('pileta',              'Pileta',                 'Waves',          'exterior',  300),
  ('jacuzzi',             'Jacuzzi',                'Bath',           'exterior',  310),
  ('parrilla',            'Parrilla',               'Flame',          'exterior',  320),
  ('jardin',              'Jardín',                 'Trees',          'exterior',  330),
  ('terraza',             'Terraza',                'Building',       'exterior',  340),
  ('vista',               'Vista panorámica',       'Mountain',       'exterior',  350),
  -- familia
  ('apto_mascotas',       'Mascotas permitidas',    'PawPrint',       'familia',   400),
  ('cuna',                'Cuna disponible',        'Baby',           'familia',   410),
  ('apto_ninos',          'Apto para niños',        'Smile',          'familia',   420),
  ('silla_alta',          'Silla alta',             'Armchair',       'familia',   430),
  -- seguridad
  ('detector_humo',       'Detector de humo',       'Siren',          'seguridad', 500),
  ('caja_fuerte',         'Caja fuerte',            'Lock',           'seguridad', 510),
  ('camaras_exterior',    'Cámaras exteriores',     'Camera',         'seguridad', 520),
  ('portero',             'Portero / seguridad',    'Shield',         'seguridad', 530),
  -- accesibilidad
  ('acceso_silla_ruedas', 'Acceso silla de ruedas', 'Accessibility',  'accesibilidad', 600),
  ('planta_baja',         'Planta baja',            'Home',           'accesibilidad', 610)
ON CONFLICT (code) DO NOTHING;

-- ─── Grants ──────────────────────────────────────────────────────────────────
GRANT ALL ON apartcba.unit_photos,
             apartcba.marketplace_amenities,
             apartcba.unit_marketplace_amenities,
             apartcba.unit_pricing_rules,
             apartcba.guest_profiles,
             apartcba.booking_requests,
             apartcba.reviews,
             apartcba.wishlists
  TO authenticated, service_role;

GRANT SELECT ON apartcba.unit_photos,
                apartcba.marketplace_amenities,
                apartcba.unit_marketplace_amenities,
                apartcba.unit_pricing_rules,
                apartcba.reviews
  TO anon;

-- Realtime para las que ameritan suscripciones (admin viendo new requests)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.booking_requests;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.reviews;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
