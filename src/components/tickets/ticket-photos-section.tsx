"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Camera,
  Download,
  FileWarning,
  ImageIcon,
  ImageOff,
  Loader2,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  uploadTicketPhoto,
  deleteTicketAttachment,
  listTicketAttachments,
} from "@/lib/actions/ticket-attachments";
import { prepareImageForUpload } from "@/lib/image-compress";
import { formatTimeAgo } from "@/lib/format";
import type { TicketAttachment } from "@/lib/types/database";
import { cn } from "@/lib/utils";

interface Props {
  ticketId: string;
  initialAttachments?: TicketAttachment[];
  /** En mobile pone "Cámara" como acción primaria (igual deja elegir galería). */
  preferCamera?: boolean;
  /** Modo lectura: muestra las fotos pero oculta subir/eliminar (historial). */
  readOnly?: boolean;
  className?: string;
}

/** HEIC/HEIF no lo renderiza ningún browser salvo Safari. Las fotos viejas
 *  quedaron en HEIC; las nuevas ya entran como JPEG (ver image-compress). */
function isUnviewable(a: TicketAttachment): boolean {
  const m = (a.mime_type ?? "").toLowerCase();
  const n = (a.file_name ?? "").toLowerCase();
  return (
    m.includes("heic") ||
    m.includes("heif") ||
    n.endsWith(".heic") ||
    n.endsWith(".heif")
  );
}

/** Endpoint de transformación de Supabase: imgproxy puede transcodear HEIC→JPEG
 *  on the fly. Si el add-on no está habilitado devuelve error → cae al onError. */
function transformUrl(fileUrl: string): string {
  const out = fileUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );
  return out === fileUrl ? fileUrl : `${out}?width=1400&quality=80`;
}

export function TicketPhotosSection({
  ticketId,
  initialAttachments,
  preferCamera = false,
  readOnly = false,
  className,
}: Props) {
  const [attachments, setAttachments] = useState<TicketAttachment[]>(
    initialAttachments ?? []
  );
  const [loading, setLoading] = useState(initialAttachments === undefined);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const uploading = uploadProgress !== null;
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialAttachments !== undefined) return;
    let cancelled = false;
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

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      setUploadProgress({ done: 0, total: list.length });
      let succeeded = 0;
      const errors: string[] = [];
      // Secuencial: el celular comprime en canvas, en paralelo lo cuelga.
      for (const original of list) {
        try {
          const file = await prepareImageForUpload(original);
          const fd = new FormData();
          fd.append("file", file);
          const att = await uploadTicketPhoto(ticketId, fd);
          setAttachments((cur) => [att, ...cur]);
          succeeded += 1;
        } catch (e) {
          errors.push((e as Error).message);
        } finally {
          setUploadProgress((p) => (p ? { done: p.done + 1, total: p.total } : null));
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1 ? "Foto subida" : `${succeeded} fotos subidas`
        );
      }
      if (errors.length > 0) {
        toast.error(
          errors.length === 1
            ? "No se pudo subir 1 foto"
            : `No se pudieron subir ${errors.length} fotos`,
          { description: errors[0] }
        );
      }
      setUploadProgress(null);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    },
    [ticketId]
  );

  const handleDelete = useCallback(
    (id: string) => {
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
    },
    []
  );

  const count = attachments.length;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <Camera size={13} />
          Fotos del trabajo
          {count > 0 ? (
            <span className="text-muted-foreground/70">· {count}</span>
          ) : null}
        </span>
        {readOnly ? null : (
          <UploadButtons
            galleryRef={galleryRef}
            cameraRef={cameraRef}
            preferCamera={preferCamera}
            uploading={uploading}
            progress={uploadProgress}
            onFiles={handleFiles}
          />
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : count === 0 ? (
        <EmptyState
          readOnly={readOnly}
          onClick={() =>
            (preferCamera ? cameraRef : galleryRef).current?.click()
          }
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {attachments.map((a, i) => (
            <AttachmentTile
              key={a.id}
              attachment={a}
              onOpen={() => setPreviewIdx(i)}
              onDelete={readOnly ? undefined : () => handleDelete(a.id)}
              deleting={pendingDelete === a.id}
            />
          ))}
        </div>
      )}

      {previewIdx !== null && attachments[previewIdx] ? (
        <Lightbox
          attachments={attachments}
          index={previewIdx}
          onIndex={setPreviewIdx}
          onClose={() => setPreviewIdx(null)}
        />
      ) : null}
    </div>
  );
}

