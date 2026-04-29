"use client";

import { useState, useTransition } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AccountFormDialog } from "@/components/cash/account-form-dialog";
import { deleteAccount } from "@/lib/actions/cash";
import type { CashAccount } from "@/lib/types/database";

export function AccountCardActions({ account }: { account: CashAccount }) {
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (!window.confirm(`¿Eliminar la cuenta "${account.name}"? Sus movimientos se conservan, pero la cuenta dejará de aparecer.`)) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteAccount(account.id);
        toast.success("Cuenta eliminada");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            disabled={isPending}
            aria-label="Acciones de la cuenta"
          >
            <MoreVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil size={14} /> Editar
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
            <Trash2 size={14} /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountFormDialog account={account} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
