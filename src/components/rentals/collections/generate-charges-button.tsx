"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateChargesNow } from "@/lib/actions/rentals-collections";
import { cn } from "@/lib/utils";
import { Spinner } from "./whatsapp-message-dialog";

/** "Generar ahora": corre la misma sincronización que el cron diario para todos los contratos vigentes. */
export function GenerateChargesButton({
  label = "Generar ahora",
  size = "sm",
  variant = "outline",
  className,
}: {
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run() {
    startTransition(async () => {
      const res = await generateChargesNow();
      if (!res.ok) {
        toast.error("No se pudieron generar los cargos", { description: res.error });
        return;
      }
      const what =
        res.created === 0
          ? "No faltaba ningún cargo: todo estaba al día."
          : res.created === 1
            ? "Se generó 1 cargo nuevo."
            : `Se generaron ${res.created} cargos nuevos.`;
      if (res.partial) {
        toast.warning("Quedaron contratos sin revisar", { description: `${what} Revisamos ${res.synced} de ${res.contracts}: tocá de nuevo para seguir.` });
      } else {
        toast.success("Listo", { description: `${what} Revisamos ${res.contracts} ${res.contracts === 1 ? "contrato" : "contratos"}.` });
      }
      router.refresh();
    });
  }
  return (
    <Button size={size} variant={variant} onClick={run} disabled={pending} className={cn("gap-2", className)}>
      {pending ? <Spinner /> : <RefreshCw size={14} />}
      {pending ? "Generando…" : label}
    </Button>
  );
}
