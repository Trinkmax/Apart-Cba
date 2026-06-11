import { Cable, Download, Upload, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { listIcalFeedsWithHealth, listUnitExportFeeds } from "@/lib/actions/ical";
import { listOtaListings } from "@/lib/actions/ota-listings";
import { listUnitRefs } from "@/lib/actions/units";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IcalFeedDialog } from "@/components/channel-manager/ical-feed-dialog";
import { ChannelManagerList } from "@/components/channel-manager/channel-manager-list";
import { SyncAllButton } from "@/components/channel-manager/sync-all-button";
import { ExportFeedsList } from "@/components/channel-manager/export-feeds-list";
import { OtaListingsList } from "@/components/channel-manager/ota-listings-list";
import { OtaListingDialog } from "@/components/channel-manager/ota-listing-dialog";
import { OtaListingBulkDialog } from "@/components/channel-manager/ota-listing-bulk-dialog";
import { SyncGuide } from "@/components/channel-manager/sync-guide";

export default async function ChannelManagerPage() {
  const [feeds, units, exportFeeds, otaListingsRes] = await Promise.all([
    listIcalFeedsWithHealth(),
    listUnitRefs(),
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
          <IcalFeedDialog
            units={units}
            connectedFeeds={feeds.map((f) => ({ unitId: f.unit_id, source: f.source }))}
            exportUrlByUnit={Object.fromEntries(exportFeeds.map((f) => [f.id, f.export_url]))}
          />
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
          <SyncGuide variant="import" />

          <ChannelManagerList feeds={feeds} />
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <SyncGuide variant="export" />

          <ExportFeedsList units={exportFeeds} />
        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">
          <SyncGuide
            variant="mapping"
            action={
              <div className="flex items-center gap-2">
                <OtaListingBulkDialog units={units} existing={otaListings} />
                <OtaListingDialog units={units} />
              </div>
            }
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Cuando llega una reserva por email, el sistema usa este mapeo para
              identificar la unidad correcta sin depender del matching por nombre.
            </p>
            <ul className="mt-3 space-y-2">
              <li className="flex gap-2 text-xs text-muted-foreground">
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-rose-500/15 text-[8px] font-bold text-rose-600 dark:text-rose-400">
                  A
                </span>
                <span>
                  <b className="font-medium text-foreground/80">Airbnb:</b> el número
                  del listing en la URL{" "}
                  <span className="font-mono text-foreground/70">
                    airbnb.com/rooms/<b className="text-foreground">50432101</b>
                  </span>
                  .
                </span>
              </li>
              <li className="flex gap-2 text-xs text-muted-foreground">
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-blue-500/15 text-[8px] font-bold text-blue-600 dark:text-blue-400">
                  B
                </span>
                <span>
                  <b className="font-medium text-foreground/80">Booking:</b> el slug en{" "}
                  <span className="font-mono text-foreground/70">
                    booking.com/hotel/ar/<b className="text-foreground">mi-departamento</b>.html
                  </span>
                  .
                </span>
              </li>
              <li className="flex gap-2 text-xs text-muted-foreground">
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[8px] font-bold text-foreground/60">
                  •
                </span>
                <span>
                  Otras OTAs: cualquier identificador estable que aparezca en sus
                  emails.
                </span>
              </li>
            </ul>
          </SyncGuide>

          <OtaListingsList listings={otaListings} units={units} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
