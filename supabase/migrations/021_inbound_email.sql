-- Token de inbound email por org
ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS inbound_email_token text UNIQUE;

-- Generar tokens para orgs existentes
UPDATE apartcba.organizations
SET inbound_email_token = encode(gen_random_bytes(16), 'hex')
WHERE inbound_email_token IS NULL;

ALTER TABLE apartcba.organizations
  ALTER COLUMN inbound_email_token SET NOT NULL,
  ALTER COLUMN inbound_email_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

-- Log de emails entrantes
CREATE TABLE apartcba.inbound_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  resend_message_id text UNIQUE,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  received_at timestamptz NOT NULL DEFAULT now(),
  parser_used text,
  event_type text,
  status text NOT NULL CHECK (status IN ('parsed','unmatched','error','duplicate')),
  booking_id uuid REFERENCES apartcba.bookings(id) ON DELETE SET NULL,
  error_message text,
  raw_size_bytes integer
);

CREATE INDEX idx_inbound_log_org ON apartcba.inbound_email_log(organization_id, received_at DESC);
