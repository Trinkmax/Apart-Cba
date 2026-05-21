"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Image from "next/image";
import { IdCard, Loader2, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  uploadDni,
  deleteDni,
  getDniSignedUrls,
} from "@/lib/actions/team-dni";
import { ALLOWED_DNI_MIME, validateDniFile } from "@/lib/dni-upload";

type Side = "front" | "back";

const REFRESH_MS = 50_000; // refrescar signed URLs antes de los 60s de TTL

interface DniSectionProps {
  /** user_id cuyo DNI estamos viendo/editando. */
  userId: string;
  /** Si false, oculta botones de subir/borrar (solo lectura). */
  canEdit: boolean;
  /** Override del título. Default "Documento (DNI)". */
  title?: string;
}

interface SideState {
  url: string | null;
  loading: boolean;
}

export function DniSection({ userId, canEdit, title = "Documento (DNI)" }: DniSectionProps) {
  const [front, setFront] = useState<SideState>({ url: null, loading: true });
  const [back, setBack] = useState<SideState>({ url: null, loading: true });
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      const { front: f, back: b } = await getDniSignedUrls(userId);
      setFront({ url: f?.url ?? null, loading: false });
      setBack({ url: b?.url ?? null, loading: false });
      setFetchedAt(Date.now());
    } catch (e) {
      setFront({ url: null, loading: false });
      setBack({ url: null, loading: false });
      toast.error("No se pudo cargar el DNI", { description: (e as Error).message });
    }
  }, [userId]);

  // Carga inicial al montar / al cambiar de userId. Va inline (en vez de
  // `refetch()`) para que la regla set-state-in-effect vea que el setState es
  // post-await, y para poder cancelar si el componente se desmonta antes de
  // que la promesa resuelva.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { front: f, back: b } = await getDniSignedUrls(userId);
        if (cancelled) return;
        setFront({ url: f?.url ?? null, loading: false });
        setBack({ url: b?.url ?? null, loading: false });
        setFetchedAt(Date.now());
      } catch (e) {
        if (cancelled) return;
        setFront({ url: null, loading: false });
        setBack({ url: null, loading: false });
        toast.error("No se pudo cargar el DNI", { description: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Auto-refresh antes de los 60s de expiración de las signed URLs.
  useEffect(() => {
    if (!fetchedAt) return;
    if (!front.url && !back.url) return; // nada que refrescar
    const timer = setTimeout(() => {
      void refetch();
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [fetchedAt, front.url, back.url, refetch]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IdCard size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Opcional · solo vos y los admins de tu organización pueden verlo.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DniSlot
          userId={userId}
          side="front"
          label="Frente"
          ariaLabel="Frente del DNI"
          state={front}
          canEdit={canEdit}
          onChanged={refetch}
        />
        <DniSlot
          userId={userId}
          side="back"
          label="Dorso"
          ariaLabel="Dorso del DNI"
          state={back}
          canEdit={canEdit}
          onChanged={refetch}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">JPG, PNG o WebP · máx 5 MB.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DniSlotProps {
  userId: string;
  side: Side;
  label: string;
  ariaLabel: string;
  state: SideState;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}

function DniSlot({
  userId,
  side,
  label,
  ariaLabel,
  state,
  canEdit,
  onChanged,
}: DniSlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleFile(file: File) {
    const err = validateDniFile(file);
    if (err) {
      toast.error(err);
      return;
    }
    const fd = new FormData();
    fd.append("userId", userId);
    fd.append("side", side);
    fd.append("file", file);
    startTransition(async () => {
      const result = await uploadDni(fd);
      if (!result.ok) {
        toast.error("Error al subir", { description: result.error });
        return;
      }
      toast.success(`${label} actualizado`);
      await onChanged();
    });
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (!canEdit) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDelete() {
    if (!canEdit) return;
    if (!confirm(`¿Eliminar el ${label.toLowerCase()} del DNI?`)) return;
    startTransition(async () => {
      const result = await deleteDni({ userId, side });
      if (!result.ok) {
        toast.error("Error al eliminar", { description: result.error });
        return;
      }
      toast.success(`${label} eliminado`);
      await onChanged();
    });
  }

  const hasImage = !!state.url;
  const showSkeleton = state.loading;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground font-medium">{label}</div>

      <div
        className={cn(
          "relative aspect-[1.6/1] rounded-md overflow-hidden bg-muted border-2",
          isDragging ? "border-primary bg-primary/5" : "border-dashed border-muted-foreground/30",
          canEdit && "cursor-pointer hover:border-primary/50 transition-colors"
        )}
        onClick={() => canEdit && !isPending && inputRef.current?.click()}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : -1}
        aria-label={ariaLabel}
      >
        {showSkeleton ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : hasImage ? (
          <Image
            src={state.url!}
            alt={ariaLabel}
            fill
            unoptimized
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground p-3 text-center">
            <Upload size={16} />
            <span className="text-[11px]">
              {canEdit ? "Click o arrastrá una imagen" : "Sin imagen"}
            </span>
          </div>
        )}

        {isPending && (
          <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_DNI_MIME.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
          >
            <Upload size={12} /> {hasImage ? "Reemplazar" : "Subir"}
          </Button>
          {hasImage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              <Trash2 size={12} /> Eliminar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
