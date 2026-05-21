# Carga de DNI al invitar un miembro del equipo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un admin adjunte opcionalmente las fotos del frente y/o dorso del DNI al invitar un nuevo miembro del equipo.

**Architecture:** El diálogo de invitación guarda los archivos del DNI en estado local y, una vez que `inviteTeamMember` creó el usuario, sube cada lado en paralelo reutilizando el server action `uploadDni` existente. **No hay migración de base de datos ni cambios en la lógica de los server actions** — el bucket `team-dni`, las columnas `dni_*` y las RLS ya existen. Un módulo nuevo (`dni-upload.ts`) centraliza las constantes de validación que hoy están duplicadas.

**Tech Stack:** Next.js 16 App Router · React 19 (Server Actions, `useTransition`) · TypeScript · Tailwind v4 + shadcn/ui · Supabase Storage.

**Spec de referencia:** `docs/superpowers/specs/2026-05-21-dni-invitacion-equipo-design.md`

---

## Enfoque de testing

Este repo **no tiene test runner** (ver `CLAUDE.md`). No se escriben tests unitarios. La verificación de cada tarea es:

- `npx tsc --noEmit` — sin errores de tipos.
- `npm run lint` — sin errores de ESLint.
- La **Tarea 4** es verificación manual en el navegador.

> El working tree puede tener cambios previos no relacionados con este plan. Si `tsc` o `lint` reportan errores en archivos que **no** tocaste, son preexistentes — concentrate en que los archivos de este plan queden limpios.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/dni-upload.ts` | Crear | Constantes (`ALLOWED_DNI_MIME`, `MAX_DNI_BYTES`) y `validateDniFile()` compartidas. Módulo neutral (sin `"use server"`/`"use client"`). |
| `src/components/team/dni-invite-picker.tsx` | Crear | Picker diferido controlado: dos slots (frente/dorso) que guardan un `File` en el componente padre sin subirlo. |
| `src/lib/actions/team-dni.ts` | Modificar | Usa las constantes de `dni-upload.ts`. Sin cambio de lógica. |
| `src/components/team/dni-section.tsx` | Modificar | Usa las constantes y `validateDniFile()` de `dni-upload.ts`. Sin cambio de comportamiento. |
| `src/components/team/invite-dialog.tsx` | Modificar | Estado de los archivos, ancho del diálogo, render del picker y orquestación de la subida tras crear el usuario. |

---

## Task 1: Módulo compartido de validación del DNI

Crea `dni-upload.ts` y reemplaza las constantes duplicadas de `team-dni.ts` y `dni-section.tsx` por imports de ese módulo. Es un refactor sin cambio de comportamiento (mismos valores, misma lógica de validación).

**Files:**
- Create: `src/lib/dni-upload.ts`
- Modify: `src/lib/actions/team-dni.ts` (líneas 1-11 y 85-90)
- Modify: `src/components/team/dni-section.tsx` (líneas 15-25, 134-141 y 241)

- [ ] **Step 1: Crear `src/lib/dni-upload.ts`**

```ts
/**
 * Constantes y validación compartidas para la carga de fotos del DNI del
 * equipo. Lo usan el flujo de subida inmediata (`dni-section.tsx`), el server
 * action (`team-dni.ts`) y el picker diferido del diálogo de invitación
 * (`dni-invite-picker.tsx`).
 *
 * Módulo neutral (sin "use server"/"use client"): importable desde cliente y
 * servidor.
 */

export const ALLOWED_DNI_MIME: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const MAX_DNI_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Valida un archivo de DNI por tipo MIME y tamaño.
 * Devuelve un mensaje de error (es-AR) si no es válido, o `null` si está OK.
 */
export function validateDniFile(file: File): string | null {
  if (!ALLOWED_DNI_MIME.includes(file.type)) return "Solo JPG, PNG o WebP";
  if (file.size > MAX_DNI_BYTES) return "Máximo 5 MB";
  return null;
}
```

- [ ] **Step 2: `team-dni.ts` — reemplazar imports y constantes**

En `src/lib/actions/team-dni.ts`, reemplazar el bloque de las líneas 1-11.

Buscar exactamente:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";

const BUCKET = "team-dni";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL_SECONDS = 60;
```

Reemplazar por:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { ALLOWED_DNI_MIME, MAX_DNI_BYTES } from "@/lib/dni-upload";
import { requireSession } from "./auth";

const BUCKET = "team-dni";
const SIGNED_URL_TTL_SECONDS = 60;
```

- [ ] **Step 3: `team-dni.ts` — actualizar el uso de las constantes en `uploadDni`**

En el mismo archivo, buscar exactamente (dentro de `uploadDni`):

```ts
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "Solo JPG, PNG o WebP" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Máximo 5 MB" };
  }
