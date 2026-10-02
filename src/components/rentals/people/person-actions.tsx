"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FilePlus2, Loader2, MoreHorizontal, UserRoundPen } from "lucide-react";
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
import { archivePerson, restorePerson } from "@/lib/actions/rentals-people";
import type { RentalPerson } from "@/lib/types/database";
import { PersonFormDialog } from "./person-form-dialog";

/** Acciones de la ficha de una persona: editar, contrato nuevo como inquilino, archivar / reactivar. */
export function PersonActions({ person, intent }: { person: RentalPerson; intent?: "inquilino" | "garante" }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    startTransition(async () => {
      const res = person.active ? await archivePerson(person.id) : await restorePerson(person.id);
      if (!res.ok) {
        toast.error(person.active ? "No se pudo archivar" : "No se pudo reactivar", { description: res.error });
        return;
      }
      toast.success(person.active ? "Persona archivada" : "Persona activa de nuevo");
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto">
      <PersonFormDialog person={person} intent={intent}>
        <Button variant="outline" className="gap-2 flex-1 sm:flex-none">
          <UserRoundPen size={14} /> Editar
        </Button>
      </PersonFormDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Más acciones">
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {person.active && (
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/alquileres/contratos/nuevo?inquilino=${person.id}`}>
                <FilePlus2 size={14} /> Contrato nuevo como inquilino
              </Link>
            </DropdownMenuItem>
          )}
          {person.active ? (
            <DropdownMenuItem onSelect={() => setConfirm(true)}>
              <Archive size={14} /> Archivar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={toggleArchive}>
              <ArchiveRestore size={14} /> Volver a activar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar a {person.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de aparecer en los buscadores y en el alta de contratos. Sus contratos anteriores, recibos y documentos quedan guardados, y la
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
