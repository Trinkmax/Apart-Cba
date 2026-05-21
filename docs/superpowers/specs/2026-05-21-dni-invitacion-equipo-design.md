# Carga de DNI al invitar un miembro del equipo — Design

**Status:** Aprobado por el usuario (brainstorming 2026-05-21), listo para plan de implementación.
**Date:** 2026-05-21
**Topic:** Permitir adjuntar, de forma opcional, la foto del DNI (frente y/o dorso) en el mismo paso de invitar a un miembro del equipo.

## Relación con specs previos

Esto **completa la §6.5 ("Dialog de invitación")** del spec `2026-05-14-equipo-dni-design.md`, que fue aprobada pero **nunca se implementó**. El historial git lo confirma: `invite-dialog.tsx` nunca tuvo código de DNI, y el `dni-dropzone.tsx` / `DropzoneSimple` que ese spec planeaba nunca se creó. El resto de ese spec (bucket, columnas, RLS, `team-dni.ts`, `DniSection`, `DniDialog`, tabs de perfil) **sí** está implementado y en producción.

El spec `2026-05-07-foto-documento-invite-design.md` quedó **superado** por el del 14-may (cambió de bucket `id-documents` a `team-dni`, de un archivo único a frente/dorso, y agregó PDF que después se descartó). Se ignora.

## 1. Contexto

El feature de DNI por miembro ya existe y funciona:

- **Storage:** bucket privado `team-dni`, paths `{user_id}/{front|back}.{ext}`.
- **Datos:** columnas `dni_front_path`, `dni_back_path`, `dni_updated_at` en `apartcba.user_profiles`.
- **Server actions** (`src/lib/actions/team-dni.ts`): `uploadDni(FormData)`, `deleteDni()`, `getDniSignedUrls()`. Todas pasan por `assertCanManageDni()`, que autoriza al dueño del DNI o a un admin activo de una org compartida.
- **UI:** `DniSection` (componente reutilizable con dos `DniSlot` que suben al instante), usado en perfil propio desktop (`/dashboard/perfil`), mobile (`/m/perfil`), y en la página de Equipo vía `DniDialog` por miembro.

Lo que falta: hoy `InviteDialog` sólo captura nombre, email, teléfono y rol. Para cargar el DNI de un recién invitado, el admin tiene que invitarlo y después volver a abrir el `DniDialog` de ese miembro.

## 2. Objetivo

Que al invitar un miembro el admin pueda, **opcionalmente**, adjuntar el frente y/o el dorso del DNI en el mismo formulario. Cada lado es independiente y opcional.

## 3. Alcance

**Incluye:**
- Dos slots de carga (frente / dorso) en `InviteDialog`, siempre visibles debajo del campo Rol.
- Subida al bucket `team-dni` existente, reutilizando el action `uploadDni`, **después** de crear el usuario.
- Un módulo compartido para deduplicar las constantes de validación de archivos del DNI.

**No incluye (sin cambios):**
- **Base de datos:** el bucket, las columnas y las RLS ya existen. **No hay migración.**
- **Server actions de DNI:** `uploadDni` / `deleteDni` / `getDniSignedUrls` quedan **igual**.
- El flujo de DNI del perfil y del `DniDialog` de Equipo.
- La invitación de superadmin (`src/components/superadmin/create-org-dialog.tsx`).

## 4. Enfoque

**Orquestación desde el cliente, reutilizando `uploadDni`** (Opción A del brainstorming; coincide con lo que la §6.5 / §7.2 del spec del 14-may ya había definido).

El `InviteDialog` guarda los `File` elegidos en estado local sin subirlos. Al enviar el formulario:

1. `inviteTeamMember(form)` crea el usuario (o lo encuentra si ya existía) y devuelve `{ userId, tempPassword }`.
2. Con el `userId`, por cada lado adjuntado se arma un `FormData` (`userId`, `side`, `file`) y se llama `uploadDni()` — los dos lados en paralelo (`Promise.all`).
3. Se muestra la pantalla de éxito: contraseña temporal para usuario nuevo, o cierre + toast para usuario ya existente.

**Por qué este enfoque:**

- **Cero cambios en server actions.** `uploadDni` ya valida tipo/tamaño, borra el archivo previo si cambia la extensión, revalida rutas y chequea permisos (`assertCanManageDni`). Apenas el invitado existe como miembro activo de la org, el admin que invita pasa ese chequeo.
- Mínima superficie de cambio: el flujo de DNI del perfil queda intacto, sin riesgo de regresión.
- Se descartó un server action combinado (cambiaría la firma de `inviteTeamMember` a `FormData`, más superficie por un beneficio chico: la subida del DNI no conviene "revertirla" si falla, es opcional).
- Se descartó generalizar `DniSlot` a un modo "diferido": volvería dual-mode un componente usado en pantallas sensibles del perfil.

