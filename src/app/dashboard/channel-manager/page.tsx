import { Cable, Wifi, Download, Upload, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { listIcalFeedsWithHealth, listUnitExportFeeds } from "@/lib/actions/ical";
import { listOtaListings } from "@/lib/actions/ota-listings";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IcalFeedDialog } from "@/components/channel-manager/ical-feed-dialog";
import { ChannelManagerList } from "@/components/channel-manager/channel-manager-list";
import { SyncAllButton } from "@/components/channel-manager/sync-all-button";
import { ExportFeedsList } from "@/components/channel-manager/export-feeds-list";
import { OtaListingsList } from "@/components/channel-manager/ota-listings-list";
import { OtaListingDialog } from "@/components/channel-manager/ota-listing-dialog";
import { OtaListingBulkDialog } from "@/components/channel-manager/ota-listing-bulk-dialog";

export default async function ChannelManagerPage() {
  const [feeds, units, exportFeeds, otaListingsRes] = await Promise.all([
    listIcalFeedsWithHealth(),
    listUnitsEnriched(),
    listUnitExportFeeds(),
    listOtaListings(),
  ]);
  const otaListings = otaListingsRes.ok ? otaListingsRes.listings : [];

  const brokenCount = feeds.filter((f) => f.health === "broken").length;

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

      {brokenCount > 0 && (
        <Card className="p-4 border-l-4 border-l-rose-500 bg-rose-500/5">
          <div className="flex gap-3 items-center">
            <AlertTriangle className="size-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-rose-700 dark:text-rose-300">
                {brokenCount} feed{brokenCount > 1 ? "s" : ""} con errores persistentes.
              </span>{" "}
              <span className="text-muted-foreground">
                Revisá la URL del feed o verificá que el calendario sigue publicado en la OTA.
              </span>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList>
          <TabsTrigger value="import" className="gap-2">
            <Download size={14} /> Importar (entrante)
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2">
            <Upload size={14} /> Exportar (saliente)
          </TabsTrigger>
          <TabsTrigger value="mapping" className="gap-2">
            <LinkIcon size={14} /> Mapeo de listings
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

          <ChannelManagerList feeds={feeds} />
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card className="p-4 border-l-4 border-l-sky-500 bg-sky-500/5">
            <div className="flex gap-3">
              <Upload className="size-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Cómo exportar las reservas de Apart-Cba a Airbnb / Booking</p>
                <ol className="list-decimal pl-5 text-muted-foreground text-xs space-y-1">
                  <li>Copiá la URL de la unidad (botón <b>Copiar</b>).</li>
                  <li>En Airbnb: Listing → Calendar → Availability → Sync calendars → <b>Import calendar</b> → pegá la URL y poné un nombre (ej. &quot;rentOS&quot;).</li>
                  <li>En Booking: Extranet → Rates &amp; Availability → Sync calendars → pestaña <b>Import calendar</b> → pegá la URL.</li>
                  <li>Cada plataforma actualiza el calendario cada ~2-12 hs (no es instantáneo). Cargá las reservas directas con anticipación para evitar doble-reserva.</li>
                  <li>El feed expone solo fechas ocupadas (sin nombres de huéspedes ni montos), respetando privacidad.</li>
                </ol>
              </div>
            </div>
          </Card>

          <ExportFeedsList units={exportFeeds} />
        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">
          <Card className="p-4 border-l-4 border-l-violet-500 bg-violet-500/5">
            <div className="flex gap-3">
              <LinkIcon className="size-5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="font-medium">Mapeo determinístico de listings</p>
                  <div className="flex items-center gap-2">
                    <OtaListingBulkDialog units={units} existing={otaListings} />
                    <OtaListingDialog units={units} />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  Asociá cada unidad con su listing en Airbnb, Booking u otra OTA. Cuando llega
                  una reserva por email, el sistema usa este mapeo para identificar la unidad
                  correcta sin depender de matching por nombre.
                </p>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-0.5 mt-2">
                  <li><b>Airbnb:</b> número del listing en la URL <span className="font-mono">airbnb.com/rooms/<b>50432101</b></span>.</li>
                  <li><b>Booking:</b> slug en <span className="font-mono">booking.com/hotel/ar/<b>mi-departamento</b>.html</span>.</li>
                  <li>Otras OTAs: cualquier identificador estable que aparezca en sus emails.</li>
                </ul>
              </div>
            </div>
          </Card>

          <OtaListingsList listings={otaListings} units={units} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
