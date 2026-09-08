"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncChannelsNow } from "@/lib/actions/channels";

export function SyncNowButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      try {
        const r = await syncChannelsNow();
        if (r.errors > 0) {
          toast.error(
            `Lectura con ${r.errors} ${r.errors === 1 ? "error" : "errores"} — revisá las incidencias`,
          );
        } else if (r.imported + r.updated + r.conflicts === 0) {
          // "Sincronizado: 0 nuevas" se lee como que algo falló. Y es el momento
          // exacto en que hay que aclarar la otra dirección: alguien que acaba
          // de cargar una reserva propia aprieta este botón esperando que se la
          // mande a la OTA, y este botón sólo TRAE.
          toast.success("No había reservas nuevas en las OTAs", {
            description:
              "Tus reservas viajan solas hacia las OTAs: ellas leen tu calendario cada alrededor de una hora.",
          });
        } else {
          toast.success(
            `Llegaron ${r.imported} nuevas, ${r.updated} actualizadas, ${r.conflicts} conflictos${
              r.requested + r.promoted + r.discarded > 0
                ? ` · solicitudes: ${r.requested} nuevas, ${r.promoted} confirmadas, ${r.discarded} caídas`
                : ""
            }`,
          );
        }
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al leer las OTAs");
      }
    });
  }

  return (
    <Button
      variant="outline"
      onClick={sync}
      disabled={disabled || pending}
      className="gap-1.5"
      // El nombre dice la dirección: "Sincronizar" a secas hacía pensar que
      // también empujaba las reservas propias hacia la OTA, y no.
      title="Busca reservas nuevas en Airbnb y Booking. Lo que cargás vos viaja solo."
    >
      <Download size={14} className={pending ? "animate-pulse" : ""} />
      {pending ? "Buscando…" : "Traer reservas"}
    </Button>
  );
}
