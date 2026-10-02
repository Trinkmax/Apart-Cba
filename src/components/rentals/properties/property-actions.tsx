"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FilePlus2, Loader2, MoreHorizontal, PencilLine } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { archiveProperty, restoreProperty } from "@/lib/actions/rentals-properties";
import type { RentalProperty } from "@/lib/types/database";
import { PropertyFormDialog } from "./property-form-dialog";
import type { PropertyOwnerInput } from "./property-types";

/** Barra de acciones de la ficha: nuevo contrato, editar y archivar / reactivar. */
export function PropertyActions({
  property,
  owners,
  canNewContract,
}: {
  property: RentalProperty;
  owners: PropertyOwnerInput[];
  canNewContract: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    startTransition(async () => {
      const res = property.active ? await archiveProperty(property.id) : await restoreProperty(property.id);
      if (!res.ok) {
        toast.error(property.active ? "No se pudo archivar" : "No se pudo reactivar", { description: res.error });
        return;
      }
      toast.success(property.active ? "Propiedad archivada" : "Propiedad activa de nuevo");
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto">
      {canNewContract && property.active && (
        <Button asChild className="gap-2 flex-1 sm:flex-none">
          <Link href={`/dashboard/alquileres/contratos/nuevo?propiedad=${property.id}`}>
            <FilePlus2 size={14} /> Cargar contrato
          </Link>
        </Button>
      )}
      <PropertyFormDialog property={property} owners={owners}>
        <Button variant="outline" className="gap-2 flex-1 sm:flex-none">
          <PencilLine size={14} /> Editar
        </Button>
      </PropertyFormDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Más acciones">
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {property.active ? (
            <DropdownMenuItem onSelect={() => setConfirm(true)}>
              <Archive size={14} /> Archivar propiedad
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={toggleArchive}>
              <ArchiveRestore size={14} /> Volver a activarla
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar la propiedad?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de aparecer en las listas y en el alta de contratos. Se conserva todo: contratos, cobros, documentos e historial, y la
              podés volver a activar cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                toggleArchive();
              }}
              disabled={pending}
              className="gap-2"
            >
              {pending && <Loader2 size={14} className="animate-spin" />} Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
