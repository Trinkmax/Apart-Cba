# Foto de documento opcional en invite + tab perfil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el admin suba opcionalmente la foto del DNI del empleado al invitarlo (mismo submit), y que el empleado pueda subir/reemplazar/eliminar su documento desde una nueva tab "Documento" en `/dashboard/perfil`. Foto privada — sólo el dueño y los admins de la org pueden verla vía URLs firmadas.

**Architecture:** Nuevo bucket privado `id-documents` en Supabase Storage. Dos columnas nuevas en `user_profiles` (`id_document_path`, `id_document_uploaded_at`). Tres server actions nuevas en `profile.ts` (`uploadIdDocument`, `deleteIdDocument`, `getIdDocumentSignedUrl`). `inviteTeamMember` cambia su firma de objeto a `FormData` para soportar archivo. UI: campo nuevo en `<InviteDialog>`, nueva tab `<DocumentUploader>` en perfil, ícono indicador en lista de equipo (sólo visible para admins).

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase (Postgres `apartcba` schema + Storage), Zod, shadcn/ui, Tailwind v4, lucide-react, sonner.

**Pre-requisito de entorno (importante):** este proyecto **no tiene test runner** (CLAUDE.md: "Don't claim tests pass — run `tsc --noEmit` and `lint` instead"). Por eso cada tarea cierra con `npx tsc --noEmit`, `npm run lint`, y verificación manual en browser donde aplica — **no con pytest/vitest/etc**.

**Cómo correr el dev server:** `npm run dev` arranca en `http://localhost:3001` (no 3000). Loguearse con un usuario admin de una organización.

---

## Mapa de archivos

### Crear
- `supabase/migrations/015_user_id_document.sql` — columnas + bucket privado.
- `src/app/dashboard/perfil/document-uploader.tsx` — client component con dropzone + acciones.
- `src/components/team/view-id-document-button.tsx` — client component con botón ícono que pide URL firmada.

### Modificar
- `src/lib/types/database.ts` — agregar `id_document_path` y `id_document_uploaded_at` a `UserProfile`.
- `src/lib/actions/profile.ts` — agregar `uploadIdDocument`, `deleteIdDocument`, `getIdDocumentSignedUrl`.
- `src/lib/actions/team.ts` — refactor `inviteTeamMember` a `FormData`; agregar campo `viewerRole` al return de `listTeamMembers`.
- `src/components/team/invite-dialog.tsx` — campo nuevo de archivo, submit con FormData.
- `src/app/dashboard/perfil/profile-tabs.tsx` — sumar tab "Documento" entre "Foto" y "Seguridad".
- `src/app/dashboard/perfil/page.tsx` — pasar flags de documento al `ProfileTabs`.
- `src/app/dashboard/configuracion/equipo/page.tsx` — usar `viewerRole` para condicionar ícono "Ver doc".

---

## Task 1: Migración SQL — columnas + bucket privado

**Files:**
- Create: `supabase/migrations/015_user_id_document.sql`

- [ ] **Step 1: Crear el archivo de migración**

Contenido completo de `supabase/migrations/015_user_id_document.sql`:

```sql
-- 015_user_id_document.sql
-- Foto de documento (DNI/pasaporte) opcional para miembros del equipo.
-- Almacenamiento privado: el path se guarda en user_profiles, el acceso
-- al archivo va siempre por server actions con URLs firmadas (1h).

-- 1) Columnas en user_profiles
alter table apartcba.user_profiles
  add column if not exists id_document_path text,
  add column if not exists id_document_uploaded_at timestamptz;

-- 2) Bucket privado para documentos de identidad
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Aplicar la migración al proyecto Supabase**

Aplicar vía MCP de Supabase (mismo patrón usado en migraciones previas del repo):

Llamar `mcp__supabase-apartcba__apply_migration` con:
- `name`: `"015_user_id_document"`
- `query`: el SQL completo del paso 1.

Esperar confirmación de éxito. Si falla, leer el error y corregir; no avanzar a Task 2.

- [ ] **Step 3: Verificar que la migración se aplicó**

Llamar `mcp__supabase-apartcba__list_migrations` y confirmar que `015_user_id_document` está en la lista.

Llamar `mcp__supabase-apartcba__execute_sql` con:
```sql
select column_name, data_type
from information_schema.columns
where table_schema='apartcba'
  and table_name='user_profiles'
  and column_name in ('id_document_path','id_document_uploaded_at');
