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
import { uploadDni } from "@/lib/actions/team-dni";
import { DniInvitePicker } from "@/components/team/dni-invite-picker";
import { ROLE_META } from "@/lib/constants";

export function InviteDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [uploadingDni, setUploadingDni] = useState(false);

  const [form, setForm] = useState<InviteInput>({
    email: "",
    full_name: "",
    role: "recepcion",
    phone: "",
  });

  const [dniFront, setDniFront] = useState<File | null>(null);
  const [dniBack, setDniBack] = useState<File | null>(null);

  function set<K extends keyof InviteInput>(k: K, v: InviteInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setDni(side: "front" | "back", file: File | null) {
    if (side === "front") setDniFront(file);
    else setDniBack(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await inviteTeamMember(form);

        // El usuario ya existe: subimos cada lado del DNI adjuntado en
        // paralelo, reutilizando el server action `uploadDni`.
        const sides: { side: "front" | "back"; file: File }[] = [];
        if (dniFront) sides.push({ side: "front", file: dniFront });
        if (dniBack) sides.push({ side: "back", file: dniBack });

        if (sides.length > 0) {
          setUploadingDni(true);
          const results = await Promise.all(
            sides.map(async ({ side, file }) => {
              const fd = new FormData();
              fd.append("userId", r.userId);
              fd.append("side", side);
              fd.append("file", file);
              const res = await uploadDni(fd);
              return { side, ok: res.ok };
            })
          );
          setUploadingDni(false);

          const failed = results.filter((x) => !x.ok).map((x) => x.side);
          if (failed.length > 0) {
            const labels = failed
              .map((s) => (s === "front" ? "frente" : "dorso"))
              .join(" y ");
            toast.warning("El DNI no se pudo subir", {
              description: `No se pudo subir el ${labels} del DNI. Podés cargarlo después desde Equipo.`,
            });
          }
        }

        if (r.tempPassword) {
          setTempPassword(r.tempPassword);
          toast.success("Usuario invitado con contraseña temporal");
        } else {
          toast.success("Usuario agregado a la organización");
          setOpen(false);
        }
        router.refresh();
      } catch (e) {
        setUploadingDni(false);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function reset() {
    setOpen(false);
    setTempPassword(null);
    setUploadingDni(false);
    setForm({ email: "", full_name: "", role: "recepcion", phone: "" });
    setDniFront(null);
    setDniBack(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
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

            <DniInvitePicker
              frontFile={dniFront}
              backFile={dniBack}
              onChange={setDni}
              disabled={isPending}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {uploadingDni ? "Subiendo DNI…" : "Invitar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
