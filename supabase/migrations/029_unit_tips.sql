-- ════════════════════════════════════════════════════════════════════════
-- 029_unit_tips.sql
--
-- "Consejos del depto": mini-feed colaborativo asociado a cada unidad para
-- que el equipo (limpieza, recepción, mantenimiento, admin) se pase
-- conocimiento operativo entre departamentos. Reacciones tipo emoji y
-- foto opcional. Pinned por admin/recepción para destacar consejos críticos.
--
-- Mismo patrón de hardening que cleaning_events (009): RLS abierto, scoping
-- real en server actions vía service_role + org filter. REPLICA IDENTITY
-- FULL para que los filters server-side de realtime no rompan DELETEs
-- (ver 011_realtime_replica_identity_full.sql).
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1) unit_tips ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.unit_tips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  unit_id         uuid NOT NULL REFERENCES apartcba.units(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES auth.users(id),
  content         text NOT NULL,
  category        text NOT NULL DEFAULT 'general',
  photo_url       text,
  pinned_at       timestamptz,
  pinned_by       uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT unit_tips_content_length CHECK (length(btrim(content)) BETWEEN 3 AND 2000),
  CONSTRAINT unit_tips_category_valid CHECK (
    category IN ('general','cocina','bano','dormitorio','acceso','electrodomesticos','importante')
  )
);

-- Feed por unidad (lo más usado): pinned arriba, luego por fecha desc.
CREATE INDEX IF NOT EXISTS idx_unit_tips_unit_feed
  ON apartcba.unit_tips(organization_id, unit_id, pinned_at DESC NULLS LAST, created_at DESC)
  WHERE deleted_at IS NULL;

-- Feed global org-wide para /m/consejos.
CREATE INDEX IF NOT EXISTS idx_unit_tips_org_feed
  ON apartcba.unit_tips(organization_id, pinned_at DESC NULLS LAST, created_at DESC)
  WHERE deleted_at IS NULL;

-- Lookup de "mis consejos" (UI: editar/borrar).
CREATE INDEX IF NOT EXISTS idx_unit_tips_author
  ON apartcba.unit_tips(author_id, created_at DESC)
  WHERE deleted_at IS NULL;


-- ─── 2) unit_tip_reactions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.unit_tip_reactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id          uuid NOT NULL REFERENCES apartcba.unit_tips(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_tip_reactions_reaction_valid CHECK (
    reaction IN ('helpful','important','love')
  ),
  CONSTRAINT unit_tip_reactions_unique UNIQUE (tip_id, user_id, reaction)
);

-- Agregación rápida de counts por tip (group by tip_id, reaction).
CREATE INDEX IF NOT EXISTS idx_unit_tip_reactions_tip
  ON apartcba.unit_tip_reactions(tip_id, reaction);

-- "¿Reaccionó este usuario?" para hidratar my_reactions en el feed.
CREATE INDEX IF NOT EXISTS idx_unit_tip_reactions_user
  ON apartcba.unit_tip_reactions(user_id, tip_id);


-- ─── 3) Trigger updated_at (reusa fn ya existente) ────────────────────────
DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.unit_tips;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON apartcba.unit_tips
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at();


-- ─── 4) RLS — patrón cleaning_events (apertura, scoping en server actions)
ALTER TABLE apartcba.unit_tips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_tips_select ON apartcba.unit_tips;
CREATE POLICY unit_tips_select ON apartcba.unit_tips FOR SELECT USING (true);
DROP POLICY IF EXISTS unit_tips_insert ON apartcba.unit_tips;
CREATE POLICY unit_tips_insert ON apartcba.unit_tips FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS unit_tips_update ON apartcba.unit_tips;
CREATE POLICY unit_tips_update ON apartcba.unit_tips FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS unit_tips_delete ON apartcba.unit_tips;
CREATE POLICY unit_tips_delete ON apartcba.unit_tips FOR DELETE USING (true);

ALTER TABLE apartcba.unit_tip_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unit_tip_reactions_select ON apartcba.unit_tip_reactions;
CREATE POLICY unit_tip_reactions_select ON apartcba.unit_tip_reactions FOR SELECT USING (true);
DROP POLICY IF EXISTS unit_tip_reactions_insert ON apartcba.unit_tip_reactions;
CREATE POLICY unit_tip_reactions_insert ON apartcba.unit_tip_reactions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS unit_tip_reactions_delete ON apartcba.unit_tip_reactions;
CREATE POLICY unit_tip_reactions_delete ON apartcba.unit_tip_reactions FOR DELETE USING (true);


-- ─── 5) REPLICA IDENTITY FULL + supabase_realtime publication ─────────────
-- Sin REPLICA IDENTITY FULL, los eventos DELETE solo traen el PK en `old` y el
-- filter `organization_id=eq.X` los descarta silenciosamente. Sin la
-- publicación, Supabase Realtime ni siquiera ve los cambios.
ALTER TABLE apartcba.unit_tips REPLICA IDENTITY FULL;
ALTER TABLE apartcba.unit_tip_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'apartcba' AND tablename = 'unit_tips'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.unit_tips';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'apartcba' AND tablename = 'unit_tip_reactions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.unit_tip_reactions';
  END IF;
END $$;


-- ─── 6) Storage bucket `unit-tips` (fotos opcionales de los consejos) ─────
-- Público (CDN), 10 MB, JPEG/PNG/WebP. Path: {organization_id}/{tip_id}/{filename}.
-- HEIC se convierte client-side a JPEG en el browser para evitar el bug histórico
-- de display/upload (ver memoria storage-buckets-and-heic).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unit-tips',
  'unit-tips',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ─── 7) RLS de storage.objects para `unit-tips` ──────────────────────────
-- Read: público (la URL se sirve directo desde el CDN de Supabase).
-- Write/Update/Delete: cualquier miembro activo de la org dueña del path.
-- (Mismo patrón de org-logos: match por primer foldername.)

DROP POLICY IF EXISTS "unit_tips_public_read" ON storage.objects;
CREATE POLICY "unit_tips_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'unit-tips');

DROP POLICY IF EXISTS "unit_tips_member_write" ON storage.objects;
CREATE POLICY "unit_tips_member_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'unit-tips'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "unit_tips_member_update" ON storage.objects;
CREATE POLICY "unit_tips_member_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'unit-tips'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );

DROP POLICY IF EXISTS "unit_tips_member_delete" ON storage.objects;
CREATE POLICY "unit_tips_member_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'unit-tips'
    AND EXISTS (
      SELECT 1 FROM apartcba.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = (storage.foldername(name))[1]
        AND om.active = true
    )
  );