```
Esperado: 2 filas, ambas con `data_type` `text` y `timestamp with time zone`.

Llamar `mcp__supabase-apartcba__execute_sql` con:
```sql
select id, public from storage.buckets where id='id-documents';
```
Esperado: 1 fila, `public=false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/015_user_id_document.sql
git commit -m "feat(db): id_document fields + private bucket for team docs"
```

---

## Task 2: Tipos TypeScript — campos en `UserProfile`

**Files:**
- Modify: `src/lib/types/database.ts:165-175`

- [ ] **Step 1: Agregar las propiedades al type**

Reemplazar la interfaz `UserProfile` por:

```ts
export interface UserProfile {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  is_superadmin: boolean;
  active: boolean;
  preferred_locale: string | null;
  id_document_path: string | null;
  id_document_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Esperado: sin errores nuevos. (Puede haber errores preexistentes — sólo importa que no aparezca uno nuevo relacionado con `UserProfile`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat(types): id_document_path + id_document_uploaded_at en UserProfile"
```

---

## Task 3: Server actions de documento — `uploadIdDocument` y `deleteIdDocument`

**Files:**
- Modify: `src/lib/actions/profile.ts` (agregar al final del archivo, antes de la función `extractPathFromPublicUrl`).

- [ ] **Step 1: Agregar constantes y `uploadIdDocument`**

Insertar al final de `src/lib/actions/profile.ts`, antes de `function extractPathFromPublicUrl`:

```ts
const ALLOWED_DOC_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
const ID_DOC_BUCKET = "id-documents";

function inferDocMime(path: string): "image" | "pdf" {
  return path.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
}

export async function uploadIdDocument(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió archivo" };
  if (!ALLOWED_DOC_TYPES.includes(file.type)) {
    return { ok: false, error: "Tipo no soportado (JPG/PNG/WebP/PDF)" };
  }
  if (file.size > MAX_DOC_BYTES) {
    return { ok: false, error: "Archivo > 5 MB" };
  }

  const admin = createAdminClient();

  // Borrar documento previo si existe
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id_document_path")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.id_document_path) {
    await admin.storage.from(ID_DOC_BUCKET).remove([profile.id_document_path]).catch(() => null);
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `${session.userId}/${Date.now()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(ID_DOC_BUCKET)
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: updateError } = await admin
    .from("user_profiles")
    .update({
      id_document_path: path,
      id_document_uploaded_at: new Date().toISOString(),
    })
    .eq("user_id", session.userId);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard/configuracion/equipo");
  return { ok: true };
}

export async function deleteIdDocument(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id_document_path")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (profile?.id_document_path) {
    await admin.storage.from(ID_DOC_BUCKET).remove([profile.id_document_path]).catch(() => null);
  }
  await admin
    .from("user_profiles")
    .update({ id_document_path: null, id_document_uploaded_at: null })
    .eq("user_id", session.userId);
  revalidatePath("/dashboard/perfil");
  revalidatePath("/dashboard/configuracion/equipo");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/profile.ts
git commit -m "feat(actions): uploadIdDocument + deleteIdDocument (bucket privado)"
```

---

## Task 4: Server action `getIdDocumentSignedUrl` con permisos org

**Files:**
- Modify: `src/lib/actions/profile.ts` (agregar después de `deleteIdDocument`).

- [ ] **Step 1: Agregar import de `getCurrentOrg`**

Al tope de `src/lib/actions/profile.ts`, después de `import { requireSession } from "./auth";`:

```ts
import { getCurrentOrg } from "./org";
```

- [ ] **Step 2: Implementar `getIdDocumentSignedUrl`**

Agregar después de `deleteIdDocument` (antes de `extractPathFromPublicUrl`):

```ts
export async function getIdDocumentSignedUrl(
  userId: string
): Promise<{ url: string; mimeType: "image" | "pdf" }> {
  const session = await requireSession();
  const admin = createAdminClient();

  // Permisos
  if (userId !== session.userId) {
    const { organization, role } = await getCurrentOrg();
    const isAdmin = role === "admin" || session.profile.is_superadmin;
    if (!isAdmin) throw new Error("No autorizado");
    // Verificar que el target sea miembro de la misma org
    const { data: membership } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organization.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("No autorizado");
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("id_document_path")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id_document_path) throw new Error("Sin documento");

  const { data, error } = await admin.storage
    .from(ID_DOC_BUCKET)
    .createSignedUrl(profile.id_document_path, 60 * 60); // 1 hora
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "No se pudo generar la URL");
  }

  return { url: data.signedUrl, mimeType: inferDocMime(profile.id_document_path) };
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/profile.ts
git commit -m "feat(actions): getIdDocumentSignedUrl con permisos org admin/owner"
```

---

## Task 5: Refactor `inviteTeamMember` a `FormData` + subir documento opcional

**Files:**
- Modify: `src/lib/actions/team.ts:10-117`

Este task cambia la **firma pública** de `inviteTeamMember` (de objeto a `FormData`). El único caller de la action es `<InviteDialog>` (Task 7), que se actualiza en el mismo commit por consistencia. Para mantener el commit chico, en este task se actualizan **ambos** archivos.

- [ ] **Step 1: Reemplazar el schema y la action**

Reemplazar las líneas 10-117 de `src/lib/actions/team.ts` (desde `const inviteSchema` hasta el cierre de `inviteTeamMember`) por:

```ts
const ALLOWED_INVITE_DOC_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_INVITE_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
const ID_DOC_BUCKET = "id-documents";

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: z.enum(["admin", "recepcion", "mantenimiento", "limpieza", "owner_view"]),
  phone: z.string().optional().nullable(),
});

export type InviteInput = z.infer<typeof inviteSchema>;

export async function listTeamMembers(): Promise<(OrganizationMember & { profile: UserProfile | null; email: string | null })[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("*")
    .eq("organization_id", organization.id)
    .order("active", { ascending: false })
    .order("joined_at");

  if (!members || members.length === 0) return [];
  const userIds = members.map((m) => m.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("*")
    .in("user_id", userIds);

  // Get emails from auth.users via admin
  const authAdmin = createAuthAdminClient();
  const emailsByUser = new Map<string, string>();
  for (const m of members) {
    try {
      const { data } = await authAdmin.auth.admin.getUserById(m.user_id);
      if (data?.user?.email) emailsByUser.set(m.user_id, data.user.email);
    } catch {
      // ignore
    }
  }

  return members.map((m) => ({
    ...m,
    profile: profiles?.find((p) => p.user_id === m.user_id) ?? null,
    email: emailsByUser.get(m.user_id) ?? null,
  })) as never;
}

export async function inviteTeamMember(
  formData: FormData
): Promise<{ userId: string; tempPassword: string; documentWarning?: string }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin" && !session.profile.is_superadmin) {
    throw new Error("Solo los admins pueden invitar usuarios");
  }

  const validated = inviteSchema.parse({
    email: formData.get("email"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    phone: (formData.get("phone") as string | null) || null,
  });

  const docFile = formData.get("id_document");
  const hasDoc = docFile instanceof File && docFile.size > 0;

  const authAdmin = createAuthAdminClient();
  const admin = createAdminClient();

  // Check si el user existe en auth.users
  let userId: string;
  let tempPassword = "";

  const { data: existingUsers } = await authAdmin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === validated.email);

  if (existing) {
    userId = existing.id;
  } else {
    tempPassword = `Apart${Math.random().toString(36).slice(-8)}!`;
    const { data: created, error } = await authAdmin.auth.admin.createUser({
      email: validated.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: validated.full_name },
    });
    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("No se pudo crear el usuario");
    userId = created.user.id;
  }

  // Asegurar perfil
  await admin
    .from("user_profiles")
    .upsert({
      user_id: userId,
      full_name: validated.full_name,
      phone: validated.phone,
      active: true,
    }, { onConflict: "user_id" });

  // Membership
  const { error: memErr } = await admin
    .from("organization_members")
    .upsert({
      organization_id: organization.id,
      user_id: userId,
      role: validated.role,
      invited_by: session.userId,
      invited_at: new Date().toISOString(),
      active: true,
    }, { onConflict: "organization_id,user_id" });

  if (memErr) throw new Error(memErr.message);

  // Subida opcional de documento. Si falla, no revertimos el invite — devolvemos warning.
  let documentWarning: string | undefined;
  if (hasDoc) {
    const file = docFile as File;
    if (!ALLOWED_INVITE_DOC_TYPES.includes(file.type)) {
      documentWarning = "Tipo de archivo no soportado (JPG/PNG/WebP/PDF). Documento no guardado.";
    } else if (file.size > MAX_INVITE_DOC_BYTES) {
      documentWarning = "Archivo > 5 MB. Documento no guardado.";
    } else {
      // Borrar previo si existía (caso: re-invite sobre user existente con doc)
      const { data: prev } = await admin
        .from("user_profiles")
        .select("id_document_path")
        .eq("user_id", userId)
        .maybeSingle();
      if (prev?.id_document_path) {
        await admin.storage.from(ID_DOC_BUCKET).remove([prev.id_document_path]).catch(() => null);
      }

      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
      const path = `${userId}/${Date.now()}.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadErr } = await admin.storage
        .from(ID_DOC_BUCKET)
        .upload(path, arrayBuffer, { contentType: file.type, upsert: false });
      if (uploadErr) {
        documentWarning = uploadErr.message;
      } else {
        const { error: profErr } = await admin
          .from("user_profiles")
          .update({
            id_document_path: path,
            id_document_uploaded_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        if (profErr) documentWarning = profErr.message;
      }
    }
  }

  revalidatePath("/dashboard/configuracion/equipo");
  return { userId, tempPassword, ...(documentWarning ? { documentWarning } : {}) };
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
**Esperado:** **un error nuevo** en `src/components/team/invite-dialog.tsx` porque sigue llamando a `inviteTeamMember(form)` con un objeto. Lo arreglamos en el siguiente paso. Cualquier otro error nuevo es un bug — investigar antes de avanzar.

- [ ] **Step 3: Actualizar el caller en `<InviteDialog>` para mantener el typecheck verde**

(El UI completo del file uploader se hace en Task 7. Acá sólo se actualiza la invocación para que compile.)

En `src/components/team/invite-dialog.tsx`, reemplazar el bloque actual de `handleSubmit` (líneas ~36-53):

```tsx
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  startTransition(async () => {
    try {
      const r = await inviteTeamMember(form);
      if (r.tempPassword) {
        setTempPassword(r.tempPassword);
        toast.success("Usuario invitado con contraseña temporal");
      } else {
        toast.success("Usuario agregado a la organización");
        setOpen(false);
      }
      router.refresh();
    } catch (e) {
      toast.error("Error", { description: (e as Error).message });
    }
  });
}
```

por:

```tsx
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  startTransition(async () => {
    try {
      const fd = new FormData();
      fd.set("email", form.email);
      fd.set("full_name", form.full_name);
      fd.set("role", form.role);
      if (form.phone) fd.set("phone", form.phone);
      const r = await inviteTeamMember(fd);
      if (r.documentWarning) {
        toast.warning("Documento no guardado", { description: r.documentWarning });
      }
      if (r.tempPassword) {
        setTempPassword(r.tempPassword);
        toast.success("Usuario invitado con contraseña temporal");
      } else {
        toast.success("Usuario agregado a la organización");
        setOpen(false);
      }
      router.refresh();
    } catch (e) {
      toast.error("Error", { description: (e as Error).message });
    }
  });
}
```

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/team.ts src/components/team/invite-dialog.tsx
git commit -m "feat(actions): inviteTeamMember acepta FormData + sube id_document opcional"
```

---

## Task 6: Sumar `viewerRole` a `listTeamMembers` y a la página

**Files:**
- Modify: `src/lib/actions/team.ts` (función `listTeamMembers`)
- Modify: `src/app/dashboard/configuracion/equipo/page.tsx`

- [ ] **Step 1: Cambiar el return de `listTeamMembers`**

Reemplazar la firma + cuerpo de `listTeamMembers` por:

```ts
export async function listTeamMembers(): Promise<{
  members: (OrganizationMember & { profile: UserProfile | null; email: string | null })[];
  viewerRole: UserRole;
  viewerIsSuperadmin: boolean;
}> {
  const session = await requireSession();
  const { organization, role: viewerRole } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("*")
    .eq("organization_id", organization.id)
    .order("active", { ascending: false })
    .order("joined_at");

  if (!members || members.length === 0) {
    return { members: [], viewerRole, viewerIsSuperadmin: session.profile.is_superadmin };
  }
  const userIds = members.map((m) => m.user_id);

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("*")
    .in("user_id", userIds);

  const authAdmin = createAuthAdminClient();
  const emailsByUser = new Map<string, string>();
  for (const m of members) {
    try {
      const { data } = await authAdmin.auth.admin.getUserById(m.user_id);
      if (data?.user?.email) emailsByUser.set(m.user_id, data.user.email);
    } catch {
      // ignore
    }
  }

  const enriched = members.map((m) => ({
    ...m,
    profile: profiles?.find((p) => p.user_id === m.user_id) ?? null,
    email: emailsByUser.get(m.user_id) ?? null,
  })) as (OrganizationMember & { profile: UserProfile | null; email: string | null })[];

  return {
    members: enriched,
    viewerRole,
    viewerIsSuperadmin: session.profile.is_superadmin,
  };
}
```

- [ ] **Step 2: Actualizar la página de equipo para consumir el nuevo shape**

Reemplazar la línea `const members = await listTeamMembers();` en `src/app/dashboard/configuracion/equipo/page.tsx` por:

```tsx
const { members, viewerRole, viewerIsSuperadmin } = await listTeamMembers();
```

`viewerRole` y `viewerIsSuperadmin` se van a consumir en Task 9 cuando agreguemos el botón "Ver doc". Por ahora, para que el linter no se queje de variables no usadas, descartamos las que aún no usamos así (la usamos como discard explícito):

```tsx
const { members, viewerRole, viewerIsSuperadmin } = await listTeamMembers();
void viewerRole;
void viewerIsSuperadmin;
```

(Esas dos líneas `void` se borran en Task 9.)

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/team.ts src/app/dashboard/configuracion/equipo/page.tsx
git commit -m "feat(team): listTeamMembers devuelve viewerRole para gating de UI"
```

---

## Task 7: UI — campo de archivo en `<InviteDialog>`

**Files:**
- Modify: `src/components/team/invite-dialog.tsx`

- [ ] **Step 1: Actualizar imports**

Reemplazar la línea de imports de `lucide-react` (línea 4) por:

```tsx
import { Loader2, Copy, CheckCircle2, Upload, X, FileText } from "lucide-react";
```

Agregar `useRef` al import de React (línea 3):

```tsx
import { useState, useTransition, useRef } from "react";
```

- [ ] **Step 2: Sumar estado del archivo y el input ref**

Justo después del bloque actual de `useState` para `form` (línea ~25-30), agregar:

```tsx
const [documentFile, setDocumentFile] = useState<File | null>(null);
const docInputRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 3: Actualizar `handleSubmit` para incluir el archivo**

Reemplazar el cuerpo de `handleSubmit` (que ya quedó parcialmente actualizado en Task 5/Step 3) por:

```tsx
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  startTransition(async () => {
    try {
      const fd = new FormData();
      fd.set("email", form.email);
      fd.set("full_name", form.full_name);
      fd.set("role", form.role);
      if (form.phone) fd.set("phone", form.phone);
      if (documentFile) fd.set("id_document", documentFile);
      const r = await inviteTeamMember(fd);
      if (r.documentWarning) {
        toast.warning("Documento no guardado", { description: r.documentWarning });
      }
      if (r.tempPassword) {
        setTempPassword(r.tempPassword);
        toast.success("Usuario invitado con contraseña temporal");
      } else {
        toast.success("Usuario agregado a la organización");
        setOpen(false);
      }
      router.refresh();
    } catch (e) {
      toast.error("Error", { description: (e as Error).message });
    }
  });
}
```

- [ ] **Step 4: Actualizar `reset` para limpiar el archivo**

Reemplazar la función `reset` por:

```tsx
function reset() {
  setOpen(false);
  setTempPassword(null);
  setForm({ email: "", full_name: "", role: "recepcion", phone: "" });
  setDocumentFile(null);
  if (docInputRef.current) docInputRef.current.value = "";
}
```

- [ ] **Step 5: Sumar el campo nuevo en el form**

Insertar el siguiente bloque **entre el campo "Teléfono" y el campo "Rol"** (después del `<div>` de Teléfono que termina con `</div>` y antes del `<div>` de Rol):

```tsx
<div className="space-y-1.5">
  <Label>Foto de documento (opcional)</Label>
  {documentFile ? (
    <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2">
      <FileText size={14} className="shrink-0" />
      <div className="flex-1 min-w-0 text-xs">
        <div className="truncate">{documentFile.name}</div>
        <div className="text-muted-foreground">
          {(documentFile.size / 1024).toFixed(0)} KB
        </div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => {
          setDocumentFile(null);
          if (docInputRef.current) docInputRef.current.value = "";
        }}
      >
        <X size={14} />
      </Button>
    </div>
  ) : (
    <>
      <input
        ref={docInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) {
            toast.error("Archivo > 5 MB");
            if (docInputRef.current) docInputRef.current.value = "";
            return;
          }
          setDocumentFile(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => docInputRef.current?.click()}
      >
        <Upload size={14} className="mr-1.5" /> Adjuntar archivo
      </Button>
      <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP, PDF · max 5 MB</p>
    </>
  )}
