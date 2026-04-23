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
        toast.success(`Sync completo`, {
          description: `${r.totalImported} importadas, ${r.totalSkipped} omitidas, ${r.errors} errores`,
        });
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
