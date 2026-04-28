"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Image from "next/image";
import { Camera, ImageOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  uploadTicketPhoto,
  deleteTicketAttachment,
  listTicketAttachments,
} from "@/lib/actions/ticket-attachments";
import { formatTimeAgo } from "@/lib/format";
import type { TicketAttachment } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  ticketId: string;
  initialAttachments?: TicketAttachment[];
  /** When true, the uploader auto-opens the camera on mobile */
  preferCamera?: boolean;
  className?: string;
}

export function TicketPhotosSection({
  ticketId,
  initialAttachments,
  preferCamera = false,
  className,
}: Props) {
  const [attachments, setAttachments] = useState<TicketAttachment[]>(
    initialAttachments ?? []
  );
  const [loading, setLoading] = useState(initialAttachments === undefined);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [_isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialAttachments !== undefined) return;
    let cancelled = false;
    setLoading(true);
    listTicketAttachments(ticketId)
      .then((data) => {
        if (!cancelled) setAttachments(data);
      })
      .catch((e) => toast.error("Error", { description: (e as Error).message }))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, initialAttachments]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const att = await uploadTicketPhoto(ticketId, fd);
        setAttachments((cur) => [att, ...cur]);
      }
      toast.success(
        files.length === 1 ? "Foto subida" : `${files.length} fotos subidas`
      );
    } catch (e) {
      toast.error("Error al subir", { description: (e as Error).message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDelete(id: string) {
    setPendingDelete(id);
    startTransition(async () => {
      try {
        await deleteTicketAttachment(id);
        setAttachments((cur) => cur.filter((a) => a.id !== id));
        toast.success("Foto eliminada");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      } finally {
        setPendingDelete(null);
      }
    });
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Camera size={13} />
          Fotos del trabajo
          {attachments.length > 0 && (
            <span className="text-muted-foreground/70">· {attachments.length}</span>
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          {...(preferCamera ? { capture: "environment" } : {})}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          {uploading ? "Subiendo…" : "Agregar"}
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-md bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : attachments.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full rounded-lg border border-dashed bg-muted/20 hover:bg-muted/40 transition-colors px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground"
        >
          <ImageOff size={20} />
          <span className="text-xs">
            Tocá para agregar foto del arreglo (evidencia)
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="group relative aspect-square rounded-md overflow-hidden border bg-muted"
            >
              <button
                type="button"
                onClick={() => setPreviewUrl(a.file_url)}
                className="absolute inset-0 w-full h-full"
                aria-label={`Ver foto ${a.file_name ?? ""}`}
              >
                <Image
                  src={a.file_url}
                  alt={a.file_name ?? "Foto del trabajo"}
                  fill
                  sizes="(max-width: 640px) 33vw, 200px"
                  className="object-cover transition-transform group-hover:scale-[1.02]"
                  unoptimized
                />
              </button>
              <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-[10px] text-white">
                <span className="truncate">{formatTimeAgo(a.uploaded_at)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(a.id);
                  }}
                  disabled={pendingDelete === a.id}
                  className="size-5 grid place-items-center rounded-sm hover:bg-red-500/80 transition-colors"
                  aria-label="Eliminar foto"
                >
                  {pendingDelete === a.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 grid place-items-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
          <img
            src={previewUrl}
            alt="Foto del trabajo"
            className="max-h-full max-w-full object-contain rounded-md"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
