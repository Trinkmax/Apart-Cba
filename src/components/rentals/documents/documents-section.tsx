// Server component genérico: archivos de un contrato, propiedad o persona (bucket privado rental-docs).
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { listRentalDocuments } from "@/lib/actions/rentals-documents";
import { scopeRefOf, type DocumentsScope } from "./document-types";
import { DocumentsPanel } from "./documents-panel";

export type { DocumentsScope } from "./document-types";

export async function DocumentsSection({ scope, title }: { scope: DocumentsScope; title?: string }) {
  const ref = scopeRefOf(scope);
  const res = await listRentalDocuments(ref);
  if (!res.ok) {
    return (
      <Card className="p-4 sm:p-5 flex-row items-start gap-3 border-amber-500/30 bg-amber-500/5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="text-sm">
          <p className="font-medium">No se pudieron cargar los documentos</p>
          <p className="text-muted-foreground text-xs mt-0.5">{res.error} Recargá la página para reintentar.</p>
        </div>
      </Card>
    );
  }
  return <DocumentsPanel scope={ref} documents={res.documents} title={title} />;
}

/** Esqueleto con la misma silueta (para <Suspense fallback>). */
export function DocumentsSectionSkeleton() {
  return (
    <Card className="p-4 sm:p-5 gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-3 w-56 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-9 w-20 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-8 w-32 rounded-full bg-muted animate-pulse" />
        <div className="h-8 w-24 rounded-full bg-muted animate-pulse" />
      </div>
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-muted animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
              <div className="h-3 w-64 max-w-full rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
