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

  // El object URL se crea en los handlers (abajo), NO dentro de un effect:
  // la regla `react-hooks/set-state-in-effect` prohíbe llamar setState dentro
  // de un useEffect. Este effect sólo *revoca* el URL —al reemplazarlo o al
  // desmontar el slot— para no filtrar memoria.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFile(picked: File) {
    const err = validateDniFile(picked);
    if (err) {
      toast.error(err);
      return;
    }
    setPreviewUrl(URL.createObjectURL(picked));
    onChange(side, picked);
  }

  function handleRemove() {
    setPreviewUrl(null);
    onChange(side, null);
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
            onClick={handleRemove}
            disabled={disabled}
          >
            <X size={12} /> Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
