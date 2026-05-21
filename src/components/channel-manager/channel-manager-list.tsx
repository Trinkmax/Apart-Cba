"use client";

import { useTransition } from "react";
import { RefreshCw, Trash2, Loader2, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { syncIcalFeed, deleteIcalFeed } from "@/lib/actions/ical";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatTimeAgo } from "@/lib/format";
import { SyncHistoryDialog } from "./sync-history-dialog";
import type { IcalFeedWithHealth } from "@/lib/types/database";

const HEALTH_BADGE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ok: { label: "Sano", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  warning: { label: "Alerta", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: AlertTriangle },
  broken: { label: "Error", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30", icon: AlertCircle },
};

export function ChannelManagerList({ feeds }: { feeds: IcalFeedWithHealth[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function sync(id: string) {
    startTransition(async () => {
      try {
        const r = await syncIcalFeed(id);
        const parts = [`${r.imported} importadas`, `${r.skipped} omitidas`];
        if (r.cancelled > 0) parts.push(`${r.cancelled} canceladas`);
        toast.success("Sync OK", { description: parts.join(" · ") });
        router.refresh();
      } catch (e) {
        toast.error("Error sincronizando", { description: (e as Error).message });
      }
    });
  }

  function remove(id: string) {
    if (!confirm("¿Eliminar este feed? Las reservas ya importadas no se borran.")) return;
    startTransition(async () => {
      try {
        await deleteIcalFeed(id);
        toast.success("Feed eliminado");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  if (feeds.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
        Aún no conectaste feeds. Empezá conectando el iCal de Airbnb o Booking.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {feeds.map((f) => {
          const sm = BOOKING_SOURCE_META[f.source as keyof typeof BOOKING_SOURCE_META];
          const hb = HEALTH_BADGE[f.health] ?? HEALTH_BADGE.ok;
          const HealthIcon = hb.icon;
          return (
            <div key={f.id} className="grid grid-cols-12 items-center gap-3 p-4">
              <div className="col-span-1">
                <div
                  className="size-10 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-sm"
                  style={{ backgroundColor: sm.color }}
                >
                  {sm.label.slice(0, 2)}
                </div>
              </div>
              <div className="col-span-3">
                <div className="font-medium text-sm">{sm.label}</div>
                <div className="text-xs text-muted-foreground">{f.label ?? "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Unidad</div>
                <div className="font-mono text-sm">{f.unit.code}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Última sync</div>
                <div className="text-sm flex items-center gap-1.5">
                  {f.last_sync_status === "ok" ? (
                    <CheckCircle2 size={12} className="text-emerald-500" />
                  ) : f.last_sync_status === "error" ? (
                    <AlertCircle size={12} className="text-rose-500" />
                  ) : null}
                  {f.last_sync_at ? formatTimeAgo(f.last_sync_at) : "Nunca"}
                </div>
                {f.last_sync_error && (
                  <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-0.5 truncate">{f.last_sync_error}</div>
                )}
                <Badge variant="secondary" className="text-[10px] mt-1">{f.events_imported_count} importados</Badge>
              </div>
              <div className="col-span-1">
                <Badge variant="outline" className={`text-[10px] gap-1 ${hb.className}`}>
                  <HealthIcon size={10} />
                  {hb.label}
                </Badge>
              </div>
              <div className="col-span-3 flex items-center gap-1 justify-end">
                <SyncHistoryDialog feedId={f.id} feedLabel={`${sm.label} · ${f.unit.code}`} />
                <Button size="sm" variant="outline" onClick={() => sync(f.id)} disabled={isPending} className="gap-1.5">
                  {isPending ? <Loader2 className="animate-spin size-3" /> : <RefreshCw size={12} />}
                  Sync
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(f.id)} disabled={isPending} className="size-8 text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
