-- 018_user_dni.sql
-- Adjuntar foto del DNI (frente y dorso, opcionales) por miembro del equipo.
-- Bucket privado + paths interno por user_id + RLS "owner OR admin de la misma org".
-- Idempotente.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Bucket privado
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-dni',
  'team-dni',
  false,                              -- privado: solo signed URLs
  5242880,                            -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Columnas nuevas en user_profiles
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE apartcba.user_profiles
  ADD COLUMN IF NOT EXISTS dni_front_path text,
  ADD COLUMN IF NOT EXISTS dni_back_path  text,
  ADD COLUMN IF NOT EXISTS dni_updated_at timestamptz;

COMMENT ON COLUMN apartcba.user_profiles.dni_front_path IS
  'Path interno en el bucket team-dni (ej. "<user_id>/front.jpg"). NULL si no hay archivo.';
COMMENT ON COLUMN apartcba.user_profiles.dni_back_path IS
  'Path interno en el bucket team-dni (ej. "<user_id>/back.jpg"). NULL si no hay archivo.';
COMMENT ON COLUMN apartcba.user_profiles.dni_updated_at IS
  'Última vez que se subió o reemplazó cualquier lado del DNI.';

-- ════════════════════════════════════════════════════════════════════════
-- 3. RLS de storage.objects para bucket team-dni
-- Path pattern: {user_id}/{front|back}.{ext}
-- Permiso: el propio dueño, O un admin activo de una org de la cual el dueño
-- también es miembro activo.
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "team_dni_select_owner_or_admin" ON storage.objects;
CREATE POLICY "team_dni_select_owner_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'team-dni'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM apartcba.organization_members me
        JOIN apartcba.organization_members other
          ON other.organization_id = me.organization_id
        WHERE me.user_id = auth.uid()
          AND me.role = 'admin'
          AND me.active = true
          AND other.user_id::text = (storage.foldername(name))[1]
          AND other.active = true
      )
    )
  );

DROP POLICY IF EXISTS "team_dni_insert_owner_or_admin" ON storage.objects;
CREATE POLICY "team_dni_insert_owner_or_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'team-dni'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM apartcba.organization_members me
        JOIN apartcba.organization_members other
          ON other.organization_id = me.organization_id
        WHERE me.user_id = auth.uid()
          AND me.role = 'admin'
          AND me.active = true
          AND other.user_id::text = (storage.foldername(name))[1]
          AND other.active = true
      )
    )
  );

DROP POLICY IF EXISTS "team_dni_update_owner_or_admin" ON storage.objects;
CREATE POLICY "team_dni_update_owner_or_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'team-dni'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM apartcba.organization_members me
        JOIN apartcba.organization_members other
          ON other.organization_id = me.organization_id
        WHERE me.user_id = auth.uid()
          AND me.role = 'admin'
          AND me.active = true
          AND other.user_id::text = (storage.foldername(name))[1]
          AND other.active = true
      )
    )
  );

DROP POLICY IF EXISTS "team_dni_delete_owner_or_admin" ON storage.objects;
CREATE POLICY "team_dni_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'team-dni'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM apartcba.organization_members me
        JOIN apartcba.organization_members other
          ON other.organization_id = me.organization_id
        WHERE me.user_id = auth.uid()
          AND me.role = 'admin'
          AND me.active = true
          AND other.user_id::text = (storage.foldername(name))[1]
          AND other.active = true
      )
    )
  );
