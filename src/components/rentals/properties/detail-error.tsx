import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Error de carga de una ficha (no es "no existe": eso va a notFound). */
export function DetailError({ backHref, backLabel, message }: { backHref: string; backLabel: string; message: string }) {
  return (
    <div className="page-x page-y space-y-4 max-w-5xl mx-auto">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> {backLabel}
      </Link>
      <Card className="p-5 flex-row items-start gap-3 border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="size-5 shrink-0 text-amber-500" />
        <div className="text-sm">
          <p className="font-medium">No se pudo cargar</p>
          <p className="text-muted-foreground mt-0.5">{message} Recargá la página para reintentar.</p>
        </div>
      </Card>
    </div>
  );
}
