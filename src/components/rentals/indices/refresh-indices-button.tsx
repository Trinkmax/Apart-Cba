"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatTimeAgo } from "@/lib/format";
import { refreshIndicesNow } from "@/lib/actions/rentals-indices";

/** "Actualizar ahora": trae los índices de INDEC/BCRA y recalcula los ajustes que esperaban un dato. */
export function RefreshIndicesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await refreshIndicesNow();
      if (!res.ok) {
        toast.error("No se pudieron actualizar", { description: res.error });
        return;
      }
      if (res.skipped) {
        toast.message("Los índices ya están al día", {
          description: res.fetchedAt ? `Se actualizaron ${formatTimeAgo(res.fetchedAt)}.` : undefined,
        });
        return;
      }
      const failed = res.updated.filter((u) => u.error).map((u) => u.code.toUpperCase());
      toast.success("Índices actualizados", {
        description: [
          failed.length ? `No respondió: ${failed.join(", ")} (se reintenta esta noche).` : "Todas las fuentes respondieron.",
          res.contractsResynced ? `Se recalcularon ${res.contractsResynced} contratos.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      });
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={run} disabled={pending}>
      {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      <span>{pending ? "Actualizando…" : "Actualizar ahora"}</span>
    </Button>
  );
}
