-- ════════════════════════════════════════════════════════════════════════════
-- APART CBA — Mensajería (WhatsApp + Instagram vía Meta Cloud API)
--
-- Tablas:
--   messaging_channels       — credenciales de cada canal Meta conectado
--   messaging_tags           — etiquetas para clasificar conversaciones
--   messaging_contacts       — contactos externos (phone/IG ID), opcionalmente
--                              vinculados a un guest
--   messaging_conversations  — hilo único contacto × canal
--   messaging_messages       — mensajes individuales (inbound y outbound)
--   messaging_templates      — mensajes rápidos con shortcut "/"
--   messaging_workflows      — automatizaciones (welcome, post-checkin, …)
--   messaging_broadcasts     — campañas masivas
--   messaging_alerts         — alertas operativas (respuesta pendiente, SLA, …)
--
-- Idempotente: usa IF NOT EXISTS y DROP IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── Canales conectados ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('whatsapp','instagram')),
  display_name text,
  -- Credenciales Meta. Se guardan en columnas explícitas (no en jsonb cifrado)
  -- porque el server actions ya corre detrás de service_role + scope por org.
  access_token text,                 -- Meta Graph API access token (long-lived)
  app_id text,                       -- App ID de Meta Developer
  app_secret text,                   -- usado para verificar firmas X-Hub-Signature-256
  business_account_id text,          -- WABA ID (WhatsApp) / Page ID (Instagram)
  phone_number_id text,              -- WhatsApp Business phone_number_id
  instagram_account_id text,         -- IG Business Account ID
  webhook_verify_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  graph_api_version text NOT NULL DEFAULT 'v21.0',
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected','disconnected','error')),
  status_detail text,
  last_verified_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel_type)
);

CREATE INDEX IF NOT EXISTS idx_messaging_channels_org
  ON apartcba.messaging_channels(organization_id) WHERE active;

-- ─── Etiquetas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#10b981',
  description text,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, label)
);

CREATE INDEX IF NOT EXISTS idx_messaging_tags_org
  ON apartcba.messaging_tags(organization_id, sort_order);