## 5. Diseño detallado

### 5.1 Módulo compartido — `src/lib/dni-upload.ts` (NUEVO)

Módulo plano (sin `"use server"` ni `"use client"`). Centraliza las constantes de validación que hoy están **triplicadas** en `dni-section.tsx`, `team-dni.ts` y que el componente nuevo también necesita:

```ts
export const ALLOWED_DNI_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_DNI_BYTES = 5 * 1024 * 1024; // 5 MB

/** Devuelve un mensaje de error (es-AR) si el archivo no es válido, o null si está OK. */
export function validateDniFile(file: File): string | null {
  if (!(ALLOWED_DNI_MIME as readonly string[]).includes(file.type)) return "Solo JPG, PNG o WebP";
  if (file.size > MAX_DNI_BYTES) return "Máximo 5 MB";
  return null;
}
```

Es un módulo neutral, importable tanto desde componentes cliente como desde el server action.

### 5.2 Componente nuevo — `src/components/team/dni-invite-picker.tsx` (NUEVO)

Client component **controlado**: el estado de los archivos vive en el `InviteDialog`.

**Props:**

```ts
interface DniInvitePickerProps {
  frontFile: File | null;
  backFile: File | null;
  onChange: (side: "front" | "back", file: File | null) => void;
  disabled?: boolean;
}
```

**Estructura visual** — espeja a `DniSection` para mantener consistencia:

- Encabezado: ícono `IdCard` + título "Documento (DNI)" + línea auxiliar "Opcional · JPG, PNG o WebP · máx 5 MB".
- Grid `grid-cols-1 sm:grid-cols-2 gap-3` con dos slots internos (sub-componente `InvitePickerSlot`): "Frente" y "Dorso".

**Cada slot:**

- **Sin archivo:** dropzone punteada (`aspect-[1.6/1]`, mismo look que `DniSlot`) con ícono `Upload` y texto "Click o arrastrá una imagen".
- **Con archivo:** previsualización con `next/image` (`fill`, `unoptimized` — igual que `DniSlot`) usando un object URL; debajo, botones "Reemplazar" y "Quitar".
- Acepta click (input `type="file"` oculto, `accept` armado desde `ALLOWED_DNI_MIME`) y drag & drop.
- Valida con `validateDniFile`; si falla, `toast.error(mensaje)` y no cambia el estado.
- "Quitar" sólo limpia el estado local (`onChange(side, null)`) — **no** hay llamada al server.
- **Object URL:** se crea con `URL.createObjectURL(file)` dentro de un `useEffect` por slot y se **revoca en el cleanup** (al cambiar el archivo o al desmontar) para no filtrar memoria.
- Respeta `disabled`: deshabilita click, drop y botones mientras el invite está en curso.

No tiene estados de fetch ni skeleton (el archivo es local) y no llama a `uploadDni` (eso lo orquesta el dialog).

### 5.3 Modificación — `src/components/team/invite-dialog.tsx`

- **Estado nuevo:** `dniFront: File | null`, `dniBack: File | null`, `uploadingDni: boolean` (para el texto del botón). Se mantienen separados de `form: InviteInput` porque los archivos no son parte del schema de `inviteTeamMember`.
- **Ancho del dialog:** `DialogContent` pasa de `max-w-md` a `max-w-lg` para que los dos slots entren cómodos lado a lado. En pantalla chica se apilan (`grid-cols-1 sm:grid-cols-2` dentro del picker).
- **Render:** `<DniInvitePicker frontFile={dniFront} backFile={dniBack} onChange={...} disabled={isPending} />` entre el campo Rol y el `DialogFooter` (sólo en la rama del formulario, no en la pantalla de "Usuario creado").
- **`handleSubmit`** — dentro del `startTransition` existente:
  1. `const r = await inviteTeamMember(form);`
  2. Armar las subidas de los lados adjuntados y correrlas en paralelo. Por cada lado con `File`: `FormData` con `userId` (= `r.userId`), `side`, `file`; luego `uploadDni(fd)`. Se trackea el `side` localmente para saber cuál falló (el resultado de `uploadDni` sólo trae `side` en el caso `ok: true`).
  3. Si hubo archivos: `setUploadingDni(true)`, `await Promise.all(...)`, y juntar los lados que devolvieron `ok: false`.
  4. Si algún lado falló → `toast.warning` (ver §5.4).
  5. Seguir con la lógica actual: si `r.tempPassword` → `setTempPassword(r.tempPassword)` + toast de éxito; si no → `setOpen(false)` + `toast.success("Usuario agregado a la organización")`. `router.refresh()` como hoy.
