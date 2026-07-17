"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pause, Play, RefreshCw, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteLink, pauseLink, resumeLink, syncChannelsNow } from "@/lib/actions/channels";

export function LinkActions({
  linkId,
  status,
  hasFeed,
}: {
  linkId: string;
  status: "draft" | "active" | "paused" | "error";
  hasFeed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>, okMsg: string, redirectTo?: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(okMsg);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {status === "draft" && (
        <Button asChild size="sm" variant="secondary" className="gap-1.5">
          <Link href={`/dashboard/canales/conectar?link=${linkId}`}>
            <Wrench size={14} /> Terminar conexión
          </Link>
        </Button>
      )}
      {status === "active" && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pending || !hasFeed}
            onClick={() => run(() => syncChannelsNow(linkId), "Sincronización ejecutada")}
          >
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> Sincronizar ahora
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pending}
            onClick={() => run(() => pauseLink(linkId), "Conexión pausada")}
          >
            <Pause size={14} /> Pausar
          </Button>
        </>
      )}
      {status === "paused" && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={pending}
          onClick={() => run(() => resumeLink(linkId), "Conexión reanudada")}
        >
          <Play size={14} /> Reanudar
        </Button>
      )}
      {status !== "active" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="gap-1.5 text-rose-600 dark:text-rose-400">
              <Trash2 size={14} /> Eliminar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar esta conexión?</AlertDialogTitle>
              <AlertDialogDescription>
                Se deja de sincronizar este canal para la unidad. Las reservas ya importadas no se
                tocan. Si la OTA sigue leyendo nuestro calendario, dejará de encontrarlo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  run(() => deleteLink(linkId), "Conexión eliminada", "/dashboard/canales")
                }
              >
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
