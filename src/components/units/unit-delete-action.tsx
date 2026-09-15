"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  MoreVertical,
  Trash2,
  Loader2,
  CalendarX2,
  Cable,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { archiveUnit, type ArchiveUnitResult } from "@/lib/actions/units";
import { BOOKING_SOURCE_META, BOOKING_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";

type ArchiveBlockers = NonNullable<
  Extract<ArchiveUnitResult, { ok: false }>["blockers"]
>;

interface UnitDeleteActionProps {
  unitId: string;
  unitCode: string;
  unitName: string;
}

export function UnitDeleteAction({
  unitId,
  unitCode,
  unitName,
}: UnitDeleteActionProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [blockers, setBlockers] = useState<ArchiveBlockers | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(open: boolean) {
    setConfirmOpen(open);
    // Al reabrir se vuelve a preguntar: lo que frenaba pudo haberse resuelto.
    if (!open) setBlockers(null);
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        const r = await archiveUnit(unitId);
        if (!r.ok) {
          // El servidor devuelve el motivo (no lo lanza): en producción una
          // excepción llegaría acá como un texto en inglés sin información.
          if (r.blockers) setBlockers(r.blockers);
          else toast.error("No se pudo eliminar la unidad", { description: r.error });
          return;
        }
        toast.success(`Unidad ${unitCode} eliminada`, {
          description: "Se conserva la historia de reservas y liquidaciones.",
        });
        handleOpenChange(false);
        router.refresh();
      } catch {
        toast.error("No se pudo eliminar la unidad", {
          description: "Probá de nuevo en unos segundos.",
        });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Acciones para ${unitCode}`}
          >
            <MoreVertical size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 size={14} /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          {blockers ? (
            <ArchiveBlockersView
              unitCode={unitCode}
              blockers={blockers}
              onNavigate={() => handleOpenChange(false)}
            />
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar unidad {unitCode}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vas a eliminar <strong>{unitName}</strong>. La unidad desaparece
                  del listado pero se conserva la historia de reservas, tickets y
                  liquidaciones para auditoría. Si tiene reservas activas o
                  futuras, o sigue conectada a Airbnb o Booking, primero hay que
                  resolverlo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={isPending}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {isPending && <Loader2 className="animate-spin" size={14} />}
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Lo que frena el borrado, con acceso directo a cada cosa para resolverla. */
function ArchiveBlockersView({
  unitCode,
  blockers,
  onNavigate,
}: {
  unitCode: string;
  blockers: ArchiveBlockers;
  onNavigate: () => void;
}) {
  const { bookings, bookingsTotal, links } = blockers;
  const restantes = bookingsTotal - bookings.length;
  const canales = links.map((l) => BOOKING_SOURCE_META[l.channel].label).join(" y ");

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Todavía no se puede eliminar {unitCode}</AlertDialogTitle>
        <AlertDialogDescription>
          Resolvé esto primero y después volvé a eliminarla.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {bookingsTotal > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarX2 size={14} className="text-amber-600 dark:text-amber-400" />
            {bookingsTotal === 1
              ? "1 reserva activa o futura"
              : `${bookingsTotal} reservas activas o futuras`}
          </h3>
          <ul className="divide-y rounded-md border">
            {bookings.map((b) => {
              const detalle = [
                b.is_block ? "Cierre" : null,
                b.source ? BOOKING_SOURCE_META[b.source].label : null,
                b.is_block ? null : BOOKING_STATUS_META[b.status].label,
                b.guest_name,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/reservas/${b.id}`}
                    onClick={onNavigate}
                    className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium tabular-nums">
                        {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                      </span>
                      {detalle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {detalle}
                        </span>
                      )}
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {restantes > 0 && `Y ${restantes} más. `}
            {bookingsTotal === 1
              ? "Cancelala o pasala a otra unidad."
              : "Cancelalas o pasalas a otra unidad."}
          </p>
        </section>
      )}

      {links.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Cable size={14} className="text-amber-600 dark:text-amber-400" />
            Sigue conectada a {canales}
          </h3>
          <ul className="divide-y rounded-md border">
            {links.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/canales/${l.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                >
                  <span className="flex-1 font-medium">
                    {BOOKING_SOURCE_META[l.channel].label}
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {links.length === 1
              ? "Pausá la conexión y cerrá el anuncio en el canal: si no, pueden seguir entrando reservas a una unidad que ya no se ve."
              : "Pausá las conexiones y cerrá el anuncio en cada canal: si no, pueden seguir entrando reservas a una unidad que ya no se ve."}
          </p>
        </section>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel>Cerrar</AlertDialogCancel>
      </AlertDialogFooter>
    </>
  );
}