- **`reset()`:** además de lo actual, `setDniFront(null)`, `setDniBack(null)`, `setUploadingDni(false)`.
- **Botón submit:** mientras `isPending`, spinner (como hoy). El texto pasa a "Subiendo DNI…" cuando `uploadingDni` es `true`; si no, "Invitar".

### 5.4 Manejo de errores

| Caso | Comportamiento |
|---|---|
| Falla `inviteTeamMember` | `toast.error` (como hoy). El formulario queda intacto y los archivos elegidos se conservan. |
| Invite OK pero falla un lado del DNI (red, o permisos) | El usuario **ya** fue creado. Se muestra igual la pantalla de éxito / contraseña temporal — **no se pierde la contraseña**. `toast.warning` indicando el lado: "No se pudo subir el {frente/dorso} del DNI. Podés cargarlo después desde Equipo." |
| Archivo inválido (tipo o tamaño) al elegirlo | `validateDniFile` → `toast.error`, no se agrega al estado. Nunca llega al server. |
| Email ya pertenece a un usuario existente de la plataforma | `inviteTeamMember` ya lo maneja (sólo agrega membership). `uploadDni` reemplaza **sólo** el lado adjuntado; los lados en blanco no tocan el DNI previo. Es coherente con lo que ya permite el `DniDialog` de Equipo (un admin puede gestionar el DNI de un miembro). |
| El que invita es superadmin sin ser admin de la org | El invite funciona (lo permite `inviteTeamMember`), pero `assertCanManageDni` podría rechazar la subida. Cae en la fila "falla un lado": invite OK + `toast.warning`. Degradación aceptable; en la práctica quien usa este dialog es un admin de la org. |

### 5.5 Sin cambios

- `src/lib/actions/team.ts` — `inviteTeamMember` y `listTeamMembers` quedan igual.
- `src/lib/actions/team-dni.ts` — la lógica de los tres actions queda igual (sólo se tocan sus constantes, ver §6).
- Base de datos — no hay migración.

## 6. Archivos afectados

**Nuevos:**

- `src/lib/dni-upload.ts` — constantes `ALLOWED_DNI_MIME` / `MAX_DNI_BYTES` + `validateDniFile()`.
- `src/components/team/dni-invite-picker.tsx` — picker diferido controlado (frente / dorso).

**Modificados:**

- `src/components/team/invite-dialog.tsx` — **núcleo del feature**: estado de archivos, `max-w-lg`, render del `DniInvitePicker`, orquestación de subida en `handleSubmit`, `reset()`.
- `src/components/team/dni-section.tsx` — importa `ALLOWED_DNI_MIME` / `MAX_DNI_BYTES` / `validateDniFile` de `dni-upload.ts` y borra sus copias locales (`ALLOWED_TYPES`, `MAX_BYTES`, su `validate` interno). `REFRESH_MS` queda local. Mismos valores, sin cambio de comportamiento.
- `src/lib/actions/team-dni.ts` — reemplaza sus `ALLOWED_TYPES` / `MAX_BYTES` locales por las constantes de `dni-upload.ts`. Sin cambio de lógica; completa el dedup (single source of truth).

## 7. Verificación

No hay test runner configurado. Verificación:

- `npx tsc --noEmit` limpio.
- `npm run lint` limpio.
- Manual en browser, en `/dashboard/configuracion/equipo` → "Invitar usuario":
  1. Invitar **sin** adjuntar DNI → flujo idéntico al actual (aparece la contraseña temporal).
  2. Invitar adjuntando **sólo el frente** → usuario creado; abrir el `DniDialog` de ese miembro → el frente aparece, el dorso vacío.
  3. Invitar adjuntando **frente + dorso** → ambos aparecen en el `DniDialog`.
  4. Adjuntar un archivo > 5 MB o un PDF → `toast.error`, no se agrega.
  5. "Quitar" un archivo elegido antes de enviar → desaparece la previsualización, no se sube nada.
  6. Cancelar el dialog con archivos elegidos y reabrirlo → empieza limpio (sin archivos).

## 8. Decisiones tomadas (brainstorming 2026-05-21)

- **Layout:** slots siempre visibles (no desplegable ni botones compactos). El objetivo del feature es que el admin vea de entrada que puede adjuntar el DNI.
- **Enfoque:** orquestación desde el cliente reutilizando `uploadDni` (Opción A) — cero cambios de backend.
- **Falla parcial:** no se bloquea ni se revierte el invite; se avisa con `toast.warning` y el DNI se puede cargar después desde Equipo.
- **Componente separado** (`DniInvitePicker`) en lugar de generalizar `DniSlot` — aísla el riesgo del flujo de perfil.
- **Dedup:** módulo `dni-upload.ts` como única fuente de las constantes de validación del DNI.
