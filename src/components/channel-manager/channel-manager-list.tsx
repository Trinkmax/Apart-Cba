"use client";

import { useTransition } from "react";
import { RefreshCw, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { syncIcalFeed, deleteIcalFeed } from "@/lib/actions/ical";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatTimeAgo } from "@/lib/format";
import type { IcalFeed, Unit } from "@/lib/types/database";

type FeedWithUnit = IcalFeed & { unit: Pick<Unit, "id" | "code" | "name"> };

export function ChannelManagerList({ feeds }: { feeds: FeedWithUnit[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function sync(id: string) {
    startTransition(async () => {
      try {
        const r = await syncIcalFeed(id);
        toast.success(`Sync OK · ${r.imported} importadas, ${r.skipped} omitidas`);
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
              <div className="col-span-3">
                <div className="text-xs text-muted-foreground">Unidad</div>
                <div className="font-mono text-sm">{f.unit.code}</div>
              </div>
              <div className="col-span-3">
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
              <div className="col-span-2 flex items-center gap-1 justify-end">
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
