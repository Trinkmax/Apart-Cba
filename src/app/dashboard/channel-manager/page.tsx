import { Cable, Wifi, Download, Upload } from "lucide-react";
import { listIcalFeeds, listUnitExportFeeds } from "@/lib/actions/ical";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IcalFeedDialog } from "@/components/channel-manager/ical-feed-dialog";
import { ChannelManagerList } from "@/components/channel-manager/channel-manager-list";
import { SyncAllButton } from "@/components/channel-manager/sync-all-button";
import { ExportFeedsList } from "@/components/channel-manager/export-feeds-list";

export default async function ChannelManagerPage() {
  const [feeds, units, exportFeeds] = await Promise.all([
    listIcalFeeds(),
    listUnitsEnriched(),
    listUnitExportFeeds(),
  ]);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Cable className="size-5 text-primary" />
            Channel Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sincronización bidireccional con Airbnb, Booking, Expedia y otros via iCal
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SyncAllButton />
          <IcalFeedDialog units={units} />
        </div>
      </div>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList>
          <TabsTrigger value="import" className="gap-2">
            <Download size={14} /> Importar (entrante)
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2">
            <Upload size={14} /> Exportar (saliente)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <Card className="p-4 border-l-4 border-l-amber-500 bg-amber-500/5">
            <div className="flex gap-3">
              <Wifi className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Cómo importar reservas de Airbnb / Booking</p>
                <ol className="list-decimal pl-5 text-muted-foreground text-xs space-y-1">
                  <li>En Airbnb: Listing → Calendar → Availability → Sync calendars → <b>Export calendar</b>.</li>
                  <li>En Booking: Extranet → Rates &amp; Availability → Sync calendars → pestaña <b>Export calendar</b>.</li>
                  <li>Tocá <b>+ Conectar feed</b> arriba a la derecha y pegá la URL.</li>
                  <li>El sistema sincroniza automáticamente una vez al día (Vercel Cron, 03:00 UTC). Forzá manualmente con &quot;Sincronizar todos&quot;.</li>
                </ol>
              </div>
            </div>
          </Card>

          <ChannelManagerList feeds={feeds as never} />
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card className="p-4 border-l-4 border-l-sky-500 bg-sky-500/5">
            <div className="flex gap-3">
              <Upload className="size-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Cómo exportar las reservas de Apart-Cba a Airbnb / Booking</p>
                <ol className="list-decimal pl-5 text-muted-foreground text-xs space-y-1">
                  <li>Copiá la URL de la unidad (botón <b>Copiar</b>).</li>
                  <li>En Airbnb: Listing → Calendar → Availability → Sync calendars → <b>Import calendar</b> → pegá la URL y poné un nombre (ej. &quot;Apart Cba&quot;).</li>
                  <li>En Booking: Extranet → Rates &amp; Availability → Sync calendars → pestaña <b>Import calendar</b> → pegá la URL.</li>
                  <li>Cada plataforma actualiza el calendario cada ~2-12 hs (no es instantáneo). Cargá las reservas directas con anticipación para evitar doble-reserva.</li>
                  <li>El feed expone solo fechas ocupadas (sin nombres de huéspedes ni montos), respetando privacidad.</li>
                </ol>
              </div>
            </div>
          </Card>

          <ExportFeedsList units={exportFeeds} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
