-- Storage buckets para Spec 2: avatares de usuarios + logos de organizaciones
-- Idempotente.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Buckets (públicos, para servir directo via CDN)
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ════════════════════════════════════════════════════════════════════════
-- 2. RLS de avatars: cualquiera lee (público), solo el dueño escribe
-- Path pattern: {user_id}/{filename}
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_write" ON storage.objects;
CREATE POLICY "avatars_owner_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ════════════════════════════════════════════════════════════════════════
-- 3. RLS de org-logos: cualquiera lee, miembros activos de la org escriben
-- Path pattern: {organization_id}/{filename}
-- (Sin discriminación por rol — decisión explícita de Spec 2)
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "org_logos_public_read" ON storage.objects;
CREATE POLICY "org_logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');

DROP POLICY IF EXISTS "org_logos_member_write" ON storage.objects;
CREATE POLICY "org_logos_member_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "org_logos_member_update" ON storage.objects;
CREATE POLICY "org_logos_member_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "org_logos_member_delete" ON storage.objects;
CREATE POLICY "org_logos_member_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );
