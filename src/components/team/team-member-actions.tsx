"use client";

import { useTransition } from "react";
import { MoreVertical, UserX, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { changeMemberRole, deactivateMember } from "@/lib/actions/team";
import { ROLE_META } from "@/lib/constants";
import type { OrganizationMember, UserProfile, UserRole } from "@/lib/types/database";

interface Props {
  member: OrganizationMember & { profile: UserProfile | null; email: string | null };
}

export function TeamMemberActions({ member }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  function handleDeactivate() {
    if (!confirm("¿Desactivar este usuario?")) return;
    startTransition(async () => {
      try {
        await deactivateMember(member.user_id);
        toast.success("Usuario desactivado");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical size={14} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
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
        <DropdownMenuItem onClick={handleDeactivate} className="text-destructive focus:text-destructive">
          <UserX size={14} />
          Desactivar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