-- ─── Contactos externos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('whatsapp','instagram')),
  -- external_id: número E.164 sin "+" para WA, IGSID para Instagram
  external_id text NOT NULL,
  display_name text,
  profile_pic_url text,
  guest_id uuid REFERENCES apartcba.guests(id) ON DELETE SET NULL,
  notes text,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_contacts_org
  ON apartcba.messaging_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_messaging_contacts_guest
  ON apartcba.messaging_contacts(guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messaging_contacts_search
  ON apartcba.messaging_contacts
  USING gin ((coalesce(display_name,'') || ' ' || coalesce(external_id,'')) gin_trgm_ops);

-- ─── Conversaciones ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.messaging_channels(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES apartcba.messaging_contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','snoozed','closed','archived')),
  assigned_to uuid REFERENCES auth.users(id),
  tag_ids uuid[] NOT NULL DEFAULT '{}',
  related_booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  related_unit_id uuid REFERENCES apartcba.units(id) ON DELETE SET NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text CHECK (last_message_direction IN ('inbound','outbound')),
  snoozed_until timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_conv_org_lastmsg
  ON apartcba.messaging_conversations(organization_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_messaging_conv_status
  ON apartcba.messaging_conversations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_messaging_conv_assigned
  ON apartcba.messaging_conversations(assigned_to)
  WHERE status NOT IN ('closed','archived');
CREATE INDEX IF NOT EXISTS idx_messaging_conv_unread
  ON apartcba.messaging_conversations(organization_id, unread_count DESC)
  WHERE unread_count > 0;

-- ─── Mensajes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES apartcba.messaging_conversations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.messaging_channels(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  external_message_id text,             -- WAMID / IG message id
  content_type text NOT NULL DEFAULT 'text'
    CHECK (content_type IN (
      'text','image','audio','video','document','sticker','location','contacts','template','reaction','system'
    )),
  text text,
  media_url text,
  media_mime_type text,
  media_caption text,
  media_filename text,
  reply_to_message_id uuid REFERENCES apartcba.messaging_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('queued','sent','delivered','read','failed')),
  error_message text,
  sender_user_id uuid REFERENCES auth.users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_msg_conv
  ON apartcba.messaging_messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messaging_msg_org_date
  ON apartcba.messaging_messages(organization_id, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messaging_msg_external
  ON apartcba.messaging_messages(channel_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- ─── Mensajes rápidos / templates internos ──────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  shortcut text NOT NULL,                  -- ej. "/info", "/checkin"
  title text NOT NULL,
  body text NOT NULL,
  category text,                            -- pre-arrival | during-stay | post-stay | service
  attachments jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_messaging_templates_org
  ON apartcba.messaging_templates(organization_id) WHERE active;

-- ─── Workflows / automatizaciones ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger text NOT NULL CHECK (trigger IN (
    'booking_confirmed',
    'pre_check_in',
    'on_check_in',
    'during_stay',
    'pre_check_out',
    'on_check_out',
    'post_stay_review',
    'inbound_first_message'
  )),
  delay_minutes integer NOT NULL DEFAULT 0,
  channel_type text NOT NULL CHECK (channel_type IN ('whatsapp','instagram')),
  message_body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  filters jsonb NOT NULL DEFAULT '{}',
  last_run_at timestamptz,
  runs_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_workflows_org_trigger
  ON apartcba.messaging_workflows(organization_id, trigger) WHERE active;

-- ─── Difusiones ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel_id uuid NOT NULL REFERENCES apartcba.messaging_channels(id) ON DELETE RESTRICT,
  audience text NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all','active_guests','past_guests','upcoming_arrivals','custom_tag')),
  audience_filter jsonb NOT NULL DEFAULT '{}',
  message_body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_broadcasts_org
  ON apartcba.messaging_broadcasts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messaging_broadcasts_status
  ON apartcba.messaging_broadcasts(organization_id, status);

-- ─── Alertas operativas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.messaging_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES apartcba.messaging_conversations(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN (
    'unanswered','vip','negative_sentiment','sla_breach','workflow_failure','channel_error'
  )),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','urgent')),
  title text NOT NULL,
  body text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_alerts_open
  ON apartcba.messaging_alerts(organization_id, created_at DESC) WHERE resolved_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

-- updated_at automático en las tablas con esa columna
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'messaging_channels','messaging_contacts','messaging_conversations',
    'messaging_templates','messaging_workflows','messaging_broadcasts'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON apartcba.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON apartcba.%I FOR EACH ROW EXECUTE FUNCTION apartcba.tg_set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- Cuando se inserta un mensaje, denormalizar en la conversación.
CREATE OR REPLACE FUNCTION apartcba.tg_messaging_msg_after_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = apartcba, public
AS $$
DECLARE
  preview text;
BEGIN
  preview := COALESCE(
    NULLIF(NEW.text, ''),
    CASE NEW.content_type
      WHEN 'image' THEN '🖼️ Imagen'
      WHEN 'audio' THEN '🎙️ Audio'
      WHEN 'video' THEN '🎬 Video'
      WHEN 'document' THEN '📄 Documento'
      WHEN 'sticker' THEN '🌟 Sticker'
      WHEN 'location' THEN '📍 Ubicación'
      WHEN 'contacts' THEN '👤 Contacto'
      WHEN 'template' THEN '📋 Plantilla'
      ELSE NEW.content_type
    END
  );

  UPDATE apartcba.messaging_conversations c
  SET
    last_message_at = NEW.sent_at,
    last_message_preview = LEFT(preview, 240),
    last_message_direction = NEW.direction,
    unread_count = CASE
      WHEN NEW.direction = 'inbound' THEN c.unread_count + 1
      ELSE c.unread_count
    END,
    -- Reabre la conversación si estaba cerrada y entra mensaje del cliente
    status = CASE
      WHEN NEW.direction = 'inbound' AND c.status IN ('closed','snoozed','archived') THEN 'open'
      ELSE c.status
    END,
    snoozed_until = CASE
      WHEN NEW.direction = 'inbound' AND c.status = 'snoozed' THEN NULL
      ELSE c.snoozed_until
    END,
    updated_at = now()
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_messaging_msg_after_insert ON apartcba.messaging_messages;
CREATE TRIGGER trg_messaging_msg_after_insert
  AFTER INSERT ON apartcba.messaging_messages
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_messaging_msg_after_insert();

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'messaging_channels','messaging_tags','messaging_contacts',
    'messaging_conversations','messaging_messages','messaging_templates',
    'messaging_workflows','messaging_broadcasts','messaging_alerts'
  ]) LOOP
    EXECUTE format('ALTER TABLE apartcba.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS members_all ON apartcba.%I', t);
    EXECUTE format(
      $POL$ CREATE POLICY members_all ON apartcba.%I FOR ALL
            USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
            WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin()) $POL$,
      t
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ════════════════════════════════════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA apartcba TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime (para live-update del inbox)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.messaging_messages;
      EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.messaging_conversations;
      EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — etiquetas y mensajes rápidos por defecto (idempotente)
-- ════════════════════════════════════════════════════════════════════════════

-- Las orgs reciben defaults la primera vez que entran a la sección de
-- mensajería (server action seedDefaults). El SQL no ejecuta INSERTs
-- por-org porque no conoce las orgs existentes — esto se hace desde TS.
