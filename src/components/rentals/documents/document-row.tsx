"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, ImageIcon, Loader2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { DOCUMENT_KIND_LABEL } from "@/lib/rentals/labels";
import { deleteRentalDocument, getRentalDocumentUrl, updateRentalDocument } from "@/lib/actions/rentals-documents";
import type { RentalDocumentKind } from "@/lib/types/database";
import { Field } from "@/components/rentals/people/form-bits";
import { KINDS_BY_SCOPE, formatFileSize, type DocumentScopeKind, type RentalDocumentView } from "./document-types";

export function DocumentRow({ doc, canDelete, kinds }: { doc: RentalDocumentView; canDelete: boolean; kinds: DocumentScopeKind }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isImage = (doc.file_mime ?? "").startsWith("image/");
  const isHeic = doc.file_mime === "image/heic" || doc.file_mime === "image/heif";

  function open(download: boolean) {
    // La pestaña se abre ya (dentro del clic) para que el navegador no la bloquee; el link firmado llega después.
    const tab = !download && !(isImage && !isHeic) ? window.open("", "_blank") : null;
    startTransition(async () => {
      const res = await getRentalDocumentUrl(doc.id, { download });
      if (!res.ok) {
        tab?.close();
        toast.error("No se pudo abrir el documento", { description: res.error });
        return;
      }
      if (download) {
        window.location.assign(res.url);
      } else if (isImage && !isHeic) {
        setPreview(res.url);
      } else if (tab) {
        tab.opener = null;
        tab.location.href = res.url;
      } else {
        window.location.assign(res.url);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteRentalDocument(doc.id);
      if (!res.ok) {
        toast.error("No se pudo borrar", { description: res.error });
        return;
      }
      toast.success("Documento borrado", { description: doc.title });
      setConfirmDelete(false);
      router.refresh();
    });
  }

  const meta = [DOCUMENT_KIND_LABEL[doc.kind], formatFileSize(doc.file_size), `subido el ${formatDate(doc.created_on)}`, doc.uploader_name ? `por ${doc.uploader_name}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "size-9 rounded-lg flex items-center justify-center shrink-0",
          isImage ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
        )}
      >
        {isImage ? <ImageIcon size={16} /> : <FileText size={16} />}
      </span>
      <button type="button" onClick={() => open(false)} className="min-w-0 flex-1 text-left group" disabled={busy}>
        <span className="block text-sm font-medium truncate group-hover:underline underline-offset-2">{doc.title}</span>
        <span className="block text-[11px] text-muted-foreground truncate">{meta}</span>
      </button>
      {busy && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />}
      <Button variant="ghost" size="sm" className="h-9 gap-1.5 hidden sm:inline-flex" onClick={() => open(false)} disabled={busy}>
        <Eye size={14} /> Ver
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Más acciones para ${doc.title}`}>
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => open(false)} className="sm:hidden">
            <Eye size={14} /> Ver
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open(true)}>
            <Download size={14} /> Descargar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilLine size={14} /> Cambiar nombre
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-rose-600 focus:text-rose-700">
                <Trash2 size={14} /> Borrar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{doc.title}</DialogTitle>
          </DialogHeader>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de un bucket privado
            <img src={preview} alt={doc.title} className="w-full max-h-[70svh] object-contain rounded-lg bg-muted" />
          )}
          <DialogFooter>
            <Button variant="outline" className="gap-1.5" onClick={() => open(true)} disabled={busy}>
              <Download size={14} /> Descargar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameDialog doc={doc} kinds={kinds} open={renaming} onOpenChange={setRenaming} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{doc.title}»?</AlertDialogTitle>
            <AlertDialogDescription>Se borra el archivo para siempre. Si lo necesitás de nuevo, vas a tener que volver a subirlo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
              disabled={busy}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />} Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function RenameDialog({
  doc,
  kinds,
  open,
  onOpenChange,
}: {
  doc: RentalDocumentView;
  kinds: DocumentScopeKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<RentalDocumentKind>(doc.kind);
  const [pending, startTransition] = useTransition();
  const options = Array.from(new Set([...KINDS_BY_SCOPE[kinds], doc.kind]));

  function save() {
    startTransition(async () => {
      const res = await updateRentalDocument(doc.id, { title, kind });
      if (!res.ok) {
        toast.error("No se pudo guardar", { description: res.error });
        return;
      }
      toast.success("Cambios guardados");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setTitle(doc.title);
          setKind(doc.kind);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar nombre</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field id={`rename-${doc.id}`} label="Nombre">
            <Input id={`rename-${doc.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className="h-10" autoFocus />
          </Field>
          <Field label="Tipo">
            <div role="radiogroup" aria-label="Tipo de documento" className="flex flex-wrap gap-1.5">
              {options.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending} className="gap-2">
            {pending && <Loader2 size={14} className="animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
