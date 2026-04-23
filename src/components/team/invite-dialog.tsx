"use client";

import { useState, useTransition } from "react";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { inviteTeamMember, type InviteInput } from "@/lib/actions/team";
import { ROLE_META } from "@/lib/constants";

export function InviteDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [form, setForm] = useState<InviteInput>({
    email: "",
    full_name: "",
    role: "recepcion",
    phone: "",
  });

  function set<K extends keyof InviteInput>(k: K, v: InviteInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await inviteTeamMember(form);
        if (r.tempPassword) {
          setTempPassword(r.tempPassword);
          toast.success("Usuario invitado con contraseña temporal");
        } else {
          toast.success("Usuario agregado a la organización");
          setOpen(false);
        }
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function reset() {
    setOpen(false);
    setTempPassword(null);
    setForm({ email: "", full_name: "", role: "recepcion", phone: "" });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tempPassword ? "Usuario creado" : "Invitar usuario"}</DialogTitle>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Listo. Pasale al usuario:</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input readOnly value={form.email} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contraseña temporal</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={tempPassword} className="font-mono text-xs" />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(tempPassword);
                          toast.success("Copiado");
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    El usuario debería cambiarla en su primer ingreso.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={reset} className="w-full">Listo</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nombre completo *</Label>
              <Input required autoFocus value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="usuario@apartcba.com.ar" />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v as InviteInput["role"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <div>
                        <div className="font-medium" style={{ color: m.color }}>{m.label}</div>
                        <div className="text-[10px] text-muted-foreground">{m.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Invitar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
