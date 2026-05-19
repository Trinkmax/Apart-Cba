"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Phone, Mail, Building2, ChevronDown, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { getInitials, CURRENCY_LABELS } from "@/lib/format";
import { deleteOwner } from "@/lib/actions/owners";
import type { OwnerListItem } from "@/lib/actions/owners";

interface OwnersListClientProps {
  owners: OwnerListItem[];
}

export function OwnersListClient({ owners }: OwnersListClientProps) {
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!query.trim()) return owners;
    const q = query.toLowerCase();
    return owners.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        (o.email?.toLowerCase().includes(q) ?? false) ||
        (o.phone?.includes(q) ?? false) ||
        (o.document_number?.includes(q) ?? false)
    );
  }, [owners, query]);

  const deletingOwner = deletingId
    ? owners.find((o) => o.id === deletingId)
    : null;

  function handleDelete() {
    if (!deletingId) return;
    startTransition(async () => {
      try {
        await deleteOwner(deletingId);
        toast.success("Propietario eliminado");
        setDeletingId(null);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email, teléfono o DNI…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 h-10"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No hay propietarios todavía</p>
          <p className="text-xs text-muted-foreground mt-1">
            {query ? "Probá con otra búsqueda" : "Agregá el primero con el botón de arriba"}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((owner) => {
            const units = owner.unit_owners ?? [];
            return (
              <Card
                key={owner.id}
                className="group relative p-4 transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 z-10 size-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeletingId(owner.id)}
                >
                  <Trash2 size={14} />
                </Button>

                <Link
                  href={`/dashboard/propietarios/${owner.id}`}
                  className="block outline-none after:absolute after:inset-0"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="size-11 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {getInitials(owner.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate pr-6">{owner.full_name}</h3>
                      <div className="flex flex-col gap-1 mt-2">
                        {owner.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Phone size={11} />
                            <span className="truncate">{owner.phone}</span>
                          </div>
                        )}
                        {owner.email && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Mail size={11} />
                            <span className="truncate">{owner.email}</span>
                          </div>
                        )}
                      </div>
                      {owner.preferred_currency &&
                        owner.preferred_currency !== "ARS" &&
                        owner.preferred_currency !== "ARS_EFECTIVO" && (
                          <Badge variant="secondary" className="mt-2 text-[10px] h-5">
                            Cobra en {CURRENCY_LABELS[owner.preferred_currency] ?? owner.preferred_currency}
                          </Badge>
                        )}
                    </div>
                  </div>
                </Link>

                {units.length > 0 && (
                  <div className="relative z-10 mt-3 pt-2 border-t border-border/50 ml-14">
                    {units.length === 1 ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 size={12} className="shrink-0" />
                        <span className="truncate">
                          {units[0].unit.code}
                          {units[0].unit.name ? ` — ${units[0].unit.name}` : ""}
                        </span>
                      </div>
                    ) : (
                      <Collapsible>
                        <CollapsibleTrigger className="group/units flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                          <Building2 size={12} className="shrink-0" />
                          <span>{units.length} departamentos</span>
                          <ChevronDown
                            size={12}
                            className="ml-auto shrink-0 transition-transform group-data-[state=open]/units:rotate-180"
                          />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-1.5 space-y-1 pl-[18px]">
                            {units.map((uo) => (
                              <div key={uo.unit.id} className="text-xs text-muted-foreground">
                                {uo.unit.code}
                                {uo.unit.name ? ` — ${uo.unit.name}` : ""}
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar propietario?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará a <strong>{deletingOwner?.full_name}</strong> permanentemente.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending && <Loader2 className="animate-spin mr-2" size={14} />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
