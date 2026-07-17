"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncChannelsNow } from "@/lib/actions/channels";

export function SyncNowButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      try {
        const r = await syncChannelsNow();
        toast.success(
          r.errors > 0
            ? `Sincronización con ${r.errors} ${r.errors === 1 ? "error" : "errores"} — revisá las incidencias`
            : `Sincronizado: ${r.imported} nuevas, ${r.updated} actualizadas, ${r.conflicts} conflictos`,
        );
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al sincronizar");
      }
    });
  }

  return (
    <Button variant="outline" onClick={sync} disabled={disabled || pending} className="gap-1.5">
      <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
      {pending ? "Sincronizando…" : "Sincronizar ahora"}
    </Button>
  );
}
