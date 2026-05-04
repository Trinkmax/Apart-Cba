"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
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
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountFormDialog } from "@/components/cash/account-form-dialog";
import { deleteAccount } from "@/lib/actions/cash";
import { formatMoney } from "@/lib/format";
import type { CashAccount } from "@/lib/types/database";

interface Props {
  accounts: CashAccount[];
  balances: number[];
  canManage: boolean;
}

export function AccountsGrid({ accounts, balances, canManage }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<CashAccount | null>(null);
  const [deleting, setDeleting] = useState<CashAccount | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function handleConfirmDelete() {
    if (!deleting) return;
    const target = deleting;
    startDelete(async () => {
      try {
        await deleteAccount(target.id);
        toast.success("Cuenta eliminada");
        setDeleting(null);
        router.refresh();
      } catch (e) {
        toast.error("Error al eliminar", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((acc, i) => (
          <div key={acc.id} className="relative group">
            <Link
              href={`/dashboard/caja/${acc.id}`}
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
              aria-label={`Ver detalle de ${acc.name}`}
            >
              <Card className="p-4 hover:shadow-md hover:border-primary/40 transition-all">
                <div className="flex items-center gap-2 min-w-0 pr-9">
                  <div
                    className="size-8 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0"
                    style={{ backgroundColor: acc.color ?? "#0F766E" }}
                  >
                    <Wallet size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{acc.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {acc.type} · {acc.currency}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatMoney(balances[i], acc.currency)}
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
                  />
                </div>
              </Card>
            </Link>

            {canManage && (
              <div className="absolute top-3 right-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 bg-background/60 backdrop-blur-sm hover:bg-background"
                      aria-label={`Acciones de ${acc.name}`}
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setEditing(acc);
                      }}
                    >
                      <Pencil size={14} /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        setDeleting(acc);
                      }}
                    >
                      <Trash2 size={14} /> Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modales únicos a nivel del grid — fuera del subárbol del Link de cada card */}
      {editing && (
        <AccountFormDialog
          key={editing.id}
          account={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cuenta</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Querés eliminar la cuenta <strong>{deleting?.name}</strong>? Sus movimientos se conservan,
              pero la cuenta dejará de aparecer en el listado y no podrás registrar nuevos movimientos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
