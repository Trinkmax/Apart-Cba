# Spec 2 — Perfil + Branding + Seguridad + Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar todo Spec 2 en 4 sub-PRs serializados — PR 2.A (cimientos + perfil personal), PR 2.B (configuración de organización), PR 2.C (seguridad de credenciales + 2FA), PR 2.D (popup multi-canal de reserva + mobile).

**Architecture:** Una migration única más 4 grupos de cambios mergeables independientemente. Cada PR es self-contained y deja el sistema en estado funcional. Server actions con el patrón estándar (`requireSession + getCurrentOrg + Zod + admin client`). Storage Supabase para imágenes (avatars + org-logos públicos). Resend para emails (split sistema vs huésped). Supabase Auth MFA nativo para TOTP. Recovery codes hasheados con bcrypt.

**Tech Stack:** Next.js 16 App Router · React 19 (Compiler) · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres `apartcba` schema + Auth + Storage + Realtime) · `resend` SDK · `qrcode` · `bcryptjs` · `otplib` opcional · `react-image-crop` opcional fuera de scope.

**Spec:** [`docs/superpowers/specs/2026-05-06-spec-2-perfil-branding-seguridad-resend.md`](../specs/2026-05-06-spec-2-perfil-branding-seguridad-resend.md).

**Convención de commits:** un commit por task. Mensajes en español. Prefijos: `feat:` para nueva funcionalidad, `feat(db):` para migrations, `fix:` para bugs, `chore(deps):` para deps. NO skipear hooks. Branch base: `main`.

**Verificación (sin test runner):** Cada task termina con `npx tsc --noEmit` filtrado contra los 2 errores pre-existentes de `src/app/api/webhooks/meta` (que son del commit `4bb3a50` y no son nuestros) + `npm run lint -- <archivos-tocados>`. Smoke manual al final de cada PR.

**PRs y orden:**

| PR | Tasks | Estado intermedio |
|---|---|---|
| Pre-flight | 0 | branch + baseline |
| PR 2.A | 1-13 | DB + storage + helpers email + perfil personal funcional |
| PR 2.B | 14-24 | configuración de organización completa |
| PR 2.C | 25-37 | seguridad: password, email, 2FA + login flow |
| PR 2.D | 38-42 | popup multi-canal + mobile perfil |
| Verificación final | 43-44 | full build + smoke completo |

Cada PR tiene su propia branch desde `main` (o todos en una branch única — ver Pre-flight).

---

## Pre-flight

- [ ] **Confirmar branch strategy con el usuario antes de tocar nada**

Run:
```bash
git status --short | head -10
git branch --show-current
git log --oneline -5
```

Decidir con el usuario:
- Opción A — **Una sola branch `feat/spec-2-perfil-branding`** — todos los PRs se commitean acá; el "merge" del PR 2.A a main pasa cuando todos los tasks 1-13 están aprobados; después se rebasea para empezar PR 2.B. Más simple.
- Opción B — **Una branch por sub-PR** (`feat/spec-2a-perfil-cimientos`, `feat/spec-2b-org-config`, etc.). Cada uno mergea solo. Más overhead de gestión.

Default si no hay respuesta: **Opción A**. Salir del pre-flight a la Task 1 con `git checkout -b feat/spec-2-perfil-branding`.

- [ ] **Verificar que el repo compila antes de tocar nada**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head -20 ; echo "(end tsc filtered)"
```
Expected: vacío (solo los 2 errores pre-existentes del webhook que están filtrados).

Si aparecen errores nuevos, frenar y consultar — hay regresiones previas que no son nuestras.

- [ ] **Verificar que el working tree no tiene los archivos del spec sin trackear**

Run:
```bash
git status --short docs/superpowers/specs/2026-05-06-spec-2-*.md docs/superpowers/plans/2026-05-06-spec-2-*.md
```
Expected: vacío (ya commiteados en `e8aa3c1`).

- [ ] **Inspeccionar el working tree para CRLF noise**

Run:
```bash
git diff --ignore-cr-at-eol --stat | tail -5
```
Expected: `2 files changed, ...` o similar — solo `.claude/settings.local.json` y `package-lock.json` (cambios reales). El resto del noise es CRLF artifact y NO toca nada de Spec 2.

Estrategia para los archivos de Spec 2: **antes de cada Edit a un archivo target**, hacer `git checkout HEAD -- <archivo>` para limpiar el CRLF artifact y trabajar sobre LF. Esto se hace en cada task que toca código.

---

# PR 2.A — Cimientos + Perfil personal

**Goal del PR**: dejar la migration + storage + helpers de Resend + componentes reusables + página de perfil personal funcional (datos, foto). Sin seguridad ni org config todavía.

**Files que va a tocar PR 2.A:**
- `supabase/migrations/010_profile_branding_security.sql` (create)
- `src/lib/types/database.ts` (modify — regenerar o agregar manual)
- `src/lib/email/system.ts` (create)
- `src/lib/email/guest.ts` (create)
- `src/lib/email/render.ts` (create)
- `src/components/brand/org-brand.tsx` (create)
- `src/components/dashboard/app-sidebar.tsx` (modify — reemplazar `<Logo>` por `<OrgBrand>`)
- `src/components/ui/image-uploader.tsx` (create)
- `src/lib/actions/profile.ts` (create)
- `src/app/dashboard/perfil/page.tsx` (create)
- `src/app/dashboard/perfil/profile-tabs.tsx` (create)
- `src/app/dashboard/perfil/profile-data-form.tsx` (create)
- `src/app/dashboard/perfil/avatar-uploader.tsx` (create)
- `src/components/dashboard/top-bar.tsx` (modify — wire "Mi perfil" link)
- `package.json` + `package-lock.json` (modify — add `resend`)
- `.env.local.example` + `README.md` (modify — env vars nuevas)

---

## Task 1 — Migration `010_profile_branding_security.sql`

**Goal:** Crear toda la estructura DB nueva en una migration idempotente.

**Files:**
- Create: `supabase/migrations/010_profile_branding_security.sql`

- [ ] **Step 1: Verificar el último número de migration**

Run:
```bash
ls supabase/migrations/ | sort | tail -5
```
Expected: el último número usado es `009_*.sql`. Confirmamos que `010_*` es el siguiente libre.

- [ ] **Step 2: Crear el archivo de migration con todo el SQL**

Crear `supabase/migrations/010_profile_branding_security.sql` con este contenido EXACTO:

```sql
-- Spec 2 — perfil + branding + seguridad de credenciales + Resend
-- Ver docs/superpowers/specs/2026-05-06-spec-2-perfil-branding-seguridad-resend.md
-- Idempotente: usar IF NOT EXISTS / DO blocks para repetibilidad.

SET search_path TO apartcba, public;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas en organizations (logo_url ya existe)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.organizations
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS email_domain text,
  ADD COLUMN IF NOT EXISTS email_sender_name text,
  ADD COLUMN IF NOT EXISTS email_sender_local_part text,
  ADD COLUMN IF NOT EXISTS email_domain_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_domain_dns_records jsonb;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Tabla user_2fa_recovery_codes
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.user_2fa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_active
  ON apartcba.user_2fa_recovery_codes(user_id) WHERE used_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Tabla email_change_requests
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_email text NOT NULL,
  new_email text NOT NULL,
  confirm_token_hash text NOT NULL,
  cancel_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  notified_old_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_change_user_open
  ON apartcba.email_change_requests(user_id)
  WHERE confirmed_at IS NULL AND cancelled_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 4. Tabla org_message_templates
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS apartcba.org_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject text,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_org_templates_lookup
  ON apartcba.org_message_templates(organization_id, event_type, channel);

