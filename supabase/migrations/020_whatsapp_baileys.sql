-- ════════════════════════════════════════════════════════════════════════════
-- Migration 020 — Canal WhatsApp vía Baileys (WhatsApp Web, no-oficial)
-- ════════════════════════════════════════════════════════════════════════════
-- Se suma un proveedor `baileys` a la abstracción de canales ya existente
-- (crm_channels). Convive con `meta_cloud` / `meta_instagram`: cada organización
-- elige su proveedor. Como TODO el envío sale por el embudo único
-- sendMessageNow() → crm_message_outbox → processOutbox() → getProviderForChannel()
-- y TODO lo entrante entra por el webhook → processInboundMessage() →
-- dispatchEvent("message.received") → workflows, agregar un canal `baileys`
-- hace que mensajes manuales, automatizaciones, workflows y difusiones salgan
-- por ahí sin reescribir el pipeline.
--
-- Cambios aditivos e idempotentes:
--   • crm_channels.provider: CHECK extendido a ('meta_cloud','meta_instagram','baileys').
--   • crm_channels: phone_number / phone_number_id / waba_id pasan a NULLABLE
--     (Baileys no tiene IDs de Meta; el número se conoce recién al vincularse).
--   • uniq_crm_channels_pnid → índice único PARCIAL (WHERE phone_number_id
--     IS NOT NULL) para permitir múltiples canales Baileys sin phone_number_id.
--   • crm_baileys_sessions → estado de conexión por canal (status, QR, pairing
--     code, teléfono, último error). Realtime ON para que la UI de "Conectar
--     WhatsApp" se actualice sola mientras se escanea el QR.
--   • crm_baileys_auth_state → keystore Baileys durable (sobrevive redeploys
--     del gateway). Blob cifrado AES-256-GCM por la app. RLS BLOQUEADA: sólo
--     service_role (ni authenticated ni anon pueden leer la sesión de WA).
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = apartcba, public;

-- ─── crm_channels: habilitar proveedor baileys + relajar campos Meta ────────
ALTER TABLE apartcba.crm_channels
  DROP CONSTRAINT IF EXISTS crm_channels_provider_check;
ALTER TABLE apartcba.crm_channels
  ADD CONSTRAINT crm_channels_provider_check
  CHECK (provider IN ('meta_cloud', 'meta_instagram', 'baileys'));

ALTER TABLE apartcba.crm_channels ALTER COLUMN phone_number     DROP NOT NULL;
ALTER TABLE apartcba.crm_channels ALTER COLUMN phone_number_id  DROP NOT NULL;
ALTER TABLE apartcba.crm_channels ALTER COLUMN waba_id          DROP NOT NULL;

COMMENT ON COLUMN apartcba.crm_channels.phone_number_id IS
  'Meta phone_number_id. NULL para provider=baileys (no aplica). La app valida presencia para meta_cloud.';

-- El índice único global por phone_number_id sólo tiene sentido para canales
-- Meta. Con Baileys el valor es NULL → índice parcial para que varios canales
-- baileys (NULL) no colisionen y el routing Meta siga siendo único.
DROP INDEX IF EXISTS apartcba.uniq_crm_channels_pnid;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_channels_pnid
  ON apartcba.crm_channels(phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- ─── crm_baileys_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apartcba.crm_baileys_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL UNIQUE REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN (
      'disconnected',  -- nunca vinculado / desvinculado manualmente
      'connecting',    -- gateway abriendo socket
      'qr',            -- esperando escaneo de QR
      'pairing',       -- esperando ingreso de pairing code en el teléfono
      'connected',     -- vinculado y operativo
      'logged_out',    -- el teléfono cerró sesión → re-vincular
      'conflict',      -- otra sesión tomó el socket (WhatsApp Web abierto en otro lado)
      'error',         -- error transitorio (reconectando)
      'banned'         -- número bloqueado por WhatsApp
    )),
  phone text,                       -- E.164 sin "+", se conoce al vincular
  device_name text,                 -- nombre del dispositivo reportado por WA
  qr text,                          -- string crudo del QR (la UI lo renderiza). Transitorio.
  qr_expires_at timestamptz,
  pairing_code text,                -- código de 8 chars para vinculación por número. Transitorio.
  last_error text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_seen_at timestamptz,         -- heartbeat del gateway
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_baileys_sessions_org
  ON apartcba.crm_baileys_sessions(organization_id);

COMMENT ON TABLE apartcba.crm_baileys_sessions IS
  'Estado de conexión del canal WhatsApp-Baileys por org/canal. qr y pairing_code son transitorios. Realtime ON para la UI de vinculación.';

-- ─── crm_baileys_auth_state ────────────────────────────────────────────────
-- Keystore Baileys (creds + app-state keys). Lo escribe SÓLO el gateway con
-- service_role. `data` es un blob cifrado AES-256-GCM (iv:tag:ct base64) — la
-- clave vive en el env del gateway (BAILEYS_STATE_ENC_KEY), nunca en la DB.
CREATE TABLE IF NOT EXISTS apartcba.crm_baileys_auth_state (
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES apartcba.crm_channels(id) ON DELETE CASCADE,
  key text NOT NULL,                -- 'creds' | 'app-state-sync-key-<id>' | 'pre-key-<id>' | ...
  data text NOT NULL,               -- blob cifrado AES-256-GCM
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, key)
);

CREATE INDEX IF NOT EXISTS idx_crm_baileys_auth_state_org
  ON apartcba.crm_baileys_auth_state(organization_id);

COMMENT ON TABLE apartcba.crm_baileys_auth_state IS
  'Keystore Baileys durable y cifrado. RLS sin policy → sólo service_role (el gateway). authenticated/anon NUNCA acceden a la sesión de WhatsApp.';

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- crm_baileys_sessions: patrón uniforme members_all (igual que el resto del CRM).
ALTER TABLE apartcba.crm_baileys_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.crm_baileys_sessions;
CREATE POLICY members_all ON apartcba.crm_baileys_sessions FOR ALL
  USING (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin())
  WITH CHECK (organization_id = ANY(apartcba.current_user_orgs()) OR apartcba.is_superadmin());
GRANT ALL ON apartcba.crm_baileys_sessions TO authenticated, service_role;

-- crm_baileys_auth_state: RLS habilitada SIN policy → nadie con anon/authenticated
-- puede leer/escribir. service_role bypassa RLS (es el único que lo toca).
ALTER TABLE apartcba.crm_baileys_auth_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS members_all ON apartcba.crm_baileys_auth_state;
REVOKE ALL ON apartcba.crm_baileys_auth_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON apartcba.crm_baileys_auth_state TO service_role;

-- ─── updated_at trigger (reusa la función uniforme del CRM) ─────────────────
DROP TRIGGER IF EXISTS trg_crm_touch_updated_at ON apartcba.crm_baileys_sessions;
CREATE TRIGGER trg_crm_touch_updated_at BEFORE UPDATE ON apartcba.crm_baileys_sessions
  FOR EACH ROW EXECUTE FUNCTION apartcba.tg_crm_touch_updated_at();

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- La UI de "Conectar WhatsApp" se suscribe a crm_baileys_sessions filtrando por
-- organization_id. REPLICA IDENTITY FULL para que el filtro server-side aplique
-- también en UPDATE/DELETE (idéntico a migration 011). El keystore NO va a
-- realtime.
ALTER TABLE apartcba.crm_baileys_sessions REPLICA IDENTITY FULL;
DO $rt$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE apartcba.crm_baileys_sessions';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $rt$;
