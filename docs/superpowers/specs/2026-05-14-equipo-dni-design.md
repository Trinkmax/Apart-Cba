# DNI por miembro del equipo — Design

**Status:** Aprobado por el usuario, listo para plan de implementación.
**Date:** 2026-05-14
**Topic:** Adjuntar foto de DNI (frente y dorso, opcionales) a cada miembro del equipo de una organización, para que cada miembro la tenga a mano dentro de la plataforma y la muestre cuando se le pida identificarse.

---

## 1. Goal

Permitir que cada miembro de una organización tenga registrado en la plataforma una foto del **frente** y/o **dorso** de su DNI. La imagen sirve para que el propio miembro la abra en pantalla y la muestre a quien se la pida (p. ej. un huésped, un dueño). Los admins de la misma organización también pueden visualizarla y cargarla en nombre del miembro (por ejemplo al invitarlo).

Ambas imágenes son **opcionales**.

## 2. Scope

In scope:
- Subir, ver, reemplazar y eliminar frente y/o dorso del DNI.
- Tres puntos de entrada UI: perfil propio (desktop + mobile), modal de invitación, lista de equipo.
- Storage privado con signed URLs cortas.
- Permisos: dueño del DNI y admins activos de la org del dueño.

Out of scope (por ahora):
- OCR / extracción automática de datos del DNI.
- PDF (solo imágenes).
- Versionado / historial de cargas.
- Limpieza automática de archivos huérfanos cuando se borra el `user_id` (queda en backlog para un cron futuro).

## 3. Roles y permisos

| Acción | Dueño (`user_id` = self) | Admin activo de la misma org | Otros roles | Superadmin |
|---|---|---|---|---|
| Ver frente/dorso | ✅ | ✅ | ❌ | ❌ |
| Subir/Reemplazar | ✅ | ✅ | ❌ | ❌ |
| Eliminar | ✅ | ✅ | ❌ | ❌ |

> El superadmin queda fuera deliberadamente. La regla del usuario fue "tanto el admin como el dueño". Si más adelante se necesita acceso de soporte cross-org, se agrega como excepción explícita.

## 4. Modelo de datos

### 4.1 Storage

Bucket nuevo: **`team-dni`** (privado, no público).

- `public = false`
- `file_size_limit = 5 MB` (5_242_880 bytes)
- `allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']`
- Path pattern: `{user_id}/front.{ext}` y `{user_id}/back.{ext}` (un solo archivo por lado — el reemplazo sobrescribe).

### 4.2 Columnas en `apartcba.user_profiles`

Migración **`018_user_dni.sql`** agrega:

```sql
ALTER TABLE apartcba.user_profiles
  ADD COLUMN IF NOT EXISTS dni_front_path  text,
  ADD COLUMN IF NOT EXISTS dni_back_path   text,
  ADD COLUMN IF NOT EXISTS dni_updated_at  timestamptz;
```

Las columnas guardan el path **interno** (`<user_id>/front.jpg`), no una URL pública. Las URLs se generan firmadas y con expiración corta a demanda. Tener los paths persistidos sirve para:

- Saber con un `SELECT` si un miembro tiene DNI cargado (lista de equipo).
- Recuperar la extensión correcta sin tener que `list()` el bucket.
- Tracking de la última actualización.

### 4.3 RLS de storage

En la migración:

```sql
DROP POLICY IF EXISTS "team_dni_select_owner_or_admin" ON storage.objects;
CREATE POLICY "team_dni_select_owner_or_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'team-dni'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM apartcba.organization_members me, apartcba.organization_members other
        WHERE me.user_id = auth.uid()
          AND me.role = 'admin'
          AND me.active = true
          AND other.user_id::text = (storage.foldername(name))[1]
          AND other.organization_id = me.organization_id
          AND other.active = true
      )
    )
  );

-- INSERT/UPDATE/DELETE con la misma lógica.
```

Las server actions usan `createAdminClient()` (service_role, bypassea RLS), así que el control real vive en el código. La RLS es una segunda barrera por si alguien hiciera fetch directo desde el navegador con la anon key.

## 5. Server actions

Archivo nuevo: **`src/lib/actions/team-dni.ts`**.

### 5.1 Helper de autorización

```ts
async function assertCanManageDni(targetUserId: string): Promise<void>;
```

- Es el `targetUserId === session.userId` → ok.
- O `session` es admin activo en una org donde `targetUserId` también es miembro activo.
- Si no, `throw new Error("No tenés permiso")`.

### 5.2 Actions

```ts
type DniSide = "front" | "back";

uploadDni(input: {
  userId: string;
  side: DniSide;
  fileBytes: ArrayBuffer;   // o FormData en el form action
  contentType: string;
  ext: "jpg" | "png" | "webp";
}): Promise<{ path: string }>;

deleteDni(input: { userId: string; side: DniSide }): Promise<void>;

/** Genera URLs firmadas a 60s para los lados que tengan path. */
getDniSignedUrls(userId: string): Promise<{
  front: { url: string; updatedAt: string | null } | null;
  back:  { url: string; updatedAt: string | null } | null;
}>;
```

