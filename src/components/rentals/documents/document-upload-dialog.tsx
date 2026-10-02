"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DOCUMENT_KIND_LABEL } from "@/lib/rentals/labels";
import type { RentalDocumentKind } from "@/lib/types/database";
import { Field } from "@/components/rentals/people/form-bits";
import { DOCUMENT_MAX_BYTES, KINDS_BY_SCOPE, formatFileSize, type DocumentScopeRef } from "./document-types";
import { DOCUMENT_ACCEPT, isImageFile, uploadDocumentFile } from "./upload-document";

export function DocumentUploadDialog({
  scope,
  open,
  onOpenChange,
  defaultKind,
}: {
  scope: DocumentScopeRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: RentalDocumentKind;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
              <Upload size={16} />
            </span>
            Subir documento
          </DialogTitle>
          <DialogDescription>PDF o fotos (JPG, PNG, HEIC), hasta 15 MB cada uno. Las fotos se achican solas.</DialogDescription>
        </DialogHeader>
        {open && <UploadForm scope={scope} defaultKind={defaultKind ?? KINDS_BY_SCOPE[scope.kind][0]} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ scope, defaultKind, onDone }: { scope: DocumentScopeRef; defaultKind: RentalDocumentKind; onDone: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<RentalDocumentKind>(defaultKind);
  const [title, setTitle] = useState(DOCUMENT_KIND_LABEL[defaultKind]);
  const [titleTouched, setTitleTouched] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickKind(k: RentalDocumentKind) {
    setKind(k);
    if (!titleTouched) setTitle(DOCUMENT_KIND_LABEL[k]);
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > DOCUMENT_MAX_BYTES && !isImageFile(f));
    setError(tooBig ? `«${tooBig.name}» pesa más de 15 MB.` : null);
    setFiles((prev) => [...prev, ...incoming.filter((f) => f !== tooBig)].slice(0, 10));
  }

  function submit() {
    if (pending) return;
    if (!files.length) {
      setError("Elegí al menos un archivo.");
      return;
    }
    startTransition(async () => {
      let okCount = 0;
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : "Subiendo…");
        const base = title.trim() || DOCUMENT_KIND_LABEL[kind];
        const res = await uploadDocumentFile(scope, kind, files.length > 1 ? `${base} (${i + 1})` : base, files[i]);
        if (!res.ok) {
          setProgress(null);
          setError(res.error);
          setFiles(files.slice(i));
          if (okCount) router.refresh();
          return;
        }
        okCount++;
      }
      setProgress(null);
      toast.success(okCount > 1 ? `${okCount} documentos subidos` : "Documento subido", { description: title.trim() || DOCUMENT_KIND_LABEL[kind] });
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="space-y-4">
      <Field label="¿Qué es?">
        <div role="radiogroup" aria-label="Tipo de documento" className="flex flex-wrap gap-1.5">
          {KINDS_BY_SCOPE[scope.kind].map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => pickKind(k)}
              className={cn(
                "h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                kind === k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {DOCUMENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Field>
      <Field id="doc-title" label="Nombre" hint={files.length > 1 ? "Con varios archivos se numeran: (1), (2)…" : "Así lo vas a ver en la lista."}>
        <Input
          id="doc-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleTouched(true);
          }}
          maxLength={150}
          className="h-10"
        />
      </Field>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed transition-colors",
          dragging ? "border-teal-500 bg-teal-500/5" : "border-input hover:border-teal-500/50",
        )}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="size-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Upload size={18} />
          </span>
          <span className="text-sm font-medium">Elegí archivos o arrastralos acá</span>
          <span className="text-xs text-muted-foreground">Desde el celular podés sacar la foto en el momento.</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="rounded-lg border divide-y">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
              <span className="size-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                {isImageFile(f) ? <ImageIcon size={15} /> : <FileText size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{f.name}</span>
                <span className="block text-[11px] text-muted-foreground tabular-nums">{formatFileSize(f.size)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                disabled={pending}
                aria-label={`Quitar ${f.name}`}
              >
                <X size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" onClick={submit} disabled={pending || !files.length} className="gap-2">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {pending && progress ? progress : files.length > 1 ? `Subir ${files.length} archivos` : "Subir"}
        </Button>
      </DialogFooter>
    </div>
  );
}
