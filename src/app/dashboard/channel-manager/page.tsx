import { Cable, Plus, Wifi } from "lucide-react";
import { listIcalFeeds } from "@/lib/actions/ical";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IcalFeedDialog } from "@/components/channel-manager/ical-feed-dialog";
import { ChannelManagerList } from "@/components/channel-manager/channel-manager-list";
import { SyncAllButton } from "@/components/channel-manager/sync-all-button";

export default async function ChannelManagerPage() {
  const [feeds, units] = await Promise.all([listIcalFeeds(), listUnitsEnriched()]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cable className="size-5 text-primary" />
            Channel Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sincronizá reservas de Airbnb, Booking, Expedia y otros via iCal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncAllButton />
          <IcalFeedDialog units={units}>
            <Button className="gap-2"><Plus size={16} /> Conectar feed</Button>
          </IcalFeedDialog>
        </div>
      </div>

      <Card className="p-4 border-l-4 border-l-amber-500 bg-amber-500/5">
        <div className="flex gap-3">
          <Wifi className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">Cómo conectar Airbnb / Booking</p>
            <ol className="list-decimal pl-5 text-muted-foreground text-xs space-y-1">
              <li>En Airbnb: Listing → Calendar → Availability → Sync calendars → Export.</li>
              <li>En Booking: Calendar → Sync calendars → Export.</li>
              <li>Pegá la URL acá y elegí la unidad correspondiente.</li>
              <li>El sistema sincroniza automáticamente cada hora (cron pg_cron). Podés forzar manualmente con &quot;Sincronizar ahora&quot;.</li>
            </ol>
          </div>
        </div>
      </Card>

      <ChannelManagerList feeds={feeds as never} />
    </div>
  );
}