-- ════════════════════════════════════════════════════════════════════════
-- 5. Enum + tabla security_audit_log
-- ════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE apartcba.security_event_type AS ENUM (
    'password_changed',
    'email_change_requested',
    'email_change_confirmed',
    'email_change_cancelled',
    '2fa_enabled',
    '2fa_disabled',
    '2fa_recovery_codes_regenerated',
    'login_with_recovery_code'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS apartcba.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type apartcba.security_event_type NOT NULL,
  metadata jsonb,
  ip text,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_user_time
  ON apartcba.security_audit_log(user_id, occurred_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- 6. Columna nueva en bookings
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;

-- ════════════════════════════════════════════════════════════════════════
-- 7. Seeding inicial de templates default para todas las orgs existentes
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
SELECT
  o.id,
  'booking_confirmed',
  'email',
  'Tu reserva en {{org.name}} está confirmada — {{booking.check_in_date}}',
  E'Hola {{guest.first_name}},\n\nTe confirmamos la reserva en {{unit.name}} ({{org.name}}).\n\nDetalles:\n- Check-in: {{booking.check_in_date}}\n- Check-out: {{booking.check_out_date}}\n- Noches: {{booking.nights}}\n- Huéspedes: {{booking.guests_count}}\n- Total: {{booking.total_amount}}\n\nCualquier consulta, escribinos a {{org.contact_email}} o llamanos al {{org.contact_phone}}.\n\n¡Te esperamos!\n{{org.name}}',
  true
FROM apartcba.organizations o
ON CONFLICT (organization_id, event_type, channel) DO NOTHING;

INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
SELECT
  o.id,
  'booking_confirmed',
  'whatsapp',
  NULL,
  'Hola {{guest.first_name}}! Te confirmamos la reserva en {{unit.name}} del {{booking.check_in_date}} al {{booking.check_out_date}} ({{booking.nights}} noches). Total: {{booking.total_amount}}. Consultas: {{org.contact_email}}.',
  true
FROM apartcba.organizations o
ON CONFLICT (organization_id, event_type, channel) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- 8. Trigger para seedear templates al crear org nueva
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apartcba.seed_default_templates_for_org()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO apartcba.org_message_templates (organization_id, event_type, channel, subject, body, is_default)
  VALUES
    (NEW.id, 'booking_confirmed', 'email',
     'Tu reserva en {{org.name}} está confirmada — {{booking.check_in_date}}',
     E'Hola {{guest.first_name}},\n\nTe confirmamos la reserva en {{unit.name}} ({{org.name}}).\n\nDetalles:\n- Check-in: {{booking.check_in_date}}\n- Check-out: {{booking.check_out_date}}\n- Noches: {{booking.nights}}\n- Huéspedes: {{booking.guests_count}}\n- Total: {{booking.total_amount}}\n\nCualquier consulta, escribinos a {{org.contact_email}} o llamanos al {{org.contact_phone}}.\n\n¡Te esperamos!\n{{org.name}}',
     true),
    (NEW.id, 'booking_confirmed', 'whatsapp', NULL,
     'Hola {{guest.first_name}}! Te confirmamos la reserva en {{unit.name}} del {{booking.check_in_date}} al {{booking.check_out_date}} ({{booking.nights}} noches). Total: {{booking.total_amount}}. Consultas: {{org.contact_email}}.',
     true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_templates_for_new_org ON apartcba.organizations;
CREATE TRIGGER trg_seed_templates_for_new_org
  AFTER INSERT ON apartcba.organizations
  FOR EACH ROW EXECUTE FUNCTION apartcba.seed_default_templates_for_org();

-- ════════════════════════════════════════════════════════════════════════
-- 9. Trigger para actualizar updated_at en org_message_templates
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apartcba.touch_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_template_updated_at ON apartcba.org_message_templates;
CREATE TRIGGER trg_touch_template_updated_at
  BEFORE UPDATE ON apartcba.org_message_templates
  FOR EACH ROW EXECUTE FUNCTION apartcba.touch_template_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- Final: comentarios sobre RLS de Storage (se aplica en Task 2)
-- ════════════════════════════════════════════════════════════════════════
-- Los buckets `avatars` y `org-logos` se crean en Task 2 vía Supabase
-- API/CLI (no son objetos SQL). Las RLS de storage también se aplican ahí.
```

- [ ] **Step 3: Aplicar la migration localmente vía Supabase MCP**

Run via MCP:
```
mcp__supabase-apartcba__apply_migration({
  name: "010_profile_branding_security",
  query: "<contenido del archivo>"
})
```

Si trabajamos contra remote directo, esto aplica a remote. Si tenemos local stack vía `supabase start`, aplicar primero ahí.

Expected: success.

- [ ] **Step 4: Verificar que las tablas y columnas existen**

Run via MCP:
```
mcp__supabase-apartcba__execute_sql({
  query: "SELECT column_name FROM information_schema.columns WHERE table_schema='apartcba' AND table_name='organizations' AND column_name IN ('description', 'address', 'contact_phone', 'contact_email', 'email_domain', 'email_sender_name', 'email_sender_local_part', 'email_domain_verified_at', 'email_domain_dns_records') ORDER BY column_name;"
})
```
Expected: 9 rows.

```
mcp__supabase-apartcba__execute_sql({
  query: "SELECT table_name FROM information_schema.tables WHERE table_schema='apartcba' AND table_name IN ('user_2fa_recovery_codes', 'email_change_requests', 'org_message_templates', 'security_audit_log') ORDER BY table_name;"
})
```
Expected: 4 rows.

```
mcp__supabase-apartcba__execute_sql({
  query: "SELECT count(*) FROM apartcba.org_message_templates WHERE is_default = true;"
})
```
Expected: count = 2 × N (donde N es número de orgs existentes).

- [ ] **Step 5: Commit**

Run:
```bash
git add supabase/migrations/010_profile_branding_security.sql
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(db): migration 010 — perfil + branding + seguridad + templates

Crea schema para Spec 2:
- Columnas nuevas en organizations (descripción, dirección, contacto, dominio Resend)
- user_2fa_recovery_codes (codes hasheados, single-use)
- email_change_requests (doble token: confirmar nuevo + cancelar desde viejo)
- org_message_templates (con seeding inicial + trigger AFTER INSERT)
- security_audit_log con enum tipado
- bookings.confirmation_sent_at

Idempotente (IF NOT EXISTS, DO blocks). Storage buckets se crean en Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Storage buckets + RLS

**Goal:** Crear buckets `avatars` y `org-logos` con políticas de RLS.

**Files:**
- Create: `supabase/migrations/011_storage_buckets_rls.sql` (alternativa a Supabase Dashboard manual)

- [ ] **Step 1: Crear migration de storage**

Crear `supabase/migrations/011_storage_buckets_rls.sql`:

```sql
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
```

- [ ] **Step 2: Aplicar migration vía MCP**

```
mcp__supabase-apartcba__apply_migration({
  name: "011_storage_buckets_rls",
  query: "<contenido>"
})
```

Si la migration falla porque `storage.buckets` no es accessible (Supabase managed schema), aplicar desde el Dashboard manualmente y documentar en el commit que es manual.

- [ ] **Step 3: Verificar buckets creados**

Run:
```
mcp__supabase-apartcba__execute_sql({
  query: "SELECT id, public, file_size_limit FROM storage.buckets WHERE id IN ('avatars', 'org-logos');"
})
```
Expected: 2 rows con `public=true`, sizes correctos.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_storage_buckets_rls.sql
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(db): storage buckets para avatars + org-logos con RLS

avatars (2MB, jpg/png/webp): lectura pública, write solo del dueño
(path = {user_id}/...).

org-logos (5MB, jpg/png/webp/svg): lectura pública, write solo de
miembros activos de la org (path = {org_id}/...).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Instalar `resend` + env vars + actualizar `.env.local.example`

**Goal:** Tener la dep instalada y las env vars documentadas antes de escribir el helper.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.env.local.example`
- Modify: `README.md`

- [ ] **Step 1: Instalar `resend` y `qrcode` + types**

```bash
npm install resend qrcode bcryptjs
npm install --save-dev @types/qrcode @types/bcryptjs
```

Expected: `package.json` actualizado con 3 deps + 2 dev deps. `package-lock.json` regenerado.

- [ ] **Step 2: Verificar tsc sigue compilando**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
```
Expected: vacío.

- [ ] **Step 3: Actualizar `.env.local.example`**

Si el archivo no existe, crearlo. Si existe, agregar al final:

```bash
# ──────────────────────────────────────────────────────────────────
# Spec 2 — Resend (emails sistema y huésped)
# ──────────────────────────────────────────────────────────────────
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
SYSTEM_EMAIL_FROM=auth@apartcba.com
SYSTEM_EMAIL_FROM_NAME="Apart Cba Seguridad"
APART_CBA_FALLBACK_FROM=noreply@apartcba.com
APART_CBA_FALLBACK_FROM_NAME="Apart Cba"
```

- [ ] **Step 4: Actualizar `README.md` sección "Variables de entorno"**

Buscar la sección de env en README y agregar las 5 vars nuevas con descripción breve.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.local.example README.md
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
chore(deps): agregar resend + qrcode + bcryptjs para Spec 2

resend: SDK para enviar mails (sistema + huésped).
qrcode: generar SVG del QR para enrollment 2FA.
bcryptjs: hashear recovery codes y tokens de email change.

Documenta las 5 env vars nuevas en .env.local.example y README.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `src/lib/email/render.ts` + `src/lib/email/system.ts` (helper sistema)

**Goal:** Helper para renderizar templates con `{{var}}` y wrapper de Resend para mails de sistema (auth flows).

**Files:**
- Create: `src/lib/email/render.ts`
- Create: `src/lib/email/system.ts`
- Create: `src/lib/email/templates/system/index.ts`
- Create: `src/lib/email/templates/system/password-changed.ts`
- Create: `src/lib/email/templates/system/email-change-confirm.ts`
- Create: `src/lib/email/templates/system/email-change-notify-old.ts`
- Create: `src/lib/email/templates/system/email-change-cancel-confirm.ts`
- Create: `src/lib/email/templates/system/2fa-enabled.ts`
- Create: `src/lib/email/templates/system/2fa-disabled.ts`

- [ ] **Step 1: Crear `src/lib/email/render.ts`**

```ts
/**
 * Sustituye {{path.to.var}} en un template plain-text con valores de un
 * objeto. Escape básico de HTML solo si renderHtml=true.
 *
 * Variables permitidas: lookup nested via "."
 *   { guest: { first_name: "María" } } + "{{guest.first_name}}" → "María"
 *
 * Variables faltantes se dejan literales para que sea obvio en debug.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
  options: { escapeHtml?: boolean } = {}
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as object)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, variables);
    if (value === undefined || value === null) return `{{${path}}}`;
    const str = String(value);
    return options.escapeHtml ? escapeHtml(str) : str;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convierte texto plano a HTML simple: párrafos con <p>, links autodetect,
 * line breaks con <br>.
 */
export function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
```

- [ ] **Step 2: Crear `src/lib/email/templates/system/password-changed.ts`**

```ts
export const passwordChangedTemplate = {
  subject: "Tu contraseña fue actualizada",
  text: (vars: { occurredAt: string }) => `Hola,

Te avisamos que tu contraseña de Apart Cba fue actualizada el ${vars.occurredAt}.

Si fuiste vos, ignorá este mensaje.

Si NO fuiste vos, contactanos urgente porque alguien podría haber accedido a tu cuenta.

— Apart Cba Seguridad`,
};
```

- [ ] **Step 3: Crear `src/lib/email/templates/system/email-change-confirm.ts`**

```ts
export const emailChangeConfirmTemplate = {
  subject: "Confirmá tu nuevo email",
  text: (vars: { confirmUrl: string; expiresAt: string }) => `Hola,

Recibimos un pedido para cambiar el email de tu cuenta de Apart Cba.

Hacé click en este link para confirmar el cambio:

${vars.confirmUrl}

El link expira el ${vars.expiresAt}.

Si NO pediste este cambio, podés ignorar este mensaje.

— Apart Cba Seguridad`,
};
```

- [ ] **Step 4: Crear `src/lib/email/templates/system/email-change-notify-old.ts`**

```ts
export const emailChangeNotifyOldTemplate = {
  subject: "Pedido de cambio de email en tu cuenta",
  text: (vars: { newEmail: string; cancelUrl: string }) => `Hola,

Recibimos un pedido de cambio de email para tu cuenta de Apart Cba.

El nuevo email solicitado es: ${vars.newEmail}

Si fuiste vos, no necesitás hacer nada — solo confirmá el cambio desde el link que enviamos al nuevo email.

Si NO fuiste vos, hacé click acá para CANCELAR el cambio:

${vars.cancelUrl}

Si lo cancelás, tu email actual queda sin cambios.

— Apart Cba Seguridad`,
};
```

- [ ] **Step 5: Crear `src/lib/email/templates/system/email-change-cancel-confirm.ts`**

```ts
export const emailChangeCancelConfirmTemplate = {
  subject: "Cambio de email cancelado",
  text: () => `Hola,

Cancelaste correctamente el cambio de email pendiente. Tu cuenta sigue con el email actual.

Si querés revisar la actividad reciente de tu cuenta, ingresá al panel y andá a Mi perfil → Seguridad.

— Apart Cba Seguridad`,
};
```

- [ ] **Step 6: Crear `src/lib/email/templates/system/2fa-enabled.ts` y `2fa-disabled.ts`**

`2fa-enabled.ts`:
```ts
export const twoFactorEnabledTemplate = {
  subject: "Activaste verificación en dos pasos",
  text: (vars: { occurredAt: string }) => `Hola,

Activaste correctamente la verificación en dos pasos (2FA) en tu cuenta de Apart Cba el ${vars.occurredAt}.

A partir de ahora, además de tu contraseña te vamos a pedir un código de 6 dígitos generado por tu app de autenticación.

Si NO fuiste vos, contactanos urgente.

— Apart Cba Seguridad`,
};
```

`2fa-disabled.ts`:
```ts
export const twoFactorDisabledTemplate = {
  subject: "Desactivaste verificación en dos pasos",
  text: (vars: { occurredAt: string }) => `Hola,

Desactivaste la verificación en dos pasos (2FA) en tu cuenta de Apart Cba el ${vars.occurredAt}.

A partir de ahora vamos a pedir solamente tu contraseña para entrar.

Si NO fuiste vos, contactanos urgente y volvé a activar 2FA cuando puedas.

— Apart Cba Seguridad`,
};
```

- [ ] **Step 7: Crear `src/lib/email/templates/system/index.ts`**

```ts
export { passwordChangedTemplate } from "./password-changed";
export { emailChangeConfirmTemplate } from "./email-change-confirm";
export { emailChangeNotifyOldTemplate } from "./email-change-notify-old";
export { emailChangeCancelConfirmTemplate } from "./email-change-cancel-confirm";
export { twoFactorEnabledTemplate } from "./2fa-enabled";
export { twoFactorDisabledTemplate } from "./2fa-disabled";
```

- [ ] **Step 8: Crear `src/lib/email/system.ts`**

```ts
import "server-only";
import { Resend } from "resend";
import {
  passwordChangedTemplate,
  emailChangeConfirmTemplate,
  emailChangeNotifyOldTemplate,
  emailChangeCancelConfirmTemplate,
  twoFactorEnabledTemplate,
  twoFactorDisabledTemplate,
} from "./templates/system";
import { plainTextToHtml } from "./render";

type SystemTemplate =
  | { name: "password-changed"; vars: { occurredAt: string } }
  | { name: "email-change-confirm"; vars: { confirmUrl: string; expiresAt: string } }
  | { name: "email-change-notify-old"; vars: { newEmail: string; cancelUrl: string } }
  | { name: "email-change-cancel-confirm"; vars: Record<string, never> }
  | { name: "2fa-enabled"; vars: { occurredAt: string } }
  | { name: "2fa-disabled"; vars: { occurredAt: string } };

const TEMPLATE_MAP = {
  "password-changed": passwordChangedTemplate,
  "email-change-confirm": emailChangeConfirmTemplate,
  "email-change-notify-old": emailChangeNotifyOldTemplate,
  "email-change-cancel-confirm": emailChangeCancelConfirmTemplate,
  "2fa-enabled": twoFactorEnabledTemplate,
  "2fa-disabled": twoFactorDisabledTemplate,
} as const;

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

/**
 * Envía un mail "del sistema" (auth flows: password change, email change,
 * 2FA enable/disable). Siempre desde el dominio configurado en
 * SYSTEM_EMAIL_FROM, no desde el dominio de ninguna org.
 *
 * Best-effort: si Resend falla, NO throw — devuelve `{ ok: false, error }`.
 * El caller decide si mostrar warning o ignorar.
 */
export async function sendSystemMail(args: {
  to: string;
  template: SystemTemplate;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const from = process.env.SYSTEM_EMAIL_FROM;
  const fromName = process.env.SYSTEM_EMAIL_FROM_NAME ?? "Apart Cba Seguridad";
  if (!from) return { ok: false, error: "SYSTEM_EMAIL_FROM no configurada" };

  const tpl = TEMPLATE_MAP[args.template.name];
  if (!tpl) return { ok: false, error: `Template desconocido: ${args.template.name}` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = tpl.text(args.template.vars as any);
  const subject = typeof tpl.subject === "string" ? tpl.subject : tpl.subject;
  const html = plainTextToHtml(text);

  try {
    const result = await getResend().emails.send({
      from: `${fromName} <${from}>`,
      to: args.to,
      subject,
      text,
      html,
    });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true, id: result.data?.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 9: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/email/render.ts src/lib/email/system.ts src/lib/email/templates/system/
```
Expected: vacíos, exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/lib/email/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(email): helper sistema + render + 6 templates auth-flow

renderTemplate: sustituye {{path.to.var}} con escape opcional HTML.
plainTextToHtml: convierte texto a HTML básico (párrafos + br + links).

sendSystemMail: wrapper sobre Resend para mails de auth flows
(password, email change, 2FA enable/disable). Siempre desde
SYSTEM_EMAIL_FROM. Best-effort: si Resend falla devuelve { ok:false }
sin throw, para que el caller no bloquee la operación principal.

Templates en español, todos en plain-text con render automático a HTML.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — `src/lib/email/guest.ts` (helper huésped con fallback)

**Goal:** Wrapper de Resend para mails al huésped, lookup del dominio de la org y fallback al sistema si no está verificado.

**Files:**
- Create: `src/lib/email/guest.ts`

- [ ] **Step 1: Crear `src/lib/email/guest.ts`**

```ts
import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";

let resendClient: Resend | null = null;
function getResend(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

/**
 * Envía un mail al huésped (confirmación de reserva, recibos, etc).
 *
 * Lookup del dominio de la org:
 * - Si `email_domain_verified_at` IS NOT NULL → from = "{sender_name} <{local_part}@{domain}>"
 * - Si NO verificado → from = "{org.name} <APART_CBA_FALLBACK_FROM>"
 *
 * Best-effort: si Resend falla, devuelve { ok: false, error } sin throw.
 */
export async function sendGuestMail(args: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<{ ok: true; id: string; from_used: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("name, email_domain, email_sender_name, email_sender_local_part, email_domain_verified_at")
    .eq("id", args.organizationId)
    .maybeSingle();

  if (orgErr || !org) {
    return { ok: false, error: orgErr?.message ?? "Org no encontrada" };
  }

  let from: string;
  if (
    org.email_domain_verified_at &&
    org.email_domain &&
    org.email_sender_local_part
  ) {
    const senderName = org.email_sender_name ?? org.name;
    from = `${senderName} <${org.email_sender_local_part}@${org.email_domain}>`;
  } else {
    const fallbackFrom = process.env.APART_CBA_FALLBACK_FROM;
    if (!fallbackFrom) return { ok: false, error: "APART_CBA_FALLBACK_FROM no configurada" };
    from = `${org.name} <${fallbackFrom}>`;
  }

  try {
    const result = await getResend().emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true, id: result.data?.id ?? "", from_used: from };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/email/guest.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/guest.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(email): helper guest mail con fallback a dominio sistema

sendGuestMail: lookup del dominio de la org en organizations. Si
email_domain_verified_at != null → envía desde dominio org. Si no →
fallback a APART_CBA_FALLBACK_FROM con friendly name = org.name.

Best-effort igual que sendSystemMail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Regenerar `src/lib/types/database.ts` con columnas + tablas nuevas

**Goal:** Que TypeScript conozca las columnas nuevas en `organizations`, `bookings` y las 4 tablas nuevas.

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Generar tipos vía MCP**

```
mcp__supabase-apartcba__generate_typescript_types({})
```

Eso devuelve el TypeScript completo del schema. Usar el output como referencia.

- [ ] **Step 2: Localizar las regiones del archivo a modificar**

```bash
grep -n "interface Organization\|type Organization\|interface Booking\|type Booking" src/lib/types/database.ts | head -10
grep -n "user_2fa_recovery_codes\|email_change_requests\|org_message_templates\|security_audit_log" src/lib/types/database.ts | head ; echo "(if empty: types nuevos no existen, hay que agregarlos)"
```

- [ ] **Step 3: Si el archivo es manual (no auto-generado), agregar manualmente**

Buscar el bloque de `Organization` y agregar al type las columnas nuevas (todas opcionales-string-null para org existentes que vienen sin valor):

```ts
// Dentro de Organization {
description: string | null;
address: string | null;
contact_phone: string | null;
contact_email: string | null;
email_domain: string | null;
email_sender_name: string | null;
email_sender_local_part: string | null;
email_domain_verified_at: string | null;
email_domain_dns_records: ResendDnsRecord[] | null;  // ver type abajo
```

Y al final del archivo agregar:

```ts
// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Tipos para tablas nuevas
// ════════════════════════════════════════════════════════════════════════

export interface ResendDnsRecord {
  type: string;          // 'TXT', 'MX', 'CNAME'
  name: string;          // ej. 'resend._domainkey'
  value: string;         // contenido del record
  ttl?: number;
  priority?: number;
}

export interface User2FARecoveryCode {
  id: string;
  user_id: string;
  code_hash: string;
  used_at: string | null;
  created_at: string;
}

export interface EmailChangeRequest {
  id: string;
  user_id: string;
  old_email: string;
  new_email: string;
  confirm_token_hash: string;
  cancel_token_hash: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  notified_old_at: string | null;
  created_at: string;
}

export type MessageChannel = "email" | "whatsapp";

export type MessageEventType = "booking_confirmed";  // futuro: 'booking_reminder', etc.

export interface OrgMessageTemplate {
  id: string;
  organization_id: string;
  event_type: MessageEventType | string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type SecurityEventType =
  | "password_changed"
  | "email_change_requested"
  | "email_change_confirmed"
  | "email_change_cancelled"
  | "2fa_enabled"
  | "2fa_disabled"
  | "2fa_recovery_codes_regenerated"
  | "login_with_recovery_code";

export interface SecurityAuditLog {
  id: string;
  user_id: string;
  event_type: SecurityEventType;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
}
```

Y dentro de `Booking`:
```ts
confirmation_sent_at: string | null;
```

- [ ] **Step 4: Verificar tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
```
Expected: vacío.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/database.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(types): tipos para Spec 2 — columnas nuevas + 4 tablas

Organization: +9 columnas (descripción, dirección, contacto, dominio
Resend con DNS records).

Booking: +confirmation_sent_at.

Tipos nuevos: User2FARecoveryCode, EmailChangeRequest, OrgMessageTemplate,
SecurityAuditLog, MessageChannel, MessageEventType, SecurityEventType,
ResendDnsRecord.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — `<OrgBrand>` + reemplazar `<Logo>` en sidebar

**Goal:** Sidebar muestra el logo de la org si existe, fallback al brand Apart Cba si no.

**Files:**
- Create: `src/components/brand/org-brand.tsx`
- Modify: `src/components/dashboard/app-sidebar.tsx`

- [ ] **Step 1: Restaurar archivo target a HEAD (limpiar CRLF)**

```bash
git checkout HEAD -- src/components/dashboard/app-sidebar.tsx
git status --short src/components/dashboard/app-sidebar.tsx ; echo "(should be empty)"
```

- [ ] **Step 2: Localizar el uso del `<Logo>` en sidebar**

```bash
grep -n "<Logo\|import.*Logo" src/components/dashboard/app-sidebar.tsx
```
Expected: encontrar import + uso del componente.

- [ ] **Step 3: Crear `src/components/brand/org-brand.tsx`**

```tsx
import Image from "next/image";
import { Logo } from "./logo";
import type { Organization } from "@/lib/types/database";

interface OrgBrandProps {
  organization: Pick<Organization, "id" | "name" | "logo_url">;
  size?: "sm" | "md";
}

/**
 * Brand del sidebar:
 * - Si la org tiene logo_url → renderiza ese logo (white-label total).
 * - Si no → fallback al <Logo> de Apart Cba.
 *
 * Decisión Spec 2: las orgs sin logo siguen viendo "APART" como antes.
 */
export function OrgBrand({ organization, size = "sm" }: OrgBrandProps) {
  const dim = size === "sm" ? 32 : 44;
  if (organization.logo_url) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Image
          src={organization.logo_url}
          alt={organization.name}
          width={dim}
          height={dim}
          unoptimized
          className="h-9 w-auto max-w-[120px] object-contain"
        />
        <span className="font-semibold text-sm truncate">{organization.name}</span>
      </div>
    );
  }
  return <Logo size={size} />;
}
```

Nota técnica: `unoptimized` evita configurar `images.remotePatterns` para Supabase Storage en `next.config.ts`. Como los logos son < 5MB y se cachean en CDN de Supabase, la optimización del Next.js Image no agrega valor.

- [ ] **Step 4: Modificar `src/components/dashboard/app-sidebar.tsx`**

Localizar línea con `import { Logo }` y reemplazar:

Antes:
```tsx
import { Logo } from "@/components/brand/logo";
```

Después:
```tsx
import { OrgBrand } from "@/components/brand/org-brand";
```

Localizar el uso `<Logo .../>` y reemplazar por:
```tsx
<OrgBrand organization={currentOrg} />
```

(donde `currentOrg` es la prop que ya recibe el sidebar).

- [ ] **Step 5: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/components/brand/org-brand.tsx src/components/dashboard/app-sidebar.tsx
```
Expected: vacíos.

- [ ] **Step 6: Smoke test mental**

Verificar que en una org sin `logo_url` (todas las existentes), el sidebar se ve igual a antes (con el `<Logo>` Apart Cba). Si el `currentOrg.logo_url` no se actualiza en realtime al cambiar la URL desde la sección Branding (Task 18), eso se resuelve con `revalidatePath('/dashboard', 'layout')` desde la server action de upload.

- [ ] **Step 7: Commit**

```bash
git add src/components/brand/org-brand.tsx src/components/dashboard/app-sidebar.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(branding): <OrgBrand> en sidebar — white-label con fallback

Si organization.logo_url existe, renderiza ese logo + nombre.
Si no, fallback al <Logo> Apart Cba (igual que antes).

Usa next/image con unoptimized para evitar configurar remotePatterns
para Supabase Storage. Los logos se cachean en CDN.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — `<ImageUploader>` componente reusable

**Goal:** Componente client que envuelve drag & drop + file picker + preview + upload server action. Reusable para avatar (Task 11) y logo de org (Task 18).

**Files:**
- Create: `src/components/ui/image-uploader.tsx`

- [ ] **Step 1: Crear `src/components/ui/image-uploader.tsx`**

```tsx
"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ImageUploaderProps {
  /** URL de la imagen actual (o null si no hay). */
  currentUrl: string | null;
  /** Server action que recibe FormData con campo "file" y devuelve nuevo URL. */
  uploadAction: (formData: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  /** Server action opcional para borrar (sin file). */
  deleteAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Tamaños y tipos. */
  maxSizeMB: number;
  acceptedTypes: string[];  // ej. ["image/jpeg", "image/png", "image/webp"]
  /** Tamaño visual del preview (px). */
  previewSize?: number;
  /** Forma del preview. */
  shape?: "circle" | "square";
  /** Callback opcional al success. */
  onUploaded?: (newUrl: string) => void;
  /** Texto del placeholder cuando no hay imagen. */
  placeholderText?: string;
}

export function ImageUploader({
  currentUrl,
  uploadAction,
  deleteAction,
  maxSizeMB,
  acceptedTypes,
  previewSize = 144,
  shape = "circle",
  onUploaded,
  placeholderText = "Arrastrá una imagen o hacé click para subir",
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayUrl = previewUrl ?? currentUrl;

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!acceptedTypes.includes(file.type)) {
        return `Tipo no soportado. Permitidos: ${acceptedTypes.map((t) => t.split("/")[1]).join(", ")}`;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        return `Archivo demasiado grande. Máximo: ${maxSizeMB} MB`;
      }
      return null;
    },
    [acceptedTypes, maxSizeMB]
  );

  const handleFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        toast.error(err);
        return;
      }
      setPreviewFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    },
    [validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleUpload = useCallback(async () => {
    if (!previewFile) return;
    setIsUploading(true);
    const fd = new FormData();
    fd.append("file", previewFile);
    try {
      const result = await uploadAction(fd);
      if (!result.ok) {
        toast.error("Error al subir", { description: result.error });
        return;
      }
      toast.success("Imagen actualizada");
      setPreviewFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      onUploaded?.(result.url);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [previewFile, previewUrl, uploadAction, onUploaded]);

  const handleCancel = useCallback(() => {
    setPreviewFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [previewUrl]);

  const handleDelete = useCallback(async () => {
    if (!deleteAction) return;
    if (!confirm("¿Seguro que querés eliminar la imagen actual?")) return;
    setIsUploading(true);
    try {
      const result = await deleteAction();
      if (!result.ok) {
        toast.error("Error al eliminar", { description: result.error });
        return;
      }
      toast.success("Imagen eliminada");
      onUploaded?.("");
    } finally {
      setIsUploading(false);
    }
  }, [deleteAction, onUploaded]);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "mx-auto flex items-center justify-center bg-muted overflow-hidden border-2 transition-colors",
          shape === "circle" ? "rounded-full" : "rounded-lg",
          isDragging ? "border-primary bg-primary/5" : "border-dashed border-muted-foreground/30"
        )}
        style={{ width: previewSize, height: previewSize }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {displayUrl ? (
          <Image
            src={displayUrl}
            alt="Preview"
            width={previewSize}
            height={previewSize}
            unoptimized
            className="object-cover w-full h-full"
          />
        ) : (
          <div className="text-center text-xs text-muted-foreground p-4">{placeholderText}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        <input
          type="file"
          ref={inputRef}
          accept={acceptedTypes.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {!previewFile && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload size={14} className="mr-1.5" /> Elegir imagen
          </Button>
        )}
        {previewFile && (
          <>
            <Button type="button" size="sm" onClick={handleUpload} disabled={isUploading}>
              {isUploading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
              Subir
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={isUploading}>
              <X size={14} className="mr-1.5" /> Cancelar
            </Button>
          </>
        )}
        {currentUrl && !previewFile && deleteAction && (
          <Button type="button" size="sm" variant="ghost" onClick={handleDelete} disabled={isUploading} className="text-destructive">
            Eliminar
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {acceptedTypes.map((t) => t.split("/")[1].toUpperCase()).join(", ")} · max {maxSizeMB} MB
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/components/ui/image-uploader.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/image-uploader.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(ui): <ImageUploader> reusable — drag&drop + preview + upload

Componente client genérico que envuelve:
- Drag & drop + file picker
- Preview antes de subir (URL.createObjectURL con cleanup)
- Validación de tipo + tamaño en cliente
- uploadAction/deleteAction como server actions inyectados
- Toast de feedback
- Soporte círculo (avatar) y cuadrado (logo)

Se reusa en Task 11 (avatar) y Task 18 (logo de org).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — `src/lib/actions/profile.ts` (server actions de perfil personal)

**Goal:** Server actions para actualizar datos personales y subir/eliminar avatar.

**Files:**
- Create: `src/lib/actions/profile.ts`

- [ ] **Step 1: Crear `src/lib/actions/profile.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";

const profileUpdateSchema = z.object({
  full_name: z.string().min(2, "Nombre muy corto").max(120),
  phone: z.string().max(40).optional().nullable(),
  preferred_locale: z.enum(["es-AR", "en", "pt-BR"]).default("es-AR"),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export async function updateUserProfile(
  input: ProfileUpdateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = profileUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone ?? null,
      preferred_locale: parsed.data.preferred_locale,
    })
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true };
}

const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

export async function uploadAvatar(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return { ok: false, error: "Tipo no soportado (JPG/PNG/WebP)" };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: "Archivo > 2 MB" };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${session.userId}/${Date.now()}.${ext}`;

  // Borrar avatar previo si existe
  const { data: profile } = await admin
    .from("user_profiles")
    .select("avatar_url")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.avatar_url) {
    const prevPath = extractPathFromPublicUrl(profile.avatar_url, "avatars");
    if (prevPath) {
      await admin.storage.from("avatars").remove([prevPath]).catch(() => null);
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from("avatars")
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: publicData } = admin.storage.from("avatars").getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  const { error: updateError } = await admin
    .from("user_profiles")
    .update({ avatar_url: publicUrl })
    .eq("user_id", session.userId);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true, url: publicUrl };
}

export async function deleteAvatar(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("avatar_url")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.avatar_url) {
    const prevPath = extractPathFromPublicUrl(profile.avatar_url, "avatars");
    if (prevPath) {
      await admin.storage.from("avatars").remove([prevPath]).catch(() => null);
    }
  }
  await admin.from("user_profiles").update({ avatar_url: null }).eq("user_id", session.userId);
  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/m/perfil");
  return { ok: true };
}

function extractPathFromPublicUrl(url: string, bucket: string): string | null {
  // ...storage/v1/object/public/{bucket}/{path}
  const idx = url.indexOf(`/${bucket}/`);
  if (idx === -1) return null;
  return url.slice(idx + bucket.length + 2);
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/profile.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/profile.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): profile.ts — updateUserProfile + uploadAvatar + deleteAvatar

Server actions con patrón estándar: requireSession + Zod + admin client.

uploadAvatar: valida tipo y tamaño en server, sube a bucket avatars con
path {user_id}/{ts}.{ext}, borra avatar previo, updatea avatar_url.

deleteAvatar: borra del bucket + setea avatar_url = null.

Tres revalidatePath: /dashboard/perfil, /dashboard layout (TopBar), /m/perfil.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — `/dashboard/perfil` page + `<ProfileTabs>` shell

**Goal:** Crear la ruta y el shell con tabs Datos / Foto / Seguridad.

**Files:**
- Create: `src/app/dashboard/perfil/page.tsx`
- Create: `src/app/dashboard/perfil/profile-tabs.tsx`

- [ ] **Step 1: Crear `src/app/dashboard/perfil/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { ProfileTabs } from "./profile-tabs";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="container max-w-3xl py-6 px-4 sm:px-6">
      <h1 className="text-2xl font-bold mb-6">Mi perfil</h1>
      <ProfileTabs profile={session.profile} email={session.user.email ?? ""} />
    </div>
  );
}
```

(Nota: si `getSession` no devuelve `user.email`, ajustar el campo según la estructura real — verificar primero con `grep -n "getSession\|interface Session" src/lib/actions/auth.ts`).

- [ ] **Step 2: Crear `src/app/dashboard/perfil/profile-tabs.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileDataForm } from "./profile-data-form";
import { AvatarUploader } from "./avatar-uploader";
import { SecuritySection } from "./security-section";  // creado en PR 2.C
import type { UserProfile } from "@/lib/types/database";

