# Spec — Foto de documento opcional en invitación de equipo

**Fecha:** 2026-05-07
**Branch base:** `feat/spec-2-perfil-branding`
**Estado:** Aprobado para planificación

## Contexto

Hoy el flow de invitación a un miembro del equipo (`/dashboard/configuracion/equipo` → "Invitar usuario") sólo captura nombre, email, teléfono y rol. No envía email transaccional al empleado: crea el usuario con `email_confirm: true` y devuelve una contraseña temporal que el admin pasa a mano.

El admin (Agustín) quiere poder subir, opcionalmente, una **foto del documento de identidad** del nuevo empleado al momento de invitarlo. Si en ese momento no la tiene, el propio empleado debe poder cargarla más tarde desde su perfil.

La foto del DNI es un dato sensible — debe quedar accesible sólo para administradores de la organización y para el propio dueño del documento.

## Decisiones de diseño (acordadas en brainstorming)

1. **Punto de subida:** desde el form de invitar (admin) **y** desde una nueva tab "Documento" en `/dashboard/perfil` (empleado). Sin email/link público.
2. **Acceso al archivo:** privado. Bucket privado en Supabase Storage; URLs firmadas con expiración de 1 hora generadas server-side.
3. **Formatos aceptados:** JPG, PNG, WebP, PDF. Tamaño máximo: 5 MB.
4. **Flow del form de invitación:** un único submit. El admin selecciona el archivo, queda en memoria del browser, y al hacer click en "Invitar" se envía como `FormData` junto al resto de los campos. La subida ocurre en el mismo server action que crea el usuario.

## Modelo de datos

### Migración SQL

Archivo nuevo: `supabase/migrations/015_user_id_document.sql` (la última migración existente al momento del spec es `014_storage_buckets_rls.sql`).

```sql
-- 1. Columnas en user_profiles
alter table apartcba.user_profiles
  add column if not exists id_document_path text,
  add column if not exists id_document_uploaded_at timestamptz;

-- 2. Bucket privado para documentos de identidad
insert into storage.buckets (id, name, public)
values ('id-documents', 'id-documents', false)
on conflict (id) do nothing;
```

**Notas:**
- `id_document_path` guarda el path interno del bucket (ej. `<user_id>/1730000000000.pdf`), **no** una URL — porque el bucket es privado y la URL firmada se genera al vuelo.
- `id_document_uploaded_at` es para auditoría y para mostrar "Subido hace X días" en la UI.
- No se definen RLS policies en `storage.objects` para este bucket: todo acceso ocurre vía server actions usando `createAdminClient()`, que ya bypasea RLS. Es coherente con el resto de la app.

### TypeScript

Actualizar la interfaz `UserProfile` en `src/lib/types/database.ts` (líneas 165-175) agregando los dos nuevos campos.

## Server actions

### Modificar `src/lib/actions/team.ts`

**Cambios en `inviteTeamMember`:**

- Cambiar la firma de `inviteTeamMember(input: InviteInput)` a `inviteTeamMember(formData: FormData)`.
- Extraer los campos del `FormData` y validarlos con un schema actualizado:
  ```ts
  const ALLOWED_DOC_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ];
  const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB
  ```
- Después de crear el usuario y hacer el upsert de `user_profiles` y `organization_members`, si vino archivo en `formData.get("id_document")`:
  1. Validar tipo y tamaño. Si falla, devolver el invite exitoso pero con un campo `documentWarning: string` describiendo el motivo.
  2. Subir a `id-documents/<userId>/<timestamp>.<ext>` con `upsert: false`.
  3. Si la subida falla, dejar log y devolver `documentWarning`. **No revertir** la creación del usuario — el admin puede pedirle al empleado que la suba después.
  4. Si la subida es exitosa, hacer un segundo `update` de `user_profiles` seteando `id_document_path` y `id_document_uploaded_at = now()`.
- El return type pasa de `{ userId; tempPassword }` a `{ userId; tempPassword; documentWarning?: string }`.
- `revalidatePath("/dashboard/configuracion/equipo")` se mantiene.

**Permisos:** la verificación existente `role === "admin" || profile.is_superadmin` se mantiene sin cambios.

### Agregar a `src/lib/actions/profile.ts`

Tres acciones nuevas, siguiendo el patrón existente de `uploadAvatar`/`deleteAvatar`:

#### `uploadIdDocument(formData: FormData)`

