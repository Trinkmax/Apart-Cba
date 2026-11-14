-- 081 — Tex, el agente de Apart (14/11/2026).
--
-- Tex (la mascota de la familia textOS / sharp-app) es un agente con Claude
-- Haiku 5.5 que consulta, analiza y propone acciones sobre el sistema. Las
-- acciones que escriben NUNCA se ejecutan solas: Tex propone (tex_actions,
-- status 'pending'), la persona confirma con un botón y recién ahí corre la
-- server action real (src/lib/actions/tex.ts → confirmTexAction).
--
-- Se enciende por organización (`tex_enabled`, default apagado; lo prende el
-- superadmin) y tiene un presupuesto mensual en USD como freno de costos.
--
-- Aditiva: columnas con default y tablas nuevas. Se aplica antes del código.
--
-- Seguridad: las tres tablas se usan SÓLO desde el servidor con service role
-- (route /api/tex/chat y server actions). RLS encendido sin policies y sin
-- privilegios para anon/authenticated, como 067c: la capa de actions es el
-- borde (requireSession + getCurrentOrg + filtro de organization_id).
--
-- `tex_messages.content` guarda los bloques de Anthropic TAL CUAL (thinking
-- incluido): Haiku 5.5 valida que la historia que vuelve sea idéntica a la que
-- produjo cada bloque (preserved thinking). Append-only: nunca se editan.

alter table apartcba.organizations
  add column if not exists tex_enabled boolean not null default false,
  add column if not exists tex_monthly_budget_usd numeric(10, 2) not null default 25;

comment on column apartcba.organizations.tex_enabled is
  'Tex (agente IA) encendido para la organización. Lo prende el superadmin.';
comment on column apartcba.organizations.tex_monthly_budget_usd is
  'Tope de gasto mensual de Tex en USD (freno de costos; Haiku 5.5 ≈ 0.002-0.01 USD por mensaje).';

create table if not exists apartcba.tex_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists tex_conversations_user_idx
  on apartcba.tex_conversations (organization_id, user_id, last_message_at desc);

create table if not exists apartcba.tex_messages (
  id uuid primary key default gen_random_uuid(),
  -- Orden estable (dos mensajes del mismo turno pueden compartir created_at).
  seq bigint generated always as identity,
  conversation_id uuid not null references apartcba.tex_conversations(id) on delete cascade,
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Bloques de Anthropic tal cual (texto, tool_use, tool_result, thinking).
  content jsonb not null,
  -- Lo que la app dibuja (texto, tarjetas, propuestas) para reabrir la conversación.
  ui jsonb,
  -- tool_result y notas internas: van al modelo, no se muestran.
  hidden boolean not null default false,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists tex_messages_conversation_idx
  on apartcba.tex_messages (conversation_id, seq);
-- Presupuesto mensual por organización.
create index if not exists tex_messages_org_created_idx
  on apartcba.tex_messages (organization_id, created_at);
-- Topes por persona (mensajes escritos por ella).
create index if not exists tex_messages_user_typed_idx
  on apartcba.tex_messages (user_id, created_at)
  where role = 'user' and hidden = false;

create table if not exists apartcba.tex_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references apartcba.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references apartcba.tex_conversations(id) on delete cascade,
  tool text not null,
  -- Payload ya validado y resuelto a ids (se vuelve a validar antes de ejecutar).
  payload jsonb not null,
  -- El resumen que vio la persona en la tarjeta de confirmación.
  summary jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'executing', 'executed', 'failed', 'cancelled', 'expired')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists tex_actions_conversation_idx
  on apartcba.tex_actions (conversation_id, created_at);
create index if not exists tex_actions_org_idx
  on apartcba.tex_actions (organization_id, created_at);

alter table apartcba.tex_conversations enable row level security;
alter table apartcba.tex_messages enable row level security;
alter table apartcba.tex_actions enable row level security;

revoke all on table apartcba.tex_conversations from anon, authenticated;
revoke all on table apartcba.tex_messages from anon, authenticated;
revoke all on table apartcba.tex_actions from anon, authenticated;
grant all on table apartcba.tex_conversations to service_role;
grant all on table apartcba.tex_messages to service_role;
grant all on table apartcba.tex_actions to service_role;