interface ProfileTabsProps {
  profile: UserProfile;
  email: string;
}

export function ProfileTabs({ profile, email }: ProfileTabsProps) {
  const [tab, setTab] = useState("datos");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-6">
        <TabsTrigger value="datos">Datos</TabsTrigger>
        <TabsTrigger value="foto">Foto</TabsTrigger>
        <TabsTrigger value="seguridad">Seguridad</TabsTrigger>
      </TabsList>

      <TabsContent value="datos">
        <ProfileDataForm
          profile={profile}
          email={email}
          onChangeAvatarRequested={() => setTab("foto")}
          onChangeEmailRequested={() => setTab("seguridad")}
        />
      </TabsContent>

      <TabsContent value="foto">
        <AvatarUploader currentUrl={profile.avatar_url} />
      </TabsContent>

      <TabsContent value="seguridad">
        <SecuritySection profile={profile} email={email} />
      </TabsContent>
    </Tabs>
  );
}
```

**Importante:** `SecuritySection` se crea en PR 2.C (Task 27+). Para PR 2.A vamos a crear un placeholder mínimo que no rompa la build:

- [ ] **Step 3: Crear placeholder `src/app/dashboard/perfil/security-section.tsx`**

```tsx
"use client";

import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
}

export function SecuritySection({ profile: _profile, email: _email }: Props) {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      La sección de seguridad (cambio de contraseña, email, 2FA) se habilita en el próximo PR.
    </div>
  );
}
```

- [ ] **Step 4: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/
```
Expected: vacíos.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/perfil/page.tsx src/app/dashboard/perfil/profile-tabs.tsx src/app/dashboard/perfil/security-section.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): /dashboard/perfil page + tabs shell (Datos/Foto/Seguridad)

Tabs internas con state client-side (no subrutas — decisión spec).
ProfileDataForm y AvatarUploader van en Tasks 11-12.

SecuritySection es placeholder para que la build no rompa; se completa
en PR 2.C (cambio password, email, 2FA).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — `<ProfileDataForm>` (Tab Datos)

**Goal:** Form de datos personales editables: nombre, teléfono, idioma. Email read-only con link al tab Seguridad.

**Files:**
- Create: `src/app/dashboard/perfil/profile-data-form.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateUserProfile } from "@/lib/actions/profile";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  onChangeAvatarRequested: () => void;
  onChangeEmailRequested: () => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfileDataForm({
  profile,
  email,
  onChangeAvatarRequested,
  onChangeEmailRequested,
}: Props) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [locale, setLocale] = useState(profile.preferred_locale ?? "es-AR");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateUserProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        preferred_locale: locale as "es-AR" | "en" | "pt-BR",
      });
      if (!result.ok) {
        toast.error("Error al actualizar", { description: result.error });
        return;
      }
      toast.success("Datos actualizados");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative size-16 rounded-full bg-muted overflow-hidden">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile.full_name}
              width={64}
              height={64}
              unoptimized
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-lg font-semibold text-primary bg-primary/15">
              {getInitials(profile.full_name)}
            </div>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onChangeAvatarRequested}>
          Cambiar foto →
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Teléfono</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+54 9 351 ..."
          maxLength={40}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locale">Idioma de la interfaz</Label>
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger id="locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es-AR">Español (Argentina)</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <div className="flex items-center gap-2">
          <Input id="email" value={email} disabled className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onChangeEmailRequested}>
            Cambiar →
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          El email se cambia desde el tab Seguridad por motivos de protección.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/profile-data-form.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/perfil/profile-data-form.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): Tab Datos — nombre + teléfono + idioma + email read-only

Form con avatar chico al tope, botón "Cambiar foto" cambia al tab Foto.
Botón "Cambiar" del email cambia al tab Seguridad.

Server action updateUserProfile con re-validación de paths del dashboard
+ mobile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12 — `<AvatarUploader>` (Tab Foto)

**Goal:** Wrapper sobre `<ImageUploader>` que conecta con `uploadAvatar` y `deleteAvatar`.

**Files:**
- Create: `src/app/dashboard/perfil/avatar-uploader.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { ImageUploader } from "@/components/ui/image-uploader";
import { uploadAvatar, deleteAvatar } from "@/lib/actions/profile";

interface Props {
  currentUrl: string | null;
}

export function AvatarUploader({ currentUrl }: Props) {
  const router = useRouter();
  return (
    <div className="max-w-md mx-auto">
      <ImageUploader
        currentUrl={currentUrl}
        uploadAction={uploadAvatar}
        deleteAction={deleteAvatar}
        maxSizeMB={2}
        acceptedTypes={["image/jpeg", "image/png", "image/webp"]}
        previewSize={144}
        shape="circle"
        placeholderText="Arrastrá una imagen o hacé click para subir tu avatar"
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/avatar-uploader.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/perfil/avatar-uploader.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): Tab Foto — wrapper de <ImageUploader> para avatar

Conecta ImageUploader con uploadAvatar/deleteAvatar de profile.ts.
router.refresh() al success para que el avatar se actualice en la
página y en el TopBar (vía revalidatePath layout).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13 — Wire dropdown "Mi perfil" en TopBar

**Goal:** El item "Mi perfil" del dropdown del avatar (que hoy es placeholder sin link) abre `/dashboard/perfil`.

**Files:**
- Modify: `src/components/dashboard/top-bar.tsx:175-178`

- [ ] **Step 1: Restaurar archivo target a HEAD**

```bash
git checkout HEAD -- src/components/dashboard/top-bar.tsx
git status --short src/components/dashboard/top-bar.tsx ; echo "(should be empty)"
```

- [ ] **Step 2: Localizar import de Link y bloque "Mi perfil"**

```bash
grep -n "next/link\|Mi perfil" src/components/dashboard/top-bar.tsx | head
```

- [ ] **Step 3: Si Link no está importado, agregarlo**

Buscar la sección de imports al tope del archivo y agregar:
```tsx
import Link from "next/link";
```

- [ ] **Step 4: Reemplazar el item "Mi perfil"**

Antes:
```tsx
<DropdownMenuItem>
  <Settings size={14} />
  Mi perfil
</DropdownMenuItem>
```

Después:
```tsx
<DropdownMenuItem asChild>
  <Link href="/dashboard/perfil" className="cursor-pointer">
    <Settings size={14} />
    Mi perfil
  </Link>
</DropdownMenuItem>
```

- [ ] **Step 5: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/components/dashboard/top-bar.tsx
```
Expected: vacíos.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/top-bar.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): wire item "Mi perfil" del dropdown a /dashboard/perfil

El item ya estaba en TopBar pero era placeholder sin onClick. Ahora
linkea correctamente.

El item "Configuración de organización" (visible para admin solo) se
agrega en PR 2.B Task 24.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Checkpoint PR 2.A

- [ ] **Verificación final del PR 2.A**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end tsc)"
npm run lint -- src/lib/email/ src/lib/actions/profile.ts src/app/dashboard/perfil/ src/components/brand/org-brand.tsx src/components/dashboard/app-sidebar.tsx src/components/dashboard/top-bar.tsx src/components/ui/image-uploader.tsx 2>&1 | tail -10
git log --oneline main..HEAD | head -20
```

Expected: tsc filtrado vacío. lint exit 0. Log con 13 commits (Task 1-13).

- [ ] **Smoke pass manual de PR 2.A:**
  - `npm run dev`, abrir `/dashboard/perfil` → tabs Datos/Foto/Seguridad visibles.
  - Cambiar nombre + teléfono + idioma → guardar → toast OK + recargar muestra los nuevos valores.
  - Subir un avatar real → ver preview → confirmar upload → toast OK → ver el avatar en el TopBar arriba a la derecha.
  - Eliminar avatar → confirmar → vuelve a las iniciales.
  - Click en "Mi perfil" del dropdown del avatar → linkea a `/dashboard/perfil`.
  - El sidebar muestra el `<Logo>` Apart Cba (porque `currentOrg.logo_url` es null en orgs existentes).

Si todo va, este es el corte natural de PR 2.A. Si trabajamos en branch única (Opción A del Pre-flight), solo seguimos con Task 14. Si trabajamos en branches separadas, mergeamos PR 2.A y arrancamos `feat/spec-2b-org-config` desde la nueva main.

---

# PR 2.B — Configuración de organización

**Goal del PR**: dejar `/dashboard/configuracion/organizacion` con sus 3 secciones (Identidad, Branding, Comunicaciones — incluye dominio Resend + templates editables).

**Files que va a tocar PR 2.B:**
- `src/lib/actions/org.ts` (modify — agregar updateOrgIdentity, uploadOrgLogo, deleteOrgLogo, createOrgDomain, verifyOrgDomain, deleteOrgDomain, updateOrgTemplate)
- `src/components/dashboard/app-sidebar.tsx` (modify — agregar item "Organización" en grupo Configuración)
- `src/app/dashboard/configuracion/organizacion/page.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/identity-section.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/branding-section.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/communications-section.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/domain-card.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/templates-section.tsx` (create)
- `src/app/dashboard/configuracion/organizacion/template-editor.tsx` (create)
- `src/lib/email/templates/variables.ts` (create — lista cerrada de variables permitidas)
- `src/components/dashboard/top-bar.tsx` (modify — agregar item "Configuración de organización" al dropdown del avatar)

---

## Task 14 — Extender `src/lib/actions/org.ts` con identity + branding actions

**Goal:** Server actions para `updateOrgIdentity`, `uploadOrgLogo`, `deleteOrgLogo`.

**Files:**
- Modify: `src/lib/actions/org.ts`

- [ ] **Step 1: Restaurar archivo a HEAD**

```bash
git checkout HEAD -- src/lib/actions/org.ts
```

- [ ] **Step 2: Localizar el final del archivo + estructura**

```bash
grep -n "^export\|^const\|^import" src/lib/actions/org.ts | head -20
wc -l src/lib/actions/org.ts
```

- [ ] **Step 3: Agregar `updateOrgIdentity` al final del archivo**

Append al final del archivo (antes de cualquier export último, agregar):

```ts

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Identidad + Branding + Resend dominio + Templates
// ════════════════════════════════════════════════════════════════════════

import { z } from "zod";  // (si ya está importado arriba, NO duplicar)

const orgIdentitySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact_phone: z.string().max(40).optional().nullable(),
  contact_email: z.string().email().max(200).optional().nullable().or(z.literal("")),
});

export type OrgIdentityInput = z.infer<typeof orgIdentitySchema>;

export async function updateOrgIdentity(
  input: OrgIdentityInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = orgIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      address: parsed.data.address ?? null,
      contact_phone: parsed.data.contact_phone ?? null,
      contact_email: parsed.data.contact_email || null,
    })
    .eq("id", organization.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

const ALLOWED_LOGO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export async function uploadOrgLogo(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { ok: false, error: "Tipo no soportado (JPG/PNG/WebP/SVG)" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Archivo > 5 MB" };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${organization.id}/${Date.now()}.${ext}`;

  const { data: prevOrg } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", organization.id)
    .maybeSingle();
  if (prevOrg?.logo_url) {
    const prevPath = extractPathFromPublicUrl(prevOrg.logo_url, "org-logos");
    if (prevPath) {
      await admin.storage.from("org-logos").remove([prevPath]).catch(() => null);
    }
  }

  const buf = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from("org-logos")
    .upload(path, buf, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: publicData } = admin.storage.from("org-logos").getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ logo_url: publicUrl })
    .eq("id", organization.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true, url: publicUrl };
}

export async function deleteOrgLogo(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", organization.id)
    .maybeSingle();
  if (org?.logo_url) {
    const prev = extractPathFromPublicUrl(org.logo_url, "org-logos");
    if (prev) await admin.storage.from("org-logos").remove([prev]).catch(() => null);
  }
  await admin.from("organizations").update({ logo_url: null }).eq("id", organization.id);

  revalidatePath("/dashboard/configuracion/organizacion");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

function extractPathFromPublicUrl(url: string, bucket: string): string | null {
  const idx = url.indexOf(`/${bucket}/`);
  if (idx === -1) return null;
  return url.slice(idx + bucket.length + 2);
}
```

**Importante**: si `z` ya estaba importado al tope del archivo, NO duplicar el import. Verificar con `grep -n "^import.*zod" src/lib/actions/org.ts`. Si no está importado, agregar `import { z } from "zod"` al tope.

- [ ] **Step 4: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/org.ts
```
Expected: vacíos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/org.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): org.ts — updateOrgIdentity + upload/deleteOrgLogo

Server actions para datos de identidad (nombre, descripción, dirección,
contacto) y logo de la org. Patrón estándar: requireSession +
getCurrentOrg + Zod + admin client.

Storage: bucket org-logos con path {org_id}/{ts}.{ext}.

revalidatePath del dashboard layout para que <OrgBrand> en sidebar
refresque.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15 — Agregar item "Organización" al sidebar Configuración

**Goal:** En `src/components/dashboard/app-sidebar.tsx`, dentro del grupo Configuración, agregar el item "Organización" arriba de Equipo y Colores.

**Files:**
- Modify: `src/components/dashboard/app-sidebar.tsx`

- [ ] **Step 1: Restaurar archivo + localizar**

```bash
git checkout HEAD -- src/components/dashboard/app-sidebar.tsx
grep -n "configuracion\|Equipo\|Colores" src/components/dashboard/app-sidebar.tsx | head -10
```

- [ ] **Step 2: Agregar el item nuevo**

Buscar el bloque que define los items del grupo Configuración (probablemente un array o JSX con SidebarMenuItem). Agregar arriba de Equipo:

```tsx
{
  href: "/dashboard/configuracion/organizacion",
  label: "Organización",
  icon: Building2,  // import de lucide-react
}
```

(Adaptar a la sintaxis exacta del archivo — puede ser JSX inline o array de objetos.)

Si los items son JSX inline, ejemplo:
```tsx
<SidebarMenuItem>
  <SidebarMenuButton asChild>
    <Link href="/dashboard/configuracion/organizacion">
      <Building2 size={16} />
      <span>Organización</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

Asegurar import `import { Building2 } from "lucide-react"` (junto a los otros iconos).

- [ ] **Step 3: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/components/dashboard/app-sidebar.tsx
```
Expected: vacíos.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/app-sidebar.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(sidebar): item "Organización" en grupo Configuración

Arriba de Equipo y Colores. Sin gating por rol (decisión Spec 2).
Linkea a /dashboard/configuracion/organizacion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16 — `/dashboard/configuracion/organizacion` page shell

**Goal:** Crear la ruta + page que ensambla las 3 secciones.

**Files:**
- Create: `src/app/dashboard/configuracion/organizacion/page.tsx`

- [ ] **Step 1: Crear el page**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { createAdminClient } from "@/lib/supabase/server";
import { IdentitySection } from "./identity-section";
import { BrandingSection } from "./branding-section";
import { CommunicationsSection } from "./communications-section";
import type { OrgMessageTemplate } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export default async function OrganizacionPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { organization } = await getCurrentOrg();

  const admin = createAdminClient();
  const { data: templates } = await admin
    .from("org_message_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("event_type")
    .order("channel");

  return (
    <div className="container max-w-4xl py-6 px-4 sm:px-6 space-y-8">
      <h1 className="text-2xl font-bold">Configuración de organización</h1>

      <IdentitySection organization={organization} />
      <BrandingSection organization={organization} />
      <CommunicationsSection
        organization={organization}
        templates={(templates ?? []) as OrgMessageTemplate[]}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint** (con stubs de los componentes children que vamos a crear en Tasks 17, 18, 19)

Stub mínimo para que la build no rompa: crear archivos vacíos que exporten componentes fake.

```bash
mkdir -p src/app/dashboard/configuracion/organizacion
```

Tres archivos stub:

`identity-section.tsx`:
```tsx
"use client";
import type { Organization } from "@/lib/types/database";
export function IdentitySection({ organization: _ }: { organization: Organization }) {
  return <div className="rounded-lg border p-6">Identidad — TODO Task 17</div>;
}
```

`branding-section.tsx`:
```tsx
"use client";
import type { Organization } from "@/lib/types/database";
export function BrandingSection({ organization: _ }: { organization: Organization }) {
  return <div className="rounded-lg border p-6">Branding — TODO Task 18</div>;
}
```

`communications-section.tsx`:
```tsx
"use client";
import type { Organization, OrgMessageTemplate } from "@/lib/types/database";
export function CommunicationsSection({
  organization: _,
  templates: __,
}: {
  organization: Organization;
  templates: OrgMessageTemplate[];
}) {
  return <div className="rounded-lg border p-6">Comunicaciones — TODO Tasks 19-23</div>;
}
```

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): page shell + stubs de Identidad/Branding/Comunicaciones

Page server-side carga organization + templates en paralelo.
Stubs de las 3 secciones para que la build no rompa; cada uno se
implementa en Tasks 17, 18 y 19-23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17 — `<IdentitySection>` (form de identidad)

**Goal:** Form con nombre, descripción, dirección, teléfono, email contacto. Botón Guardar.

**Files:**
- Modify: `src/app/dashboard/configuracion/organizacion/identity-section.tsx` (reemplazar stub)

- [ ] **Step 1: Reemplazar el stub**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateOrgIdentity } from "@/lib/actions/org";
import type { Organization } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

export function IdentitySection({ organization }: Props) {
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description ?? "");
  const [address, setAddress] = useState(organization.address ?? "");
  const [phone, setPhone] = useState(organization.contact_phone ?? "");
  const [email, setEmail] = useState(organization.contact_email ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateOrgIdentity({
        name: name.trim(),
        description: description.trim() || null,
        address: address.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
      });
      if (!result.ok) {
        toast.error("Error al guardar", { description: result.error });
        return;
      }
      toast.success("Identidad actualizada");
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Identidad</h2>
        <p className="text-sm text-muted-foreground">
          Datos públicos de la organización. Aparecen en mails al huésped y en la cabecera del producto.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="org_name">Nombre comercial</Label>
          <Input id="org_name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org_desc">Descripción</Label>
          <Textarea id="org_desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Una frase breve que describa tu negocio." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org_addr">Dirección</Label>
          <Input id="org_addr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} placeholder="Calle 123, Ciudad, Provincia" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="org_phone">Teléfono de contacto</Label>
            <Input id="org_phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="+54 9 351 ..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org_email">Email de contacto</Label>
            <Input id="org_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="hola@miorg.com" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            Guardar identidad
          </Button>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/identity-section.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/identity-section.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): sección Identidad — form de datos públicos

Nombre, descripción, dirección, teléfono y mail de contacto.
Server action updateOrgIdentity + revalidatePath del dashboard layout
para refrescar el nombre en TopBar y sidebar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18 — `<BrandingSection>` (logo de la org)

**Goal:** Reusar `<ImageUploader>` para subir/eliminar el logo de la org.

**Files:**
- Modify: `src/app/dashboard/configuracion/organizacion/branding-section.tsx` (reemplazar stub)

- [ ] **Step 1: Reemplazar el stub**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { ImageUploader } from "@/components/ui/image-uploader";
import { uploadOrgLogo, deleteOrgLogo } from "@/lib/actions/org";
import type { Organization } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

