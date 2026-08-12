-- 049_trial_orgs.sql
-- Alta self-serve desde la landing de rentOS (/rentos → /rentos/probar).
--
-- Una "cuenta de prueba" es una organización REAL creada por un visitante
-- anónimo, sembrada con datos de ejemplo para que el panel no arranque vacío.
-- No es un tenant especial: usa las mismas tablas, las mismas acciones y el
-- mismo aislamiento por organization_id. Lo único que la distingue son estas
-- tres columnas, que sirven para:
--
--   is_trial              → mostrar el banner "Datos de ejemplo" en /dashboard
--                           y poder excluirlas de métricas de negocio.
--   demo_data_seeded_at   → si es NOT NULL, la org todavía tiene los datos de
--                           ejemplo. Se pone en NULL al vaciarlos (purgeDemoData),
--                           que es como una cuenta de prueba se convierte en
--                           cuenta real sin migrar nada.
--   trial_expires_at      → fecha de referencia para una futura purga de cuentas
--                           abandonadas. Hoy ningún código la aplica.
--
-- INVARIANTES del sembrado (se cumplen en src/lib/demo/seed-data.ts, no acá):
-- las orgs de prueba NO crean channel_links, ical_feeds ni crm_channels, y sus
-- units quedan con slug NULL y marketplace_published = false. Si no, los crons
-- (channel-dispatch corre cada minuto) y el buscador cross-org del marketplace
-- las levantarían como si fueran datos productivos.

alter table apartcba.organizations
  add column if not exists is_trial boolean not null default false,
  add column if not exists demo_data_seeded_at timestamptz,
  add column if not exists trial_expires_at timestamptz;

-- Índice parcial: las cuentas de prueba son la minoría y siempre se consultan
-- por is_trial = true (banner, métricas, futura purga).
create index if not exists idx_organizations_is_trial
  on apartcba.organizations (trial_expires_at)
  where is_trial;

comment on column apartcba.organizations.is_trial is
  'La org nació de un alta self-serve desde la landing, no de una carga manual del superadmin.';
comment on column apartcba.organizations.demo_data_seeded_at is
  'NOT NULL mientras la org conserve los datos de ejemplo. NULL una vez vaciados.';
comment on column apartcba.organizations.trial_expires_at is
  'Referencia para purgar cuentas de prueba abandonadas. Todavía sin job asociado.';
