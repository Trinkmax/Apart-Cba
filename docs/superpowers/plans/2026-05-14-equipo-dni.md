# DNI por miembro del equipo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline execution chosen).

**Goal:** Permitir subir/ver/borrar frente y dorso del DNI de cada miembro del equipo desde su perfil, desde el dialog de invitar usuarios, y desde la lista de equipo (admins).

**Architecture:** Bucket privado `team-dni` con paths `{user_id}/{side}.{ext}`. Server actions verifican que `auth.uid()` sea el dueño o admin activo de la misma org. UI reutilizable `<DniSection>` montada en 3 lugares; URLs firmadas a 60 s.

**Tech Stack:** Supabase Storage (privado) + RLS, Next.js Server Actions, react-hook-form ya no se usa acá (es UI más simple). Reutiliza el patrón del `<ImageUploader>` existente.

**Spec:** `docs/superpowers/specs/2026-05-14-equipo-dni-design.md`

---

## File map

Nuevos:
- `supabase/migrations/018_user_dni.sql` — bucket + columnas + RLS
- `src/lib/actions/team-dni.ts` — server actions + helper de autorización
- `src/components/team/dni-section.tsx` — componente reutilizable con 2 slots
- `src/components/team/dni-dialog.tsx` — dialog del admin para ver DNI ajeno

Modificados:
- `src/lib/types/database.ts` — `UserProfile` gana 3 campos
- `src/lib/actions/team.ts` — `listTeamMembers` incluye los 3 campos nuevos
- `src/app/dashboard/perfil/profile-tabs.tsx` — tab "Documento"
- `src/app/m/perfil/mobile-profile.tsx` — sección "Documento"
- `src/app/dashboard/configuracion/equipo/page.tsx` — click + dialog + indicador
- `src/components/team/invite-dialog.tsx` — 2 slots opcionales + post-create upload

---

## Task 1: Migración SQL 018

**Files:**
- Create: `supabase/migrations/018_user_dni.sql`

- [ ] Crear archivo con bucket `team-dni` privado (5 MB, jpg/png/webp), columnas en `user_profiles`, y 4 policies de RLS (SELECT/INSERT/UPDATE/DELETE) cada una con la lógica "owner OR admin de misma org".
- [ ] Aplicar la migración vía `mcp__supabase-apartcba__apply_migration`.
- [ ] Verificar columnas y bucket vía `execute_sql`.

## Task 2: Actualizar tipo `UserProfile`

**Files:**
- Modify: `src/lib/types/database.ts` (interface UserProfile)

- [ ] Agregar `dni_front_path`, `dni_back_path`, `dni_updated_at` (todos nullable).

## Task 3: Server actions de DNI

**Files:**
- Create: `src/lib/actions/team-dni.ts`

Exports:
```ts
export async function uploadDni(formData: FormData):
  Promise<{ ok: true; side: "front"|"back"; path: string } | { ok: false; error: string }>;
export async function deleteDni(input: { userId: string; side: "front"|"back" }):
  Promise<{ ok: true } | { ok: false; error: string }>;
export async function getDniSignedUrls(userId: string):
  Promise<{ front: { url: string; updatedAt: string|null } | null;
            back:  { url: string; updatedAt: string|null } | null }>;
```

Helper interno `assertCanManageDni(targetUserId)`:
- Si `targetUserId === session.userId` → ok.
- Si no, query `organization_members` para ver si `session.userId` es admin activo de alguna org de la cual `targetUserId` también es miembro activo. Si no → throw.

`uploadDni` lee de FormData: `file`, `userId`, `side`. Valida tamaño (5 MB), tipo (jpg/png/webp). Antes de subir, borra el archivo previo del lado correspondiente si la extensión es distinta (para no acumular). Sube vía service role. Update `user_profiles.dni_{side}_path` y `dni_updated_at`. `revalidatePath` x3 (perfil, /m/perfil, equipo).

`deleteDni`: remove from storage + setea path en null.

`getDniSignedUrls`: lee `user_profiles.dni_front_path` y `dni_back_path`, llama a `storage.from("team-dni").createSignedUrl(path, 60)` por cada uno presente.

## Task 4: Componente `<DniSection>`

**Files:**
- Create: `src/components/team/dni-section.tsx`

Props: `{ userId: string; canEdit: boolean; initialFrontUrl?: string|null; initialBackUrl?: string|null; }`

Internamente, dos `<DniSlot>` (componente local en el mismo archivo). Cada slot maneja:
- Hidden `<input type="file" accept="image/jpeg,image/png,image/webp">`
- Click en el preview / botón abre el file picker
- Drag & drop sobre el preview
- Validación cliente (5 MB, tipo)
- Submit: crea FormData con `file`, `userId`, `side` y llama `uploadDni`
- On success: re-fetch via `getDniSignedUrls` para refrescar todas las URLs

