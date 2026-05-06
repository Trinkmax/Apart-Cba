-- ════════════════════════════════════════════════════════════════════════════
-- 010 — CRM (Inbox + Workflows + Rápidos + Templates)
--
-- Construye un CRM completo dentro del schema apartcba:
--   • Inbox unificada (canal MetaCloud WhatsApp inicialmente, futuro IG/Email)
--   • Conversaciones con auto-link a guests/owners/bookings, tags, asignación,
--     ciclo abierta → cerrada (auto 24h) → reabierta on inbound, archivada
--   • Mensajes multimedia con outbox + idempotencia + status de entrega
--   • Workflows visuales estilo n8n: graph en jsonb, runs persistidos, step logs,
--     resumability (wait_time / wait_reply), nodos PMS-aware extensibles
--   • Templates WhatsApp Business con submit a Meta + polling
--   • Rápidos (snippets / quick replies)
--   • IA por organización (claude / gpt / vercel-gateway) con quotas y tracking
--   • Storage bucket crm-media para attachments
--   • RLS por current_user_orgs() + service_role bypass
--   • Realtime en messages, conversations, contacts, workflow_runs
--   • pg_cron jobs (auto-close 24h, dispatcher subdaily a /api/cron/from-pg)
--
-- Encriptación: usamos supabase_vault (AES-256-GCM).
-- Las tablas guardan secret_id; server actions resuelven via RPC crm_get_secret.
--
-- pg_cron + pg_net jobs: definidos al final. Ejecutar como service_role.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. Extensiones ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
-- pg_trgm, btree_gist, pgcrypto, supabase_vault ya instalados.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. crm_channels — un canal de mensajería por org/proveedor
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('meta_cloud')),
  display_name text NOT NULL,
  phone_number text NOT NULL,                 -- E.164 +5493515551234
  phone_number_id text NOT NULL,              -- Meta phone_number_id
  waba_id text NOT NULL,                      -- Meta WhatsApp Business Account id
  app_id text,
  access_token_secret_id uuid,                -- vault.secrets.id (resolver via RPC)
  app_secret_secret_id uuid,
  webhook_verify_token_secret_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','disabled','error')),
  last_error text,
  last_health_check_at timestamptz,
  webhook_subscribed_fields text[] DEFAULT ARRAY['messages','message_template_status_update'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lookup global por phone_number_id (webhook → org). Único globalmente.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_channels_pnid
  ON apartcba.crm_channels(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_crm_channels_org
  ON apartcba.crm_channels(organization_id);

COMMENT ON TABLE apartcba.crm_channels IS
  'Canales de mensajería por organización. phone_number_id es UNIQUE globalmente para routing de webhooks.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. crm_contacts — un contacto por (org, telefono)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  phone text NOT NULL,                                -- E.164 normalizado
  name text,                                          -- nombre WA o resolved
  avatar_url text,
  guest_id uuid REFERENCES apartcba.guests(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES apartcba.owners(id) ON DELETE SET NULL,
  contact_kind text NOT NULL DEFAULT 'lead'
    CHECK (contact_kind IN ('lead','guest','owner','staff','other')),
  preferred_locale text DEFAULT 'es-AR',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,        -- ai_tags, custom fields
  blocked boolean NOT NULL DEFAULT false,
  last_message_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_org_last
  ON apartcba.crm_contacts(organization_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_guest
  ON apartcba.crm_contacts(guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_owner
  ON apartcba.crm_contacts(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_search
  ON apartcba.crm_contacts
  USING gin ((coalesce(name,'') || ' ' || phone) gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. crm_conversations — un thread por (contact + channel)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES apartcba.crm_contacts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','archived','snoozed')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_message_preview text,                                    -- 120 chars
  last_customer_message_at timestamptz,                         -- driver del 24h auto-close + sesión WA
  last_outbound_message_at timestamptz,
  closed_at timestamptz,
  closed_reason text,                                           -- 'auto_24h','manual','workflow'
  snoozed_until timestamptz,
  ai_summary text,                                              -- short context
  ai_summary_generated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contact_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_convs_org_status
  ON apartcba.crm_conversations(organization_id, status, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_crm_convs_assigned
  ON apartcba.crm_conversations(assigned_to, last_message_at DESC) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_convs_open_idle
  ON apartcba.crm_conversations(organization_id, last_customer_message_at)
  WHERE status = 'open';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. crm_messages — texto/multimedia/templates/interactive
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES apartcba.crm_conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES apartcba.crm_contacts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  type text NOT NULL CHECK (type IN (
    'text','image','audio','video','document','location','contacts','sticker',
    'template','interactive_buttons','interactive_list','reaction','system','unsupported'
  )),
  body text,
  media_storage_path text,                                    -- bucket crm-media
  media_url text,                                             -- signed/public cacheada
  media_mime text,
  media_size_bytes bigint,
  media_duration_ms integer,                                  -- audio/video
  media_filename text,                                        -- documents
  media_thumbnail_path text,
  transcription_text text,                                    -- audio→Whisper
  transcription_language text,
  payload jsonb,                                              -- raw provider event
  template_name text,
  template_variables jsonb,
  reply_to_message_id uuid REFERENCES apartcba.crm_messages(id) ON DELETE SET NULL,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_kind text CHECK (sender_kind IN ('human','workflow','ai','contact','system')),
  workflow_run_id uuid,                                        -- soft FK a crm_workflow_runs
  wa_message_id text,                                          -- Meta wam.id (idempotencia)
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','queued','sending','sent','delivered','read','failed','deleted')),
  status_updated_at timestamptz,
  error_code text,
  error_message text,
  starred boolean NOT NULL DEFAULT false,
  ai_classified_tags text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_messages_wa_id
  ON apartcba.crm_messages(channel_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_messages_conv_created
  ON apartcba.crm_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_org_created
  ON apartcba.crm_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_failed
  ON apartcba.crm_messages(organization_id, created_at)
  WHERE direction = 'out' AND status = 'failed';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. crm_tags + crm_conversation_tags
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  color text NOT NULL,                                          -- hex
  description text,
  is_system boolean NOT NULL DEFAULT false,
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS apartcba.crm_conversation_tags (
  conversation_id uuid NOT NULL REFERENCES apartcba.crm_conversations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES apartcba.crm_tags(id) ON DELETE CASCADE,
  added_via text NOT NULL DEFAULT 'manual'
    CHECK (added_via IN ('manual','ai','workflow','system')),
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_conv_tags_tag
  ON apartcba.crm_conversation_tags(tag_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. crm_quick_replies — snippets reutilizables
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  shortcut text NOT NULL,                                       -- 'saludo' (sin slash)
  title text NOT NULL,
  body text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',                       -- ['guest_name','unit_code']
  visible_to_roles text[] NOT NULL DEFAULT ARRAY['admin','recepcion'],
  usage_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_crm_qr_org
  ON apartcba.crm_quick_replies(organization_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. crm_workflows + runs + step_logs + schedules
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive','active','draft','archived')),
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('message_received','conversation_closed','pms_event','scheduled','manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  active_version integer,
  validation_errors jsonb,
  last_executed_at timestamptz,
  runs_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_wfs_org_active
  ON apartcba.crm_workflows(organization_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_crm_wfs_trigger
  ON apartcba.crm_workflows(organization_id, trigger_type) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS apartcba.crm_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES apartcba.crm_workflows(id) ON DELETE CASCADE,
  workflow_version integer NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','success','failed','cancelled','suspended')),
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation_id uuid REFERENCES apartcba.crm_conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES apartcba.crm_contacts(id) ON DELETE SET NULL,
  current_node_id text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps_executed smallint NOT NULL DEFAULT 0,
  resume_at timestamptz,
  resume_reason text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_wf_runs_wf
  ON apartcba.crm_workflow_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_wf_runs_resume
  ON apartcba.crm_workflow_runs(resume_at)
  WHERE status = 'suspended' AND resume_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_wf_runs_waiting_reply
  ON apartcba.crm_workflow_runs(conversation_id)
  WHERE status = 'suspended' AND resume_reason = 'wait_reply';
CREATE INDEX IF NOT EXISTS idx_crm_wf_runs_queued
  ON apartcba.crm_workflow_runs(organization_id, started_at)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS apartcba.crm_workflow_step_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES apartcba.crm_workflow_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed','skipped','pending')),
  input_snapshot jsonb,
  output_snapshot jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_wf_logs_run
  ON apartcba.crm_workflow_step_logs(run_id, created_at);

CREATE TABLE IF NOT EXISTS apartcba.crm_workflow_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES apartcba.crm_workflows(id) ON DELETE CASCADE,
  cron_expression text NOT NULL,                                -- '*/15 * * * *'
  timezone text NOT NULL DEFAULT 'America/Argentina/Cordoba',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_wf_sched_due
  ON apartcba.crm_workflow_schedules(next_run_at) WHERE active;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. crm_whatsapp_templates
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  name text NOT NULL,                                            -- snake_case slug Meta
  language text NOT NULL DEFAULT 'es_AR',
  category text NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  header_type text CHECK (header_type IN ('NONE','TEXT','IMAGE','VIDEO','DOCUMENT')),
  header_text text,
  header_media_url text,
  body text NOT NULL,
  body_example jsonb,
  footer text,
  buttons jsonb,
  variables_count smallint NOT NULL DEFAULT 0,
  meta_status text NOT NULL DEFAULT 'draft'
    CHECK (meta_status IN ('draft','pending','approved','rejected','paused','disabled')),
  meta_template_id text,
  meta_rejection_reason text,
  submitted_at timestamptz,
  approved_at timestamptz,
  last_polled_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_crm_tpl_org_status
  ON apartcba.crm_whatsapp_templates(organization_id, meta_status);

-- ════════════════════════════════════════════════════════════════════════════
-- 9. crm_ai_settings — 1 row por org
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_ai_settings (
  organization_id uuid PRIMARY KEY REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  chat_provider text NOT NULL DEFAULT 'anthropic'
    CHECK (chat_provider IN ('anthropic','openai','vercel_gateway')),
  chat_default_model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  chat_api_key_secret_id uuid,
  transcription_provider text NOT NULL DEFAULT 'openai',
  transcription_api_key_secret_id uuid,
  transcribe_audio_min_seconds smallint NOT NULL DEFAULT 3,
  transcribe_audio_max_seconds smallint NOT NULL DEFAULT 600,
  monthly_token_budget integer,
  tokens_used_this_month integer NOT NULL DEFAULT 0,
  cost_used_this_month_usd numeric(12,4) NOT NULL DEFAULT 0,
  budget_period_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  enabled_models text[] NOT NULL DEFAULT ARRAY[
    'claude-sonnet-4-6','claude-opus-4-7','gpt-5','gpt-5-mini'
  ],
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10. crm_message_outbox — cola de mensajes salientes con retry
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_message_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES apartcba.crm_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES apartcba.crm_messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_outbox_due
  ON apartcba.crm_message_outbox(next_attempt_at)
  WHERE status IN ('pending','failed');

-- ════════════════════════════════════════════════════════════════════════════
-- 11. crm_events — bus interno (audit + replay para workflows)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS apartcba.crm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation_id uuid REFERENCES apartcba.crm_conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES apartcba.crm_contacts(id) ON DELETE SET NULL,
  ref_type text,
  ref_id uuid,
  dispatched boolean NOT NULL DEFAULT false,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_events_undispatched
  ON apartcba.crm_events(organization_id, created_at)
  WHERE dispatched = false;
CREATE INDEX IF NOT EXISTS idx_crm_events_org_type_date
  ON apartcba.crm_events(organization_id, event_type, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 12. RLS — patrón uniforme members_all
-- ════════════════════════════════════════════════════════════════════════════
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_channels','crm_contacts','crm_conversations','crm_messages',
    'crm_tags','crm_quick_replies',
    'crm_workflows','crm_workflow_runs','crm_workflow_schedules',
    'crm_whatsapp_templates','crm_ai_settings',
    'crm_message_outbox','crm_events'
  ] LOOP
    EXECUTE format('ALTER TABLE apartcba.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS members_all ON apartcba.%I', t);
    EXECUTE format($p$CREATE POLICY members_all ON apartcba.%I FOR ALL
      USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
      WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())$p$, t);
    EXECUTE format('GRANT ALL ON apartcba.%I TO authenticated, service_role', t);
  END LOOP;
END $rls$;

-- crm_conversation_tags y crm_workflow_step_logs: RLS via parent (no organization_id directo)
ALTER TABLE apartcba.crm_conversation_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.crm_conversation_tags;
CREATE POLICY members_all ON apartcba.crm_conversation_tags FOR ALL
  USING (EXISTS (
    SELECT 1 FROM apartcba.crm_conversations c
    WHERE c.id = crm_conversation_tags.conversation_id
      AND (c.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM apartcba.crm_conversations c
    WHERE c.id = crm_conversation_tags.conversation_id
      AND (c.organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  ));
GRANT ALL ON apartcba.crm_conversation_tags TO authenticated, service_role;

ALTER TABLE apartcba.crm_workflow_step_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.crm_workflow_step_logs;
CREATE POLICY members_all ON apartcba.crm_workflow_step_logs FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());
GRANT ALL ON apartcba.crm_workflow_step_logs TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. Realtime publication
-- ════════════════════════════════════════════════════════════════════════════
DO $rt$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_messages','crm_conversations','crm_contacts','crm_workflow_runs'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $rt$;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. Triggers + Funciones
-- ════════════════════════════════════════════════════════════════════════════

-- 14.1 — touch updated_at uniforme
CREATE OR REPLACE FUNCTION apartcba.tg_crm_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DO $tt$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_channels','crm_contacts','crm_conversations',
    'crm_tags','crm_quick_replies',
    'crm_workflows','crm_whatsapp_templates','crm_ai_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_crm_touch_updated_at ON apartcba.%I', t);
    EXECUTE format($q$CREATE TRIGGER trg_crm_touch_updated_at BEFORE UPDATE ON apartcba.%I
                      FOR EACH ROW EXECUTE FUNCTION apartcba.tg_crm_touch_updated_at()$q$, t);
  END LOOP;
END $tt$;

-- 14.2 — touch conversation on message insert + auto-reopen + emit event
CREATE OR REPLACE FUNCTION apartcba.tg_crm_messages_touch_conv() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $fn$
BEGIN
  UPDATE apartcba.crm_conversations
     SET last_message_at = NEW.created_at,
         last_message_preview = LEFT(COALESCE(NEW.body, '['||NEW.type||']'), 120),
         last_customer_message_at = CASE WHEN NEW.direction='in' THEN NEW.created_at ELSE last_customer_message_at END,
         last_outbound_message_at = CASE WHEN NEW.direction='out' THEN NEW.created_at ELSE last_outbound_message_at END,
         unread_count = CASE WHEN NEW.direction='in' THEN unread_count + 1 ELSE unread_count END,
         status = CASE WHEN NEW.direction='in' AND status='closed' THEN 'open' ELSE status END,
         closed_reason = CASE WHEN NEW.direction='in' AND status='closed' THEN NULL ELSE closed_reason END,
         closed_at = CASE WHEN NEW.direction='in' AND status='closed' THEN NULL ELSE closed_at END,
         updated_at = now()
   WHERE id = NEW.conversation_id;

  UPDATE apartcba.crm_contacts
     SET last_message_at = NEW.created_at,
         updated_at = now()
   WHERE id = NEW.contact_id;

  IF NEW.direction = 'in' THEN
    INSERT INTO apartcba.crm_events(organization_id, event_type, conversation_id, contact_id, payload)
    VALUES (NEW.organization_id, 'message.received', NEW.conversation_id, NEW.contact_id,
            jsonb_build_object('message_id', NEW.id, 'type', NEW.type, 'wa_message_id', NEW.wa_message_id));
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_messages_touch ON apartcba.crm_messages;
CREATE TRIGGER trg_crm_messages_touch
  AFTER INSERT ON apartcba.crm_messages
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_crm_messages_touch_conv();

-- 14.3 — auto-close conversaciones idle 24h
CREATE OR REPLACE FUNCTION apartcba.crm_close_idle_conversations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $fn$
DECLARE
  closed_rows record;
  n integer := 0;
BEGIN
  FOR closed_rows IN
    UPDATE apartcba.crm_conversations
       SET status = 'closed',
           closed_at = now(),
           closed_reason = 'auto_24h',
           updated_at = now()
     WHERE status = 'open'
       AND last_customer_message_at IS NOT NULL
       AND last_customer_message_at < now() - interval '24 hours'
    RETURNING id, organization_id, contact_id
  LOOP
    INSERT INTO apartcba.crm_events(organization_id, event_type, conversation_id, contact_id, payload)
    VALUES (closed_rows.organization_id, 'conversation.closed',
            closed_rows.id, closed_rows.contact_id,
            jsonb_build_object('reason','auto_24h'));
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION apartcba.crm_close_idle_conversations() TO service_role;

-- 14.4 — Resolver Vault secret (sólo service_role)
CREATE OR REPLACE FUNCTION apartcba.crm_get_secret(p_secret_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public AS $fn$
DECLARE v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE id = p_secret_id;
  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION apartcba.crm_get_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.crm_get_secret(uuid) TO service_role;

-- 14.5 — Crear/rotar Vault secret (service_role only)
CREATE OR REPLACE FUNCTION apartcba.crm_vault_create_secret(p_name text, p_value text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public AS $fn$
DECLARE sid uuid;
BEGIN
  sid := vault.create_secret(p_value, p_name);
  RETURN sid;
END;
$fn$;

REVOKE ALL ON FUNCTION apartcba.crm_vault_create_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.crm_vault_create_secret(text, text) TO service_role;

CREATE OR REPLACE FUNCTION apartcba.crm_vault_update_secret(p_secret_id uuid, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vault, public AS $fn$
BEGIN
  PERFORM vault.update_secret(p_secret_id, p_value);
END;
$fn$;

REVOKE ALL ON FUNCTION apartcba.crm_vault_update_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apartcba.crm_vault_update_secret(uuid, text) TO service_role;

-- 14.6 — Selector de workflows que matchean un evento
CREATE OR REPLACE FUNCTION apartcba.crm_select_workflows_for_event(
  p_organization_id uuid, p_event_type text, p_payload jsonb
) RETURNS TABLE (workflow_id uuid, workflow_version integer, trigger_config jsonb)
LANGUAGE sql STABLE AS $fn$
  SELECT w.id, w.version, w.trigger_config
  FROM apartcba.crm_workflows w
  WHERE w.organization_id = p_organization_id
    AND w.status = 'active'
    AND (
      (p_event_type = 'message.received'    AND w.trigger_type = 'message_received')
      OR (p_event_type = 'conversation.closed' AND w.trigger_type = 'conversation_closed')
      OR (
        (p_event_type LIKE 'booking.%' OR p_event_type LIKE 'ticket.%' OR
         p_event_type LIKE 'cleaning.%' OR p_event_type LIKE 'concierge.%' OR
         p_event_type LIKE 'payment.%')
        AND w.trigger_type = 'pms_event'
        AND w.trigger_config->>'pms_event' = p_event_type
      )
    );
$fn$;

GRANT EXECUTE ON FUNCTION apartcba.crm_select_workflows_for_event(uuid, text, jsonb) TO service_role;

-- 14.7 — Resume reply waiters (al recibir mensaje nuevo)
CREATE OR REPLACE FUNCTION apartcba.crm_resume_reply_waiters(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $fn$
DECLARE n integer;
BEGIN
  UPDATE apartcba.crm_workflow_runs
     SET status = 'queued',
         resume_reason = NULL
   WHERE conversation_id = p_conversation_id
     AND status = 'suspended'
     AND resume_reason = 'wait_reply';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION apartcba.crm_resume_reply_waiters(uuid) TO service_role;

-- 14.8 — Reset mensual de quota AI
CREATE OR REPLACE FUNCTION apartcba.crm_reset_monthly_ai_quota() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $fn$
DECLARE n integer;
BEGIN
  UPDATE apartcba.crm_ai_settings
     SET tokens_used_this_month = 0,
         cost_used_this_month_usd = 0,
         budget_period_started_at = date_trunc('month', now()),
         updated_at = now()
   WHERE budget_period_started_at < date_trunc('month', now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION apartcba.crm_reset_monthly_ai_quota() TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. Storage bucket 'crm-media'
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crm-media', 'crm-media', false, 26214400, NULL)
ON CONFLICT (id) DO NOTHING;

-- Policies del bucket: solo service_role puede leer/escribir.
-- (NO se exponen URLs públicas; la app usa signedUrl con TTL.)
DROP POLICY IF EXISTS crm_media_service_only_read ON storage.objects;
DROP POLICY IF EXISTS crm_media_service_only_write ON storage.objects;
CREATE POLICY crm_media_service_only_read ON storage.objects FOR SELECT
  USING (bucket_id = 'crm-media' AND (auth.role() = 'service_role'));
CREATE POLICY crm_media_service_only_write ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'crm-media' AND (auth.role() = 'service_role'));

-- ════════════════════════════════════════════════════════════════════════════
-- 16. Seed: 12 system tags por organización (ejecutar para cada org existente)
-- ════════════════════════════════════════════════════════════════════════════
DO $seed$
DECLARE
  org record;
  tag_data jsonb := '[
    {"slug":"lead","name":"Lead","color":"#10b981","order":1},
    {"slug":"consulta-disponibilidad","name":"Consulta disponibilidad","color":"#3b82f6","order":2},
    {"slug":"reserva-pendiente","name":"Reserva pendiente","color":"#eab308","order":3},
    {"slug":"reserva-confirmada","name":"Reserva confirmada","color":"#a855f7","order":4},
    {"slug":"incidente","name":"Incidente","color":"#ef4444","order":5},
    {"slug":"reclamo","name":"Reclamo","color":"#f97316","order":6},
    {"slug":"huesped-vip","name":"Huésped VIP","color":"#fbbf24","order":7},
    {"slug":"propietario","name":"Propietario","color":"#92400e","order":8},
    {"slug":"checkout-positivo","name":"Checkout positivo","color":"#22c55e","order":9},
    {"slug":"checkout-negativo","name":"Checkout negativo","color":"#dc2626","order":10},
    {"slug":"spam","name":"Spam","color":"#71717a","order":11},
    {"slug":"staff-interno","name":"Staff interno","color":"#facc15","order":12}
  ]'::jsonb;
  tag jsonb;
BEGIN
  FOR org IN SELECT id FROM apartcba.organizations LOOP
    FOR tag IN SELECT * FROM jsonb_array_elements(tag_data) LOOP
      INSERT INTO apartcba.crm_tags
        (organization_id, slug, name, color, is_system, display_order)
      VALUES (
        org.id,
        tag->>'slug',
        tag->>'name',
        tag->>'color',
        true,
        (tag->>'order')::smallint
      )
      ON CONFLICT (organization_id, slug) DO NOTHING;
    END LOOP;
  END LOOP;
END $seed$;

-- Trigger para auto-seedear tags cuando se crea una organización nueva
CREATE OR REPLACE FUNCTION apartcba.tg_crm_seed_system_tags() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = apartcba, public AS $fn$
DECLARE
  tag_data jsonb := '[
    {"slug":"lead","name":"Lead","color":"#10b981","order":1},
    {"slug":"consulta-disponibilidad","name":"Consulta disponibilidad","color":"#3b82f6","order":2},
    {"slug":"reserva-pendiente","name":"Reserva pendiente","color":"#eab308","order":3},
    {"slug":"reserva-confirmada","name":"Reserva confirmada","color":"#a855f7","order":4},
    {"slug":"incidente","name":"Incidente","color":"#ef4444","order":5},
    {"slug":"reclamo","name":"Reclamo","color":"#f97316","order":6},
    {"slug":"huesped-vip","name":"Huésped VIP","color":"#fbbf24","order":7},
    {"slug":"propietario","name":"Propietario","color":"#92400e","order":8},
    {"slug":"checkout-positivo","name":"Checkout positivo","color":"#22c55e","order":9},
    {"slug":"checkout-negativo","name":"Checkout negativo","color":"#dc2626","order":10},
    {"slug":"spam","name":"Spam","color":"#71717a","order":11},
    {"slug":"staff-interno","name":"Staff interno","color":"#facc15","order":12}
  ]'::jsonb;
  tag jsonb;
BEGIN
  FOR tag IN SELECT * FROM jsonb_array_elements(tag_data) LOOP
    INSERT INTO apartcba.crm_tags
      (organization_id, slug, name, color, is_system, display_order)
    VALUES (NEW.id, tag->>'slug', tag->>'name', tag->>'color', true, (tag->>'order')::smallint)
    ON CONFLICT (organization_id, slug) DO NOTHING;
  END LOOP;

  -- Inicializar también ai_settings vacío (sin keys cargadas)
  INSERT INTO apartcba.crm_ai_settings (organization_id) VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_seed_on_org_create ON apartcba.organizations;
CREATE TRIGGER trg_crm_seed_on_org_create
  AFTER INSERT ON apartcba.organizations
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_crm_seed_system_tags();

-- Seedear ai_settings para orgs existentes
INSERT INTO apartcba.crm_ai_settings (organization_id)
SELECT id FROM apartcba.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 17. pg_cron jobs (requiere superuser; correr en SQL editor de Supabase si MCP falla)
--
-- NOTA: Los siguientes cron.schedule deben ejecutarse 1x desde Supabase Dashboard
-- → SQL Editor con role 'postgres'. El MCP apply_migration NO siempre tiene
-- privilegios para cron.* (depende de la cuenta).
--
-- Si fallan en este migration, copiarlos y ejecutarlos manualmente.
-- ════════════════════════════════════════════════════════════════════════════

-- Configuración de variables (correr 1x manualmente):
--   ALTER DATABASE postgres SET apartcba.app_url = 'https://app.apart-cba.com';
--   ALTER DATABASE postgres SET apartcba.pg_cron_secret = '<random>';

DO $crons$
BEGIN
  -- Auto-close conversaciones idle 24h cada 10 min
  PERFORM cron.unschedule('crm-close-idle');
EXCEPTION WHEN OTHERS THEN NULL;
END $crons$;

DO $crons2$
BEGIN
  PERFORM cron.schedule(
    'crm-close-idle',
    '*/10 * * * *',
    $job$ SELECT apartcba.crm_close_idle_conversations(); $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule crm-close-idle skipped (privileges?). Run manually.';
END $crons2$;

DO $crons3$
BEGIN
  PERFORM cron.unschedule('crm-dispatch-subdaily');
EXCEPTION WHEN OTHERS THEN NULL;
END $crons3$;

DO $crons4$
BEGIN
  PERFORM cron.schedule(
    'crm-dispatch-subdaily',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url := current_setting('apartcba.app_url', true) || '/api/cron/from-pg',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-pg-cron-secret', current_setting('apartcba.pg_cron_secret', true)
      ),
      body := jsonb_build_object('source','pg_cron','job','dispatch_subdaily'),
      timeout_milliseconds := 10000
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule crm-dispatch-subdaily skipped (privileges?). Run manually.';
END $crons4$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMENTARIOS para self-doc
-- ════════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE apartcba.crm_channels IS 'Canales de mensajería por org. phone_number_id UNIQUE global para routing webhook.';
COMMENT ON TABLE apartcba.crm_contacts IS 'Contactos del CRM. Auto-link a guests/owners por phone match.';
COMMENT ON TABLE apartcba.crm_conversations IS 'Threads de conversación. Auto-close 24h sin msg cliente, auto-reopen on inbound.';
COMMENT ON TABLE apartcba.crm_messages IS 'Mensajes inbound/outbound multimedia. Idempotencia por wa_message_id.';
COMMENT ON TABLE apartcba.crm_tags IS 'Tags de conversación. 12 system precargados por org.';
COMMENT ON TABLE apartcba.crm_workflows IS 'Workflows visuales (n8n-style). graph en jsonb formato @xyflow.';
COMMENT ON TABLE apartcba.crm_workflow_runs IS 'Ejecuciones individuales. Resumability via current_node_id + resume_at/reason.';
COMMENT ON TABLE apartcba.crm_message_outbox IS 'Cola outbound con retry exponencial. Procesada por /api/cron/from-pg cada 5min.';
COMMENT ON TABLE apartcba.crm_events IS 'Bus interno de eventos (audit + replay). Dispatcher lee aquí.';
COMMENT ON FUNCTION apartcba.crm_get_secret(uuid) IS 'Resolver Vault secret. Solo service_role.';
COMMENT ON FUNCTION apartcba.crm_close_idle_conversations() IS 'Cierra convs sin actividad cliente 24h+. Llamado por pg_cron cada 10min.';
