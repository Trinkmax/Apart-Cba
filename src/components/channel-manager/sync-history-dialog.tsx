"use client";

import { useState, useTransition } from "react";
import { History, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSyncRunsForFeed } from "@/lib/actions/ical";
import { formatDateTime } from "@/lib/format";
import type { IcalSyncRun } from "@/lib/types/database";

const STATUS_STYLE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ok: { label: "OK", variant: "default" },
  error: { label: "Error", variant: "destructive" },
  running: { label: "Corriendo", variant: "secondary" },
};

export function SyncHistoryDialog({ feedId, feedLabel }: { feedId: string; feedLabel: string }) {
  const [runs, setRuns] = useState<IcalSyncRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  function loadHistory() {
    if (loaded) return;
    startTransition(async () => {
      const data = await getSyncRunsForFeed(feedId);
      setRuns(data);
      setLoaded(true);
    });
  }

  return (
    <Dialog onOpenChange={(open) => { if (open) loadHistory(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
          <History size={12} />
          Historial
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Historial de sync — {feedLabel}</DialogTitle>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin size-5 text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Sin historial de sync.</p>
        ) : (
          <div className="divide-y text-sm">
            {runs.map((r) => {
              const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.ok;
              return (
                <div key={r.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.started_at)}</span>
                    <Badge variant={style.variant} className="text-[10px]">{style.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400">{r.imported_count} importadas</span>
                    <span className="text-muted-foreground">{r.skipped_count} omitidas</span>
                    <span className="text-muted-foreground capitalize">{r.trigger_source}</span>
                  </div>
                  {r.error_message && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400 truncate">{r.error_message}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