export function BrandingSection({ organization }: Props) {
  const router = useRouter();
  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Branding</h2>
        <p className="text-sm text-muted-foreground">
          Subí el logo de tu organización. Se va a mostrar en el sidebar del producto en lugar del logo de Apart Cba.
          Si lo eliminás, vuelve al brand Apart Cba por default.
        </p>
      </header>
      <div className="max-w-md mx-auto">
        <ImageUploader
          currentUrl={organization.logo_url}
          uploadAction={uploadOrgLogo}
          deleteAction={deleteOrgLogo}
          maxSizeMB={5}
          acceptedTypes={["image/jpeg", "image/png", "image/webp", "image/svg+xml"]}
          previewSize={180}
          shape="square"
          placeholderText="Arrastrá tu logo o hacé click para subirlo"
          onUploaded={() => router.refresh()}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/branding-section.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/branding-section.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): sección Branding — upload/delete de logo

Reusa <ImageUploader> con bucket org-logos (5MB, jpg/png/webp/svg).
router.refresh() al success para refrescar <OrgBrand> en sidebar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19 — `createOrgDomain` server action

**Goal:** Llamar Resend API para crear un dominio + guardar DNS records en DB.

**Files:**
- Modify: `src/lib/actions/org.ts` (append)

- [ ] **Step 1: Agregar imports al tope del archivo si faltan**

Verificar que `Resend` esté disponible. Si no se quiere instanciar Resend por cada server action, podés extraer un getter local. Mejor: importar el helper que ya tenemos.

Pero `system.ts` tiene un client privado. Acá necesitamos llamar `resend.domains.create` que NO está en helpers. Solución: crear un getter compartido en un módulo aparte o instanciar acá local.

Append a `src/lib/actions/org.ts`:

```ts

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Resend domain management (Task 19+)
// ════════════════════════════════════════════════════════════════════════

import { Resend } from "resend";
import type { ResendDnsRecord } from "@/lib/types/database";

let resendClient: Resend | null = null;
function getResendForOrg(): Resend {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY no configurada");
  resendClient = new Resend(key);
  return resendClient;
}

const domainSchema = z.object({
  domain: z.string().min(3).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "Dominio inválido"),
  sender_name: z.string().min(1).max(120),
  sender_local_part: z.string().min(1).max(64).regex(/^[a-z0-9._-]+$/i, "Local part inválida"),
});

export type CreateOrgDomainInput = z.infer<typeof domainSchema>;

export async function createOrgDomain(
  input: CreateOrgDomainInput
): Promise<{ ok: true; dns_records: ResendDnsRecord[] } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = domainSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (org?.email_domain) {
    return { ok: false, error: "Ya hay un dominio configurado. Reiniciá la configuración primero." };
  }

  let createResult;
  try {
    createResult = await getResendForOrg().domains.create({ name: parsed.data.domain });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (createResult.error) return { ok: false, error: createResult.error.message };
  const dnsRecords = (createResult.data?.records ?? []) as unknown as ResendDnsRecord[];

  const { error: updateError } = await admin
    .from("organizations")
    .update({
      email_domain: parsed.data.domain,
      email_sender_name: parsed.data.sender_name,
      email_sender_local_part: parsed.data.sender_local_part,
      email_domain_dns_records: dnsRecords,
      email_domain_verified_at: null,
    })
    .eq("id", organization.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true, dns_records: dnsRecords };
}
```

**Importante**: `Resend` ya está importado en `system.ts` y `guest.ts`. Si querés evitar duplicar el getter, mové `getResend()` a un archivo común `src/lib/email/client.ts`. Por simplicidad ahora dejamos un getter por archivo.

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/org.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/org.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): createOrgDomain — registrar dominio en Resend

Valida formato del dominio + sender_name + local_part con Zod.
Llama Resend domains.create, persiste DNS records en
organizations.email_domain_dns_records (jsonb).

Bloquea si ya hay dominio configurado (forzar a usar deleteOrgDomain
primero).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20 — `verifyOrgDomain` + `deleteOrgDomain` server actions

**Files:**
- Modify: `src/lib/actions/org.ts` (append)

- [ ] **Step 1: Append al final del archivo**

```ts

export async function verifyOrgDomain(): Promise<
  { ok: true; verified: boolean } | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (!org?.email_domain) return { ok: false, error: "No hay dominio configurado" };

  let listResult;
  try {
    listResult = await getResendForOrg().domains.list();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (listResult.error) return { ok: false, error: listResult.error.message };
  const found = listResult.data?.data?.find((d) => d.name === org.email_domain);
  if (!found) return { ok: false, error: "Dominio no encontrado en Resend (¿lo borraste?)" };

  const verified = found.status === "verified";
  if (verified) {
    await admin
      .from("organizations")
      .update({ email_domain_verified_at: new Date().toISOString() })
      .eq("id", organization.id);
  }
  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true, verified };
}

export async function deleteOrgDomain(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("email_domain")
    .eq("id", organization.id)
    .maybeSingle();
  if (!org?.email_domain) return { ok: true };  // nada que borrar

  // Buscar el ID del dominio en Resend para borrarlo
  try {
    const list = await getResendForOrg().domains.list();
    const found = list.data?.data?.find((d) => d.name === org.email_domain);
    if (found?.id) {
      await getResendForOrg().domains.remove(found.id);
    }
  } catch (e) {
    // si falla el delete remoto, igual limpiamos local
    console.warn("Error borrando dominio en Resend:", e);
  }

  await admin
    .from("organizations")
    .update({
      email_domain: null,
      email_sender_name: null,
      email_sender_local_part: null,
      email_domain_dns_records: null,
      email_domain_verified_at: null,
    })
    .eq("id", organization.id);

  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true };
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/org.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/org.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): verify/deleteOrgDomain — gestión completa del dominio Resend

verifyOrgDomain: lista dominios en Resend, busca el de la org, si
status=verified setea email_domain_verified_at.

deleteOrgDomain: borra en Resend (best-effort) y limpia 5 cols en
organizations. Permite reiniciar config si DNS está mal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21 — `<DomainCard>` UI con 3 estados (sin/pendiente/verificado)

**Files:**
- Create: `src/app/dashboard/configuracion/organizacion/domain-card.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { createOrgDomain, verifyOrgDomain, deleteOrgDomain } from "@/lib/actions/org";
import type { Organization, ResendDnsRecord } from "@/lib/types/database";

interface Props {
  organization: Organization;
}

export function DomainCard({ organization }: Props) {
  const hasDomain = !!organization.email_domain;
  const isVerified = !!organization.email_domain_verified_at;

  if (!hasDomain) return <DomainEmptyState />;
  if (!isVerified) return <DomainPendingState organization={organization} />;
  return <DomainVerifiedState organization={organization} />;
}

// ─────────────────────────────────────────────────────────────────────
// Estado A — sin dominio
// ─────────────────────────────────────────────────────────────────────