- `requireSession()` — sólo el propio usuario sube su documento; sin override admin (para evitar tocar documentos ajenos por accidente).
- Validar el archivo: tipo en `ALLOWED_DOC_TYPES`, tamaño ≤ 5 MB.
- Si ya existe `id_document_path`, borrarlo del storage primero (mismo patrón que `uploadAvatar` con avatares previos).
- Subir a `id-documents/<session.userId>/<timestamp>.<ext>`.
- `update user_profiles set id_document_path, id_document_uploaded_at` para `user_id = session.userId`.
- `revalidatePath("/dashboard/perfil")`, `revalidatePath("/dashboard/configuracion/equipo")` (para que el ícono aparezca en la lista del admin).
- Return: `{ ok: true } | { ok: false; error: string }`. No expone path ni URL — la UI siempre pide la URL firmada por separado.

#### `deleteIdDocument()`

- `requireSession()` — sólo el propio usuario.
- Si `id_document_path` existe, removerlo del bucket (`.storage.from("id-documents").remove([path])`, ignorando errores de "no existe").
- `update user_profiles set id_document_path = null, id_document_uploaded_at = null`.
- `revalidatePath("/dashboard/perfil")`, `revalidatePath("/dashboard/configuracion/equipo")`.

#### `getIdDocumentSignedUrl(userId: string)`

- `requireSession()`.
- Permisos:
  - Si `userId === session.userId` → permitido.
  - Si no, verificar que el caller tenga `role === "admin"` (o `is_superadmin === true`) **y** que `userId` sea miembro de la misma org actual (`getCurrentOrg()` + query a `organization_members`).
  - Caso contrario, throw `"No autorizado"`.
- Leer `id_document_path` del perfil del `userId` solicitado. Si es null, throw `"Sin documento"`.
- Generar URL firmada con 1 hora de expiración:
  ```ts
  const { data, error } = await admin.storage
    .from("id-documents")
    .createSignedUrl(path, 60 * 60);
  ```
- Return: `{ url: string; mimeType: "image" | "pdf" }` (el `mimeType` se infiere del path para que la UI sepa si renderizar `<Image>` o un visor de PDF / link).

## UI

### `src/components/team/invite-dialog.tsx`

Cambios:

1. **Estado adicional:**
   ```ts
   const [documentFile, setDocumentFile] = useState<File | null>(null);
   ```

