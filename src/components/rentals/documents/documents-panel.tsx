"use client";

import { useState } from "react";
import { CheckCircle2, FolderOpen, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DOCUMENT_KIND_LABEL } from "@/lib/rentals/labels";
import type { RentalDocumentKind } from "@/lib/types/database";
import { EXPECTED_KINDS, SCOPE_EMPTY_HINT, type DocumentScopeRef, type RentalDocumentView } from "./document-types";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { DocumentRow } from "./document-row";

/**
 * Documentos de un contrato, propiedad o persona: lista de control de lo que
 * conviene tener (contrato firmado, garantía, DNI…), subida y la lista con
 * ver / bajar / renombrar / borrar. Los archivos se abren con links firmados
 * de 10 minutos: el bucket es privado.
 */
export function DocumentsPanel({
  scope,
  documents,
  canDelete = true,
  title = "Documentos",
}: {
  scope: DocumentScopeRef;
  documents: RentalDocumentView[];
  canDelete?: boolean;
  title?: string;
}) {
  const [upload, setUpload] = useState<{ open: boolean; kind?: RentalDocumentKind }>({ open: false });
  const present = new Set(documents.map((d) => d.kind));
  const expected = EXPECTED_KINDS[scope.kind];
  const missing = expected.filter((k) => !present.has(k));

  return (
    <Card className="p-4 sm:p-5 gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FolderOpen size={15} className="text-muted-foreground" />
            {title}
            {documents.length > 0 && <span className="font-normal text-muted-foreground tabular-nums">({documents.length})</span>}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {missing.length === 0 && expected.length > 0
              ? "Está todo lo importante. Sumá lo que quieras tener a mano."
              : missing.length
                ? `Falta: ${missing.map((k) => DOCUMENT_KIND_LABEL[k].toLowerCase()).join(", ")}.`
                : SCOPE_EMPTY_HINT[scope.kind]}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0 h-9" onClick={() => setUpload({ open: true })}>
          <Upload size={14} /> Subir
        </Button>
      </div>

      {expected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Documentos importantes">
          {expected.map((k) =>
            present.has(k) ? (
              <li
                key={k}
                className="inline-flex items-center gap-1.5 h-8 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-200"
              >
                <CheckCircle2 size={13} /> {DOCUMENT_KIND_LABEL[k]}
              </li>
            ) : (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => setUpload({ open: true, kind: k })}
                  className="inline-flex items-center gap-1.5 h-8 rounded-full border border-dashed border-amber-500/50 px-2.5 text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 transition-colors"
                >
                  <Plus size={13} /> {DOCUMENT_KIND_LABEL[k]}
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {documents.length > 0 ? (
        <ul className="divide-y -my-1">
          {documents.map((d) => (
            <DocumentRow key={d.id} doc={d} canDelete={canDelete} kinds={scope.kind} />
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setUpload({ open: true })}
          className={cn(
            "w-full rounded-lg border border-dashed px-4 py-6 text-center transition-colors hover:bg-accent/30",
            "flex flex-col items-center gap-1.5",
          )}
        >
          <Upload size={18} className="text-muted-foreground" />
          <span className="text-sm font-medium">Todavía no hay documentos</span>
          <span className="text-xs text-muted-foreground max-w-sm">{SCOPE_EMPTY_HINT[scope.kind]}</span>
        </button>
      )}

      <DocumentUploadDialog
        scope={scope}
        open={upload.open}
        defaultKind={upload.kind}
        onOpenChange={(open) => setUpload((u) => ({ ...u, open }))}
      />
    </Card>
  );
}
