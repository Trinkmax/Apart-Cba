"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
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
import { requestEmailChange } from "@/lib/actions/security";

interface Props {
  email: string;
}

export function EmailCard({ email }: Props) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestEmailChange({ newEmail: newEmail.trim(), currentPassword: pwd });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success(`Te enviamos un mail a ${newEmail.trim()}. Confirmalo en las próximas 24hs.`);
      setOpen(false);
      setNewEmail("");
      setPwd("");
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail size={14} /> Email
          </h3>
          <p className="text-sm text-muted-foreground">
            Email actual: <span className="font-mono">{email}</span>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Cambiar</Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar email</DialogTitle>
            <DialogDescription>
              Te vamos a enviar un link de confirmación al nuevo email. También notificamos al email
              actual con un link para cancelar (por si no fuiste vos).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new_email">Nuevo email</Label>
              <Input
                id="new_email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email_pwd">Contraseña actual</Label>
              <Input
                id="email_pwd"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Solicitar cambio
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