2. **Nuevo campo en el form**, ubicado entre Teléfono y Rol:

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
         <Button type="button" size="icon" variant="ghost" onClick={() => setDocumentFile(null)}>
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
             // Validación cliente (defensa en profundidad)
             if (f.size > 5 * 1024 * 1024) { toast.error("Archivo > 5 MB"); return; }
             setDocumentFile(f);
           }}
         />
         <Button type="button" variant="outline" size="sm" onClick={() => docInputRef.current?.click()}>
           <Upload size={14} className="mr-1.5" /> Adjuntar archivo
         </Button>
         <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP, PDF · max 5 MB</p>
       </>
     )}
   </div>
   ```

3. **Submit:** construir un `FormData` en lugar del objeto `InviteInput`:
   ```ts
   const fd = new FormData();
   fd.set("email", form.email);
   fd.set("full_name", form.full_name);
   fd.set("role", form.role);
   if (form.phone) fd.set("phone", form.phone);
   if (documentFile) fd.set("id_document", documentFile);
   const r = await inviteTeamMember(fd);
   ```

4. **Manejo del response:** si vino `r.documentWarning`, mostrar `toast.warning("Usuario creado, pero el documento no se pudo subir", { description: r.documentWarning })`. El step "Usuario creado" sigue mostrando la contraseña temporal igual que hoy.

5. **Reset:** `setDocumentFile(null)` en la función `reset()`.

### `src/app/dashboard/perfil/` — nueva tab "Documento"

La página ya tiene tabs "Datos / Foto / Seguridad" implementadas en:
- `src/app/dashboard/perfil/page.tsx` (server component que lee el perfil del usuario)
- `src/app/dashboard/perfil/profile-tabs.tsx` (client component con el shell de tabs)
- `src/app/dashboard/perfil/avatar-uploader.tsx` (referencia de patrón para el nuevo uploader)
- `src/app/dashboard/perfil/security-section.tsx`
- `src/app/dashboard/perfil/profile-data-form.tsx`

Cambios:
- Insertar nueva tab **"Documento"** entre "Foto" y "Seguridad" en `profile-tabs.tsx`.
- Componente nuevo: `src/app/dashboard/perfil/document-uploader.tsx` (client component).
- `page.tsx` lee `id_document_path` (sólo para el flag) e `id_document_uploaded_at`, los pasa al nuevo componente como `initial`.

**Comportamiento:**

- Recibe como prop `initial: { hasDocument: boolean; uploadedAt: string | null; mimeType: "image" | "pdf" | null }`.
- Si `hasDocument === false`:
  - Dropzone (similar al `<ImageUploader>` pero acepta PDF). Botón "Adjuntar archivo".
  - Al elegir, sube via `uploadIdDocument(formData)` directamente.
- Si `hasDocument === true`:
  - Tarjeta con: ícono (FileText para PDF, ImageIcon para imagen), texto "Documento cargado", "Subido hace X" (`formatTimeAgo`).
  - Botón **"Ver"** → llama a `getIdDocumentSignedUrl(session.userId)` y abre `result.url` en nueva pestaña.
  - Botón **"Reemplazar"** → mismo flow de subida (la action borra el anterior).
  - Botón **"Eliminar"** (destructive) → confirma y llama a `deleteIdDocument()`.

`src/app/dashboard/perfil/page.tsx` lee de `user_profiles` los campos `id_document_path` (sólo para derivar el flag `hasDocument` y el `mimeType` — no lo expone al cliente) y `id_document_uploaded_at`, y se los pasa al `DocumentUploader` como `initial`.

### `src/app/dashboard/configuracion/equipo/page.tsx`

En cada fila del listado de miembros, justo antes del `<TeamMemberActions>`, agregar un ícono indicador **sólo si**:
- `m.id_document_path` está cargado, **y**
- el viewer actual es admin (o superadmin).

```tsx
{m.id_document_path && viewerIsAdmin && (
  <ViewIdDocumentButton userId={m.user_id} />
)}
```

`ViewIdDocumentButton` es un client component minimalista: un `<Button variant="ghost" size="icon">` con `<FileText size={14} />` y tooltip "Ver documento". Al click llama a `getIdDocumentSignedUrl(userId)` y abre la URL en nueva pestaña.

`listTeamMembers` ya devuelve el perfil completo, así que sólo hay que asegurarse de incluir `id_document_path` en el `select` (ya lo hace con `*`).

Para saber si el viewer es admin, agregar al return de `listTeamMembers` un flag `viewerRole: UserRole` o pasar el role como prop separada — la página ya lo puede obtener de `getCurrentOrg()`.

## Manejo de errores y edge cases

- **Archivo > 5 MB en client:** validación previa con `toast.error`, no llega al server.
- **Tipo no soportado en client:** el `accept` del input ya filtra, pero el server revalida.
- **Subida del documento falla durante invite:** el invite no se revierte. El admin recibe toast de warning y la contraseña temporal igual. El empleado sube su documento desde su perfil después.
- **Usuario invitado existe previamente:** el flow actual ya maneja esto (`existing` en `inviteTeamMember`). Si vino documento, se sube igual y se actualiza el perfil del user existente. (Decisión: pisar el documento previo si lo había.)
- **URL firmada expira mientras la pestaña está abierta:** asumimos que 1 hora es suficiente para visualizar. Si el usuario refresca y ya expiró, el link da 403 — aceptable.
- **Admin que ya no es admin intenta ver el doc:** `getIdDocumentSignedUrl` rechequea permisos en cada llamada. OK.

## Lo que **no** está en scope

- Email transaccional al empleado con link público (Resend/Postmark, tabla de tokens, página `/invite/[token]`). Se considerará en un spec aparte si se necesita.
- Campo separado para tipo de documento (DNI/Pasaporte/CUIT/etc).
- Generación de thumbnails server-side.
- OCR / extracción automática de datos del documento.
- Versionado o historial de documentos previos (al reemplazar, se borra el anterior).
- Notificaciones al admin cuando un empleado sube/cambia su documento.

## Verificación al final de la implementación

- `npx tsc --noEmit` pasa.
- `npm run lint` pasa.
- Probar manualmente en browser:
  1. Invitar usuario sin documento → flow funciona como antes.
  2. Invitar usuario con JPG → contraseña temporal aparece + ícono FileText aparece en la lista del equipo.
  3. Invitar usuario con PDF de 4 MB → ídem.
  4. Invitar usuario con archivo de 6 MB → toast de error, no se sube.
  5. Invitar usuario con archivo `.txt` → input no permite seleccionar (accept filter).
  6. Login como ese usuario nuevo → ir a `/dashboard/perfil` → tab "Documento" muestra "Documento cargado" y "Ver" abre el archivo.
  7. Como ese usuario, "Reemplazar" → archivo nuevo reemplaza al anterior; el path antiguo desaparece del bucket.
  8. Como ese usuario, "Eliminar" → tab vuelve a estado vacío; ícono desaparece de la lista del admin.
  9. Como recepción/limpieza, intentar `getIdDocumentSignedUrl(otroUserId)` directamente → tira "No autorizado".
