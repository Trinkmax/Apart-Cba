# Spec 2 — Perfil + Branding + Seguridad de credenciales + Resend + Email de reserva

**Fecha:** 2026-05-06
**Estado:** Aprobado para escritura de plan
**Autor:** Brainstormeado con el usuario, escrito por Claude

## 1. Goal

Construir, en un solo cuerpo de trabajo coherente, todas las pantallas y flujos de "configuración" del producto:

- Que el usuario pueda editar su perfil personal (datos, foto) y gestionar la seguridad de su cuenta (password, email, 2FA).
- Que el admin pueda editar los datos públicos de su organización (nombre, descripción, dirección, contacto, **logo**) y se rendericen en sidebar para todos los usuarios de esa org (white-label).
- Que la org pueda **configurar un dominio propio** para los mails que envía a sus huéspedes (vía Resend), con un fallback al dominio del sistema si no está verificado.
- Que la confirmación de una reserva dispare un **popup multi-canal** donde el operador elige canales (email habilitado, WhatsApp como toggle "Próximamente"), edita el contenido del mensaje, y envía. Email funcional end-to-end.
- Que cada acción sensible (cambio de password, cambio de email, enrollment 2FA) **notifique por mail** al usuario para detectar account takeover.

Es un PR (o cluster de PRs) deliberadamente grande porque las piezas están entrelazadas: 2FA usa Resend, email change usa Resend, popup de reserva usa Resend, dominio de la org se setea en la misma página que el logo. Separar más fragmenta la experiencia y duplica setup.

## 2. Scope

### In scope

- `/dashboard/perfil` (nueva ruta) con tabs: Datos / Foto / Seguridad.
- `/dashboard/configuracion/organizacion` (nueva ruta) con secciones: Identidad / Branding / Comunicaciones.
- `/m/perfil` (nueva ruta mobile) — versión simplificada de los tabs como secciones colapsables.
- Reemplazo del componente `<Logo>` del sidebar por `<OrgBrand>` (white-label total con fallback al brand Apart Cba).
- Storage buckets nuevos: `avatars` (público, 2MB) y `org-logos` (público, 5MB).
- Helper de Resend para mails de **sistema** (auth flows) — siempre desde dominio Apart Cba.
- Helper de Resend para mails al **huésped** — desde dominio de la org si verificado, fallback al sistema.
- Verificación de dominio Resend per-org desde la UI (DNS records, polling de verify).
- Templates de mensajes editables por org en DB con variables `{{var}}` y preview.
- `<ConfirmBookingDialog>` que reemplaza el flow actual de "confirmar reserva", multi-canal, con editor de template por envío.
- Audit log de eventos de seguridad (`security_audit_log`).
- Migration única `010_profile_branding_security.sql`.

### Out of scope (no se hace en Spec 2 — claro y explícito)

- Crop de imágenes (avatar y logo). Usamos `object-fit: cover`.
- WYSIWYG editor para templates. Texto plano + lista de variables + preview.
- WhatsApp como canal funcional. UI sí, integración con provider NO. Spec 3.
- PDF de confirmación de reserva adjunto al mail.
- Discriminación por rol del acceso a "Configuración de organización". Cualquier rol puede; se revisita en spec futuro.
- Per-tenant customización del login y landing públicos. Siguen Apart Cba branded.
- Soft-delete / data export del usuario (GDPR).
- UI para visualizar el `security_audit_log`. Solo se loggea en DB.
- Notificaciones push del navegador.
- Force-enrollment de 2FA por rol. Es opt-in para todos.
- Sistema de "perdí todo en 2FA" self-service. El superadmin lo desactiva manualmente vía `/superadmin`.

## 3. Decisiones de producto tomadas

| Decisión | Resolución | Razón |
|---|---|---|
| Layout de `/dashboard/perfil` | Una página + tabs internas (no subrutas) | Usuario eligió A en mockups |
| Logo de la org en sidebar | White-label total. Si no hay logo, fallback al brand Apart Cba | Usuario eligió A en mockups |
| Datos editables de la org | Identidad básica: nombre, descripción, dirección, teléfono, mail contacto, logo | Usuario eligió A |
| Dominio de email | Per-organización, verificado vía DNS records que mostramos en UI | Usuario eligió B |
| Split de "from" address | Mails de **cuenta** (auth flows) salen del sistema siempre. Mails al **huésped** salen de la org si verificada, fallback al sistema | Usuario confirmó división por destinatario |
| 2FA | TOTP + 8 recovery codes (single-use, hasheados) — opt-in para todos | Usuario eligió A |
| Email change | Doble notificación (confirm al nuevo + aviso al viejo, link para cancelar) | Best practice — sin pregunta |
| Email de confirmación de reserva | Auto-popup al confirmar, multi-canal (email funcional, WhatsApp UI deshabilitada), editor de contenido por envío | Usuario expandió la pregunta original |
| Discriminación por rol | NO se discrimina en Spec 2 (todos pueden acceder a `/configuracion/organizacion`) | Decisión explícita del usuario, se revisita después |
| Crop de imágenes | NO en MVP | Recomendación nuestra, usuario aceptó |
| WYSIWYG | NO en MVP, texto plano + preview | Recomendación nuestra, usuario aceptó |
| Mails fallidos bloquean operación | NO. Best-effort + log en `security_audit_log` con flag `notification_failed` | Recomendación nuestra, usuario aceptó |
| Cool-down entre cambios de password | NO | Recomendación nuestra, usuario aceptó |
| MFA implementation | Supabase Auth MFA nativo (`auth.mfa_factors`), no roll-our-own | Recomendación, usuario aceptó |

