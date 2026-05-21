"use client";

import { useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { syncAllFeeds } from "@/lib/actions/ical";

export function SyncAllButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function syncAll() {
    startTransition(async () => {
      try {
        const r = await syncAllFeeds();
        const parts = [
          `${r.totalImported} importadas`,
          `${r.totalSkipped} omitidas`,
        ];
        if (r.totalCancelled > 0) parts.push(`${r.totalCancelled} canceladas`);
        if (r.errors > 0) parts.push(`${r.errors} errores`);
        toast.success("Sync completo", { description: parts.join(" · ") });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Button variant="outline" onClick={syncAll} disabled={isPending} className="gap-2">
      {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw size={14} />}
      Sincronizar todos
    </Button>
  );
}
