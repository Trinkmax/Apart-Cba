"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Phone, UserPlus, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  removeParteDiarioRecipient,
  upsertParteDiarioRecipient,
} from "@/lib/actions/parte-diario";
import type { ParteDiarioRecipient } from "@/lib/types/database";

interface RecipientsManagerProps {
  initial: ParteDiarioRecipient[];
}

export function RecipientsManager({ initial }: RecipientsManagerProps) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<ParteDiarioRecipient | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = (next: ParteDiarioRecipient) => {
    setList((prev) => {
      const idx = prev.findIndex((r) => r.id === next.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      }
      return [next, ...prev];
    });
  };

  const handleToggleActive = (r: ParteDiarioRecipient) => {
    setList((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    startTransition(async () => {
      try {
        const updated = await upsertParteDiarioRecipient(
          {
            phone: r.phone,
            label: r.label,
            user_id: r.user_id,
            active: !r.active,
          },
          r.id,
        );
        refresh(updated);
      } catch (err) {
        toast.error("No se pudo cambiar", { description: (err as Error).message });
        setList((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: r.active } : x)));
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await removeParteDiarioRecipient(id);
        setList((prev) => prev.filter((r) => r.id !== id));
        toast.success("Destinatario eliminado");
        setDeletingId(null);
      } catch (err) {
        toast.error("No se pudo eliminar", { description: (err as Error).message });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Lista de difusión</h2>
          <p className="text-sm text-muted-foreground">
            Cuando se envía el parte, el PDF llega individualmente a cada destinatario activo.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="size-3.5" />
          Agregar
        </Button>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {list.length === 0 ? (
          <div className="p-10 text-center">
            <UserPlus className="size-8 mx-auto text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sin destinatarios todavía. Agregá al equipo de limpieza, mantenimiento y recepción.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {list.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 transition-colors",
                  !r.active && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">
                      {r.label ?? "Sin etiqueta"}
                    </span>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <Phone className="size-3" />
                    <span className="font-mono tabular-nums">+{r.phone}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => handleToggleActive(r)}
                    title={r.active ? "Desactivar" : "Activar"}
                    disabled={pending}
                  >
                    <Power
                      className={cn(
                        "size-3.5",
                        r.active ? "text-emerald-500" : "text-muted-foreground",
                      )}
                    />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    onClick={() => setEditing(r)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setDeletingId(r.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecipientFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={refresh}
        initial={null}
      />
      <RecipientFormDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={(r) => {
          refresh(r);
          setEditing(null);
        }}
        initial={editing}
      />

      <AlertDialog open={!!deletingId} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar destinatario?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de recibir el parte diario. Esta acción es reversible — podés volver a agregarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && handleDelete(deletingId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface RecipientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ParteDiarioRecipient | null;
  onSaved: (r: ParteDiarioRecipient) => void;
}

function RecipientFormDialog({ open, onOpenChange, initial, onSaved }: RecipientFormDialogProps) {
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [pending, startTransition] = useTransition();

  // Reset cuando se abre/cierra
  if (open && initial && phone === "" && initial.phone !== "") {
    setPhone(initial.phone);
    setLabel(initial.label ?? "");
    setActive(initial.active);
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const saved = await upsertParteDiarioRecipient(
          { phone, label: label || null, active },
          initial?.id,
        );
        toast.success(initial ? "Actualizado" : "Agregado");
        onSaved(saved);
        if (!initial) {
          setPhone("");
          setLabel("");
          setActive(true);
        }
        onOpenChange(false);
      } catch (err) {
        toast.error("No se pudo guardar", { description: (err as Error).message });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar destinatario" : "Agregar destinatario"}</DialogTitle>
          <DialogDescription>
            Ingresá el teléfono en formato internacional (ej: 5493514567890).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-phone">Teléfono</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                +
              </span>
              <Input
                id="r-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="5493514567890"
                inputMode="tel"
                className="pl-6 font-mono tabular-nums"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-label">Etiqueta</Label>
            <Input
              id="r-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Deysy (limpieza)"
            />
            <p className="text-[11px] text-muted-foreground">
              Aparece en el saludo del WhatsApp ({"{{1}}"} de la plantilla).
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Activo</p>
              <p className="text-xs text-muted-foreground">
                Si está apagado, no recibe partes hasta que lo reactives.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