Cada una llama a `assertCanManageDni(userId)` antes de tocar storage. Todas hacen `revalidatePath("/dashboard/perfil")`, `revalidatePath("/m/perfil")` y `revalidatePath("/dashboard/configuracion/equipo")` cuando hay mutación.

`uploadDni` borra el archivo previo si la extensión cambia (para no dejar el viejo `front.jpg` cuando se sube un nuevo `front.png`).

## 6. UI

### 6.1 Componente reutilizable

**`src/components/team/dni-section.tsx`** — props:

```ts
interface DniSectionProps {
  /** user_id cuyo DNI estamos viendo/editando. */
  userId: string;
  /** Si false, el componente es solo lectura (no botones de cargar/eliminar). */
  canEdit: boolean;
  /** Override del título visible. Default "Documento (DNI)". */
  title?: string;
}
```

Estructura visual (vertical en mobile, 2 columnas en desktop ≥ md):

```
Documento (DNI)            (texto auxiliar "Opcional · solo vos y los admins…")
┌───────────────────────┐  ┌───────────────────────┐
│ Frente                │  │ Dorso                 │
│  [preview o dropzone] │  │  [preview o dropzone] │
│  Reemplazar  Eliminar │  │  Reemplazar  Eliminar │
└───────────────────────┘  └───────────────────────┘
```

- Cada slot: si no hay imagen → área de drop / botón "Subir". Si hay imagen → `<img>` con la signed URL + botones.
- Validación cliente: `accept="image/jpeg,image/png,image/webp"`, max 5 MB, mostrar error con toast.
- Signed URLs cacheadas en `useState` con refresh on-demand si pasa de 50 s desde el fetch (un timer simple en el efecto).
- `aria-label` por slot ("Frente del DNI", "Dorso del DNI").
- Estados: `idle | uploading | error`. Mostrar `<Loader2 className="animate-spin" />` durante upload.

### 6.2 Perfil propio (desktop)

`src/app/dashboard/perfil/profile-tabs.tsx` recibe un tab nuevo **"Documento"**. Render: `<DniSection userId={profile.user_id} canEdit />`.

### 6.3 Perfil propio (mobile)

`src/app/m/perfil/mobile-profile.tsx` agrega un `<Section>` (Collapsible) nuevo con `icon={IdCard}` o similar, titulado "Documento (DNI)", que envuelve el mismo `<DniSection>`.

### 6.4 Lista de equipo (admin)

`src/app/dashboard/configuracion/equipo/page.tsx` — la row del miembro pasa a ser clickeable. Al hacer click se abre **`<DniDialog member={…} />`** (nuevo archivo `src/components/team/dni-dialog.tsx`) — un `<Dialog>` con `<DniSection userId={member.user_id} canEdit />` (admin puede editar). El título del dialog es "DNI de {full_name}".

`listTeamMembers` ya devuelve `user_profiles`; agregamos al `select` los 3 nuevos campos y mostramos un pequeño indicador (`<IdCard size={12} />` con color tenue) en la row si `dni_front_path || dni_back_path` para saber visualmente quién tiene cargado algo. (Sin mostrar la imagen — eso requiere abrir el dialog.)

### 6.5 Dialog de invitación

`src/components/team/invite-dialog.tsx` — debajo del campo Rol, se agrega un bloque "Documento (opcional)" con dos `<DropzoneSimple />` (frente + dorso). Los archivos se guardan en estado local (no se suben todavía). Al submit:

1. Llama a `inviteTeamMember(form)` como siempre → obtiene `userId`.
2. Si hay archivo de frente: `uploadDni({ userId, side: "front", … })`.
3. Si hay archivo de dorso: `uploadDni({ userId, side: "back", … })`.
4. Si paso (2) o (3) falla, el usuario YA fue creado: se muestra un toast "Usuario creado, pero falló el upload del DNI" + link "Reintentar" que reabre el upload en la pantalla de equipo. No se bloquea ni se hace rollback.

## 7. Flow end-to-end

### 7.1 Caso A — el miembro carga su DNI desde el perfil

1. Miembro entra a `/dashboard/perfil` → tab "Documento".
2. Click en "Subir frente" → file picker → selecciona JPG 3 MB.
3. Cliente valida tamaño + tipo.
4. Form action `uploadDni({ userId: self, side: "front", … })`.
5. Server: `assertCanManageDni(self)` pasa (es él mismo).
6. Sube a `team-dni/{userId}/front.jpg` con admin client.
7. Update `user_profiles.dni_front_path = "{userId}/front.jpg"`, `dni_updated_at = now()`.
8. `revalidatePath("/dashboard/perfil")` → la pantalla refresca, `getDniSignedUrls` retorna la nueva URL → preview visible.

### 7.2 Caso B — admin sube el DNI al invitar