function UploadButtons({
  galleryRef,
  cameraRef,
  preferCamera,
  uploading,
  progress,
  onFiles,
}: {
  galleryRef: React.RefObject<HTMLInputElement | null>;
  cameraRef: React.RefObject<HTMLInputElement | null>;
  preferCamera: boolean;
  uploading: boolean;
  progress: { done: number; total: number } | null;
  onFiles: (f: FileList | null) => void;
}) {
  const gallery = (
    <Button
      key="g"
      type="button"
      size="sm"
      variant={preferCamera ? "outline" : "default"}
      className="gap-1.5 h-8 tabular-nums"
      disabled={uploading}
      onClick={() => galleryRef.current?.click()}
    >
      {uploading ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <ImageIcon size={13} />
      )}
      {uploading && progress
        ? `Subiendo ${progress.done}/${progress.total}…`
        : "Galería"}
    </Button>
  );
  const camera = (
    <Button
      key="c"
      type="button"
      size="sm"
      variant={preferCamera ? "default" : "outline"}
      className="gap-1.5 h-8"
      disabled={uploading}
      onClick={() => cameraRef.current?.click()}
    >
      <Camera size={13} />
      Cámara
    </Button>
  );
  return (
    <div className="flex items-center gap-1.5">
      {/* accept="image/*" SIN heic → iOS convierte HEIC→JPEG al elegir.
          El input de galería NO lleva capture (deja elegir fotos ya tomadas). */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      {preferCamera ? (
        <>
          {camera}
          {gallery}
        </>
      ) : (
        <>
          {gallery}
          {camera}
        </>
      )}
    </div>
  );
}

function EmptyState({
  readOnly,
  onClick,
}: {
  readOnly: boolean;
  onClick: () => void;
}) {
  if (readOnly) {
    return (
      <div className="w-full rounded-lg border border-dashed bg-muted/20 px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground">
        <ImageOff size={20} />
        <span className="text-xs">No se cargaron fotos para este trabajo</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-dashed bg-muted/20 hover:bg-muted/40 transition-colors px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground"
    >
      <ImageOff size={20} />
      <span className="text-xs">
        Tocá para agregar la foto del arreglo (evidencia)
      </span>
    </button>
  );
}

function AttachmentTile({
  attachment: a,
  onOpen,
  onDelete,
  deleting,
}: {
  attachment: TicketAttachment;
  onOpen: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const unviewable = isUnviewable(a);
  const [src, setSrc] = useState(
    unviewable ? transformUrl(a.file_url) : a.file_url
  );
  const [broken, setBroken] = useState(false);

  return (
    <div className="group relative aspect-square rounded-lg overflow-hidden border bg-muted">
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 w-full h-full"
        aria-label={`Ver ${a.file_name ?? "foto del trabajo"}`}
      >
        {broken ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-muted-foreground bg-muted">
            <FileWarning size={18} />
            <span className="text-[10px] leading-tight">
              Formato no previsualizable
            </span>
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- URL pública externa + fallback onError (transcode HEIC). next/image no permite swap de src en error.
          <img
            src={src}
            alt={a.file_name ?? "Foto del trabajo"}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]"
            onError={() => {
              if (src !== a.file_url) {
                setSrc(a.file_url);
              } else {
                setBroken(true);
              }
            }}
          />
        )}
      </button>
      <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between text-[10px] text-white pointer-events-none">
        <span className="truncate">{formatTimeAgo(a.uploaded_at)}</span>
        {onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={deleting}
            className="pointer-events-auto size-5 grid place-items-center rounded-sm hover:bg-red-500/80 transition-colors"
            aria-label="Eliminar foto"
          >
            {deleting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Trash2 size={11} />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Imagen del lightbox con su propio estado de fallback. Se monta con `key`
 *  por adjunto, así al cambiar de slide arranca limpia sin useEffect de reset. */
function LightboxImage({ attachment: a }: { attachment: TicketAttachment }) {
  const [src, setSrc] = useState(() =>
    isUnviewable(a) ? transformUrl(a.file_url) : a.file_url
  );
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="flex flex-col items-center gap-3 text-white/80 p-8">
        <FileWarning size={40} />
        <p className="text-sm text-center max-w-xs">
          Esta foto está en un formato que el navegador no puede mostrar (HEIC
          de iPhone). Descargala para verla.
        </p>
        <a
          href={a.file_url}
          download={a.file_name ?? "foto"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-white/15 hover:bg-white/25 px-4 py-2 text-sm font-medium"
        >
          <Download size={15} /> Descargar foto
        </a>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver AttachmentTile
    <img
      src={src}
      alt={a.file_name ?? "Foto del trabajo"}
      className="max-h-[80vh] max-w-full w-auto h-auto object-contain rounded-md"
      onError={() => {
        if (src !== a.file_url) setSrc(a.file_url);
        else setBroken(true);
      }}
    />
  );
}

function Lightbox({
  attachments,
  index,
  onIndex,
  onClose,
}: {
  attachments: TicketAttachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const total = attachments.length;
  const a = attachments[index];

  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + total) % total;
      onIndex(next);
    },
    [index, total, onIndex]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white z-10"
        aria-label="Cerrar"
      >
        <X size={18} />
      </button>

      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 size-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white z-10"
            aria-label="Anterior"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 size-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white z-10"
            aria-label="Siguiente"
          >
            <ChevronRight size={22} />
          </button>
        </>
      ) : null}

      <div
        className="max-h-full max-w-full flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <LightboxImage key={a.id} attachment={a} />
        <div className="flex items-center gap-3 text-xs text-white/70">
          <span className="tabular-nums">
            {index + 1} / {total}
          </span>
          <span>·</span>
          <span>{formatTimeAgo(a.uploaded_at)}</span>
          <span>·</span>
          <a
            href={a.file_url}
            download={a.file_name ?? "foto"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:text-white"
          >
            <Download size={12} /> Descargar
          </a>
        </div>
      </div>
    </div>
  );
}