</div>
```

- [ ] **Step 6: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores.

- [ ] **Step 7: Verificación manual en browser**

1. `npm run dev` (puerto 3001).
2. Loguearse como admin.
3. Ir a `/dashboard/configuracion/equipo` → click "Invitar usuario".
4. Verificar: aparece el campo "Foto de documento (opcional)" entre Teléfono y Rol con el botón "Adjuntar archivo".
5. Click en "Adjuntar archivo" → seleccionar una imagen JPG pequeña (<1 MB). Verificar que aparece la card con nombre + tamaño + botón X.
6. Click en X → vuelve al estado inicial.
7. Cancelar el modal sin invitar.

(Aún **no** invitar usuarios de prueba — la verificación end-to-end es Task 11.)

- [ ] **Step 8: Commit**

```bash
git add src/components/team/invite-dialog.tsx
git commit -m "feat(team): campo opcional de foto de documento en invite dialog"
```

---

## Task 8: UI — tab "Documento" en `/dashboard/perfil`

**Files:**
- Create: `src/app/dashboard/perfil/document-uploader.tsx`
- Modify: `src/app/dashboard/perfil/profile-tabs.tsx`
- Modify: `src/app/dashboard/perfil/page.tsx`

- [ ] **Step 1: Crear `DocumentUploader`**

Contenido completo de `src/app/dashboard/perfil/document-uploader.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, FileText, ImageIcon, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  uploadIdDocument,
  deleteIdDocument,
  getIdDocumentSignedUrl,
} from "@/lib/actions/profile";
import { formatTimeAgo } from "@/lib/format";