1. Admin abre `<InviteDialog>` → completa email, nombre, rol, teléfono.
2. Arrastra una foto al slot de frente.
3. Submit:
   - `inviteTeamMember(form)` → crea `user_id` + temp password.
   - `uploadDni({ userId, side: "front", … })`.
4. Dialog cierra mostrando la pantalla actual de "Usuario creado con temp password".

### 7.3 Caso C — admin ve el DNI de un miembro

1. Admin entra a `/dashboard/configuracion/equipo`.
2. Click en la row del miembro → `<DniDialog>` abre.
3. `getDniSignedUrls(member.user_id)` → URLs firmadas (60 s).
4. Admin ve frente/dorso. Puede "Reemplazar" o "Eliminar".

## 8. Errores y edge cases

| Caso | Comportamiento |
|---|---|
| Imagen > 5 MB | Toast "Máximo 5 MB". Validado cliente y server. |
| Tipo no permitido | Toast "Solo JPG, PNG o WebP". |
| Signed URL expirada en pantalla | Refresh on-demand al volver a renderear o tras un timer de 50 s. |
| Miembro inactivo | El path persiste. Admin sigue viéndolo. Si el `user_id` se elimina, los archivos quedan huérfanos (cleanup futuro). |
| Upload falla durante invitación | El user_id YA está creado. Mostrar toast "Usuario creado, pero falló el DNI" + link a reintentar desde Equipo. |
| Admin que pierde el rol | Pierde acceso inmediato (porque `assertCanManageDni` valida en cada request contra la membership actual). |
| Cambio de extensión al reemplazar | El upload borra el archivo previo del lado correspondiente para evitar quedar `front.jpg` + `front.png`. |
| Concurrent upload (mismo user, dos pestañas) | Last-write-wins. No bloqueamos. |

## 9. Testing manual

Antes de marcar la feature como terminada, validar:

1. Miembro `recepcion` sube frente desde `/dashboard/perfil`. Vuelve a entrar y ve la imagen.
2. Miembro `recepcion` borra el dorso (que existía).
3. Miembro `recepcion` desde `/m/perfil` sube frente. Funciona.
4. Admin invita usuario nuevo con frente + dorso. Usuario creado, archivos en bucket.
5. Admin ve DNI de un miembro desde `/dashboard/configuracion/equipo`.
6. Miembro `limpieza` intenta abrir `/dashboard/configuracion/equipo/...` (debería estar gated por permisos del sidebar; no debería poder ver DNI de otros).
7. Validación: subir un PDF → toast de error.
8. Validación: subir 10 MB JPG → toast "Máximo 5 MB".

Verificaciones automáticas: `npx tsc --noEmit` y `npm run lint` limpios.

## 10. Files touched

Nuevos:
- `supabase/migrations/018_user_dni.sql`
- `src/lib/actions/team-dni.ts`
- `src/components/team/dni-section.tsx`
- `src/components/team/dni-dialog.tsx`
- `src/components/team/dni-dropzone.tsx` (uploader chico reusable interno)

Modificados:
- `src/lib/types/database.ts` — agregar `dni_front_path`, `dni_back_path`, `dni_updated_at` a `UserProfile`.
- `src/lib/actions/team.ts` — `listTeamMembers` incluye los 3 nuevos campos. `inviteTeamMember` queda sin cambios; los archivos se suben desde el dialog **después** de la creación del usuario, llamando a `uploadDni` por cada lado presente (ver §7.2). Razón: simplifica `inviteTeamMember` (no recibe FormData) y mantiene el upload atómico por lado.
- `src/app/dashboard/perfil/profile-tabs.tsx` — nuevo tab "Documento".
- `src/app/m/perfil/mobile-profile.tsx` — nueva `<Section>` "Documento".
- `src/app/dashboard/configuracion/equipo/page.tsx` — wire del click + dialog + indicador "tiene DNI".
- `src/components/team/invite-dialog.tsx` — slots opcionales frente/dorso.

## 11. Consideraciones de privacidad

- El bucket es privado. Storage RLS bloquea acceso anónimo.
- Las URLs firmadas son temporales (60 s) — no se pueden compartir indefinidamente.
- El path no contiene información sensible (`{uuid}/front.jpg`) y no es enumerable desde el cliente.
- Los logs del servidor no loguean el contenido del archivo.
- Cuando `auth.users.id` se elimina (`ON DELETE CASCADE`), `user_profiles` se borra. Los archivos en storage NO se borran automáticamente — backlog para un cron de limpieza ("borrar archivos en `team-dni` cuyo primer folder no exista en `user_profiles`").

---

## Notas para implementación

- React Compiler ya está habilitado: evitar patrones que rompan memoización (no usar `useMemo` con deps incorrectas).
- Las server actions deben tener `"use server"`, `requireSession()`, `getCurrentOrg()`, y usar `createAdminClient()`/`createAuthAdminClient()` apropiadamente.
- El `image-uploader.tsx` existente (`@/components/ui/image-uploader.tsx`) puede reutilizarse o tomarse como referencia para `dni-dropzone.tsx`.
