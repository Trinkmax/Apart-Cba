"use client";

import { useState, useTransition } from "react";
import { MoreVertical, UserX, UserCog, UserCheck, KeyRound, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Button } from "@/components/ui/button";
import { MemberProfileSheet } from "@/components/team/member-profile-sheet";
import {
  AccessCredentialDialog, type AccessCredential,
} from "@/components/team/access-credential-dialog";
import {
  changeMemberRole,
  deactivateMember,
  reactivateMember,
  removeMember,
  resetMemberAccess,
  type TeamMemberRow,
} from "@/lib/actions/team";
import { ROLE_META } from "@/lib/constants";
import type { UserRole } from "@/lib/types/database";

interface Props {
  member: TeamMemberRow;
  /** Nombre de la organización — va en el mensaje de acceso y en la confirmación. */
  orgName: string;
}

export function TeamMemberActions({ member, orgName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [credential, setCredential] = useState<AccessCredential | null>(null);
  // Confirmaciones destructivas: viven fuera del menú porque el dropdown se
  // cierra al elegir un item y se llevaría puesto el AlertDialog.
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const name = member.profile?.full_name ?? member.email ?? "esta persona";
  // Nunca ingresó → la contraseña que se generó al invitarla ya no existe en
  // ningún lado, así que regenerarla no le rompe nada a nadie.
  const neverSignedIn = !member.last_sign_in_at;

  function handleChangeRole(newRole: UserRole) {
    startTransition(async () => {
      try {
        await changeMemberRole(member.user_id, newRole);
        toast.success(`Rol cambiado a ${ROLE_META[newRole].label}`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleResetAccess() {
    setConfirmReset(false);
    startTransition(async () => {
      try {
        const r = await resetMemberAccess(member.user_id);
        setCredential({ fullName: r.fullName, email: r.email, password: r.tempPassword });
        router.refresh();
      } catch (e) {
        toast.error("No se pudo generar el acceso", { description: (e as Error).message });
      }
    });
  }

  function handleDeactivate() {
    startTransition(async () => {
      try {
        await deactivateMember(member.user_id);
        toast.success(`${name} ya no puede entrar`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleReactivate() {
    startTransition(async () => {
      try {
        await reactivateMember(member.user_id);
        toast.success(`${name} puede volver a entrar`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleRemove() {
    setConfirmRemove(false);
    startTransition(async () => {
      try {
        const { unassigned } = await removeMember(member.user_id);
        toast.success(`${name} ya no está en el equipo`, {
          description:
            unassigned > 0
              ? `Quedaron ${unassigned} ${unassigned === 1 ? "tarea sin asignar" : "tareas sin asignar"}.`
              : undefined,
        });
        router.refresh();
      } catch (e) {
        toast.error("No se pudo quitar del equipo", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical size={14} />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setSheetOpen(true)}>
            <UserCog size={14} />
            Editar perfil
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => (neverSignedIn ? handleResetAccess() : setConfirmReset(true))}
          >
            <KeyRound size={14} />
            {neverSignedIn ? "Copiar acceso para WhatsApp" : "Regenerar contraseña"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Cambiar rol</DropdownMenuLabel>
          {(Object.keys(ROLE_META) as UserRole[])
            .filter((r) => r !== member.role)
            .map((r) => (
              <DropdownMenuItem key={r} onClick={() => handleChangeRole(r)}>
                <span className="size-2 rounded-full mr-2" style={{ backgroundColor: ROLE_META[r].color }} />
                {ROLE_META[r].label}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          {member.active ? (
            <DropdownMenuItem onClick={handleDeactivate}>
              <UserX size={14} />
              Desactivar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={handleReactivate}>
              <UserCheck size={14} />
              Reactivar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setConfirmRemove(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 size={14} />
            Quitar del equipo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Regenerar la clave de alguien que ya la está usando la deja afuera:
          por eso se pregunta antes (a quien nunca entró se le regenera directo). */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Generar una contraseña nueva?</AlertDialogTitle>
            <AlertDialogDescription>
              {name} ya viene entrando con una contraseña propia. Si generás una nueva,
              la que usa hoy deja de funcionar y vas a tener que pasarle la nueva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetAccess} disabled={isPending}>
              Generar contraseña nueva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar a {name} del equipo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a quitar a {name} de {orgName}. Sus tareas asignadas quedan sin
              asignar. La persona no va a poder entrar más. Esto no borra el historial
              de lo que hizo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isPending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Quitar del equipo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AccessCredentialDialog
        credential={credential}
        orgName={orgName}
        onClose={() => setCredential(null)}
      />

      <MemberProfileSheet member={member} open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
