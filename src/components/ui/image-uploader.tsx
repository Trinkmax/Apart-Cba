"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ImageUploaderProps {
  /** URL de la imagen actual (o null si no hay). */
  currentUrl: string | null;
  /** Server action que recibe FormData con campo "file" y devuelve nuevo URL. */
  uploadAction: (formData: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  /** Server action opcional para borrar (sin file). */
  deleteAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Tamaños y tipos. */
  maxSizeMB: number;
  acceptedTypes: string[];  // ej. ["image/jpeg", "image/png", "image/webp"]
  /** Tamaño visual del preview (px). */
  previewSize?: number;
  /** Forma del preview. */
  shape?: "circle" | "square";
  /** Callback opcional al success. */
  onUploaded?: (newUrl: string) => void;
  /** Texto del placeholder cuando no hay imagen. */
  placeholderText?: string;
}

export function ImageUploader({
  currentUrl,
  uploadAction,
  deleteAction,
  maxSizeMB,
  acceptedTypes,
  previewSize = 144,
  shape = "circle",
  onUploaded,
  placeholderText = "Arrastrá una imagen o hacé click para subir",
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayUrl = previewUrl ?? currentUrl;

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!acceptedTypes.includes(file.type)) {
        return `Tipo no soportado. Permitidos: ${acceptedTypes.map((t) => t.split("/")[1]).join(", ")}`;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        return `Archivo demasiado grande. Máximo: ${maxSizeMB} MB`;
      }
      return null;
    },
    [acceptedTypes, maxSizeMB]
  );

  const handleFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        toast.error(err);
        return;
      }
      setPreviewFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    },
    [validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleUpload = useCallback(async () => {
    if (!previewFile) return;
    setIsUploading(true);
    const fd = new FormData();
    fd.append("file", previewFile);
    try {
      const result = await uploadAction(fd);
      if (!result.ok) {
        toast.error("Error al subir", { description: result.error });
        return;
      }
      toast.success("Imagen actualizada");
      setPreviewFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      onUploaded?.(result.url);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [previewFile, previewUrl, uploadAction, onUploaded]);

  const handleCancel = useCallback(() => {
    setPreviewFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [previewUrl]);

  const handleDelete = useCallback(async () => {
    if (!deleteAction) return;
    if (!confirm("¿Seguro que querés eliminar la imagen actual?")) return;
    setIsUploading(true);
    try {
      const result = await deleteAction();
      if (!result.ok) {
        toast.error("Error al eliminar", { description: result.error });
        return;
      }
      toast.success("Imagen eliminada");
      onUploaded?.("");
    } finally {
      setIsUploading(false);
    }
  }, [deleteAction, onUploaded]);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "mx-auto flex items-center justify-center bg-muted overflow-hidden border-2 transition-colors",
          shape === "circle" ? "rounded-full" : "rounded-lg",
          isDragging ? "border-primary bg-primary/5" : "border-dashed border-muted-foreground/30"
        )}
        style={{ width: previewSize, height: previewSize }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {displayUrl ? (
          <Image
            src={displayUrl}
            alt="Preview"
            width={previewSize}
            height={previewSize}
            unoptimized
            className="object-cover w-full h-full"
          />
        ) : (
          <div className="text-center text-xs text-muted-foreground p-4">{placeholderText}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        <input
          type="file"
          ref={inputRef}
          accept={acceptedTypes.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {!previewFile && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload size={14} className="mr-1.5" /> Elegir imagen
          </Button>
        )}
        {previewFile && (
          <>
            <Button type="button" size="sm" onClick={handleUpload} disabled={isUploading}>
              {isUploading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Upload size={14} className="mr-1.5" />}
              Subir
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={isUploading}>
              <X size={14} className="mr-1.5" /> Cancelar
            </Button>
          </>
        )}
        {currentUrl && !previewFile && deleteAction && (
          <Button type="button" size="sm" variant="ghost" onClick={handleDelete} disabled={isUploading} className="text-destructive">
            Eliminar
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {acceptedTypes.map((t) => t.split("/")[1].toUpperCase()).join(", ")} · max {maxSizeMB} MB
      </p>
    </div>
  );
}
