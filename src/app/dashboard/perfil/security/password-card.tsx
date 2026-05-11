"use client";

import { useState, useTransition } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { changePassword } from "@/lib/actions/security";

export function PasswordCard() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    startTransition(async () => {
      const result = await changePassword({ currentPassword: current, newPassword: newPwd });
      if (!result.ok) {
        toast.error("Error al cambiar contraseña", { description: result.error });
        return;
      }
      toast.success("Contraseña actualizada — te enviamos un mail de aviso");
      setOpen(false);
      setCurrent("");
      setNewPwd("");
      setConfirm("");
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Lock size={14} /> Contraseña
          </h3>
          <p className="text-sm text-muted-foreground">
            Cambiala periódicamente. Te avisamos por mail cada vez que la actualices.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Cambiar</Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>
              Te vamos a pedir tu contraseña actual antes de aplicar el cambio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cur_pwd">Contraseña actual</Label>
              <Input
                id="cur_pwd"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_pwd">Nueva contraseña</Label>
              <Input
                id="new_pwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Mínimo 8 caracteres, con letra y número.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conf_pwd">Confirmar nueva contraseña</Label>
              <Input
                id="conf_pwd"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Cambiar contraseña
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