interface Props {
  userId: string;
  hasDocument: boolean;
  uploadedAt: string | null;
  mimeType: "image" | "pdf" | null;
}

export function DocumentUploader({ userId, hasDocument, uploadedAt, mimeType }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Archivo > 5 MB");
      return;
    }
    setIsPending(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await uploadIdDocument(fd);
      if (!r.ok) {
        toast.error("Error al subir", { description: r.error });
        return;
      }
      toast.success("Documento subido");
      router.refresh();
    } finally {
      setIsPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleView() {
    setIsOpening(true);
    try {
      const r = await getIdDocumentSignedUrl(userId);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("No se pudo abrir", { description: (e as Error).message });
    } finally {
      setIsOpening(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Seguro que querés eliminar el documento?")) return;
    setIsPending(true);
    try {
      const r = await deleteIdDocument();
      if (!r.ok) {
        toast.error("Error al eliminar", { description: r.error });
        return;
      }
      toast.success("Documento eliminado");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {hasDocument ? (
        <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3">
          {mimeType === "pdf" ? (
            <FileText className="size-8 text-muted-foreground shrink-0" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Documento cargado</div>
            {uploadedAt && (
              <div className="text-xs text-muted-foreground">
                Subido {formatTimeAgo(uploadedAt)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center text-sm text-muted-foreground">
          Aún no subiste tu documento.
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-center">
        {hasDocument && (
          <Button type="button" variant="outline" size="sm" onClick={handleView} disabled={isOpening}>
            {isOpening ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <ExternalLink size={14} className="mr-1.5" />}
            Ver
          </Button>
        )}
        <Button
          type="button"
          variant={hasDocument ? "outline" : "default"}
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
        >
          {isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
          {hasDocument ? "Reemplazar" : "Subir documento"}
        </Button>
        {hasDocument && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="text-destructive"
          >
            <Trash2 size={14} className="mr-1.5" />
            Eliminar
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        JPG, PNG, WebP, PDF · max 5 MB
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Sumar la tab al `ProfileTabs`**

Reemplazar el contenido completo de `src/app/dashboard/perfil/profile-tabs.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileDataForm } from "./profile-data-form";
import { AvatarUploader } from "./avatar-uploader";
import { DocumentUploader } from "./document-uploader";
import { SecuritySection } from "./security-section";
import type { UserProfile } from "@/lib/types/database";

interface ProfileTabsProps {
  profile: UserProfile;
  email: string;
  userId: string;
}

export function ProfileTabs({ profile, email, userId }: ProfileTabsProps) {
  const [tab, setTab] = useState("datos");

  const hasDocument = !!profile.id_document_path;
  const docMime: "image" | "pdf" | null = hasDocument
    ? profile.id_document_path!.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : "image"
    : null;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-6">
        <TabsTrigger value="datos">Datos</TabsTrigger>
        <TabsTrigger value="foto">Foto</TabsTrigger>
        <TabsTrigger value="documento">Documento</TabsTrigger>
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

      <TabsContent value="documento">
        <DocumentUploader
          userId={userId}
          hasDocument={hasDocument}
          uploadedAt={profile.id_document_uploaded_at}
          mimeType={docMime}
        />
      </TabsContent>

      <TabsContent value="seguridad">
        <SecuritySection profile={profile} email={email} />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 3: Pasar `userId` desde la página**

Reemplazar el contenido de `src/app/dashboard/perfil/page.tsx` por:

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
      <ProfileTabs
        profile={session.profile}
        email={session.email ?? ""}
        userId={session.userId}
      />
    </div>
  );
}
```

**Nota:** `getSession()` devuelve `{ userId, email, profile, memberships }` — el campo `userId` ya existe (verificado en `src/lib/actions/auth.ts`).

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores.

- [ ] **Step 5: Verificación manual en browser**

1. `npm run dev` corriendo.
2. `/dashboard/perfil` → debe aparecer la tab "Documento" entre "Foto" y "Seguridad".
3. Click en "Documento" → muestra "Aún no subiste tu documento" + botón "Subir documento".
4. Click "Subir documento" → seleccionar una imagen JPG → toast "Documento subido", la tab refresca y muestra "Documento cargado · Subido hace unos segundos" + botones "Ver", "Reemplazar", "Eliminar".
5. Click "Ver" → abre el archivo en una pestaña nueva (URL firmada de Supabase con token).
6. Click "Reemplazar" → elegir un PDF chico → reemplaza, ahora aparece el ícono de PDF.
7. Click "Eliminar" → confirma → vuelve a "Aún no subiste tu documento".

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/perfil/document-uploader.tsx src/app/dashboard/perfil/profile-tabs.tsx src/app/dashboard/perfil/page.tsx
git commit -m "feat(perfil): tab Documento — subir/ver/reemplazar/eliminar foto DNI"
```

---

## Task 9: UI — botón "Ver doc" en lista de equipo (sólo admins)

**Files:**
- Create: `src/components/team/view-id-document-button.tsx`
- Modify: `src/app/dashboard/configuracion/equipo/page.tsx`

- [ ] **Step 1: Crear `ViewIdDocumentButton`**

(El proyecto **no** tiene `TooltipProvider` envuelto globalmente — verificado en `src/app/layout.tsx` y `src/app/dashboard/layout.tsx`. Usamos el atributo `title` nativo del `<button>` para no tener que envolver provider local.)

Contenido completo de `src/components/team/view-id-document-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getIdDocumentSignedUrl } from "@/lib/actions/profile";

interface Props {
  userId: string;
}

export function ViewIdDocumentButton({ userId }: Props) {
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const r = await getIdDocumentSignedUrl(userId);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("No se pudo abrir el documento", { description: (e as Error).message });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={isPending}
      aria-label="Ver documento"
      title="Ver documento"
    >
      {isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
    </Button>
  );
}
```

- [ ] **Step 2: Mostrar el botón en la lista de equipo**

En `src/app/dashboard/configuracion/equipo/page.tsx`:

a) Agregar el import al tope:
```tsx
import { ViewIdDocumentButton } from "@/components/team/view-id-document-button";
```

b) Quitar las líneas `void viewerRole;` y `void viewerIsSuperadmin;` que dejamos en Task 6/Step 2, y reemplazarlas por:

```tsx
const viewerIsAdmin = viewerRole === "admin" || viewerIsSuperadmin;
```

c) Insertar el botón **antes** del `<TeamMemberActions member={m} />` dentro del `.map(...)`. Justo después del `<Badge>` con el `roleMeta.label`:

```tsx
{m.profile?.id_document_path && viewerIsAdmin && (
  <ViewIdDocumentButton userId={m.user_id} />
)}
<TeamMemberActions member={m} />
```

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores.

- [ ] **Step 4: Verificación manual en browser**

1. Loguearse como admin de la org.
2. `/dashboard/configuracion/equipo` → en cualquier miembro que tenga documento subido (el que subiste en Task 8 manualmente, si era admin de la misma org), debe aparecer el ícono `FileText` antes del menú de tres puntos.
3. Click en el ícono → abre el doc en pestaña nueva.
4. Loguearse como un usuario con rol `recepcion` → el ícono **no** debe aparecer (aunque el miembro tenga documento).

- [ ] **Step 5: Commit**

```bash
git add src/components/team/view-id-document-button.tsx src/app/dashboard/configuracion/equipo/page.tsx
git commit -m "feat(team): botón Ver documento en lista (solo admins)"
```

---

## Task 10: Verificación end-to-end

- [ ] **Step 1: Typecheck final + lint**

```bash
npx tsc --noEmit && npm run lint
```
Esperado: sin errores nuevos vs. el baseline previo a la rama.

- [ ] **Step 2: Build**

```bash
npm run build
```
Esperado: build exitoso. Si falla, leer el error y corregir.

- [ ] **Step 3: Smoke test del flow completo**

Con `npm run dev` corriendo y logueado como **admin**:

1. **Invite con documento (imagen):**
   - `/dashboard/configuracion/equipo` → "Invitar usuario".
   - Llenar nombre, email único (ej. `qa-doc-jpg-<timestamp>@apartcba.test`), rol "Recepción".
   - Adjuntar una imagen JPG ≤5 MB.
   - Click "Invitar" → aparece la pantalla "Usuario creado" con la contraseña temporal. **No** aparece warning.
   - Cerrar el modal. En la lista del equipo, el nuevo usuario tiene un ícono FileText antes del menú de tres puntos.
   - Click en el ícono → se abre la imagen en una pestaña nueva.

2. **Invite con documento (PDF):**
   - Repetir con email distinto y un PDF de ~3 MB.
   - Mismo resultado, ícono FileText, "Ver" abre el PDF.

3. **Invite con archivo > 5 MB:**
   - Repetir con email distinto y un archivo >5 MB.
   - El client-side bloquea con toast "Archivo > 5 MB" y no envía. (Si se intenta saltar el límite client modificando el DOM, el server devuelve `documentWarning` y el invite ocurre igual sin documento — comportamiento aceptado.)

4. **Invite sin documento:**
   - Repetir sin adjuntar nada → flow funciona como antes; sin ícono en la lista.

5. **Empleado sube su propio documento:**
   - Loguearse como uno de los usuarios creados (con la contraseña temporal — el sistema no fuerza cambio de password en el primer login, así que se puede usar directo).
   - Ir a `/dashboard/perfil` → tab "Documento" muestra el documento que subió el admin (si correspondía) o el estado vacío.
   - Si está vacío: subir uno. Si ya tenía: "Reemplazar" con un archivo distinto. "Eliminar" lo borra.

6. **Permisos:**
   - Loguearse como un usuario rol `recepcion` (no admin). En `/dashboard/configuracion/equipo` los íconos de documento **no** aparecen para nadie.
   - En la consola del browser, ejecutar (después de pegar el `userId` de otro usuario):
     ```js
     // Debe fallar — server action sólo permite ver el propio o si sos admin
     fetch("/dashboard/configuracion/equipo", { method: "POST" }) // no aplica directo, pero sí:
     ```
     **Mejor verificación:** desde `/dashboard/perfil` el usuario `recepcion` sólo puede ver su propio documento — no hay botón ni acción que apunte a otro `userId`.

- [ ] **Step 4: Verificar que el bucket sigue privado**

`mcp__supabase-apartcba__execute_sql`:
```sql
select id, public from storage.buckets where id='id-documents';
```
Esperado: `public=false`.

- [ ] **Step 5: Final commit (si quedó algún ajuste)**

Si surgió algún fix durante el smoke test, commitear ahora:

```bash
git add -A
git commit -m "fix(team): ajustes post smoke test"
```

Si no, no hace falta commit adicional.

---

## Resumen de commits esperados

1. `feat(db): id_document fields + private bucket for team docs`
2. `feat(types): id_document_path + id_document_uploaded_at en UserProfile`
3. `feat(actions): uploadIdDocument + deleteIdDocument (bucket privado)`
4. `feat(actions): getIdDocumentSignedUrl con permisos org admin/owner`
5. `feat(actions): inviteTeamMember acepta FormData + sube id_document opcional`
6. `feat(team): listTeamMembers devuelve viewerRole para gating de UI`
7. `feat(team): campo opcional de foto de documento en invite dialog`
8. `feat(perfil): tab Documento — subir/ver/reemplazar/eliminar foto DNI`
9. `feat(team): botón Ver documento en lista (solo admins)`
10. (Opcional) `fix(team): ajustes post smoke test`