## 4. Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│  UI                                                             │
│   /dashboard/perfil (tabs: Datos / Foto / Seguridad)            │
│   /dashboard/configuracion/organizacion (Identidad / Branding /  │
│        Comunicaciones)                                          │
│   /m/perfil (accordion mobile)                                  │
│   <ConfirmBookingDialog>  (popup multi-canal)                   │
│   <OrgBrand>              (sidebar — reemplaza <Logo>)          │
│   <ImageUploader>         (reusable: avatares + logos)          │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼  server actions (use server)
┌────────────────────────────────────────────────────────────────┐
│  Server actions (src/lib/actions/)                              │
│   profile.ts:  updateUserProfile, uploadAvatar, deleteAvatar     │
│   org.ts (extended): updateOrgIdentity, uploadOrgLogo,           │
│                       deleteOrgLogo, createOrgDomain,            │
│                       verifyOrgDomain, deleteOrgDomain,          │
│                       updateOrgTemplate                          │
│   security.ts (new): changePassword, requestEmailChange,         │
│                       confirmEmailChange, cancelEmailChange,     │
│                       enrollMfaFactor, verifyMfaEnrollment,      │
│                       generateRecoveryCodes, disable2fa,         │
│                       useRecoveryCode, verifyMfaLogin            │
│   bookings.ts (extended): confirmBookingWithMessages,            │
│                            resendBookingConfirmation             │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  Email infra (src/lib/email/)                                   │
│   system.ts:    sendSystemMail()  → Resend, from sistema         │
│   guest.ts:     sendGuestMail()   → Resend, from org o sistema   │
│   templates/system/*.tsx — JSX templates de auth                │
│   templates/render.ts  — sustituye {{var}} con datos             │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  Persistencia (Supabase)                                        │
│   apartcba.organizations (cols nuevas)                          │
│   apartcba.user_2fa_recovery_codes (nueva)                       │
│   apartcba.email_change_requests (nueva)                         │
│   apartcba.org_message_templates (nueva)                         │
│   apartcba.security_audit_log (nueva)                            │
│   apartcba.bookings.confirmation_sent_at (col nueva)             │
│   auth.mfa_factors (nativo Supabase)                            │
│   storage.buckets: avatars, org-logos (nuevos, públicos)        │
└────────────────────────────────────────────────────────────────┘
```

## 5. Data model

### 5.1 — Columnas nuevas en `apartcba.organizations`

```sql
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
```

`logo_url` ya existe en el schema actual, no se toca.

### 5.2 — `apartcba.user_2fa_recovery_codes` (nueva)

```sql
CREATE TABLE IF NOT EXISTS apartcba.user_2fa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,        -- bcrypt hash, never store plain
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user
  ON apartcba.user_2fa_recovery_codes(user_id) WHERE used_at IS NULL;
```

8 codes generados al activar 2FA. Single-use. Cuando el user pide regenerar, marcamos los viejos como `used_at = now()` (lógicamente "consumidos" / inválidos) e insertamos 8 nuevos.

### 5.3 — `apartcba.email_change_requests` (nueva)

```sql
CREATE TABLE IF NOT EXISTS apartcba.email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_email text NOT NULL,
  new_email text NOT NULL,
  confirm_token_hash text NOT NULL,    -- bcrypt(random32)
  cancel_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  notified_old_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_change_user
  ON apartcba.email_change_requests(user_id);
```

`expires_at` = 24h después de la creación. Una sola request "abierta" por user a la vez (validación en server action — no en DB con UNIQUE porque las viejas quedan como histórico).

### 5.4 — `apartcba.org_message_templates` (nueva)

```sql
CREATE TABLE IF NOT EXISTS apartcba.org_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES apartcba.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,            -- 'booking_confirmed' (futuro: 'booking_reminder', 'review_request', etc.)
  channel text NOT NULL,                -- 'email' | 'whatsapp'
  subject text,                         -- solo email
  body text NOT NULL,                   -- texto plano con {{var}}
  is_default boolean NOT NULL DEFAULT false,  -- true mientras no lo editaron, false post-edit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_type, channel)
);
```

**Seeding**: en la migration, después de crear la tabla, insertamos para cada org existente 1 row de cada `(event_type, channel)` con templates default. Mismo proceso al crear org nueva (trigger / hook futuro — por ahora seedeamos en migration y agregamos comentario para crear-org futuro).

### 5.5 — `apartcba.security_audit_log` (nueva)

```sql
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

CREATE TABLE IF NOT EXISTS apartcba.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type apartcba.security_event_type NOT NULL,
  metadata jsonb,                       -- { old: '...', new: '...', notification_failed: true, ... }
  ip text,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_user_time
  ON apartcba.security_audit_log(user_id, occurred_at DESC);
```

Solo se escribe (insert-only). Sin UI en Spec 2.

### 5.6 — Columna nueva en `apartcba.bookings`

```sql
ALTER TABLE apartcba.bookings
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
```

Lo seteamos cuando `<ConfirmBookingDialog>` envía exitoso. Sirve para distinguir "primera confirmación" de "reenvío" en el botón del detalle de reserva.

### 5.7 — Storage buckets

Creados en migration vía `supabase/storage` API o paso manual documentado:

| Bucket | Visibilidad | Max size | Tipos | Path pattern |
|---|---|---|---|---|
| `avatars` | público | 2 MB | jpg, png, webp | `{user_id}/{timestamp}-{filename}` |
| `org-logos` | público | 5 MB | jpg, png, svg, webp | `{organization_id}/{timestamp}-{filename}` |

**RLS de storage** (en migration o vía dashboard):
- `avatars`: SELECT público. INSERT/UPDATE/DELETE solo si `auth.uid() = (storage.foldername(name))[1]::uuid`.
- `org-logos`: SELECT público. INSERT/UPDATE/DELETE solo si el `auth.uid()` es miembro `active=true` de la org del primer folder. Sin discriminación por rol (per decisión explícita del usuario, todos los miembros pueden subir el logo).

## 6. Routing y navegación

### 6.1 — Rutas nuevas (Next App Router)

```
src/app/dashboard/perfil/page.tsx
  └─ <ProfileTabs initialTab="datos">
       ├─ <ProfileDataForm profile={...} />
       ├─ <AvatarUploader currentUrl={...} />
       └─ <SecuritySection profile={...} mfaStatus={...} />

src/app/dashboard/configuracion/organizacion/page.tsx
  └─ <OrgSettings organization={...} domainStatus={...} templates={...}>
       ├─ Section "Identidad"
       ├─ Section "Branding"
       └─ Section "Comunicaciones"
            ├─ Subsection "Dominio Resend"
            └─ Subsection "Plantillas"

src/app/m/perfil/page.tsx
  └─ <MobileProfileAccordion> (mismo set de funcionalidades, layout colapsable)

src/app/confirm-email-change/page.tsx
  └─ Página pública (no requiere auth) que recibe ?token= y aplica cambio

src/app/cancel-email-change/page.tsx
  └─ Página pública que cancela cambio de email pendiente

src/app/login/2fa/page.tsx
  └─ Step intermedio post-login si user tiene factor activo
```

### 6.2 — Cambios al menú existente

**`src/components/dashboard/top-bar.tsx`** — dropdown del avatar:

```tsx
// Antes (línea ~175):
<DropdownMenuItem>
  <Settings size={14} />
  Mi perfil
</DropdownMenuItem>

// Después:
<DropdownMenuItem asChild>
  <Link href="/dashboard/perfil">
    <Settings size={14} /> Mi perfil
  </Link>
</DropdownMenuItem>
<DropdownMenuItem asChild>
  <Link href="/dashboard/configuracion/organizacion">
    <Building2 size={14} /> Configuración de organización
  </Link>
</DropdownMenuItem>
```

(Sin gating por rol — decidido explícitamente.)

**`src/components/dashboard/app-sidebar.tsx`** — sidebar:

Dentro del header del sidebar, reemplazar `<Logo>` por `<OrgBrand currentOrg={currentOrg} />`.

**Sidebar item "Configuración"** ya existe con sub-items Equipo y Colores. Agregamos "Organización" arriba. Visible para todos.

### 6.3 — Mobile

`/m/layout.tsx` ya tiene un user menu o link a perfil — si no, agregamos botón de avatar en el header mobile que linkea a `/m/perfil`.

## 7. UI flows detallados

### 7.1 — `/dashboard/perfil` Tab "Datos"

Layout vertical (form mocked en orden):

```
┌────────────────────────────────────────┐
│ [avatar 64px]  Cambiar foto →          │
│                                        │
│ Nombre completo                        │
│ [_______________________________]      │
│                                        │
│ Teléfono                               │
│ [_______________________________]      │
│                                        │
│ Idioma de la interfaz                  │
│ [Español (Argentina)        ▾]         │
│                                        │
│ Email (read-only)                      │
│ [user@example.com] (Cambiar →)         │
│                                        │
│            [Guardar cambios]           │
└────────────────────────────────────────┘
```

- "Cambiar foto" → cambia tab activo a "Foto" (no abre modal).
- "Cambiar" del email → cambia tab activo a "Seguridad" y hace scroll a la card de Email.
- Campo email muestra el actual de `auth.users.email`.
- Validación Zod cliente: nombre min 2 chars, teléfono regex permisivo.
- Server action: `updateUserProfile({ full_name, phone, preferred_locale })`.
- Toast "Datos actualizados" + revalidatePath('/dashboard/perfil').

### 7.2 — `/dashboard/perfil` Tab "Foto"

Componente `<AvatarUploader>` (wrapper sobre `<ImageUploader>`):

```
┌────────────────────────────────────────┐
│              [avatar 144px]             │
│                                        │
│   Arrastrá una imagen o hacé click     │
│   ╔══════════════════════════════╗     │
│   ║         📷 Subir foto         ║     │
│   ║    JPG, PNG, WebP — max 2MB   ║     │
│   ╚══════════════════════════════╝     │
│                                        │
│   [Eliminar foto actual]               │
└────────────────────────────────────────┘
```

- Drag & drop + click para abrir file picker.
- Preview del archivo seleccionado ANTES de subir.
- Botón "Subir" aparece tras seleccionar.
- Server action `uploadAvatar(formData)`:
  - Valida tipo + size en server.
  - Sube a `avatars/{user_id}/{ts}-{name}`.
  - Borra avatar previo si existía.
  - Updatea `user_profiles.avatar_url` con public URL.
  - `revalidatePath('/dashboard', 'layout')` para que TopBar refresque.
- "Eliminar foto" → confirm dialog → server action `deleteAvatar()` → setea `avatar_url = null`, borra del bucket.

### 7.3 — `/dashboard/perfil` Tab "Seguridad"

3 cards verticales:

**Card "Contraseña"** — botón "Cambiar contraseña" abre dialog:
```
┌──────────────────────────────────────┐
│ Cambiar contraseña                    │
├──────────────────────────────────────┤
│ Contraseña actual                     │
│ [____________________]                │
│                                       │
│ Nueva contraseña (min 8, letra+núm)   │
│ [____________________]                │
│                                       │
│ Confirmar nueva contraseña            │
│ [____________________]                │
│                                       │
│        [Cancelar]    [Cambiar]        │
└──────────────────────────────────────┘
```

Server action `changePassword({ currentPassword, newPassword })`:
1. Re-auth con `signInWithPassword(email, currentPassword)`. Si falla → throw.
2. `supabase.auth.updateUser({ password: newPassword })`.
3. Insert `security_audit_log` con `event_type='password_changed'`.
4. `sendSystemMail({ to: email, template: 'password-changed', variables: { occurredAt: ..., ip: ... } })` (best-effort).
5. Toast "Contraseña actualizada".

**Card "Email"** — muestra email actual + botón "Cambiar":

Al click → dialog:
```
┌──────────────────────────────────────┐
│ Cambiar email                         │
├──────────────────────────────────────┤
│ Email actual: user@example.com        │
│                                       │
│ Nuevo email                           │
│ [____________________]                │
│                                       │
│ Tu contraseña actual (re-auth)        │
│ [____________________]                │
│                                       │
│  Te vamos a enviar un mail al nuevo   │
│  para confirmar, y un aviso al viejo. │
│                                       │
│        [Cancelar]    [Solicitar]      │
└──────────────────────────────────────┘
```

Server action `requestEmailChange({ newEmail, currentPassword })`:
1. Re-auth con `signInWithPassword(currentEmail, currentPassword)`.
2. Validar que `newEmail` no está usado por otra cuenta (`auth.users` lookup vía admin client).
3. Generar 2 tokens random 32-byte hex: `confirm_token`, `cancel_token`. Hashear ambos con bcrypt.
4. Marcar requests anteriores no completadas como `cancelled_at = now()` (1 sola activa por user).
5. Insert en `email_change_requests`.
6. `sendSystemMail({ to: newEmail, template: 'email-change-confirm', variables: { confirmUrl: '${APP_URL}/confirm-email-change?token=${confirm_token}', expiresAt } })`.
7. `sendSystemMail({ to: oldEmail, template: 'email-change-notify-old', variables: { newEmail, cancelUrl: '...?token=${cancel_token}' } })`.
8. Insert `security_audit_log` event `email_change_requested`.
9. Toast "Te enviamos un mail al nuevo email. Confirmalo en 24hs."

Páginas públicas:

`/confirm-email-change?token=XXX` (`src/app/confirm-email-change/page.tsx`):
1. Server component: lookup `email_change_requests` por hash del token, validar `expires_at > now`, no `confirmed_at`, no `cancelled_at`.
2. Si OK: `supabase.auth.admin.updateUserById(userId, { email: newEmail })`. Marcar `confirmed_at = now`.
3. Insert `security_audit_log` event `email_change_confirmed`.
4. Mostrar página "✓ Email actualizado" con botón "Ir al dashboard".

`/cancel-email-change?token=YYY`:
1. Lookup por hash del cancel_token.
2. Si OK y request no aplicada todavía: marcar `cancelled_at = now`. Insert `email_change_cancelled`.
3. Mostrar "Cambio de email cancelado. Tu cuenta sigue con el email actual."

**Card "Verificación en dos pasos"** — 3 estados visuales:

Estado **desactivado**: texto explicativo + botón "Activar 2FA" → wizard.

Wizard 2FA (3 steps en un dialog grande):

*Step 1 — QR + secret:*
- Server action `enrollMfaFactor()` → llama `supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Apart Cba' })` → `{ id, totp: { qr_code, secret, uri } }`.
- Renderizar QR usando `qrcode` lib (server side genera SVG inline) o usar el `qr_code` que devuelve Supabase (es base64 PNG).
- Mostrar el `secret` en formato grupo-de-4 con botón copy.

*Step 2 — Verify:*
- Input de 6 dígitos (con auto-advance entre celdas).
- Server action `verifyMfaEnrollment({ factorId, code })` → `supabase.auth.mfa.verify({ factorId, code })`.
- Si OK: avanza a Step 3.

*Step 3 — Recovery codes:*
- Server action `generateRecoveryCodes(userId)`:
  1. Genera 8 codes random 16-char con formato `XXXX-XXXX-XXXX-XXXX`.
  2. bcrypt hash cada uno.
  3. Insert 8 rows en `user_2fa_recovery_codes`.
  4. Devuelve los codes plain (única vez que existen).
- Mostrar los 8 codes con warning grande "Guardalos. No los vamos a volver a mostrar."
- Botones "Copiar todos" y "Descargar como .txt".
- Insert `security_audit_log` event `2fa_enabled`.
- `sendSystemMail({ template: '2fa-enabled' })`.
- Botón "Listo" cierra wizard.

Estado **activado**: muestra fecha de activación + 2 botones:
- "Generar nuevos códigos de recuperación" — pide password actual, marca todos los anteriores como `used_at = now`, genera 8 nuevos con flow del Step 3.
- "Desactivar 2FA" (rojo) — pide password + código TOTP actual, llama `supabase.auth.mfa.unenroll({ factorId })`, deletea recovery codes, log event, mail.

**Login con 2FA habilitado**:

`src/lib/actions/auth.ts` server action `signIn` — después de signInWithPassword exitoso:
- Si `data.session.aal === 'aal1'` y user tiene factor activo (lookup `auth.mfa_factors` con admin client) → redirect a `/login/2fa`.

`/login/2fa` (`src/app/login/2fa/page.tsx`):
- Input de 6 dígitos.
- Botón "Ingresar".
- Link "Usá un código de recuperación" → toggle a input de recovery code.
- Server action `verifyMfaLogin({ code })` → `supabase.auth.mfa.challengeAndVerify({ factorId, code })`. Eleva AAL a aal2 → redirect `/dashboard`.
- Server action `useRecoveryCode({ code })` → bcrypt match contra cada `user_2fa_recovery_codes` activo (donde `used_at IS NULL`) del user. Si match: marca `used_at = now`, log event `login_with_recovery_code`, eleva AAL a aal2 manualmente vía un endpoint custom (necesitaremos investigar cómo hacer esto con Supabase — alternativa: marcamos el factor como verified y dejamos que normal MFA challenge pase). Dejamos esto como detalle a resolver en la fase de implementación; **flag de riesgo**: si Supabase no permite elevar AAL sin TOTP, los recovery codes desactivan temporalmente el factor en lugar de elevar AAL — el siguiente login no pide TOTP y el user re-enrolea el factor.

### 7.4 — `/dashboard/configuracion/organizacion`

**Sección "Identidad"**:
- Form simple con campos: nombre comercial, descripción (textarea), dirección, teléfono, mail contacto.
- Botón "Guardar". Server action `updateOrgIdentity({ name, description, address, contact_phone, contact_email })`.
- `revalidatePath('/dashboard', 'layout')` para refrescar nombre en TopBar.

**Sección "Branding"**:
- `<ImageUploader>` reutilizable con bucket `org-logos`, max 5MB, tipos extendidos (incluye SVG).
- Preview grande del logo actual (o placeholder con icono).
- Botón "Restaurar logo Apart Cba" (rojo, requiere confirm) — setea `logo_url = null`.
- Después del upload/delete, `revalidatePath('/dashboard', 'layout')`.

**Sección "Comunicaciones" — sub "Dominio Resend"**:
- 3 estados según el value de `email_domain` y `email_domain_verified_at`.

Estado A — sin dominio (`email_domain IS NULL`):
```
┌─────────────────────────────────────────────────────┐
│ Dominio para emails a tus huéspedes                 │
│                                                     │
│ Configurá un dominio propio para que los emails de  │
│ confirmación de reserva salgan de tu marca.         │
│ Mientras tanto, salen de noreply@apartcba.com.      │
│                                                     │
│ Dominio:           [_____________________]          │
│ Nombre remitente:  [_____________________]          │
│ Local part:        [_______]@dominio                │
│                                                     │
│                            [Crear en Resend]        │
└─────────────────────────────────────────────────────┘
```
- Server action `createOrgDomain({ domain, sender_name, sender_local_part })`:
  - Validar formato dominio + local_part.
  - Llamar `resend.domains.create({ name: domain, region: 'us-east-1' })`.
  - Guardar respuesta en `email_domain_dns_records` (jsonb) + setear las otras cols.
  - revalidate.

Estado B — pendiente verificación:
```
┌─────────────────────────────────────────────────────┐
│ ⚠ Pendiente verificación: monacosuites.com          │
│                                                     │
│ Agregá estos records en tu proveedor de DNS:        │
│                                                     │
│ ┌─────┬──────────────────┬─────────────────┬─────┐  │
│ │ TYPE│ NAME             │ VALUE           │COPY │  │
│ ├─────┼──────────────────┼─────────────────┼─────┤  │
│ │ TXT │ resend._domainkey│ p=MIIB...       │ 📋  │  │
│ │ TXT │ @                │ v=spf1 include..│ 📋  │  │
│ │ TXT │ _dmarc           │ v=DMARC1 ...    │ 📋  │  │
│ └─────┴──────────────────┴─────────────────┴─────┘  │
│                                                     │
│ Puede tardar unas horas tras agregar los records.   │
│                                                     │
│      [Reiniciar config]   [Verificar ahora]         │
└─────────────────────────────────────────────────────┘
```
- "Verificar ahora" → server action `verifyOrgDomain()`:
  - Llama `resend.domains.get(stored_domain_id)`.
  - Si `status === 'verified'` → setea `email_domain_verified_at = now`. Toast "✓ Verificado".
  - Si no → toast "Aún no verificado".
- "Reiniciar config" (rojo) → confirm → `deleteOrgDomain()`: borra en Resend + limpia cols.

Estado C — verificado:
```
┌─────────────────────────────────────────────────────┐
│ ✓ Dominio verificado: monacosuites.com              │
│ Remitente: Monaco Suites <reservas@monacosuites.com>│
│                                                     │
│              [Cambiar configuración]                │
└─────────────────────────────────────────────────────┘
```

**Sección "Comunicaciones" — sub "Plantillas"**:

Lista accordion. Cada row es `(event_type, channel)`:

```
▼ Confirmación de reserva — Email     [editado]   ⚙
▶ Confirmación de reserva — WhatsApp  [próximamente]
```

Click en email row → editor abre debajo:

```
┌─────────────────────────────────────────────────────┐
│ Asunto                                              │
│ [Tu reserva en {{org.name}} está confirmada]        │
│                                                     │
│ Cuerpo                          Variables disponibles│
│ ┌────────────────────────────┐  • {{guest.full_name}}│
│ │ Hola {{guest.first_name}}, │  • {{guest.first_name}}│
│ │                            │  • {{org.name}}       │
│ │ Te confirmamos tu reserva  │  • {{unit.name}}      │
│ │ en {{unit.name}} del       │  • {{unit.code}}      │
│ │ {{booking.check_in_date}}  │  • {{booking.check_in_date}}│
│ │ al                         │  • {{booking.check_out_date}}│
│ │ {{booking.check_out_date}} │  • {{booking.nights}} │
│ │ ...                        │  • ...                │
│ └────────────────────────────┘  (click p/insertar)    │
│                                                     │
│  [Restaurar default]   [Vista previa]   [Guardar]   │
└─────────────────────────────────────────────────────┘
```

Variables se insertan en cursor position al click. "Vista previa" abre dialog con render usando datos fake realistas.

Server action `updateOrgTemplate({ id, subject, body })`:
- Valida que las `{{var}}` mencionadas existan en la lista permitida para ese `event_type`. Si encuentra `{{foo}}` no permitida, error claro: "Variable {{foo}} no existe. Variables válidas: ...".
- Update fila + setea `is_default = false`.

### 7.5 — `<ConfirmBookingDialog>` (popup multi-canal)

**Donde se monta:** todo botón "Confirmar reserva" existente lo abre en lugar de llamar la server action directa. Lugares:
- `/dashboard/reservas/[id]` (detalle de reserva)
- `/dashboard/reservas/page.tsx` (lista)
- `/dashboard/unidades/kanban/page.tsx` (cards drag al estado "confirmada" → abre dialog antes de aplicar)
- `/dashboard/unidades/[id]/page.tsx` (calendario por unidad)
- Cualquier otro lugar con "confirmar"

**Estructura**: dialog con stepper visual.

*Step 1 — Canales:*
```
┌─────────────────────────────────────────────────────┐
│ Confirmar reserva — María González                  │
│ Departamento 3B · 12-16 May 2026                    │
├─────────────────────────────────────────────────────┤
│ Canal de confirmación                               │
│                                                     │
│ ☑ Email                                             │
│   maria.gonzalez@example.com                        │
│                                                     │
│ ☐ WhatsApp                          [próximamente]  │
│                                                     │
│              [Cancelar]   [Siguiente →]             │
└─────────────────────────────────────────────────────┘
```

Si el huésped no tiene email: warning "Este huésped no tiene email cargado." + botón "Confirmar sin enviar" + link "Editar huésped".

*Step 2 — Editor (solo si Email checked):*
- Render del template con variables sustituidas (template default si nunca editaron, custom si sí).
- Asunto editable + Cuerpo editable (textarea).
- Hint: "Cambios solo aplican a este envío."

*Step 3 — Vista previa final:*
- Card simulando el mail: from, to, subject, body.
- Botón "← Atrás" + "✓ Confirmar reserva y enviar".

**Server action `confirmBookingWithMessages`:**

```ts
async function confirmBookingWithMessages({
  bookingId: string,
  channels: ('email' | 'whatsapp')[],   // hoy solo 'email' válido
  emailOverride?: { subject: string; body: string },
}) {
  // 1. Validación: bookingId, channels válidos, etc.
  // 2. Update booking.status = 'confirmed' + booking.confirmation_sent_at = now (atómico).
  // 3. Insert booking event log.
  // 4. Si 'email' en channels:
  //    - Si emailOverride: usar literal.
  //    - Si no: lookup org_message_templates, render con vars.
  //    - sendGuestMail({ organizationId, to: guest.email, subject, html, reply_to: org.contact_email }).
  // 5. revalidate paths relevantes.
  // 6. return { ok, channels_sent, channels_failed }.
}
```

Si Resend falla, la reserva queda confirmada igual + warning toast "Email falló" + log en `security_audit_log` con `notification_failed: true` (o tabla aparte de mensajes fallidos — decisión de implementación).

**"Reenviar confirmación":** mismo dialog, server action `resendBookingConfirmation()` que solo envía sin tocar status.

## 8. Server actions — listado

### 8.1 — Nuevos archivos

`src/lib/actions/security.ts`:
- `changePassword({ currentPassword, newPassword })`
- `requestEmailChange({ newEmail, currentPassword })`
- `confirmEmailChange({ token })` — público (no requiere session)
- `cancelEmailChange({ token })` — público
- `enrollMfaFactor()`
- `verifyMfaEnrollment({ factorId, code })`
- `generateRecoveryCodes()`
- `disable2fa({ currentPassword, currentTotpCode })`
- `verifyMfaLogin({ code })` — durante login
- `useRecoveryCode({ code })` — durante login

`src/lib/email/system.ts`:
- `sendSystemMail({ to, subject, template, variables })`

`src/lib/email/guest.ts`:
- `sendGuestMail({ organizationId, to, subject, html, reply_to? })`

`src/lib/email/templates/render.ts`:
- `renderTemplate(body: string, variables: Record<string, string>): string` — sustituye `{{var}}` con escape básico.

`src/lib/email/templates/system/`:
- `password-changed.tsx`
- `email-change-confirm.tsx`
- `email-change-notify-old.tsx`
- `email-change-cancel-confirm.tsx`
- `2fa-enabled.tsx`
- `2fa-disabled.tsx`

### 8.2 — Archivos extendidos

`src/lib/actions/profile.ts` (nuevo):
- `updateUserProfile({ full_name, phone, preferred_locale })`
- `uploadAvatar(formData)`
- `deleteAvatar()`

`src/lib/actions/org.ts` (extendido — ya existe):
- `updateOrgIdentity({ name, description, address, contact_phone, contact_email })`
- `uploadOrgLogo(formData)`
- `deleteOrgLogo()`
- `createOrgDomain({ domain, sender_name, sender_local_part })`
- `verifyOrgDomain()`
- `deleteOrgDomain()`
- `updateOrgTemplate({ id, subject, body })`

`src/lib/actions/bookings.ts` (extendido — ya existe):
- `confirmBookingWithMessages({ bookingId, channels, emailOverride? })`
- `resendBookingConfirmation({ bookingId, channels, emailOverride? })`

## 9. Permisos

Per decisión explícita del usuario, **no se discrimina por rol** en Spec 2. Cualquier miembro de la org puede acceder a `/dashboard/configuracion/organizacion` y editar cualquier cosa de la org. Se revisita en spec futuro de roles.

Las server actions **sí mantienen** el check estándar de `requireSession()` + `getCurrentOrg()` + `organization_id` filtering. Solo se quita la diferenciación por rol (no se llama `can(role, "organization", "update")` en Spec 2).

## 10. Variables de entorno nuevas

```
# Resend
RESEND_API_KEY=re_xxx                      # server-only
SYSTEM_EMAIL_FROM=auth@apartcba.com
SYSTEM_EMAIL_FROM_NAME=Apart Cba Seguridad
APART_CBA_FALLBACK_FROM=noreply@apartcba.com   # cuando org no tiene dominio verificado, friendly name = org.name
APART_CBA_FALLBACK_FROM_NAME=Apart Cba         # fallback friendly name si org.name no se puede usar
```

`.env.local.example` y README se actualizan.

## 11. Dependencias npm nuevas

```json
{
  "resend": "^3.x",
  "otplib": "^12.x",       // si no usamos solo Supabase MFA verify
  "qrcode": "^1.5.x",      // generar SVG del QR de enrollment
  "@types/qrcode": "^1.x"
}
```

`bcryptjs` ya está disponible (usado en otras partes del proyecto). Si no, agregar.

## 12. Migration plan — `010_profile_branding_security.sql`

Idempotente. Orden:

1. `ALTER TABLE apartcba.organizations` agregar columnas nuevas.
2. `CREATE TYPE apartcba.security_event_type` (con `IF NOT EXISTS` workaround usando DO block).
3. `CREATE TABLE` para las 4 tablas nuevas.
4. `CREATE INDEX` correspondientes.
5. `ALTER TABLE apartcba.bookings ADD COLUMN confirmation_sent_at`.
6. Insert seeding en `org_message_templates` para cada org existente:
   - 1 row `(org_id, 'booking_confirmed', 'email')` con default template Spanish.
   - 1 row `(org_id, 'booking_confirmed', 'whatsapp')` con default template Spanish.
7. Crear storage buckets `avatars` y `org-logos` (si no existen) vía función o paso manual documentado.
8. Setear RLS de buckets.

Backfills: ninguno necesario salvo seeding de templates.

## 13. Testing & verificación (sin runner)

Surrogates idénticas a PR1:
- `tsc --noEmit` clean (filtrar errores pre-existentes de `webhooks/meta` si siguen rotos).
- `npm run lint` clean en archivos tocados.
- `npm run build` clean (idem filtro).

**Smoke manual obligatorio:**
- Subir avatar real, verificar que aparece en TopBar sin reload.
- Subir logo de org, verificar que sidebar cambia para todos los usuarios de esa org.
- Cambio de password real con notificación llegando al mail.
- Cambio de email real (pedir, recibir mail, hacer click, confirmar, ver email cambiado en sesión).
- Cancelar cambio de email desde el mail al viejo.
- Activar 2FA real con tu app de autenticación, descargar recovery codes, logout, login con 2FA.
- Login usando un recovery code (consume el code).
- Crear dominio Resend de prueba (usar un dominio real que controles), agregar DNS records, verificar.
- Editar template de booking_confirmed con `{{vars}}`, ver preview, guardar.
- Confirmar reserva con email real a casilla que controles → recibir email con datos correctos.
- Reenviar confirmación desde detalle de reserva → recibir 2do mail.
- Mismo set en `/m/perfil` (todo lo aplicable).

## 14. Rollout

Sin feature flag. Single PR (o cluster de 4 PRs — ver §16) que se mergea cuando smoke manual pasa.

Tras deploy:
- Las orgs existentes ven todo igual hasta que admin entre a `/configuracion/organizacion` y suba logo / configure dominio.
- 2FA es opt-in — usuarios existentes siguen entrando con solo password hasta que activen.

Rollback = `git revert` del PR. Las migrations de columnas nuevas no rompen lecturas (solo agregan). Tablas nuevas quedan vacías sin uso. Storage buckets vacíos.

## 15. Riesgos y mitigaciones

| Riesgo | Probabilidad | Severidad | Mitigación |
|---|---|---|---|
| Recovery code flow no puede elevar AAL en Supabase | Media | Alta | Investigar en fase de implementación. Plan B: recovery code desactiva temporalmente factor MFA y user re-enrolea |
| Resend rate limit | Baja | Media | 100 req/s es mucho. Si pasa, upgrade plan |
| Email a huésped en spam por DKIM/SPF mal configurado | Media | Alta | UI explica importancia de DNS; recomendación de plataformas (Cloudflare etc.) en docs |
| Avatar bucket leak | Baja | Baja | Public bucket pero con UUID en path evita enumeration; avatares no son sensibles |
| Breaking change al `<Logo>` rompe sidebar mobile o superadmin | Baja | Media | `<OrgBrand>` solo se usa en `/dashboard`. `/m/*` y `/superadmin/*` siguen con `<Logo>` |
| Dominio Resend con TXT records errados queda en pending eternamente | Media | Baja | Botón "Reiniciar config" disponible. Doc explicando troubleshooting |
| Cambio de email del usuario activa logout en otras sesiones | Media | Media | Documentar comportamiento. Es lo correcto desde seguridad |
| Reset de password sin re-auth deja vulnerable a session hijack | N/A | N/A | Ya pedimos re-auth con currentPassword |
| Templates con variables custom rompen render | Baja | Baja | Validamos en server action; render siempre escape-safe |

## 16. Orden de implementación (input para writing-plans)

Topología de dependencias (las posteriores requieren las anteriores):

1. **Migration + Storage buckets** — base.
2. **Helper Resend (sistema y huésped)** — base, depende de env vars + dep `resend`.
3. **`<OrgBrand>` + reemplazo de `<Logo>` en sidebar** — depende solo de schema (col existente `logo_url`).
4. **`<ImageUploader>` (componente reusable)** — base de avatar y logo.
5. **Server actions de profile + Tab Datos + Tab Foto** — depende de 4.
6. **Server actions y UI de `/configuracion/organizacion` Identidad + Branding** — depende de 4.
7. **Server actions y UI de Domain Verify** — depende de 2 (helper Resend) + acceso a Resend API directo.
8. **Server actions y UI de Templates** — depende de schema + helper render.
9. **Server actions de password change + Card Contraseña + sendSystemMail "password-changed"** — depende de 2.
10. **Server actions de email change + Cards/páginas correspondientes + sendSystemMail templates** — depende de 2.
11. **Server actions y UI de 2FA wizard + recovery codes** — depende de 2 + dep `qrcode`.
12. **`/login/2fa` + verifyMfaLogin + useRecoveryCode + cambios a auth flow** — depende de 11.
13. **`<ConfirmBookingDialog>` + server actions + reemplazo en todos los lugares de "Confirmar"** — depende de 8 + 2 + helper render.
14. **`/m/perfil` (mobile)** — depende de 5 + 9 + 11.
15. **Audit log** — escritura en cada server action de seguridad. Se va sumando a medida que se implementan 9, 10, 11, 12.

**División sugerida en 4 PRs:**

- **PR 2.A** — Cimientos + Perfil personal (1, 2, 3, 4, 5)
- **PR 2.B** — Configuración de organización (6, 7, 8)
- **PR 2.C** — Seguridad (9, 10, 11, 12, 15)
- **PR 2.D** — Confirmación de reserva multi-canal + Mobile (13, 14)

Cada PR es revisable y mergeable independientemente. PR 2.D requiere PR 2.B (templates) y PR 2.A (helper email).

El plan que viene después (next step: writing-plans) decide si se hace todo en un PR mega o se separa.

---

## Apéndice A — Lista completa de variables disponibles para templates

Para `event_type='booking_confirmed'`:

```
{{guest.full_name}}
{{guest.first_name}}
{{guest.email}}
{{guest.phone}}
{{org.name}}
{{org.contact_phone}}
{{org.contact_email}}
{{org.address}}
{{unit.name}}
{{unit.code}}
{{unit.address}}
{{booking.check_in_date}}        — formateado "Lun 12 May 2026"
{{booking.check_in_date_iso}}    — "2026-05-12"
{{booking.check_out_date}}
{{booking.check_out_date_iso}}
{{booking.nights}}
{{booking.guests_count}}
{{booking.total_amount}}         — formateado "$ 240.000"
{{booking.total_amount_raw}}     — "240000"
{{booking.currency}}
{{booking.balance_due}}
{{booking.payment_link}}         — URL al schedule de pago si tiene
```

Lista cerrada. Validamos en `updateOrgTemplate` que el body solo use estas variables.

## Apéndice B — Templates default (Spanish)

**`booking_confirmed × email`:**

Subject: `Tu reserva en {{org.name}} está confirmada — {{booking.check_in_date}}`

Body:
```
Hola {{guest.first_name}},

Te confirmamos la reserva en {{unit.name}} ({{org.name}}).

Detalles:
- Check-in: {{booking.check_in_date}}
- Check-out: {{booking.check_out_date}}
- Noches: {{booking.nights}}
- Huéspedes: {{booking.guests_count}}
- Total: {{booking.total_amount}}

Cualquier consulta, escribinos a {{org.contact_email}} o llamanos al {{org.contact_phone}}.

¡Te esperamos!
{{org.name}}
```

**`booking_confirmed × whatsapp`** (no se envía hoy, default para futuro):

```
Hola {{guest.first_name}}! Te confirmamos la reserva en {{unit.name}} del {{booking.check_in_date}} al {{booking.check_out_date}} ({{booking.nights}} noches). Total: {{booking.total_amount}}. Consultas: {{org.contact_email}}.
```

(Sin asunto en WhatsApp.)