function DomainEmptyState() {
  const [domain, setDomain] = useState("");
  const [senderName, setSenderName] = useState("");
  const [localPart, setLocalPart] = useState("reservas");
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createOrgDomain({
        domain: domain.trim().toLowerCase(),
        sender_name: senderName.trim(),
        sender_local_part: localPart.trim().toLowerCase(),
      });
      if (!result.ok) {
        toast.error("Error al crear dominio", { description: result.error });
        return;
      }
      toast.success("Dominio creado en Resend. Configurá los DNS para verificar.");
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configurá un dominio propio para que los emails a tus huéspedes salgan de tu marca.
        Mientras tanto, salen desde un remitente genérico de Apart Cba.
      </p>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="d_domain">Dominio</Label>
          <Input
            id="d_domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="monacosuites.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d_sender">Nombre del remitente</Label>
          <Input
            id="d_sender"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Monaco Suites"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d_local">Local part (lo que va antes del @)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="d_local"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="reservas"
              required
              className="max-w-[200px]"
            />
            <span className="text-sm text-muted-foreground">@{domain || "tu-dominio.com"}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={isPending || !domain || !senderName || !localPart}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Crear dominio en Resend
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado B — pendiente verificación
// ─────────────────────────────────────────────────────────────────────

function DomainPendingState({ organization }: { organization: Organization }) {
  const [isVerifying, startVerify] = useTransition();
  const [isResetting, startReset] = useTransition();
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const records = (organization.email_domain_dns_records ?? []) as ResendDnsRecord[];

  function handleVerify() {
    startVerify(async () => {
      const result = await verifyOrgDomain();
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      if (result.verified) toast.success("✓ Dominio verificado");
      else toast.warning("Aún no verificado. Esperá unos minutos tras agregar los DNS.");
    });
  }

  function handleReset() {
    if (!confirm("Esto borra el dominio en Resend y limpia la configuración. ¿Seguir?")) return;
    startReset(async () => {
      const result = await deleteOrgDomain();
      if (!result.ok) toast.error("Error", { description: result.error });
      else toast.success("Configuración reiniciada");
    });
  }

  function handleCopy(value: string, idx: number) {
    navigator.clipboard.writeText(value);
    setCopiedRow(idx);
    setTimeout(() => setCopiedRow(null), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3">
        <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Pendiente verificación: <span className="font-mono">{organization.email_domain}</span>
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Agregá los DNS records de abajo en tu proveedor (Cloudflare, GoDaddy, etc.) y presioná "Verificar ahora".
          </p>
        </div>
      </div>
      {records.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Tipo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-xs">{r.type}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{r.value}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => handleCopy(r.value, idx)}>
                      {copiedRow === idx ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleReset} disabled={isResetting} className="text-destructive">
          {isResetting && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Reiniciar config
        </Button>
        <Button onClick={handleVerify} disabled={isVerifying}>
          {isVerifying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Verificar ahora
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado C — verificado
// ─────────────────────────────────────────────────────────────────────

function DomainVerifiedState({ organization }: { organization: Organization }) {
  const [isResetting, startReset] = useTransition();

  function handleReset() {
    if (!confirm("Esto borra el dominio en Resend. Los próximos mails al huésped van a salir desde el remitente genérico de Apart Cba. ¿Seguir?")) return;
    startReset(async () => {
      const result = await deleteOrgDomain();
      if (!result.ok) toast.error("Error", { description: result.error });
      else toast.success("Dominio eliminado");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3">
        <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
            Dominio verificado: <span className="font-mono">{organization.email_domain}</span>
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Remitente: {organization.email_sender_name} &lt;{organization.email_sender_local_part}@{organization.email_domain}&gt;
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={handleReset} disabled={isResetting} className="text-destructive">
          {isResetting && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Cambiar configuración
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/domain-card.tsx
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/domain-card.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): <DomainCard> con 3 estados (vacío/pendiente/verificado)

Estado A: form para crear dominio en Resend (dominio + sender_name + local_part).
Estado B: tabla de DNS records con botón copy + verificar + reiniciar.
Estado C: badge verde de verificado + opción cambiar config.

Conecta con createOrgDomain, verifyOrgDomain, deleteOrgDomain del Task 19/20.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22 — `updateOrgTemplate` server action + lista de variables permitidas

**Files:**
- Create: `src/lib/email/templates/variables.ts`
- Modify: `src/lib/actions/org.ts` (append)

- [ ] **Step 1: Crear `src/lib/email/templates/variables.ts`**

```ts
/**
 * Lista cerrada de variables {{path.to.var}} permitidas en templates de cada
 * event_type. Validamos contra esto antes de guardar para evitar typos.
 */

export const ALLOWED_TEMPLATE_VARS: Record<string, readonly string[]> = {
  booking_confirmed: [
    "guest.full_name",
    "guest.first_name",
    "guest.email",
    "guest.phone",
    "org.name",
    "org.contact_phone",
    "org.contact_email",
    "org.address",
    "unit.name",
    "unit.code",
    "unit.address",
    "booking.check_in_date",
    "booking.check_in_date_iso",
    "booking.check_out_date",
    "booking.check_out_date_iso",
    "booking.nights",
    "booking.guests_count",
    "booking.total_amount",
    "booking.total_amount_raw",
    "booking.currency",
    "booking.balance_due",
    "booking.payment_link",
  ],
};

export function extractVariablesFromBody(body: string): string[] {
  const matches = body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

export function findInvalidVariables(body: string, eventType: string): string[] {
  const allowed = ALLOWED_TEMPLATE_VARS[eventType];
  if (!allowed) return [];
  const used = extractVariablesFromBody(body);
  return used.filter((v) => !allowed.includes(v));
}
```

- [ ] **Step 2: Append `updateOrgTemplate` a `src/lib/actions/org.ts`**

```ts

import { findInvalidVariables } from "@/lib/email/templates/variables";

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().max(300).optional().nullable(),
  body: z.string().min(1).max(10000),
});

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export async function updateOrgTemplate(
  input: UpdateTemplateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const admin = createAdminClient();
  const { data: tpl, error: lookupError } = await admin
    .from("org_message_templates")
    .select("id, organization_id, event_type, channel")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };
  if (!tpl) return { ok: false, error: "Template no encontrado" };
  if (tpl.organization_id !== organization.id) {
    return { ok: false, error: "Template no pertenece a tu organización" };
  }

  const invalid = findInvalidVariables(parsed.data.body, tpl.event_type);
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Variables no válidas: ${invalid.map((v) => `{{${v}}}`).join(", ")}`,
    };
  }

  const { error: updateError } = await admin
    .from("org_message_templates")
    .update({
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
      is_default: false,
    })
    .eq("id", parsed.data.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/configuracion/organizacion");
  return { ok: true };
}
```

- [ ] **Step 3: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/email/templates/variables.ts src/lib/actions/org.ts
```
Expected: vacíos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/templates/variables.ts src/lib/actions/org.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): updateOrgTemplate + lista cerrada de variables

ALLOWED_TEMPLATE_VARS: lista de {{var}} permitidas por event_type.
Validamos con findInvalidVariables antes de guardar el template; si hay
typos devolvemos error con el set específico.

is_default = false al primer edit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23 — `<TemplatesSection>` + `<TemplateEditor>`

**Goal:** Lista accordion de templates por (event_type, channel) + editor con variables clickeables + preview.

**Files:**
- Create: `src/app/dashboard/configuracion/organizacion/templates-section.tsx`
- Create: `src/app/dashboard/configuracion/organizacion/template-editor.tsx`

- [ ] **Step 1: Crear `templates-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TemplateEditor } from "./template-editor";
import type { OrgMessageTemplate } from "@/lib/types/database";

const EVENT_LABELS: Record<string, string> = {
  booking_confirmed: "Confirmación de reserva",
};
const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
};

interface Props {
  templates: OrgMessageTemplate[];
}

export function TemplatesSection({ templates }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Editá el contenido de los mensajes que se envían a los huéspedes. Los cambios aplican a partir del próximo envío.
      </p>
      <div className="rounded-md border divide-y">
        {templates.map((tpl) => {
          const isOpen = openId === tpl.id;
          const isWhatsApp = tpl.channel === "whatsapp";
          return (
            <div key={tpl.id}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : tpl.id)}
                className="w-full flex items-center justify-between gap-3 p-4 hover:bg-accent/30 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {isWhatsApp ? <MessageCircle size={14} className="text-muted-foreground" /> : <Mail size={14} className="text-muted-foreground" />}
                  <span className="font-medium text-sm">
                    {EVENT_LABELS[tpl.event_type] ?? tpl.event_type} — {CHANNEL_LABELS[tpl.channel]}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {tpl.is_default && <Badge variant="outline" className="text-xs">default</Badge>}
                  {isWhatsApp && <Badge variant="secondary" className="text-xs">próximamente</Badge>}
                </div>
              </button>
              {isOpen && (
                <div className="border-t bg-muted/20 p-4">
                  {isWhatsApp ? (
                    <p className="text-sm text-muted-foreground">
                      El canal WhatsApp se habilita en una versión futura. El template default ya está configurado para cuando esté disponible.
                    </p>
                  ) : (
                    <TemplateEditor template={tpl} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Crear `template-editor.tsx`**

```tsx
"use client";

import { useState, useTransition, useRef } from "react";
import { Eye, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { updateOrgTemplate } from "@/lib/actions/org";
import { ALLOWED_TEMPLATE_VARS } from "@/lib/email/templates/variables";
import { renderTemplate } from "@/lib/email/render";
import type { OrgMessageTemplate } from "@/lib/types/database";

const SAMPLE_VARS = {
  guest: {
    full_name: "María González",
    first_name: "María",
    email: "maria@example.com",
    phone: "+54 9 351 555-1234",
  },
  org: {
    name: "Monaco Suites",
    contact_phone: "+54 9 351 444-0000",
    contact_email: "hola@monacosuites.com",
    address: "Av. Colón 123, Córdoba",
  },
  unit: {
    name: "Departamento 3B",
    code: "MONACO-3B",
    address: "Av. Colón 123, Córdoba",
  },
  booking: {
    check_in_date: "Lun 12 May 2026",
    check_in_date_iso: "2026-05-12",
    check_out_date: "Vie 16 May 2026",
    check_out_date_iso: "2026-05-16",
    nights: 4,
    guests_count: 2,
    total_amount: "$ 240.000",
    total_amount_raw: "240000",
    currency: "ARS",
    balance_due: "$ 0",
    payment_link: "https://app/pay/abc123",
  },
};

interface Props {
  template: OrgMessageTemplate;
}

export function TemplateEditor({ template }: Props) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const variables = ALLOWED_TEMPLATE_VARS[template.event_type] ?? [];

  function insertVariable(varName: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const insert = `{{${varName}}}`;
    const next = body.slice(0, start) + insert + body.slice(end);
    setBody(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + insert.length, start + insert.length);
    }, 0);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateOrgTemplate({
        id: template.id,
        subject: subject.trim() || null,
        body: body.trim(),
      });
      if (!result.ok) {
        toast.error("Error al guardar", { description: result.error });
        return;
      }
      toast.success("Template actualizado");
    });
  }

  function handleRestore() {
    if (!confirm("¿Restaurar al template default? Vas a perder tus cambios.")) return;
    // Un restore "real" requeriría guardar el default original en algún lado.
    // Por ahora notificamos: el usuario puede pedir soporte. TODO: reseed action.
    toast.info("Para restaurar al default, contactá a soporte (feature en desarrollo).");
  }

  const renderedBody = renderTemplate(body, SAMPLE_VARS);
  const renderedSubject = renderTemplate(subject || "", SAMPLE_VARS);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-3">
        {template.channel === "email" && (
          <div className="space-y-2">
            <Label htmlFor={`s_${template.id}`}>Asunto</Label>
            <Input
              id={`s_${template.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`b_${template.id}`}>Cuerpo</Label>
          <Textarea
            id={`b_${template.id}`}
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={handleRestore}>
            <RotateCcw size={14} className="mr-1.5" /> Restaurar default
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye size={14} className="mr-1.5" /> Vista previa
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            Guardar
          </Button>
        </div>
      </div>

      <aside>
        <Label className="text-xs">Variables disponibles</Label>
        <p className="text-xs text-muted-foreground mb-2">Click para insertar en el cuerpo.</p>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="block w-full text-left text-xs font-mono px-2 py-1 rounded hover:bg-accent"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </aside>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Vista previa con datos de ejemplo</DialogTitle>
          </DialogHeader>
          {template.channel === "email" && renderedSubject && (
            <div className="text-sm">
              <span className="font-semibold">Asunto: </span>
              {renderedSubject}
            </div>
          )}
          <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm">
            {renderedBody}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/templates-section.tsx src/app/dashboard/configuracion/organizacion/template-editor.tsx
```
Expected: vacíos.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/templates-section.tsx src/app/dashboard/configuracion/organizacion/template-editor.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): templates accordion + editor con variables clickeables

TemplatesSection: lista por (event_type, channel) con accordion. WhatsApp
greyed out con badge "próximamente".

TemplateEditor: textarea + sidebar con vars permitidas (click inserta en
cursor), botón "Vista previa" abre dialog con render usando datos fake
realistas, botón "Guardar" llama updateOrgTemplate.

"Restaurar default" deja TODO comment — requiere action server reseed
(out of scope inmediato).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24 — Wire `<CommunicationsSection>` + dropdown del avatar

**Files:**
- Modify: `src/app/dashboard/configuracion/organizacion/communications-section.tsx` (reemplazar stub)
- Modify: `src/components/dashboard/top-bar.tsx` (agregar item "Configuración de organización")

- [ ] **Step 1: Reemplazar `communications-section.tsx`**

```tsx
"use client";

import { DomainCard } from "./domain-card";
import { TemplatesSection } from "./templates-section";
import type { Organization, OrgMessageTemplate } from "@/lib/types/database";

interface Props {
  organization: Organization;
  templates: OrgMessageTemplate[];
}

export function CommunicationsSection({ organization, templates }: Props) {
  return (
    <section className="rounded-lg border bg-card p-6 space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Comunicaciones</h2>
        <p className="text-sm text-muted-foreground">
          Dominio para mails al huésped y plantillas editables.
        </p>
      </header>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dominio Resend
        </h3>
        <DomainCard organization={organization} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Plantillas
        </h3>
        <TemplatesSection templates={templates} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Modificar `top-bar.tsx` para agregar item "Configuración de organización"**

```bash
git checkout HEAD -- src/components/dashboard/top-bar.tsx
grep -n "Mi perfil\|Building2\|Settings" src/components/dashboard/top-bar.tsx | head
```

Importar `Building2` si no está:
```tsx
import { Building2, ... } from "lucide-react";
```

Después del item "Mi perfil" agregar:

```tsx
<DropdownMenuItem asChild>
  <Link href="/dashboard/configuracion/organizacion" className="cursor-pointer">
    <Building2 size={14} />
    Configuración de organización
  </Link>
</DropdownMenuItem>
```

(Sin gating por rol — decisión Spec 2.)

- [ ] **Step 3: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/configuracion/organizacion/communications-section.tsx src/components/dashboard/top-bar.tsx
```
Expected: vacíos.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/configuracion/organizacion/communications-section.tsx src/components/dashboard/top-bar.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(org-config): wire CommunicationsSection + item dropdown avatar

CommunicationsSection arma DomainCard + TemplatesSection con headers
visuales claros.

TopBar dropdown ahora tiene "Configuración de organización" debajo de
"Mi perfil", linkea a la nueva ruta. Sin gating por rol.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Checkpoint PR 2.B

- [ ] **Verificación final del PR 2.B**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end tsc)"
npm run lint -- src/lib/actions/org.ts src/lib/email/templates/variables.ts src/app/dashboard/configuracion/organizacion/ src/components/dashboard/ 2>&1 | tail -10
git log --oneline main..HEAD | head -25
```

Expected: tsc filtrado vacío. Log con commits PR 2.A + PR 2.B (Tasks 1-24).

- [ ] **Smoke pass manual de PR 2.B:**
  - Abrir `/dashboard/configuracion/organizacion`. Ver las 3 secciones.
  - Editar identidad, guardar. Verificar que el nombre cambió en TopBar y sidebar.
  - Subir un logo, verificar que el `<OrgBrand>` del sidebar lo muestra en lugar de Apart Cba.
  - Eliminar logo, verificar que vuelve al brand Apart Cba.
  - Crear dominio Resend (usar un dominio que controles real). Ver tabla de DNS records.
  - Agregar los DNS en tu proveedor, esperar minutos, click "Verificar ahora". Ver estado verificado.
  - Click "Cambiar configuración" → confirma → vuelve al estado vacío.
  - Abrir el accordion del template "Confirmación de reserva — Email", editarlo, vista previa, guardar.
  - Tratar de guardar con una variable inventada `{{foo.bar}}` → esperar error claro.
  - Item "Configuración de organización" del dropdown → linkea correctamente.

---

# PR 2.C — Seguridad de credenciales (password, email, 2FA)

**Goal del PR**: dejar el Tab Seguridad de `/dashboard/perfil` con 3 cards funcionales (Contraseña, Email, 2FA) + login con TOTP + recovery codes.

**Files que va a tocar PR 2.C:**
- `src/lib/actions/security.ts` (create — server actions de toda la sección)
- `src/lib/security/audit.ts` (create — helper para insert security_audit_log)
- `src/lib/security/recovery-codes.ts` (create — generación + verificación de codes)
- `src/app/dashboard/perfil/security-section.tsx` (modify — reemplaza placeholder por implementación real)
- `src/app/dashboard/perfil/security/password-card.tsx` (create)
- `src/app/dashboard/perfil/security/email-card.tsx` (create)
- `src/app/dashboard/perfil/security/two-factor-card.tsx` (create)
- `src/app/dashboard/perfil/security/two-factor-wizard.tsx` (create)
- `src/app/confirm-email-change/page.tsx` (create — público)
- `src/app/cancel-email-change/page.tsx` (create — público)
- `src/app/login/2fa/page.tsx` (create)
- `src/app/login/2fa/totp-form.tsx` (create)
- `src/lib/actions/auth.ts` (modify — signIn redirect si AAL=aal1 con factor activo)

---

## Task 25 — `src/lib/security/audit.ts` (helper para insert events)

**Goal:** Helper que escribe en `security_audit_log` desde cualquier server action de seguridad.

**Files:**
- Create: `src/lib/security/audit.ts`

- [ ] **Step 1: Crear el helper**

```ts
import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type { SecurityEventType } from "@/lib/types/database";

/**
 * Inserta un evento en security_audit_log. Best-effort: nunca throw —
 * si falla loggea a console y sigue.
 */
export async function logSecurityEvent(args: {
  userId: string;
  eventType: SecurityEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = h.get("user-agent") ?? null;
    const admin = createAdminClient();
    await admin.from("security_audit_log").insert({
      user_id: args.userId,
      event_type: args.eventType,
      metadata: args.metadata ?? null,
      ip,
      user_agent: userAgent,
    });
  } catch (e) {
    console.warn("Failed to log security event", args.eventType, e);
  }
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/security/audit.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/security/audit.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): logSecurityEvent helper para audit log

Wrap insert en security_audit_log con captura automática de IP +
user agent desde headers. Best-effort: nunca throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26 — `changePassword` server action + integración con mail sistema

**Files:**
- Create: `src/lib/actions/security.ts`

- [ ] **Step 1: Crear `src/lib/actions/security.ts` con la primera action**

```ts
"use server";

import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { logSecurityEvent } from "@/lib/security/audit";
import { sendSystemMail } from "@/lib/email/system";

// ════════════════════════════════════════════════════════════════════════
// Cambio de contraseña
// ════════════════════════════════════════════════════════════════════════

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
  newPassword: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Za-z]/, "Debe incluir al menos una letra")
    .regex(/[0-9]/, "Debe incluir al menos un número"),
});

export type ChangePasswordInput = z.infer<typeof passwordSchema>;

export async function changePassword(
  input: ChangePasswordInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // Re-auth con la contraseña actual
  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const email = userData.user?.email;
  if (!email) return { ok: false, error: "No se pudo obtener el email del usuario" };

  const { error: signInError } = await sb.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña actual incorrecta" };

  // Actualizar password
  const { error: updateError } = await sb.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (updateError) return { ok: false, error: updateError.message };

  // Audit log + mail (best-effort)
  await logSecurityEvent({
    userId: session.userId,
    eventType: "password_changed",
  });
  const mailResult = await sendSystemMail({
    to: email,
    template: {
      name: "password-changed",
      vars: { occurredAt: new Date().toLocaleString("es-AR") },
    },
  });
  if (!mailResult.ok) {
    await logSecurityEvent({
      userId: session.userId,
      eventType: "password_changed",
      metadata: { notification_failed: true, error: mailResult.error },
    });
  }

  return { ok: true };
}
```

- [ ] **Step 2: Verificar tsc + lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/security.ts
```
Expected: vacíos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/security.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): changePassword server action

Re-auth con currentPassword (signInWithPassword) → updateUser({ password }).
Audit log + sendSystemMail "password-changed" best-effort.

Si el mail falla NO bloquea el cambio; loggea evento extra con
notification_failed=true para alertas operativas futuras.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27 — `<PasswordCard>` UI

**Files:**
- Create: `src/app/dashboard/perfil/security/password-card.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { changePassword } from "@/lib/actions/security";

export function PasswordCard() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    startTransition(async () => {
      const result = await changePassword({ currentPassword: current, newPassword: newPwd });
      if (!result.ok) {
        toast.error("Error al cambiar contraseña", { description: result.error });
        return;
      }
      toast.success("Contraseña actualizada — te enviamos un mail de aviso");
      setOpen(false);
      setCurrent("");
      setNewPwd("");
      setConfirm("");
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Lock size={14} /> Contraseña
          </h3>
          <p className="text-sm text-muted-foreground">
            Cambiala periódicamente. Te avisamos por mail cada vez que la actualices.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Cambiar</Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>
              Te vamos a pedir tu contraseña actual antes de aplicar el cambio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cur_pwd">Contraseña actual</Label>
              <Input
                id="cur_pwd"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_pwd">Nueva contraseña</Label>
              <Input
                id="new_pwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Mínimo 8 caracteres, con letra y número.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf_pwd">Confirmar nueva contraseña</Label>
              <Input
                id="conf_pwd"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Cambiar contraseña
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint** + commit

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/security/password-card.tsx
git add src/app/dashboard/perfil/security/password-card.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): <PasswordCard> + dialog para cambiar contraseña

Dialog con 3 campos: actual + nueva + confirmar.
Validación cliente: nueva ≥ 8 chars, las dos coinciden.
Server action changePassword + toast con aviso del mail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 28 — Email change server actions (request + confirm + cancel)

**Files:**
- Modify: `src/lib/actions/security.ts` (append)

- [ ] **Step 1: Append todo al archivo**

```ts

// ════════════════════════════════════════════════════════════════════════
// Cambio de email — request + confirm + cancel
// ════════════════════════════════════════════════════════════════════════

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import {
  emailChangeConfirmTemplate,
  emailChangeNotifyOldTemplate,
  emailChangeCancelConfirmTemplate,
} from "@/lib/email/templates/system";

const emailChangeSchema = z.object({
  newEmail: z.string().email("Email inválido").max(200),
  currentPassword: z.string().min(1),
});

export async function requestEmailChange(
  input: z.infer<typeof emailChangeSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = emailChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const oldEmail = userData.user?.email;
  if (!oldEmail) return { ok: false, error: "No se pudo obtener el email actual" };

  if (oldEmail.toLowerCase() === parsed.data.newEmail.toLowerCase()) {
    return { ok: false, error: "El nuevo email es igual al actual" };
  }

  // Re-auth
  const { error: signInError } = await sb.auth.signInWithPassword({
    email: oldEmail,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña incorrecta" };

  const admin = createAdminClient();

  // Verificar que el nuevo email no esté tomado por otra cuenta
  // listUsers en admin SDK; si hay rate-limit, usamos sb.auth.admin via service role
  const authAdmin = createAdminClient(); // mismo client; auth admin queries usan otro endpoint pero supabase-js maneja
  const { data: existing } = await admin
    .from("user_profiles")
    .select("user_id")
    .limit(1);
  // ^ user_profiles no tiene email; hay que mirar auth.users vía admin
  // Workaround simple: tratar de generar un signup token con ese email; si ya existe Supabase devuelve error.
  // Acá vamos por intento directo más adelante en confirmEmailChange — antes de eso solo registramos request.
  void existing; // suprimir unused

  // Marcar requests anteriores como cancelled
  await admin
    .from("email_change_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("confirmed_at", null)
    .is("cancelled_at", null);

  // Generar tokens
  const confirmToken = randomBytes(32).toString("hex");
  const cancelToken = randomBytes(32).toString("hex");
  const confirmHash = await bcrypt.hash(confirmToken, 10);
  const cancelHash = await bcrypt.hash(cancelToken, 10);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const { error: insertErr } = await admin.from("email_change_requests").insert({
    user_id: session.userId,
    old_email: oldEmail,
    new_email: parsed.data.newEmail.toLowerCase(),
    confirm_token_hash: confirmHash,
    cancel_token_hash: cancelHash,
    expires_at: expires.toISOString(),
  });
  if (insertErr) return { ok: false, error: insertErr.message };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const confirmUrl = `${baseUrl}/confirm-email-change?token=${confirmToken}`;
  const cancelUrl = `${baseUrl}/cancel-email-change?token=${cancelToken}`;

  // Mail al nuevo (best-effort)
  await sendSystemMail({
    to: parsed.data.newEmail,
    template: {
      name: "email-change-confirm",
      vars: {
        confirmUrl,
        expiresAt: expires.toLocaleString("es-AR"),
      },
    },
  });

  // Mail al viejo (best-effort)
  const notifyResult = await sendSystemMail({
    to: oldEmail,
    template: {
      name: "email-change-notify-old",
      vars: { newEmail: parsed.data.newEmail, cancelUrl },
    },
  });
  if (notifyResult.ok) {
    await admin
      .from("email_change_requests")
      .update({ notified_old_at: new Date().toISOString() })
      .eq("user_id", session.userId)
      .is("confirmed_at", null)
      .is("cancelled_at", null);
  }

  await logSecurityEvent({
    userId: session.userId,
    eventType: "email_change_requested",
    metadata: { from: oldEmail, to: parsed.data.newEmail },
  });

  return { ok: true };
}

// Confirma el cambio. Pública (no requiere session — viene del link del mail).
export async function confirmEmailChange(
  token: string
): Promise<{ ok: true; newEmail: string } | { ok: false; error: string }> {
  if (!token || token.length !== 64) return { ok: false, error: "Token inválido" };
  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from("email_change_requests")
    .select("*")
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: error.message };

  // Buscar por bcrypt match
  let matched = null;
  for (const req of requests ?? []) {
    if (await bcrypt.compare(token, req.confirm_token_hash)) {
      matched = req;
      break;
    }
  }
  if (!matched) return { ok: false, error: "Token inválido o expirado" };

  // Aplicar cambio en auth.users
  const { error: updErr } = await admin.auth.admin.updateUserById(matched.user_id, {
    email: matched.new_email,
  });
  if (updErr) return { ok: false, error: updErr.message };

  await admin
    .from("email_change_requests")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", matched.id);

  await logSecurityEvent({
    userId: matched.user_id,
    eventType: "email_change_confirmed",
    metadata: { from: matched.old_email, to: matched.new_email },
  });

  return { ok: true, newEmail: matched.new_email };
}

// Cancela el cambio desde el link al viejo email. Pública.
export async function cancelEmailChange(
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || token.length !== 64) return { ok: false, error: "Token inválido" };
  const admin = createAdminClient();

  const { data: requests } = await admin
    .from("email_change_requests")
    .select("*")
    .is("confirmed_at", null)
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  let matched = null;
  for (const req of requests ?? []) {
    if (await bcrypt.compare(token, req.cancel_token_hash)) {
      matched = req;
      break;
    }
  }
  if (!matched) return { ok: false, error: "Token inválido o ya procesado" };

  await admin
    .from("email_change_requests")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", matched.id);

  await logSecurityEvent({
    userId: matched.user_id,
    eventType: "email_change_cancelled",
    metadata: { attempted_email: matched.new_email },
  });

  // Mail de aviso al viejo (que es el que está cancelando)
  await sendSystemMail({
    to: matched.old_email,
    template: { name: "email-change-cancel-confirm", vars: {} },
  });

  return { ok: true };
}
```

- [ ] **Step 2: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/security.ts
git add src/lib/actions/security.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): email change — request + confirm + cancel server actions

requestEmailChange: re-auth con currentPassword, marca requests previas
como cancelled, genera 2 tokens (confirm + cancel) hasheados con bcrypt,
expira en 24h. Mail al nuevo (confirmar) + mail al viejo (cancelar).

confirmEmailChange: lookup por bcrypt match contra hashes activos,
auth.admin.updateUserById, marca confirmed_at, audit log.

cancelEmailChange: idem busqueda por bcrypt, marca cancelled_at,
audit log, mail de confirmación al viejo email.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 29 — Páginas públicas `/confirm-email-change` y `/cancel-email-change`

**Files:**
- Create: `src/app/confirm-email-change/page.tsx`
- Create: `src/app/cancel-email-change/page.tsx`

- [ ] **Step 1: Crear `confirm-email-change/page.tsx`**

```tsx
import Link from "next/link";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmEmailChange } from "@/lib/actions/security";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ConfirmEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) {
    return <ResultPanel kind="error" message="Falta el token en el link." />;
  }
  const result = await confirmEmailChange(token);
  if (!result.ok) {
    return <ResultPanel kind="error" message={result.error} />;
  }
  return (
    <ResultPanel
      kind="success"
      message={`Tu email fue actualizado a ${result.newEmail}. Cerramos tu sesión actual; volvé a entrar con el nuevo email.`}
    />
  );
}

function ResultPanel({ kind, message }: { kind: "success" | "error"; message: string }) {
  const Icon = kind === "success" ? CheckCircle2 : AlertTriangle;
  const color = kind === "success" ? "text-emerald-600" : "text-destructive";
  return (
    <main className="min-h-svh flex items-center justify-center px-4 py-10 bg-muted/40">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center space-y-4">
        <Icon size={48} className={`mx-auto ${color}`} />
        <h1 className="text-xl font-semibold">
          {kind === "success" ? "Email actualizado" : "No pudimos confirmar"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild>
          <Link href="/login">Ir al login</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Crear `cancel-email-change/page.tsx`**

```tsx
import Link from "next/link";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelEmailChange } from "@/lib/actions/security";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function CancelEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) {
    return <ResultPanel kind="error" message="Falta el token en el link." />;
  }
  const result = await cancelEmailChange(token);
  if (!result.ok) {
    return <ResultPanel kind="error" message={result.error} />;
  }
  return (
    <ResultPanel
      kind="success"
      message="Cancelaste el cambio de email. Tu cuenta sigue con el email actual y te enviamos un correo de confirmación."
    />
  );
}

function ResultPanel({ kind, message }: { kind: "success" | "error"; message: string }) {
  const Icon = kind === "success" ? CheckCircle2 : AlertTriangle;
  const color = kind === "success" ? "text-emerald-600" : "text-destructive";
  return (
    <main className="min-h-svh flex items-center justify-center px-4 py-10 bg-muted/40">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center space-y-4">
        <Icon size={48} className={`mx-auto ${color}`} />
        <h1 className="text-xl font-semibold">
          {kind === "success" ? "Cambio cancelado" : "No pudimos cancelar"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild>
          <Link href="/dashboard">Volver al dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/confirm-email-change/page.tsx src/app/cancel-email-change/page.tsx
git add src/app/confirm-email-change/ src/app/cancel-email-change/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): páginas públicas de confirmar/cancelar email change

/confirm-email-change?token=XXX → llama server action, muestra resultado,
botón "Ir al login" (la sesión vieja se invalida al cambiar email).

/cancel-email-change?token=YYY → cancela el request, mail de confirmación
al viejo email, botón "Volver al dashboard".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 30 — `<EmailCard>` UI

**Files:**
- Create: `src/app/dashboard/perfil/security/email-card.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { requestEmailChange } from "@/lib/actions/security";

interface Props {
  email: string;
}

export function EmailCard({ email }: Props) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestEmailChange({ newEmail: newEmail.trim(), currentPassword: pwd });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success(`Te enviamos un mail a ${newEmail.trim()}. Confirmalo en las próximas 24hs.`);
      setOpen(false);
      setNewEmail("");
      setPwd("");
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail size={14} /> Email
          </h3>
          <p className="text-sm text-muted-foreground">
            Email actual: <span className="font-mono">{email}</span>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Cambiar</Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar email</DialogTitle>
            <DialogDescription>
              Te vamos a enviar un link de confirmación al nuevo email. También notificamos al email
              actual con un link para cancelar (por si no fuiste vos).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new_email">Nuevo email</Label>
              <Input
                id="new_email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email_pwd">Contraseña actual</Label>
              <Input
                id="email_pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Solicitar cambio
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/security/email-card.tsx
git add src/app/dashboard/perfil/security/email-card.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): <EmailCard> + dialog para solicitar cambio de email

Form: nuevo email + contraseña actual (re-auth).
Server action requestEmailChange dispara los 2 mails (confirmar al
nuevo + avisar al viejo con cancel link).

Toast claro: "te enviamos un mail al nuevo email, confirmalo en 24hs".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 31 — `src/lib/security/recovery-codes.ts` + MFA enrollment server actions

**Files:**
- Create: `src/lib/security/recovery-codes.ts`
- Modify: `src/lib/actions/security.ts` (append)

- [ ] **Step 1: Crear `src/lib/security/recovery-codes.ts`**

```ts
import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const CODE_COUNT = 8;

/**
 * Genera CODE_COUNT codes en formato XXXX-XXXX-XXXX-XXXX.
 * Los hashea con bcrypt e inserta en user_2fa_recovery_codes.
 * Devuelve los codes plain — única vez que existen.
 *
 * Antes de generar, marca todos los codes activos previos como
 * used_at = now() (los invalida).
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const admin = createAdminClient();

  // Invalidar codes previos
  await admin
    .from("user_2fa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("used_at", null);

  const codes: string[] = [];
  const inserts: Array<{ user_id: string; code_hash: string }> = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    const code = formatCode(randomBytes(8).toString("hex").toUpperCase().slice(0, 16));
    codes.push(code);
    inserts.push({ user_id: userId, code_hash: await bcrypt.hash(code, 10) });
  }
  const { error } = await admin.from("user_2fa_recovery_codes").insert(inserts);
  if (error) throw new Error(error.message);
  return codes;
}

function formatCode(raw: string): string {
  // raw = 16 chars, formatear como 4-4-4-4
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

/**
 * Valida un recovery code contra los activos del user. Si match, marca
 * used_at = now() y devuelve true. Sino false.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  if (normalized.length !== 19) return false;  // XXXX-XXXX-XXXX-XXXX
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("user_2fa_recovery_codes")
    .select("id, code_hash")
    .eq("user_id", userId)
    .is("used_at", null);
  for (const row of rows ?? []) {
    if (await bcrypt.compare(normalized, row.code_hash)) {
      await admin
        .from("user_2fa_recovery_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", row.id);
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Append MFA actions a `src/lib/actions/security.ts`**

```ts

// ════════════════════════════════════════════════════════════════════════
// 2FA enrollment + verify + disable + recovery codes
// ════════════════════════════════════════════════════════════════════════

import { generateRecoveryCodes } from "@/lib/security/recovery-codes";
import { twoFactorEnabledTemplate, twoFactorDisabledTemplate } from "@/lib/email/templates/system";

export async function enrollMfaFactor(): Promise<
  { ok: true; factorId: string; qrCode: string; secret: string; uri: string } | { ok: false; error: string }
> {
  await requireSession();
  const sb = await createClient();
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Apart Cba",
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.totp) return { ok: false, error: "Supabase no devolvió TOTP" };
  return {
    ok: true,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

const verifyEnrollSchema = z.object({
  factorId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "El código son 6 dígitos"),
});

export async function verifyMfaEnrollment(
  input: z.infer<typeof verifyEnrollSchema>
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = verifyEnrollSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };

  const sb = await createClient();
  const { data: challenge, error: challengeError } = await sb.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challengeError) return { ok: false, error: challengeError.message };

  const { error: verifyError } = await sb.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyError) return { ok: false, error: "Código incorrecto" };

  const codes = await generateRecoveryCodes(session.userId);

  await logSecurityEvent({
    userId: session.userId,
    eventType: "2fa_enabled",
  });

  // Mail best-effort
  const { data: userData } = await sb.auth.getUser();
  const email = userData.user?.email;
  if (email) {
    await sendSystemMail({
      to: email,
      template: { name: "2fa-enabled", vars: { occurredAt: new Date().toLocaleString("es-AR") } },
    });
  }

  return { ok: true, recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(args: {
  currentPassword: string;
}): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const session = await requireSession();
  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const email = userData.user?.email;
  if (!email) return { ok: false, error: "No se pudo obtener email" };

  const { error: signInError } = await sb.auth.signInWithPassword({
    email,
    password: args.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña incorrecta" };

  const codes = await generateRecoveryCodes(session.userId);

  await logSecurityEvent({
    userId: session.userId,
    eventType: "2fa_recovery_codes_regenerated",
  });

  return { ok: true, codes };
}

const disable2faSchema = z.object({
  currentPassword: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/, "El código son 6 dígitos"),
});

export async function disable2fa(
  input: z.infer<typeof disable2faSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const parsed = disable2faSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };

  const sb = await createClient();
  const { data: userData } = await sb.auth.getUser();
  const email = userData.user?.email;
  if (!email) return { ok: false, error: "No se pudo obtener email" };

  // Re-auth
  const { error: signInError } = await sb.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
  });
  if (signInError) return { ok: false, error: "Contraseña incorrecta" };

  // Listar factors activos
  const { data: factorsData, error: listErr } = await sb.auth.mfa.listFactors();
  if (listErr) return { ok: false, error: listErr.message };
  const totpFactor = factorsData.totp?.[0];
  if (!totpFactor) return { ok: false, error: "No hay factor 2FA activo" };

  // Verify TOTP code primero
  const { data: challenge } = await sb.auth.mfa.challenge({ factorId: totpFactor.id });
  const { error: verifyErr } = await sb.auth.mfa.verify({
    factorId: totpFactor.id,
    challengeId: challenge.id,
    code: parsed.data.totpCode,
  });
  if (verifyErr) return { ok: false, error: "Código TOTP incorrecto" };

  // Unenroll
  const { error: unenrollErr } = await sb.auth.mfa.unenroll({ factorId: totpFactor.id });
  if (unenrollErr) return { ok: false, error: unenrollErr.message };

  // Marcar todos los recovery codes como usados
  const admin = createAdminClient();
  await admin
    .from("user_2fa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("used_at", null);

  await logSecurityEvent({
    userId: session.userId,
    eventType: "2fa_disabled",
  });

  await sendSystemMail({
    to: email,
    template: { name: "2fa-disabled", vars: { occurredAt: new Date().toLocaleString("es-AR") } },
  });

  return { ok: true };
}

/**
 * Lookup del estado MFA del user actual. Server-only helper para SSR de
 * la card de seguridad.
 */
export async function getMfaStatus(): Promise<{
  enrolled: boolean;
  factorId: string | null;
  enabledAt: string | null;
}> {
  await requireSession();
  const sb = await createClient();
  const { data: factorsData } = await sb.auth.mfa.listFactors();
  const totpFactor = factorsData?.totp?.[0];
  if (!totpFactor || totpFactor.status !== "verified") {
    return { enrolled: false, factorId: null, enabledAt: null };
  }
  return {
    enrolled: true,
    factorId: totpFactor.id,
    enabledAt: totpFactor.created_at ?? null,
  };
}
```

- [ ] **Step 3: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/security/recovery-codes.ts src/lib/actions/security.ts
git add src/lib/security/recovery-codes.ts src/lib/actions/security.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): MFA enrollment + recovery codes + disable

recovery-codes.ts: generateRecoveryCodes (8 codes XXXX-XXXX-XXXX-XXXX,
bcrypt hashed), consumeRecoveryCode (single-use lookup).

security.ts:
- enrollMfaFactor: supabase.auth.mfa.enroll TOTP, devuelve QR + secret
- verifyMfaEnrollment: challenge + verify, genera recovery codes,
  audit log, mail
- regenerateRecoveryCodes: re-auth + invalida + genera 8 nuevos
- disable2fa: re-auth + verify TOTP + unenroll + invalida codes + mail
- getMfaStatus: helper SSR para card de seguridad

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 32 — `<TwoFactorCard>` + `<TwoFactorWizard>` UI

**Files:**
- Create: `src/app/dashboard/perfil/security/two-factor-card.tsx`
- Create: `src/app/dashboard/perfil/security/two-factor-wizard.tsx`

- [ ] **Step 1: Crear `two-factor-wizard.tsx`** (el wizard de 3 steps)

```tsx
"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { enrollMfaFactor, verifyMfaEnrollment } from "@/lib/actions/security";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = "qr" | "verify" | "codes";

export function TwoFactorWizard({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("qr");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Trigger enroll al abrir
  function handleOpenChange(next: boolean) {
    if (next && !factorId) {
      startTransition(async () => {
        const result = await enrollMfaFactor();
        if (!result.ok) {
          toast.error("Error", { description: result.error });
          onOpenChange(false);
          return;
        }
        setFactorId(result.factorId);
        setQrCode(result.qrCode);
        setSecret(result.secret);
      });
    }
    onOpenChange(next);
    if (!next) {
      // Reset al cerrar
      setStep("qr");
      setFactorId(null);
      setQrCode(null);
      setSecret(null);
      setCode("");
      setRecoveryCodes([]);
    }
  }

  function handleVerify() {
    if (!factorId) return;
    startTransition(async () => {
      const result = await verifyMfaEnrollment({ factorId, code });
      if (!result.ok) {
        toast.error("Código incorrecto", { description: result.error });
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setStep("codes");
    });
  }

  function handleCopySecret() {
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1500);
  }

  function handleCopyAllCodes() {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  function handleDownloadCodes() {
    const blob = new Blob(
      [`Apart Cba — Códigos de recuperación 2FA\nGenerados: ${new Date().toLocaleString("es-AR")}\n\n${recoveryCodes.join("\n")}\n\nCada código es de un solo uso.`],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apartcba-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFinish() {
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activar verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {step === "qr" && "Escaneá el QR con tu app de autenticación (Authy, Google Authenticator, 1Password)."}
            {step === "verify" && "Ingresá el código de 6 dígitos que muestra tu app."}
            {step === "codes" && "Guardá estos códigos en un lugar seguro. No los vamos a volver a mostrar."}
          </DialogDescription>
        </DialogHeader>

        {step === "qr" && (
          <div className="space-y-3">
            {qrCode ? (
              <>
                <div className="rounded-md border p-4 flex justify-center bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCode} alt="QR 2FA" width={200} height={200} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">¿No podés escanear? Copiá este código manualmente:</Label>
                  <div className="flex items-center gap-2">
                    <Input value={secret ?? ""} readOnly className="font-mono text-xs" />
                    <Button type="button" size="icon" variant="ghost" onClick={handleCopySecret}>
                      {copiedSecret ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setStep("verify")}>Siguiente →</Button>
                </DialogFooter>
              </>
            ) : (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="totp_code">Código de 6 dígitos</Label>
              <Input
                id="totp_code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                autoFocus
                className="text-center tracking-widest font-mono text-lg"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("qr")}>← Atrás</Button>
              <Button onClick={handleVerify} disabled={code.length !== 6 || isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Verificar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "codes" && (
          <div className="space-y-3">
            <div className="rounded-md border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 p-3 flex items-start gap-2">
              <Shield size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Guardá estos códigos AHORA.</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">No los vamos a volver a mostrar. Si perdés el dispositivo Y los códigos, vas a tener que contactar al admin para resetear 2FA.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <div key={c} className="rounded bg-muted px-3 py-2 text-center">{c}</div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleCopyAllCodes}>
                {copiedAll ? <Check size={14} className="mr-1.5 text-emerald-600" /> : <Copy size={14} className="mr-1.5" />}
                Copiar todos
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleDownloadCodes}>
                Descargar .txt
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={handleFinish}>Listo, los guardé</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Crear `two-factor-card.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { TwoFactorWizard } from "./two-factor-wizard";
import { regenerateRecoveryCodes, disable2fa } from "@/lib/actions/security";

interface Props {
  enrolled: boolean;
  enabledAt: string | null;
}

export function TwoFactorCard({ enrolled, enabledAt }: Props) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <section className="rounded-lg border bg-card p-6 space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {enrolled ? <ShieldCheck size={14} className="text-emerald-600" /> : <Shield size={14} />}
            Verificación en dos pasos
          </h3>
          <p className="text-sm text-muted-foreground">
            {enrolled
              ? `Activa desde ${enabledAt ? new Date(enabledAt).toLocaleDateString("es-AR") : "—"}.`
              : "Agregá un código de 6 dígitos generado por tu app de autenticación al login."}
          </p>
        </div>
        {!enrolled && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>Activar 2FA</Button>
        )}
      </header>

      {enrolled && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => setRegenOpen(true)}>
            Generar nuevos códigos de recuperación
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDisableOpen(true)} className="text-destructive">
            Desactivar 2FA
          </Button>
        </div>
      )}

      <TwoFactorWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSuccess={() => router.refresh()}
      />

      <RegenerateDialog open={regenOpen} onOpenChange={setRegenOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </section>
  );
}

function RegenerateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pwd, setPwd] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await regenerateRecoveryCodes({ currentPassword: pwd });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      setCodes(result.codes);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPwd(""); setCodes(null); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar nuevos códigos de recuperación</DialogTitle>
          <DialogDescription>
            Esto invalida los códigos anteriores. Vas a ver 8 nuevos — guardalos.
          </DialogDescription>
        </DialogHeader>
        {!codes && (
          <form onSubmit={handleGenerate} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rg_pwd">Contraseña actual</Label>
              <Input id="rg_pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Generar
              </Button>
            </DialogFooter>
          </form>
        )}
        {codes && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {codes.map((c) => (
                <div key={c} className="rounded bg-muted px-3 py-2 text-center">{c}</div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Listo</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await disable2fa({ currentPassword: pwd, totpCode: code });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success("2FA desactivado");
      onOpenChange(false);
      setPwd("");
      setCode("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPwd(""); setCode(""); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Desactivar 2FA</DialogTitle>
          <DialogDescription>
            Vas a poder entrar con solo tu contraseña. Te recomendamos mantener 2FA activo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleDisable} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="d_pwd">Contraseña actual</Label>
            <Input id="d_pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d_code">Código TOTP actual (6 dígitos)</Label>
            <Input id="d_code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required className="font-mono text-center tracking-widest" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={isPending || code.length !== 6}>
              {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              Desactivar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Reemplazar `security-section.tsx` (placeholder de PR 2.A) con la implementación real**

```tsx
import { getMfaStatus } from "@/lib/actions/security";
import { PasswordCard } from "./security/password-card";
import { EmailCard } from "./security/email-card";
import { TwoFactorCard } from "./security/two-factor-card";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
}

export async function SecuritySection({ profile: _profile, email }: Props) {
  const mfa = await getMfaStatus();
  return (
    <div className="space-y-4">
      <PasswordCard />
      <EmailCard email={email} />
      <TwoFactorCard enrolled={mfa.enrolled} enabledAt={mfa.enabledAt} />
    </div>
  );
}
```

**Importante**: `SecuritySection` ahora es async (server component). Verificar que esté envuelto en Suspense o que el padre lo soporte. El padre es `ProfileTabs` que es client component → necesitamos pasarle `mfa` desde el server. Solución: pasar `mfaStatus` desde `page.tsx`:

Modificar `src/app/dashboard/perfil/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getMfaStatus } from "@/lib/actions/security";
import { ProfileTabs } from "./profile-tabs";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const mfa = await getMfaStatus();

  return (
    <div className="container max-w-3xl py-6 px-4 sm:px-6">
      <h1 className="text-2xl font-bold mb-6">Mi perfil</h1>
      <ProfileTabs profile={session.profile} email={session.user.email ?? ""} mfaStatus={mfa} />
    </div>
  );
}
```

Y modificar `profile-tabs.tsx` para aceptar `mfaStatus` y pasarlo a `<SecuritySection>` (que ahora es client component sync):

```tsx
// Top of profile-tabs.tsx
interface ProfileTabsProps {
  profile: UserProfile;
  email: string;
  mfaStatus: { enrolled: boolean; enabledAt: string | null };
}

// ...
<TabsContent value="seguridad">
  <SecuritySection profile={profile} email={email} mfaStatus={mfaStatus} />
</TabsContent>
```

Y `security-section.tsx` queda **client** (no async):

```tsx
"use client";

import { PasswordCard } from "./security/password-card";
import { EmailCard } from "./security/email-card";
import { TwoFactorCard } from "./security/two-factor-card";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  mfaStatus: { enrolled: boolean; enabledAt: string | null };
}

export function SecuritySection({ profile: _profile, email, mfaStatus }: Props) {
  return (
    <div className="space-y-4">
      <PasswordCard />
      <EmailCard email={email} />
      <TwoFactorCard enrolled={mfaStatus.enrolled} enabledAt={mfaStatus.enabledAt} />
    </div>
  );
}
```

- [ ] **Step 4: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/dashboard/perfil/security/ src/app/dashboard/perfil/security-section.tsx src/app/dashboard/perfil/profile-tabs.tsx src/app/dashboard/perfil/page.tsx
git add src/app/dashboard/perfil/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(perfil): tab Seguridad completo — PasswordCard + EmailCard + 2FA

PasswordCard, EmailCard ya existían (Tasks 27, 30).
TwoFactorCard: estados enrolled/no-enrolled con wizard de 3 steps
(QR + secret → verify TOTP → recovery codes), regenerate dialog,
disable dialog (re-auth + verify TOTP).

SecuritySection vuelve a client component recibiendo mfaStatus desde
page.tsx (que lo fetchea SSR via getMfaStatus).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 33 — Login flow con 2FA + recovery code

**Files:**
- Modify: `src/lib/actions/auth.ts` (signIn redirect)
- Create: `src/app/login/2fa/page.tsx`
- Create: `src/app/login/2fa/totp-form.tsx`
- Modify: `src/lib/actions/security.ts` (append verifyMfaLogin + useRecoveryCode)

- [ ] **Step 1: Append a `src/lib/actions/security.ts`**

```ts

import { consumeRecoveryCode } from "@/lib/security/recovery-codes";

export async function verifyMfaLogin(args: {
  factorId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(args.code)) return { ok: false, error: "Código inválido" };
  const sb = await createClient();
  const { data: challenge, error: chErr } = await sb.auth.mfa.challenge({ factorId: args.factorId });
  if (chErr) return { ok: false, error: chErr.message };
  const { error: verifyErr } = await sb.auth.mfa.verify({
    factorId: args.factorId,
    challengeId: challenge.id,
    code: args.code,
  });
  if (verifyErr) return { ok: false, error: "Código incorrecto" };
  return { ok: true };
}

/**
 * Login con recovery code: marca el code como usado y desactiva
 * temporalmente el factor MFA. Esto fuerza al usuario a re-enrolear
 * 2FA en su próxima visita a la sección de seguridad.
 *
 * NOTA: este flow es un workaround. Supabase MFA requiere TOTP para
 * elevar AAL a aal2. Para no bloquear al usuario que perdió el dispositivo
 * Y tiene un recovery code, desactivamos el factor — la sesión queda como
 * aal1 pero el user puede entrar al dashboard. La UI le va a pedir que
 * re-enrolee 2FA.
 */
export async function useRecoveryCodeLogin(args: { code: string }): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await requireSession();
  const valid = await consumeRecoveryCode(session.userId, args.code);
  if (!valid) return { ok: false, error: "Código de recuperación inválido o ya usado" };

  // Desactivar el factor MFA para que el user pueda continuar
  const sb = await createClient();
  const { data: factorsData } = await sb.auth.mfa.listFactors();
  const totpFactor = factorsData?.totp?.[0];
  if (totpFactor) {
    await sb.auth.mfa.unenroll({ factorId: totpFactor.id });
    // Marcar todos los recovery codes como usados (porque uno se consumió y el factor se reseteó)
    const admin = createAdminClient();
    await admin
      .from("user_2fa_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", session.userId)
      .is("used_at", null);
  }

  await logSecurityEvent({
    userId: session.userId,
    eventType: "login_with_recovery_code",
    metadata: { mfa_factor_disabled: true },
  });

  return { ok: true };
}
```

- [ ] **Step 2: Modificar `src/lib/actions/auth.ts` — `signIn` debe verificar AAL**

```bash
git checkout HEAD -- src/lib/actions/auth.ts
grep -n "signInWithPassword\|export async function signIn" src/lib/actions/auth.ts | head
```

Buscar la action `signIn` (o equivalente) y agregar lookup post-login del nivel AAL:

Justo después del `signInWithPassword` exitoso, antes del `redirect`:

```ts
// Spec 2: si el user tiene factor TOTP activo, redirigir a /login/2fa
const sb = await createClient();
const { data: factorsData } = await sb.auth.mfa.listFactors();
const totpFactor = factorsData?.totp?.[0];
if (totpFactor && totpFactor.status === "verified") {
  // No redirect a dashboard — pasar por /login/2fa
  redirect(`/login/2fa?factorId=${totpFactor.id}`);
}
```

(Si el patrón en el archivo difiere, adaptar a la firma actual.)

- [ ] **Step 3: Crear `src/app/login/2fa/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { TotpForm } from "./totp-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ factorId?: string }>;
}

export default async function TwoFactorLoginPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { factorId } = await searchParams;
  if (!factorId) redirect("/login");

  return (
    <main className="min-h-svh flex items-center justify-center px-4 py-10 bg-muted/40">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-semibold">Verificación en dos pasos</h1>
          <p className="text-sm text-muted-foreground">
            Ingresá el código de 6 dígitos que muestra tu app de autenticación.
          </p>
        </header>
        <TotpForm factorId={factorId} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Crear `src/app/login/2fa/totp-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { verifyMfaLogin, useRecoveryCodeLogin } from "@/lib/actions/security";

interface Props {
  factorId: string;
}

export function TotpForm({ factorId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await verifyMfaLogin({ factorId, code });
      if (!result.ok) {
        toast.error("Código incorrecto", { description: result.error });
        return;
      }
      router.push("/dashboard");
    });
  }

  function handleRecovery(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await useRecoveryCodeLogin({ code: recovery });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success("Entraste con un código de recuperación. Te recomendamos re-activar 2FA cuanto antes.");
      router.push("/dashboard/perfil");
    });
  }

  if (mode === "recovery") {
    return (
      <form onSubmit={handleRecovery} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="rec">Código de recuperación</Label>
          <Input
            id="rec"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono text-center tracking-widest"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isPending || recovery.length < 19}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Entrar con código
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("totp")}>
          ← Usar app de autenticación
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleTotp} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="totp">Código de 6 dígitos</Label>
        <Input
          id="totp"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
          required
          className="font-mono text-center tracking-widest text-lg"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isPending || code.length !== 6}>
        {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
        Ingresar
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("recovery")}>
        Usar un código de recuperación
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/security.ts src/lib/actions/auth.ts src/app/login/2fa/
git add src/lib/actions/security.ts src/lib/actions/auth.ts src/app/login/2fa/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(security): login con 2FA + recovery code workaround

auth.ts signIn: post-signInWithPassword, si user tiene TOTP factor
verificado redirect a /login/2fa?factorId=...

/login/2fa: TotpForm con 2 modos:
- TOTP: 6 dígitos → verifyMfaLogin (challenge + verify Supabase)
- Recovery: useRecoveryCodeLogin consume code, DESACTIVA el factor MFA
  (workaround porque Supabase no permite elevar AAL sin TOTP), audit log,
  redirect a /perfil para que el user re-enrolee.

Mensaje al user cuando entra con recovery: "te recomendamos re-activar 2FA".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Checkpoint PR 2.C

- [ ] **Verificación final del PR 2.C**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end tsc)"
npm run lint -- src/lib/actions/security.ts src/lib/security/ src/app/dashboard/perfil/security/ src/app/login/2fa/ src/app/confirm-email-change/ src/app/cancel-email-change/ 2>&1 | tail -10
git log --oneline main..HEAD | head -35
```

Expected: tsc filtrado vacío. Log con commits PR 2.A + 2.B + 2.C (Tasks 1-33).

- [ ] **Smoke pass manual de PR 2.C:**
  - Tab Seguridad muestra 3 cards (Contraseña, Email, 2FA).
  - Cambiar contraseña real, recibir mail de aviso.
  - Solicitar cambio de email, recibir 2 mails (al nuevo + al viejo). Hacer click en confirmar → email cambia → toast OK + se cierra sesión → re-login con nuevo email.
  - Solicitar otro cambio de email, click en cancelar desde el mail al viejo → mail de "cancelaste correctamente".
  - Activar 2FA: ver QR, escanearlo con Authy/Google Auth, ingresar código, ver 8 recovery codes, copiar/descargar.
  - Logout, login con password → redirect a /login/2fa → ingresar TOTP → entrar al dashboard.
  - Logout, login otra vez → /login/2fa → click "Usar código de recuperación" → ingresar uno → entra a /perfil con toast (factor reseteado).
  - Re-activar 2FA en /perfil/seguridad.
  - Generar nuevos recovery codes (re-auth con password) → ver 8 nuevos → los viejos quedan inválidos.
  - Desactivar 2FA (re-auth + TOTP) → mail de aviso → próximo login no pide TOTP.

---

# PR 2.D — Confirmación de reserva multi-canal + Mobile

**Goal del PR**: implementar el `<ConfirmBookingDialog>` que reemplaza el flow actual de "confirmar reserva", + el botón "reenviar confirmación" en el detalle de reserva, + el `/m/perfil` mobile.

**Files que va a tocar PR 2.D:**
- `src/components/bookings/confirm-booking-dialog.tsx` (create)
- `src/lib/actions/bookings.ts` (modify — agregar confirmBookingWithMessages + resendBookingConfirmation)
- `src/lib/email/booking-templates.ts` (create — render con vars del booking)
- `src/app/dashboard/reservas/[id]/page.tsx` (modify — botón confirmar + botón reenviar)
- `src/app/dashboard/reservas/page.tsx` (modify — botón confirmar de la lista)
- `src/app/dashboard/unidades/kanban/page.tsx` (modify — confirmar al drag al estado confirmada)
- `src/app/dashboard/unidades/[id]/page.tsx` (modify — confirmar desde calendario)
- `src/app/m/perfil/page.tsx` (create)
- `src/app/m/perfil/mobile-profile.tsx` (create)
- `src/app/m/layout.tsx` (modify — agregar link a /m/perfil)

---

## Task 34 — `src/lib/email/booking-templates.ts` (helper para render templates de reserva)

**Goal:** Función que toma un `bookingId`, fetchea todos los datos relacionados, los formatea, y devuelve `{ subject, body, variables }`.

**Files:**
- Create: `src/lib/email/booking-templates.ts`

- [ ] **Step 1: Crear el helper**

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { renderTemplate } from "./render";
import { formatMoney } from "@/lib/format";  // verificar que exista; sino formatear inline

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatDateEs(iso: string): string {
  const d = new Date(iso + (iso.includes("T") ? "" : "T12:00:00"));
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export interface BookingTemplateContext {
  variables: Record<string, unknown>;
  organizationId: string;
  guestEmail: string | null;
  orgContactEmail: string | null;
}

/**
 * Carga el booking + relaciones desde DB y arma el bag de variables
 * para renderTemplate. Devuelve también email del huésped (para el to:)
 * y email de contacto de la org (para reply-to).
 */
export async function buildBookingContext(
  bookingId: string
): Promise<BookingTemplateContext | null> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(`
      id,
      organization_id,
      check_in_date,
      check_out_date,
      total_amount,
      currency,
      paid_amount,
      guests_count,
      guest:guests(full_name, email, phone),
      unit:units(name, code, address),
      organization:organizations(name, contact_phone, contact_email, address)
    `)
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  const guest = booking.guest as { full_name: string; email: string | null; phone: string | null } | null;
  const unit = booking.unit as { name: string; code: string; address: string | null } | null;
  const org = booking.organization as { name: string; contact_phone: string | null; contact_email: string | null; address: string | null } | null;

  const ci = booking.check_in_date as string;
  const co = booking.check_out_date as string;
  const nights = Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86_400_000);
  const balance = Number(booking.total_amount ?? 0) - Number(booking.paid_amount ?? 0);

  const variables = {
    guest: {
      full_name: guest?.full_name ?? "",
      first_name: guest?.full_name?.split(" ")[0] ?? "",
      email: guest?.email ?? "",
      phone: guest?.phone ?? "",
    },
    org: {
      name: org?.name ?? "",
      contact_phone: org?.contact_phone ?? "",
      contact_email: org?.contact_email ?? "",
      address: org?.address ?? "",
    },
    unit: {
      name: unit?.name ?? "",
      code: unit?.code ?? "",
      address: unit?.address ?? "",
    },
    booking: {
      check_in_date: formatDateEs(ci),
      check_in_date_iso: ci,
      check_out_date: formatDateEs(co),
      check_out_date_iso: co,
      nights,
      guests_count: booking.guests_count ?? 0,
      total_amount: formatMoney(Number(booking.total_amount ?? 0), String(booking.currency ?? "ARS")),
      total_amount_raw: String(booking.total_amount ?? 0),
      currency: booking.currency ?? "ARS",
      balance_due: formatMoney(balance, String(booking.currency ?? "ARS")),
      payment_link: "",  // TODO: link al schedule de pago si existe
    },
  };

  return {
    variables,
    organizationId: booking.organization_id as string,
    guestEmail: guest?.email ?? null,
    orgContactEmail: org?.contact_email ?? null,
  };
}

/**
 * Carga el template de la org para (event_type, channel) y lo renderiza
 * con las variables del booking.
 */
export async function getRenderedBookingTemplate(args: {
  organizationId: string;
  eventType: string;
  channel: "email" | "whatsapp";
  variables: Record<string, unknown>;
}): Promise<{ subject: string | null; body: string } | null> {
  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from("org_message_templates")
    .select("subject, body")
    .eq("organization_id", args.organizationId)
    .eq("event_type", args.eventType)
    .eq("channel", args.channel)
    .maybeSingle();
  if (!tpl) return null;
  return {
    subject: tpl.subject ? renderTemplate(tpl.subject, args.variables) : null,
    body: renderTemplate(tpl.body, args.variables),
  };
}
```

Si `formatMoney` no existe en `src/lib/format.ts`, crear inline:
```ts
function formatMoneyInline(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("es-AR")}`;
  }
}
```

- [ ] **Step 2: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/email/booking-templates.ts
git add src/lib/email/booking-templates.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(email): booking-templates.ts — context + render helper

buildBookingContext: lookup del booking + guest + unit + org,
formatea fechas y montos para variables del template.

getRenderedBookingTemplate: lookup del template guardado en
org_message_templates, render con renderTemplate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 35 — `confirmBookingWithMessages` + `resendBookingConfirmation`

**Files:**
- Modify: `src/lib/actions/bookings.ts` (append)

- [ ] **Step 1: Append a `bookings.ts`**

```bash
git checkout HEAD -- src/lib/actions/bookings.ts
```

Append al final del archivo:

```ts

// ════════════════════════════════════════════════════════════════════════
// Spec 2 — Confirmación de reserva multi-canal
// ════════════════════════════════════════════════════════════════════════

import { sendGuestMail } from "@/lib/email/guest";
import { plainTextToHtml } from "@/lib/email/render";
import { buildBookingContext, getRenderedBookingTemplate } from "@/lib/email/booking-templates";

const confirmWithMessagesSchema = z.object({
  bookingId: z.string().uuid(),
  channels: z.array(z.enum(["email", "whatsapp"])).min(1),
  emailOverride: z
    .object({
      subject: z.string().optional().nullable(),
      body: z.string(),
    })
    .optional()
    .nullable(),
});

export async function confirmBookingWithMessages(
  input: z.infer<typeof confirmWithMessagesSchema>
): Promise<
  | {
      ok: true;
      channels_sent: string[];
      channels_failed: { channel: string; error: string }[];
    }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = confirmWithMessagesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };

  // WhatsApp es deshabilitado en Spec 2
  const allowedChannels = parsed.data.channels.filter((c) => c === "email");
  if (allowedChannels.length === 0) {
    return { ok: false, error: "Solo email está disponible. WhatsApp llega en una versión futura." };
  }

  const admin = createAdminClient();

  // Update status atómico
  const { error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      confirmation_sent_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", organization.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  // Insertar evento de log de la reserva si la tabla existe
  try {
    await admin.from("booking_events").insert({
      booking_id: parsed.data.bookingId,
      organization_id: organization.id,
      actor_user_id: session.userId,
      event_type: "confirmed",
      metadata: { channels: allowedChannels, sent_via: "confirm_dialog" },
    });
  } catch {
    // Si la tabla no existe en este proyecto, ignorar
  }

  const ctx = await buildBookingContext(parsed.data.bookingId);
  if (!ctx) return { ok: false, error: "No se pudo cargar el contexto del booking" };

  const channelsSent: string[] = [];
  const channelsFailed: { channel: string; error: string }[] = [];

  if (allowedChannels.includes("email")) {
    if (!ctx.guestEmail) {
      channelsFailed.push({ channel: "email", error: "Huésped sin email registrado" });
    } else {
      let subject: string | null;
      let body: string;
      if (parsed.data.emailOverride) {
        subject = parsed.data.emailOverride.subject ?? null;
        body = parsed.data.emailOverride.body;
      } else {
        const tpl = await getRenderedBookingTemplate({
          organizationId: ctx.organizationId,
          eventType: "booking_confirmed",
          channel: "email",
          variables: ctx.variables,
        });
        if (!tpl) {
          channelsFailed.push({ channel: "email", error: "Template no encontrado" });
          subject = null;
          body = "";
        } else {
          subject = tpl.subject;
          body = tpl.body;
        }
      }
      if (body) {
        const html = plainTextToHtml(body);
        const result = await sendGuestMail({
          organizationId: ctx.organizationId,
          to: ctx.guestEmail,
          subject: subject ?? "Confirmación de reserva",
          html,
          text: body,
          replyTo: ctx.orgContactEmail ?? undefined,
        });
        if (result.ok) channelsSent.push("email");
        else channelsFailed.push({ channel: "email", error: result.error });
      }
    }
  }

  // Revalidar paths
  revalidatePath("/dashboard/reservas");
  revalidatePath(`/dashboard/reservas/${parsed.data.bookingId}`);
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/dashboard/unidades", "layout");

  return { ok: true, channels_sent: channelsSent, channels_failed: channelsFailed };
}

const resendSchema = z.object({
  bookingId: z.string().uuid(),
  channels: z.array(z.enum(["email", "whatsapp"])).min(1),
  emailOverride: z
    .object({
      subject: z.string().optional().nullable(),
      body: z.string(),
    })
    .optional()
    .nullable(),
});

export async function resendBookingConfirmation(
  input: z.infer<typeof resendSchema>
): Promise<
  | { ok: true; channels_sent: string[]; channels_failed: { channel: string; error: string }[] }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Inputs inválidos" };

  const allowedChannels = parsed.data.channels.filter((c) => c === "email");
  if (allowedChannels.length === 0) return { ok: false, error: "Solo email disponible" };

  const ctx = await buildBookingContext(parsed.data.bookingId);
  if (!ctx) return { ok: false, error: "Booking no encontrado" };
  if (!ctx.guestEmail) return { ok: false, error: "Huésped sin email" };

  const admin = createAdminClient();

  let subject: string | null;
  let body: string;
  if (parsed.data.emailOverride) {
    subject = parsed.data.emailOverride.subject ?? null;
    body = parsed.data.emailOverride.body;
  } else {
    const tpl = await getRenderedBookingTemplate({
      organizationId: ctx.organizationId,
      eventType: "booking_confirmed",
      channel: "email",
      variables: ctx.variables,
    });
    if (!tpl) return { ok: false, error: "Template no encontrado" };
    subject = tpl.subject;
    body = tpl.body;
  }

  const result = await sendGuestMail({
    organizationId: ctx.organizationId,
    to: ctx.guestEmail,
    subject: subject ?? "Confirmación de reserva",
    html: plainTextToHtml(body),
    text: body,
    replyTo: ctx.orgContactEmail ?? undefined,
  });

  // Tocar confirmation_sent_at para tracking
  await admin
    .from("bookings")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", parsed.data.bookingId)
    .eq("organization_id", organization.id);

  // Suprimir 'session' unused
  void session;

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, channels_sent: ["email"], channels_failed: [] };
}
```

- [ ] **Step 2: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/bookings.ts
git add src/lib/actions/bookings.ts
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(actions): confirmBookingWithMessages + resendBookingConfirmation

confirmBookingWithMessages: update status='confirmed' atómico +
confirmation_sent_at, log de evento, render del template (con override
opcional desde el dialog), envío via sendGuestMail. Devuelve detalle
de canales sent/failed.

resendBookingConfirmation: reusa la misma lógica de envío sin tocar
status, para el botón "Reenviar" del detalle.

WhatsApp se filtra defensivamente (UI ya lo deshabilita pero el server
también valida).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 36 — `<ConfirmBookingDialog>` componente con stepper

**Files:**
- Create: `src/components/bookings/confirm-booking-dialog.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { Loader2, Mail, MessageCircle, Send, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  confirmBookingWithMessages,
  resendBookingConfirmation,
} from "@/lib/actions/bookings";

interface BookingPreview {
  id: string;
  guest_full_name: string;
  guest_email: string | null;
  unit_name: string;
  check_in_date: string;
  check_out_date: string;
}

interface RenderedTemplate {
  subject: string | null;
  body: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Datos del booking para mostrar en el header. */
  booking: BookingPreview;
  /** Template pre-renderizado con variables sustituidas (server-side fetch). */
  initialTemplate: RenderedTemplate | null;
  /** "confirm" = primera confirmación (cambia status). "resend" = reenviar (no cambia). */
  mode: "confirm" | "resend";
  onSuccess?: () => void;
}

type Step = "channels" | "editor" | "preview";

export function ConfirmBookingDialog({
  open,
  onOpenChange,
  booking,
  initialTemplate,
  mode,
  onSuccess,
}: Props) {
  const [step, setStep] = useState<Step>("channels");
  const [emailEnabled, setEmailEnabled] = useState(!!booking.guest_email);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [subject, setSubject] = useState(initialTemplate?.subject ?? "");
  const [body, setBody] = useState(initialTemplate?.body ?? "");
  const [isPending, startTransition] = useTransition();

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setStep("channels");
      setEmailEnabled(!!booking.guest_email);
      setWhatsappEnabled(false);
      setSubject(initialTemplate?.subject ?? "");
      setBody(initialTemplate?.body ?? "");
    }
  }, [open, booking.guest_email, initialTemplate]);

  function handleSend() {
    if (!emailEnabled) {
      toast.error("Activá al menos un canal");
      return;
    }
    const channels = emailEnabled ? ["email" as const] : [];
    const emailOverride = { subject: subject.trim() || null, body: body.trim() };

    startTransition(async () => {
      const result =
        mode === "confirm"
          ? await confirmBookingWithMessages({
              bookingId: booking.id,
              channels,
              emailOverride,
            })
          : await resendBookingConfirmation({
              bookingId: booking.id,
              channels,
              emailOverride,
            });

      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }

      const sent = result.channels_sent.length;
      const failed = result.channels_failed.length;
      if (sent > 0 && failed === 0) {
        toast.success(
          mode === "confirm"
            ? `Reserva confirmada. ${sent === 1 ? "Mail enviado" : `${sent} mensajes enviados`}.`
            : `Confirmación reenviada (${sent === 1 ? "1 canal" : `${sent} canales`})`
        );
      } else if (sent > 0 && failed > 0) {
        toast.warning(
          `${mode === "confirm" ? "Reserva confirmada" : "Reenvío parcial"} — ${sent} OK, ${failed} fallaron: ${result.channels_failed.map((f) => f.error).join("; ")}`
        );
      } else {
        toast.error("Ningún canal pudo enviarse", {
          description: result.channels_failed.map((f) => `${f.channel}: ${f.error}`).join("\n"),
        });
        return;
      }
      onOpenChange(false);
      onSuccess?.();
    });
  }

  const showWhatsAppWarning = whatsappEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "confirm" ? "Confirmar reserva" : "Reenviar confirmación"} — {booking.guest_full_name}
          </DialogTitle>
          <DialogDescription>
            {booking.unit_name} · {booking.check_in_date} → {booking.check_out_date}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper visual */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StepIndicator label="Canales" active={step === "channels"} done={step !== "channels"} />
          <span>›</span>
          <StepIndicator label="Editor" active={step === "editor"} done={step === "preview"} />
          <span>›</span>
          <StepIndicator label="Vista previa" active={step === "preview"} done={false} />
        </div>

        {step === "channels" && (
          <div className="space-y-3">
            {!booking.guest_email && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 p-3 flex items-start gap-2">
                <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Huésped sin email</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {mode === "confirm"
                      ? "Podés confirmar la reserva igual, pero no se va a enviar notificación."
                      : "No hay forma de reenviar. Editá el huésped para agregar un email."}
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="flex items-center gap-3 rounded-md border p-3 cursor-pointer">
                <Checkbox
                  checked={emailEnabled}
                  onCheckedChange={(v) => setEmailEnabled(!!v)}
                  disabled={!booking.guest_email}
                />
                <Mail size={16} />
                <div className="flex-1">
                  <div className="font-medium text-sm">Email</div>
                  <div className="text-xs text-muted-foreground">
                    {booking.guest_email ?? "Sin email registrado"}
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 rounded-md border p-3 opacity-50">
                <Checkbox
                  checked={whatsappEnabled}
                  onCheckedChange={(v) => setWhatsappEnabled(!!v)}
                  disabled
                />
                <MessageCircle size={16} />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    WhatsApp
                    <Badge variant="secondary" className="text-xs">próximamente</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">Se habilita en una versión futura</div>
                </div>
              </label>
              {showWhatsAppWarning && (
                <p className="text-xs text-muted-foreground">WhatsApp aún no está disponible. Solo se va a enviar email.</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              {emailEnabled && booking.guest_email ? (
                <Button onClick={() => setStep("editor")}>Siguiente →</Button>
              ) : !booking.guest_email && mode === "confirm" ? (
                <Button onClick={handleSend} disabled={isPending} variant="destructive">
                  {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                  Confirmar sin enviar
                </Button>
              ) : (
                <Button disabled>Sin canales activos</Button>
              )}
            </DialogFooter>
          </div>
        )}

        {step === "editor" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Editá el contenido. Los cambios solo aplican a este envío — el template default se mantiene.</p>
            <div className="space-y-2">
              <Label htmlFor="cb_subject">Asunto</Label>
              <Input id="cb_subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cb_body">Cuerpo</Label>
              <Textarea id="cb_body" value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-xs" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("channels")}>← Atrás</Button>
              <Button onClick={() => setStep("preview")}>Vista previa →</Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="rounded-md border bg-card p-4 space-y-2">
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Para:</strong> {booking.guest_email}</div>
                {subject && <div><strong>Asunto:</strong> {subject}</div>}
              </div>
              <hr />
              <div className="whitespace-pre-wrap text-sm">{body}</div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("editor")}>← Atrás</Button>
              <Button onClick={handleSend} disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                <Send size={14} className="mr-1.5" />
                {mode === "confirm" ? "Confirmar reserva y enviar" : "Reenviar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={
        active
          ? "font-semibold text-foreground"
          : done
          ? "text-muted-foreground line-through"
          : "text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/components/bookings/confirm-booking-dialog.tsx
git add src/components/bookings/confirm-booking-dialog.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(bookings): <ConfirmBookingDialog> multi-canal con stepper

3 steps: Canales (Email checked + WhatsApp disabled "próximamente") →
Editor (subject + body editables) → Vista previa.

Modos "confirm" (primera confirmación, cambia status) y "resend"
(reenvía sin tocar status).

Sin email del huésped: warning + opción "Confirmar sin enviar" en modo confirm.

Toasts diferenciados: success / partial-failure (warning) / total-failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 37 — Helper para fetchear preview + template y reemplazar botones "Confirmar"

**Goal:** En cada lugar donde hoy se confirma una reserva, abrir `<ConfirmBookingDialog>` en lugar de llamar la action directa. Necesitamos también fetchear el template renderizado server-side antes de abrir el dialog.

**Files:**
- Create: `src/lib/actions/booking-confirmation-preview.ts` (helper async para el dialog)
- Modify: `src/app/dashboard/reservas/[id]/page.tsx` — botón confirmar
- Modify: `src/app/dashboard/reservas/page.tsx` — botón confirmar de la lista
- Modify: `src/app/dashboard/unidades/kanban/page.tsx` — al drag al estado confirmada
- Modify: `src/app/dashboard/unidades/[id]/page.tsx` — confirmar desde calendario

- [ ] **Step 1: Crear `src/lib/actions/booking-confirmation-preview.ts`**

```ts
"use server";

import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { buildBookingContext, getRenderedBookingTemplate } from "@/lib/email/booking-templates";

/**
 * Server action que arma el "preview" del booking para el dialog y
 * además renderiza el template default. Devuelve todo en una sola
 * roundtrip para minimizar latencia al abrir el dialog.
 */
export async function getBookingConfirmationPreview(bookingId: string): Promise<
  | {
      ok: true;
      preview: {
        id: string;
        guest_full_name: string;
        guest_email: string | null;
        unit_name: string;
        check_in_date: string;
        check_out_date: string;
      };
      template: { subject: string | null; body: string } | null;
    }
  | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(`
      id,
      check_in_date,
      check_out_date,
      guest:guests(full_name, email),
      unit:units(name)
    `)
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Reserva no encontrada" };

  const guest = booking.guest as { full_name: string; email: string | null } | null;
  const unit = booking.unit as { name: string } | null;

  const ctx = await buildBookingContext(bookingId);
  const template = ctx
    ? await getRenderedBookingTemplate({
        organizationId: ctx.organizationId,
        eventType: "booking_confirmed",
        channel: "email",
        variables: ctx.variables,
      })
    : null;

  return {
    ok: true,
    preview: {
      id: booking.id as string,
      guest_full_name: guest?.full_name ?? "Huésped",
      guest_email: guest?.email ?? null,
      unit_name: unit?.name ?? "",
      check_in_date: booking.check_in_date as string,
      check_out_date: booking.check_out_date as string,
    },
    template,
  };
}
```

- [ ] **Step 2: Crear hook reusable `useConfirmBookingDialog` en client component**

Crear `src/components/bookings/use-confirm-booking-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmBookingDialog } from "./confirm-booking-dialog";
import { getBookingConfirmationPreview } from "@/lib/actions/booking-confirmation-preview";

interface UseConfirmBookingDialogProps {
  mode?: "confirm" | "resend";
  onSuccess?: () => void;
}

interface DialogState {
  open: boolean;
  preview: Parameters<typeof ConfirmBookingDialog>[0]["booking"] | null;
  template: Parameters<typeof ConfirmBookingDialog>[0]["initialTemplate"];
}

/**
 * Hook que devuelve:
 * - openConfirmDialog(bookingId): fetcha el preview + template y abre el dialog.
 * - dialogProps: spread en <ConfirmBookingDialog .../>
 */
export function useConfirmBookingDialog({ mode = "confirm", onSuccess }: UseConfirmBookingDialogProps = {}) {
  const [state, setState] = useState<DialogState>({ open: false, preview: null, template: null });
  const [, startTransition] = useTransition();

  function openConfirmDialog(bookingId: string) {
    startTransition(async () => {
      const result = await getBookingConfirmationPreview(bookingId);
      if (!result.ok) {
        toast.error("Error al cargar reserva", { description: result.error });
        return;
      }
      setState({ open: true, preview: result.preview, template: result.template });
    });
  }

  const dialogProps = state.preview
    ? {
        open: state.open,
        onOpenChange: (o: boolean) => setState((s) => ({ ...s, open: o })),
        booking: state.preview,
        initialTemplate: state.template,
        mode,
        onSuccess,
      }
    : null;

  return { openConfirmDialog, dialogProps, ConfirmBookingDialog };
}
```

- [ ] **Step 3: Reemplazar el botón "Confirmar" en `/dashboard/reservas/[id]/page.tsx`**

```bash
git checkout HEAD -- src/app/dashboard/reservas/[id]/page.tsx
grep -n "confirmar\|Confirmar\|status.*confirmed\|onConfirm" src/app/dashboard/reservas/\[id\]/page.tsx | head
```

Localizar el lugar donde se renderiza el botón "Confirmar reserva". Si está en server component, necesitamos extraer un client component nuevo `<BookingConfirmActions>` que use el hook.

Crear `src/app/dashboard/reservas/[id]/booking-confirm-actions.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Send } from "lucide-react";
import { useConfirmBookingDialog } from "@/components/bookings/use-confirm-booking-dialog";

interface Props {
  bookingId: string;
  status: string;
  hasGuestEmail: boolean;
}

export function BookingConfirmActions({ bookingId, status }: Props) {
  const router = useRouter();
  const { openConfirmDialog, dialogProps, ConfirmBookingDialog } = useConfirmBookingDialog({
    mode: status === "confirmed" ? "resend" : "confirm",
    onSuccess: () => router.refresh(),
  });

  return (
    <>
      {status !== "confirmed" ? (
        <Button onClick={() => openConfirmDialog(bookingId)}>
          <CheckCircle2 size={14} className="mr-1.5" /> Confirmar reserva
        </Button>
      ) : (
        <Button variant="outline" onClick={() => openConfirmDialog(bookingId)}>
          <Send size={14} className="mr-1.5" /> Reenviar confirmación
        </Button>
      )}
      {dialogProps && <ConfirmBookingDialog {...dialogProps} />}
    </>
  );
}
```

En el page server component:

```tsx
import { BookingConfirmActions } from "./booking-confirm-actions";

// ... en el JSX, donde antes estaba el botón:
<BookingConfirmActions bookingId={booking.id} status={booking.status} hasGuestEmail={!!booking.guest?.email} />
```

- [ ] **Step 4: Reemplazar en `/dashboard/reservas/page.tsx` (lista)**

Si la lista tiene un botón "Confirmar" inline, similar refactor: extraer un client component que usa el hook. Si no tiene botón inline (solo en el detalle), saltear este step.

- [ ] **Step 5: Reemplazar en `/dashboard/unidades/kanban/page.tsx`**

```bash
git checkout HEAD -- src/app/dashboard/unidades/kanban/page.tsx
grep -n "onDrop\|status.*confirmed\|moveBooking" src/app/dashboard/unidades/kanban/page.tsx | head
```

El kanban ya hace transiciones de status via drag & drop. Para Spec 2: cuando el target column es "confirmada", en lugar de aplicar la transición directa, abrir el dialog. Esto requiere:

1. Detectar el target column en el handler del drop.
2. Si target === "confirmada", abrir el dialog en lugar de llamar `moveBooking` o equivalente.
3. Si el user cancela el dialog, NO se aplica la transición (revertir visualmente).

**Decisión de simplicidad para el plan**: en el kanban actual, el drag al estado confirmada va a:
- Aplicar el cambio visual optimista
- Abrir el dialog
- Si el user cancela: hacer router.refresh() para revertir
- Si confirma: el server action ya cambia el status

Implementación:

Modificar el handler donde se detecta el drop:

```tsx
// Pseudo-código — adaptar al patrón real del kanban
function handleDrop(bookingId: string, newStatus: string) {
  if (newStatus === "confirmed") {
    openConfirmDialog(bookingId);
    return;  // no llamar moveBooking — el dialog lo va a hacer
  }
  // Resto de transiciones siguen como antes
  startTransition(async () => {
    await moveBooking({ bookingId, newStatus });
  });
}
```

Conectar el `useConfirmBookingDialog` con `mode: "confirm"` y `onSuccess: router.refresh`.

- [ ] **Step 6: Reemplazar en `/dashboard/unidades/[id]/page.tsx` (calendario por unidad)**

Mismo patrón: si hay botón "Confirmar reserva" del booking detail en el calendario, reemplazar por el component `<BookingConfirmActions>`.

Si la página solo muestra info y no tiene botones de acción, saltear.

- [ ] **Step 7: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/lib/actions/booking-confirmation-preview.ts src/components/bookings/ src/app/dashboard/reservas/ src/app/dashboard/unidades/
git add src/lib/actions/booking-confirmation-preview.ts src/components/bookings/ src/app/dashboard/reservas/ src/app/dashboard/unidades/
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(bookings): integrar <ConfirmBookingDialog> en todos los lugares de "Confirmar"

booking-confirmation-preview.ts: server action que devuelve preview +
template renderizado en una sola roundtrip.

useConfirmBookingDialog hook reutilizable.

Reemplazos:
- /dashboard/reservas/[id]: botón Confirmar/Reenviar usa el dialog
- /dashboard/unidades/kanban: drop al estado "confirmada" abre el dialog
- /dashboard/unidades/[id]: si tiene botón confirmar del booking detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 38 — `/m/perfil` mobile

**Goal:** Versión mobile-first del perfil con secciones colapsables.

**Files:**
- Create: `src/app/m/perfil/page.tsx`
- Create: `src/app/m/perfil/mobile-profile.tsx`
- Modify: `src/app/m/layout.tsx` (agregar link al perfil — si no está)

- [ ] **Step 1: Crear `src/app/m/perfil/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getMfaStatus } from "@/lib/actions/security";
import { MobileProfile } from "./mobile-profile";

export const dynamic = "force-dynamic";

export default async function MobilePerfilPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const mfa = await getMfaStatus();

  return (
    <main className="px-4 py-4 pb-24 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Mi perfil</h1>
      <MobileProfile profile={session.profile} email={session.user.email ?? ""} mfaStatus={mfa} />
    </main>
  );
}
```

- [ ] **Step 2: Crear `src/app/m/perfil/mobile-profile.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ProfileDataForm } from "@/app/dashboard/perfil/profile-data-form";
import { AvatarUploader } from "@/app/dashboard/perfil/avatar-uploader";
import { PasswordCard } from "@/app/dashboard/perfil/security/password-card";
import { EmailCard } from "@/app/dashboard/perfil/security/email-card";
import { TwoFactorCard } from "@/app/dashboard/perfil/security/two-factor-card";
import type { UserProfile } from "@/lib/types/database";

interface Props {
  profile: UserProfile;
  email: string;
  mfaStatus: { enrolled: boolean; enabledAt: string | null };
}

export function MobileProfile({ profile, email, mfaStatus }: Props) {
  // El switch entre tabs no aplica en mobile; los handlers de "cambiar foto"
  // del ProfileDataForm reciben no-ops — el usuario abre la sección Foto manualmente.
  const noop = () => {};

  return (
    <Accordion type="single" collapsible defaultValue="datos">
      <AccordionItem value="datos">
        <AccordionTrigger>Datos personales</AccordionTrigger>
        <AccordionContent className="pt-2">
          <ProfileDataForm profile={profile} email={email} onChangeAvatarRequested={noop} onChangeEmailRequested={noop} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="foto">
        <AccordionTrigger>Foto de perfil</AccordionTrigger>
        <AccordionContent className="pt-2">
          <AvatarUploader currentUrl={profile.avatar_url} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="seguridad">
        <AccordionTrigger>Seguridad</AccordionTrigger>
        <AccordionContent className="pt-2 space-y-3">
          <PasswordCard />
          <EmailCard email={email} />
          <TwoFactorCard enrolled={mfaStatus.enrolled} enabledAt={mfaStatus.enabledAt} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
```

- [ ] **Step 3: Verificar que `/m/layout.tsx` tenga link al perfil**

```bash
git checkout HEAD -- src/app/m/layout.tsx
grep -n "perfil\|profile\|avatar" src/app/m/layout.tsx | head
```

Si no hay link, agregar al header o bottom-nav un avatar/icono que linkee a `/m/perfil`. Si ya tiene un dropdown de usuario, linkear "Mi perfil" igual que en desktop.

- [ ] **Step 4: Verificar tsc + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end)"
npm run lint -- src/app/m/perfil/ src/app/m/layout.tsx
git add src/app/m/perfil/ src/app/m/layout.tsx
flock /tmp/spec2-git.lock git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(mobile): /m/perfil con accordion (Datos / Foto / Seguridad)

Reusa los components de /dashboard/perfil dentro de un Accordion mobile.
Mismo set de funcionalidades, layout colapsable optimizado para mobile.

Configuración de organización NO se incluye en mobile (queda solo en
desktop).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Checkpoint PR 2.D

- [ ] **Verificación final del PR 2.D**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | head ; echo "(end tsc)"
npm run lint -- src/components/bookings/ src/lib/actions/bookings.ts src/lib/actions/booking-confirmation-preview.ts src/lib/email/booking-templates.ts src/app/m/perfil/ 2>&1 | tail -10
git log --oneline main..HEAD | head -45
```

Expected: tsc filtrado vacío. Log con commits PR 2.A + 2.B + 2.C + 2.D (Tasks 1-38).

- [ ] **Smoke pass manual de PR 2.D:**
  - Crear una reserva, dejarla en estado "pendiente", abrir el detalle, click "Confirmar reserva".
  - Step Canales: ver checkbox Email tildado + WhatsApp greyed out con "próximamente".
  - Step Editor: ver el template renderizado con datos reales del booking. Editar el subject y agregar una línea al body.
  - Step Vista previa: ver lo final con datos correctos.
  - Click "Confirmar reserva y enviar". Toast OK. La reserva pasa a estado confirmada.
  - Verificar que el huésped recibió el mail con el contenido editado.
  - En el detalle de la reserva confirmada, click "Reenviar confirmación" → mismo dialog → enviar de nuevo.
  - En kanban, drag una reserva pendiente al estado confirmada → debería abrirse el dialog → cancel = no se cambia de columna.
  - Mobile: abrir `/m/perfil` desde el menú/avatar mobile, ver las 3 secciones (Datos / Foto / Seguridad) en accordion. Cambiar nombre, subir avatar, cambiar password.

---

# Verificación final del Spec 2

## Task 39 — Full typecheck + lint + build

- [ ] **Step 1: Full tsc filtrado**

```bash
npx tsc --noEmit 2>&1 | grep -v "src/app/api/webhooks/meta" | tail -20 ; echo "(end tsc)"
```
Expected: vacío.

- [ ] **Step 2: Full lint**

```bash
npm run lint 2>&1 | tail -30
```
Expected: 0 errors. 0 warnings (los warnings de `react-hooks/exhaustive-deps` se arreglan inline si aparecen).

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -30
```
Expected: build OK. Si los 2 errores pre-existentes de `webhooks/meta` siguen rotos en main, esto va a fallar — antes de cerrar Spec 2, arreglar esos 2 errores en un PR aparte (son del commit `4bb3a50` "idk"). Plan B: incluirlos en el primer PR del Spec 2 con un commit separado, fuera del contenido del spec.

## Task 40 — Smoke pass completo end-to-end

- [ ] **Step 1: Recorrido total del Spec 2**

Lista de verificación final:

**Perfil personal (PR 2.A):**
- [ ] `/dashboard/perfil` carga, 3 tabs visibles
- [ ] Datos: editar nombre + teléfono + idioma → guardar → toast → ver actualizado tras refresh
- [ ] Foto: subir avatar → ver preview → confirmar → aparece en TopBar
- [ ] Foto: eliminar avatar → vuelve a iniciales
- [ ] Item "Mi perfil" del dropdown del avatar linkea a `/dashboard/perfil`
- [ ] Sidebar muestra `<OrgBrand>` con fallback a Apart Cba (mientras `logo_url` sea null)

**Configuración de organización (PR 2.B):**
- [ ] `/dashboard/configuracion/organizacion` carga, 3 secciones visibles
- [ ] Identidad: editar nombre y guardar → ver el nuevo nombre en TopBar y sidebar
- [ ] Branding: subir logo → ver el logo en sidebar (white-label) reemplazando "APART"
- [ ] Branding: eliminar logo → vuelve al brand Apart Cba
- [ ] Comunicaciones: crear dominio Resend con un dominio propio → ver tabla DNS
- [ ] Agregar DNS al proveedor (paso manual) → click verificar → estado verificado
- [ ] Editar template de booking_confirmed × email → guardar → vista previa OK
- [ ] Tratar de guardar template con `{{foo.bar}}` inventada → error claro
- [ ] Item "Configuración de organización" del dropdown linkea correctamente

**Seguridad (PR 2.C):**
- [ ] Tab Seguridad muestra 3 cards
- [ ] Cambiar contraseña con re-auth → recibir mail
- [ ] Solicitar cambio email → 2 mails (al nuevo + al viejo) → confirmar nuevo → email cambia
- [ ] Solicitar otro cambio email → cancelar desde el viejo → mail de "cancelado"
- [ ] Activar 2FA: QR + verify + 8 recovery codes
- [ ] Logout → login → /login/2fa → ingresar TOTP → entrar
- [ ] Logout → login → "usar recovery code" → entrar (factor reseteado)
- [ ] Re-activar 2FA, regenerar codes, desactivar — todo recibe mail

**Confirmación reserva multi-canal (PR 2.D):**
- [ ] Confirmar reserva nueva → dialog 3 steps → email enviado al huésped
- [ ] El email usa el template editado en PR 2.B
- [ ] Si el huésped no tiene email → warning + opción "Confirmar sin enviar"
- [ ] Reenviar confirmación desde detalle → mismo dialog → mail enviado
- [ ] Kanban drag a "confirmada" → abre dialog → cancel revierte
- [ ] WhatsApp checkbox greyed out con "próximamente"
- [ ] Si el dominio org está verificado, el "from" del mail al huésped usa ese dominio
- [ ] Si el dominio NO está verificado, el "from" cae al fallback `noreply@apartcba.com` con friendly name de la org

**Mobile (PR 2.D):**
- [ ] `/m/perfil` carga con accordion 3 secciones
- [ ] Las mismas operaciones funcionan (editar, subir foto, cambiar password, activar 2FA)

---

## Rollback / contingencia

- Cada PR (2.A, 2.B, 2.C, 2.D) puede revertirse independientemente con `git revert <range>`.
- La migration 010 + storage buckets son aditivas — no rompen lecturas viejas. Si querés rollback de schema, hay que escribir `011_rollback_spec_2.sql` manual (no se incluye en este plan; es contingencia poco probable).
- Si Resend tiene downtime, los mails fallan best-effort — la app sigue funcionando, los flows de seguridad y confirmación de reserva mismos van adelante.

---

## Out of scope (no se hace en Spec 2)

(Idéntico al spec — repetimos para que quede en el plan también)

- Crop de imágenes
- WYSIWYG editor de templates
- WhatsApp funcional (UI sí, integración con provider NO — Spec 3)
- PDF de confirmación adjunto
- Discriminación por rol del acceso a configuración de organización
- Per-tenant customización de login/landing públicos
- Soft-delete / data export GDPR
- UI para visualizar audit log
- Push notifications navegador
- Force-enrollment 2FA por rol
- Self-service "perdí todo en 2FA" — recovery sigue siendo manual via superadmin

---

## Notas para el ejecutor (subagent o humano)

- **CRLF noise**: el repo tiene 200 archivos modificados por CRLF que NO son tuyos. Antes de cada Edit, hacer `git checkout HEAD -- <archivo>` para limpiar. Solo los archivos que realmente modificás aparecen en el commit.
- **No usar `git add -A` ni `git add .`** — siempre paths específicos.
- **No skipear hooks** — `--no-verify` está prohibido. Si un hook falla, fix the underlying issue.
- **`flock /tmp/spec2-git.lock git ...`** envuelve cada commit en caso que el ejecutor lance subagents en paralelo.
- **Filtro tsc**: los 2 errores pre-existentes en `src/app/api/webhooks/meta/[channel]/route.ts` no son nuestros (commit `4bb3a50` "idk"). Filtralos con `grep -v "src/app/api/webhooks/meta"`. Si el spec termina y querés que `npm run build` pase end-to-end, pedile al usuario que arregle esos 2 errores en un PR aparte.
- **Smoke manual**: este plan no tiene tests automatizados (no hay test runner). Cada PR tiene su sección de smoke explícita — ejecutarla en serio antes de cerrar.