Si `canEdit === false`: oculta botones de subir/borrar; deja solo el preview.

Refresh on-demand: si pasaron > 50 s desde el fetch inicial, en el siguiente render se refresca via `useEffect` con un timer. (Implementación simple: `setTimeout` 50 s después del último fetch → setear flag `expiringSoon` → re-fetch en próximo render).

UI:
```
Documento (DNI)
[ Frente preview ]   [ Dorso preview ]
[Subir] [Borrar]     [Subir] [Borrar]
JPG/PNG/WebP · max 5 MB
```

## Task 5: Dialog `<DniDialog>`

**Files:**
- Create: `src/components/team/dni-dialog.tsx`

Props: `{ children: React.ReactNode; userId: string; memberName: string; canEdit: boolean; initialFrontUrl?: string|null; initialBackUrl?: string|null; }`

Estructura:
```tsx
<Dialog>
  <DialogTrigger asChild>{children}</DialogTrigger>
  <DialogContent className="max-w-2xl">
    <DialogHeader><DialogTitle>DNI de {memberName}</DialogTitle></DialogHeader>
    <DniSection userId={userId} canEdit={canEdit} />
  </DialogContent>
</Dialog>
```

## Task 6: Wire perfil desktop

**Files:**
- Modify: `src/app/dashboard/perfil/profile-tabs.tsx`

- [ ] Agregar `<TabsTrigger value="documento">Documento</TabsTrigger>` y su `<TabsContent>` con `<DniSection userId={profile.user_id} canEdit />`.
- [ ] La page necesita pasar el `userId` y los paths iniciales — modificar `page.tsx` para fetchear los signed URLs server-side antes de pasar al cliente, o dejarlo client-side via `useEffect` (más simple — opto por client-side).

## Task 7: Wire perfil mobile

**Files:**
- Modify: `src/app/m/perfil/mobile-profile.tsx`

- [ ] Agregar `<Section id="documento" icon={IdCard} title="Documento (DNI)">` que envuelve `<DniSection userId={profile.user_id} canEdit />`.

## Task 8: Wire lista de equipo

**Files:**
- Modify: `src/app/dashboard/configuracion/equipo/page.tsx`
- Modify: `src/lib/actions/team.ts` (`listTeamMembers` select)

- [ ] `listTeamMembers` ya selecciona `user_profiles.*` cuando hace `select("*")` → los 3 campos nuevos vienen automáticamente. Verificar.
- [ ] En la row del miembro: envolver el contenido en `<DniDialog userId={m.user_id} memberName={m.profile?.full_name ?? "—"} canEdit={role === "admin"}>` (la row se vuelve clickeable).
- [ ] Pequeño indicador `<IdCard size={12} />` con color tenue si `m.profile?.dni_front_path || m.profile?.dni_back_path`.

## Task 9: Wire invite dialog

**Files:**
- Modify: `src/components/team/invite-dialog.tsx`

- [ ] Estado local nuevo: `dniFrontFile, dniBackFile` (File|null cada uno).
- [ ] Dos slots simples bajo el field Rol (sin signed URL fetch, solo `URL.createObjectURL` para preview local).
- [ ] En `handleSubmit`, después del `inviteTeamMember` exitoso, llamar `uploadDni` con cada file si existe. Si falla, toast no fatal.

## Task 10: Verificación

- [ ] `npx tsc --noEmit` (esperar 0 errores nuevos)
- [ ] `npm run lint` (esperar 0 errors)
- [ ] dev server: abrir perfil, subir/borrar; abrir equipo, click row, ver.

---

## Self-review

- **Spec coverage:**
  - §4.1 bucket privado → Task 1 ✅
  - §4.2 columnas → Task 1 ✅
  - §4.3 RLS → Task 1 ✅
  - §5 server actions → Task 3 ✅
  - §6.1 componente reutilizable → Task 4 ✅
  - §6.2/6.3 perfil desktop+mobile → Task 6, 7 ✅
  - §6.4 lista equipo → Task 8 ✅
  - §6.5 invite dialog → Task 9 ✅
  - §8 edge cases → Task 3 + Task 4 (validación cliente + servidor) ✅
  - §11 limpieza huérfanos → out of scope ✅

- **Placeholder scan:** ninguno.
- **Type consistency:** `dni_front_path`/`dni_back_path`/`dni_updated_at` consistentes en tabla + tipo + actions + UI.
