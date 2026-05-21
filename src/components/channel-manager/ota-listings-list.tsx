"use client";

import { useTransition } from "react";
import { Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteOtaListing } from "@/lib/actions/ota-listings";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { OtaListingDialog } from "./ota-listing-dialog";
import type { OtaListingWithUnit, Unit } from "@/lib/types/database";

interface Props {
  listings: OtaListingWithUnit[];
  units: Pick<Unit, "id" | "code" | "name">[];
}

export function OtaListingsList({ listings, units }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function remove(id: string) {
    if (!confirm("¿Eliminar este mapeo? Las reservas ya importadas no se borran.")) return;
    startTransition(async () => {
      const res = await deleteOtaListing(id);
      if (!res.ok) {
        toast.error("Error eliminando", { description: res.error });
        return;
      }
      toast.success("Mapeo eliminado");
      router.refresh();
    });
  }

  if (listings.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
        Aún no mapeaste ningún listing externo. Tocá &quot;Mapear listing&quot; para asociar
        una unidad con su anuncio en Airbnb, Booking u otra OTA.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {listings.map((l) => {
          const sm = BOOKING_SOURCE_META[l.provider as keyof typeof BOOKING_SOURCE_META];
          return (
            <div key={l.id} className="grid grid-cols-12 items-center gap-3 p-4">
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
                <div className="text-xs text-muted-foreground truncate">{l.label ?? "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Unidad</div>
                <div className="font-mono text-sm">{l.unit.code}</div>
                <div className="text-[11px] text-muted-foreground truncate">{l.unit.name}</div>
              </div>
              <div className="col-span-4">
                <div className="text-xs text-muted-foreground">ID externo</div>
                <div className="font-mono text-xs break-all">{l.external_listing_id}</div>
                {l.external_account_email && (
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {l.external_account_email}
                  </div>
                )}
                {!l.active && (
                  <Badge variant="secondary" className="text-[10px] mt-1">Inactivo</Badge>
                )}
              </div>
              <div className="col-span-2 flex items-center gap-1 justify-end">
                {l.external_listing_url && (
                  <Button
                    size="icon"
                    variant="ghost"
                    asChild
                    className="size-8"
                    title="Abrir listing en la OTA"
                  >
                    <a href={l.external_listing_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} />
                    </a>
                  </Button>
                )}
                <OtaListingDialog units={units} editing={l} triggerVariant="icon" />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(l.id)}
                  disabled={isPending}
                  className="size-8 text-muted-foreground hover:text-destructive"
                  title="Eliminar mapeo"
                >
                  {isPending ? <Loader2 className="animate-spin size-3" /> : <Trash2 size={14} />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
