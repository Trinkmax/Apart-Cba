"use client";

import { useId, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize } from "./proof-helpers";
import { PROOF_ACCEPT, prepareProofFile, type PreparedProofFile } from "./prepare-file";

/**
 * Elegir (o arrastrar) la foto / PDF de un comprobante. Comprime en el
 * navegador antes de entregar el archivo y muestra miniatura, peso y quitar.
 */
export function ProofFilePicker({
  value,
  onChange,
  error,
  onError,
  label = "Elegir foto o PDF",
  hint = "Hasta 4 MB · también podés sacar una foto",
  disabled,
  className,
}: {
  value: PreparedProofFile | null;
  onChange: (v: PreparedProofFile | null) => void;
  error?: string | null;
  onError?: (message: string | null) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function take(file: File | null | undefined) {
    if (!file) return;
    setPreparing(true);
    onError?.(null);
    try {
      const res = await prepareProofFile(file);
      if ("error" in res) {
        onError?.(res.error);
        return;
      }
      if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
      onChange(res);
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
  }

  if (value) {
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border bg-card p-2.5", className)}>
        {value.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:)
          <img src={value.previewUrl} alt="" className="size-14 shrink-0 rounded-lg border object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            {value.kind === "pdf" ? <FileText size={22} /> : <ImageIcon size={22} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {value.kind === "pdf" ? "PDF" : "Imagen"} · {formatFileSize(value.file.size)}
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Quitar archivo"
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex min-h-[4.5rem] cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3 transition-colors",
          "hover:border-primary/50 hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring/50",
          dragging && "border-primary bg-primary/5",
          error && "border-rose-400",
          (preparing || disabled) && "pointer-events-none opacity-70",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {preparing ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{preparing ? "Preparando el archivo…" : label}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={PROOF_ACCEPT}
          className="sr-only"
          disabled={preparing || disabled}
          onChange={(e) => void take(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