```

Reemplazar por:

```ts
  if (!ALLOWED_DNI_MIME.includes(file.type)) {
    return { ok: false, error: "Solo JPG, PNG o WebP" };
  }
  if (file.size > MAX_DNI_BYTES) {
    return { ok: false, error: "Máximo 5 MB" };
  }
```

- [ ] **Step 4: `dni-section.tsx` — reemplazar imports y constantes**

En `src/components/team/dni-section.tsx`, buscar exactamente:

```ts
import {
  uploadDni,
  deleteDni,
  getDniSignedUrls,
} from "@/lib/actions/team-dni";

type Side = "front" | "back";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const REFRESH_MS = 50_000; // refrescar signed URLs antes de los 60s de TTL
```

Reemplazar por:

```ts
import {
  uploadDni,
  deleteDni,
  getDniSignedUrls,
} from "@/lib/actions/team-dni";
import { ALLOWED_DNI_MIME, validateDniFile } from "@/lib/dni-upload";

type Side = "front" | "back";

const REFRESH_MS = 50_000; // refrescar signed URLs antes de los 60s de TTL
```

- [ ] **Step 5: `dni-section.tsx` — borrar el `validate` local y usar `validateDniFile`**

En el mismo archivo, dentro del componente `DniSlot`, buscar exactamente:

```ts
  function validate(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) return "Solo JPG, PNG o WebP";
    if (file.size > MAX_BYTES) return "Máximo 5 MB";
    return null;
  }

  function handleFile(file: File) {
    const err = validate(file);
```

Reemplazar por:

```ts
  function handleFile(file: File) {
    const err = validateDniFile(file);
```

- [ ] **Step 6: `dni-section.tsx` — actualizar el `accept` del input**

En el mismo archivo, buscar exactamente:

```tsx
            accept={ALLOWED_TYPES.join(",")}
```

Reemplazar por:

```tsx
            accept={ALLOWED_DNI_MIME.join(",")}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/lib/dni-upload.ts`, `src/lib/actions/team-dni.ts` ni `src/components/team/dni-section.tsx`.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: sin errores ni warnings nuevos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/dni-upload.ts src/lib/actions/team-dni.ts src/components/team/dni-section.tsx
git commit -m "refactor(team): centralizar constantes de validacion del DNI en dni-upload.ts" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Componente `DniInvitePicker`

Crea el picker diferido: dos slots (frente/dorso) que guardan el `File` en el componente padre vía `onChange` y **no** suben nada. Espeja el aspecto visual de `DniSlot` (de `dni-section.tsx`) pero opera sobre estado local.

**Files:**
- Create: `src/components/team/dni-invite-picker.tsx`

- [ ] **Step 1: Crear `src/components/team/dni-invite-picker.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { IdCard, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ALLOWED_DNI_MIME, validateDniFile } from "@/lib/dni-upload";

type Side = "front" | "back";

interface DniInvitePickerProps {
  /** Archivo del frente elegido (aún sin subir), o null. */
  frontFile: File | null;
  /** Archivo del dorso elegido (aún sin subir), o null. */
  backFile: File | null;
  /** Informa al padre el archivo elegido o quitado para un lado. */
  onChange: (side: Side, file: File | null) => void;
  /** Deshabilita la interacción (p. ej. mientras la invitación está en curso). */
  disabled?: boolean;
}

/**
 * Selector diferido del DNI para el diálogo de invitación: guarda los archivos
 * en el componente padre y NO los sube — la subida la orquesta `InviteDialog`
 * después de crear el usuario. Para la carga inmediata desde el perfil o la
 * página de equipo, ver `DniSection`.
 */
export function DniInvitePicker({
  frontFile,
  backFile,
  onChange,
  disabled = false,
}: DniInvitePickerProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IdCard size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-medium">Documento (DNI)</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Opcional · JPG, PNG o WebP · máx 5 MB.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InvitePickerSlot
          side="front"
          label="Frente"
          ariaLabel="Frente del DNI"
          file={frontFile}
          disabled={disabled}
          onChange={onChange}
        />
        <InvitePickerSlot
          side="back"
          label="Dorso"
          ariaLabel="Dorso del DNI"
          file={backFile}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface InvitePickerSlotProps {
  side: Side;
  label: string;
  ariaLabel: string;
  file: File | null;
  disabled: boolean;
  onChange: (side: Side, file: File | null) => void;
}

function InvitePickerSlot({
  side,
  label,
  ariaLabel,
  file,
  disabled,
  onChange,
}: InvitePickerSlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Object URL para previsualizar el archivo local. Se revoca al cambiar de
  // archivo o al desmontar para no filtrar memoria.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFile(picked: File) {
    const err = validateDniFile(picked);
    if (err) {
      toast.error(err);
      return;
    }
    onChange(side, picked);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const picked = e.dataTransfer.files[0];
    if (picked) handleFile(picked);
  }

  const hasImage = !!file;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground font-medium">{label}</div>

      <div
        className={cn(
          "relative aspect-[1.6/1] rounded-md overflow-hidden bg-muted border-2",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-dashed border-muted-foreground/30",
          !disabled && "cursor-pointer hover:border-primary/50 transition-colors"
        )}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
      >
        {hasImage && previewUrl ? (
          <Image
            src={previewUrl}
            alt={ariaLabel}
            fill
            unoptimized
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground p-3 text-center">
            <Upload size={16} />
            <span className="text-[11px]">Click o arrastrá una imagen</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_DNI_MIME.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) handleFile(picked);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <Upload size={12} /> {hasImage ? "Reemplazar" : "Subir"}
        </Button>
        {hasImage && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs text-destructive"
            onClick={() => onChange(side, null)}
            disabled={disabled}
          >
            <X size={12} /> Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/components/team/dni-invite-picker.tsx`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sin errores ni warnings nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/components/team/dni-invite-picker.tsx
git commit -m "feat(team): agregar DniInvitePicker para el dialogo de invitacion" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Integrar el picker en `InviteDialog`

Reescribe `invite-dialog.tsx` para: guardar los archivos del DNI en estado local, ensanchar el diálogo a `max-w-lg`, renderizar el `DniInvitePicker` debajo del campo Rol, y orquestar la subida con `uploadDni` después de crear el usuario.

**Cambios respecto del archivo original:**
- Imports nuevos: `uploadDni` y `DniInvitePicker`.
- Estado nuevo: `uploadingDni`, `dniFront`, `dniBack`.
- Helper nuevo: `setDni(side, file)`.
- `handleSubmit`: tras `inviteTeamMember`, sube en paralelo cada lado adjuntado y avisa con `toast.warning` si alguno falla.
- `reset()`: limpia los tres estados nuevos.
- `DialogContent`: `max-w-md` → `max-w-lg`.
- Render del `<DniInvitePicker>` entre el campo Rol y el `<DialogFooter>`.
- Botón submit: el texto pasa a `"Subiendo DNI…"` mientras `uploadingDni` es `true`.

**Files:**
- Modify: `src/components/team/invite-dialog.tsx` (reemplazo completo del archivo)

- [ ] **Step 1: Reemplazar el contenido completo de `src/components/team/invite-dialog.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { inviteTeamMember, type InviteInput } from "@/lib/actions/team";
import { uploadDni } from "@/lib/actions/team-dni";
import { DniInvitePicker } from "@/components/team/dni-invite-picker";
import { ROLE_META } from "@/lib/constants";

export function InviteDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [uploadingDni, setUploadingDni] = useState(false);

  const [form, setForm] = useState<InviteInput>({
    email: "",
    full_name: "",
    role: "recepcion",
    phone: "",
  });

  const [dniFront, setDniFront] = useState<File | null>(null);
  const [dniBack, setDniBack] = useState<File | null>(null);

  function set<K extends keyof InviteInput>(k: K, v: InviteInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setDni(side: "front" | "back", file: File | null) {
    if (side === "front") setDniFront(file);
    else setDniBack(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await inviteTeamMember(form);

        // El usuario ya existe: subimos cada lado del DNI adjuntado en
        // paralelo, reutilizando el server action `uploadDni`.
        const sides: { side: "front" | "back"; file: File }[] = [];
        if (dniFront) sides.push({ side: "front", file: dniFront });
        if (dniBack) sides.push({ side: "back", file: dniBack });

        if (sides.length > 0) {
          setUploadingDni(true);
          const results = await Promise.all(
            sides.map(async ({ side, file }) => {
              const fd = new FormData();
              fd.append("userId", r.userId);
              fd.append("side", side);
              fd.append("file", file);
              const res = await uploadDni(fd);
              return { side, ok: res.ok };
            })
          );
          setUploadingDni(false);

          const failed = results.filter((x) => !x.ok).map((x) => x.side);
          if (failed.length > 0) {
            const labels = failed
              .map((s) => (s === "front" ? "frente" : "dorso"))
              .join(" y ");
            toast.warning("El DNI no se pudo subir", {
              description: `No se pudo subir el ${labels} del DNI. Podés cargarlo después desde Equipo.`,
            });
          }
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
        setUploadingDni(false);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function reset() {
    setOpen(false);
    setTempPassword(null);
    setUploadingDni(false);
    setForm({ email: "", full_name: "", role: "recepcion", phone: "" });
    setDniFront(null);
    setDniBack(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tempPassword ? "Usuario creado" : "Invitar usuario"}</DialogTitle>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Listo. Pasale al usuario:</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input readOnly value={form.email} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contraseña temporal</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={tempPassword} className="font-mono text-xs" />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(tempPassword);
                          toast.success("Copiado");
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    El usuario debería cambiarla en su primer ingreso.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={reset} className="w-full">Listo</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nombre completo *</Label>
              <Input required autoFocus value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="usuario@apartcba.com.ar" />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v as InviteInput["role"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <div>
                        <div className="font-medium" style={{ color: m.color }}>{m.label}</div>
                        <div className="text-[10px] text-muted-foreground">{m.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DniInvitePicker
              frontFile={dniFront}
              backFile={dniBack}
              onChange={setDni}
              disabled={isPending}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {uploadingDni ? "Subiendo DNI…" : "Invitar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/components/team/invite-dialog.tsx`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sin errores ni warnings nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/components/team/invite-dialog.tsx
git commit -m "feat(team): permitir adjuntar el DNI al invitar un miembro" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Verificación manual

No produce commit. Requiere la app corriendo y una sesión de **admin** (o superadmin que sea admin de la org).

**Files:** ninguno (verificación).

- [ ] **Step 1: Levantar la app**

Run: `npm run dev`
Expected: Next dev en `http://localhost:3001`.

- [ ] **Step 2: Abrir el diálogo de invitación**

Ir a `http://localhost:3001/dashboard/configuracion/equipo` → botón **"Invitar usuario"**.
Expected: el diálogo muestra los campos Nombre/Email/Teléfono/Rol y, debajo del Rol, la sección **"Documento (DNI)"** con dos slots ("Frente" y "Dorso") y el texto "Opcional · JPG, PNG o WebP · máx 5 MB."

- [ ] **Step 3: Invitar sin adjuntar DNI**

Completar nombre + email + rol y enviar, sin tocar los slots.
Expected: flujo idéntico al actual — aparece la pantalla "Usuario creado" con la contraseña temporal.

- [ ] **Step 4: Invitar adjuntando solo el frente**

Invitar otro usuario; en el slot "Frente", elegir o arrastrar una imagen JPG/PNG/WebP < 5 MB. Verificar que se ve la previsualización. Enviar.
Expected: el botón muestra "Subiendo DNI…" durante la subida; luego aparece la pantalla de éxito. Abrir el `DniDialog` de ese miembro (click en la fila → DNI) → el **frente** aparece y el **dorso** está vacío.

- [ ] **Step 5: Invitar adjuntando frente y dorso**

Invitar otro usuario adjuntando ambos lados. Enviar.
Expected: en el `DniDialog` de ese miembro aparecen **ambas** imágenes.

- [ ] **Step 6: Validación de archivo inválido**

En un slot, intentar adjuntar un PDF o una imagen > 5 MB.
Expected: aparece un toast de error ("Solo JPG, PNG o WebP" o "Máximo 5 MB") y el slot queda vacío.

- [ ] **Step 7: Quitar un archivo antes de enviar**

Adjuntar una imagen en un slot y luego hacer click en "Quitar".
Expected: la previsualización desaparece, el slot vuelve al estado vacío. Nada se sube.

- [ ] **Step 8: Reset al cancelar**

Adjuntar imágenes, cerrar el diálogo (botón Cancelar o Esc) y volver a abrirlo.
Expected: el diálogo abre limpio — sin archivos, campos vacíos.

---

## Self-Review (completado al escribir el plan)

- **Cobertura del spec:** §5.1 → Task 1 (Steps 1-6). §5.2 → Task 2. §5.3 → Task 3. §5.4 (manejo de errores) → Task 3 Step 1 (`handleSubmit` con `toast.warning`) + Task 4 Steps 6-7. §7 (verificación) → Task 4. Sin migración ni cambios de server action (§5.5) → ninguna tarea los toca. Sin gaps.
- **Placeholders:** ninguno — todo el código está completo y literal.
- **Consistencia de tipos:** `validateDniFile(file: File): string | null` definida en Task 1 y usada igual en Tasks 1 y 2. `ALLOWED_DNI_MIME: readonly string[]` → `.includes()` y `.join()` válidos sin cast. `onChange: (side: "front" | "back", file: File | null) => void` — el `setDni` de Task 3 calza estructuralmente con la prop del picker de Task 2. `uploadDni(fd: FormData)` devuelve `{ ok: true; ... } | { ok: false; ... }`; en Task 3 sólo se lee `res.ok` (boolean en ambas ramas).
