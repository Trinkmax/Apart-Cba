"use client";

import { useState, useTransition } from "react";
import { Loader2, Info } from "lucide-react";
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
import {
  AccessCredentialDialog, type AccessCredential,
} from "@/components/team/access-credential-dialog";
import { ROLE_META } from "@/lib/constants";

export function InviteDialog({ orgName, children }: { orgName: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [credential, setCredential] = useState<AccessCredential | null>(null);
  const [alreadyHadAccess, setAlreadyHadAccess] = useState(false);
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

  /**
   * Sube el DNI DESPUÉS de mostrar la contraseña, no antes: si falla el storage
   * el aviso llega por su propio toast y nunca tapa el único momento en que la
   * clave está a la vista.
   */
  async function uploadDniFiles(userId: string) {
    const sides: { side: "front" | "back"; file: File }[] = [];
    if (dniFront) sides.push({ side: "front", file: dniFront });
    if (dniBack) sides.push({ side: "back", file: dniBack });
    if (sides.length === 0) return;

    setUploadingDni(true);
    try {
      const results = await Promise.all(
        sides.map(async ({ side, file }) => {
          const fd = new FormData();
          fd.append("userId", userId);
          fd.append("side", side);
          fd.append("file", file);
          const res = await uploadDni(fd);
          return { side, ok: res.ok };
        })
      );
      const failed = results.filter((x) => !x.ok).map((x) => x.side);
      if (failed.length > 0) {
        const labels = failed
          .map((s) => (s === "front" ? "frente" : "dorso"))
          .join(" y ");
        toast.warning("El DNI no se pudo subir", {
          description: `No se pudo subir el ${labels} del DNI. Podés cargarlo después desde Equipo.`,
        });
      }
    } catch (e) {
      toast.warning("El DNI no se pudo subir", { description: (e as Error).message });
    } finally {
      setUploadingDni(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await inviteTeamMember(form);

        if (r.tempPassword) {
          // Cerramos el form y abrimos el diálogo de entrega: un solo diálogo
          // a la vez, y el de la contraseña no se cierra sin confirmar.
          setOpen(false);
          setCredential({
            fullName: form.full_name,
            email: form.email,
            password: r.tempPassword,
          });
        } else if (r.alreadyHadAccess) {
          setAlreadyHadAccess(true);
        } else {
          toast.success("Usuario agregado a la organización");
          setOpen(false);
        }

        // En paralelo: no bloquea la entrega del acceso.
        void uploadDniFiles(r.userId);
        router.refresh();
      } catch (e) {
        setUploadingDni(false);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function reset() {
    setOpen(false);
    setAlreadyHadAccess(false);
    setUploadingDni(false);
    setForm({ email: "", full_name: "", role: "recepcion", phone: "" });
    setDniFront(null);
    setDniBack(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{alreadyHadAccess ? "Ya estaba en el sistema" : "Invitar usuario"}</DialogTitle>
          </DialogHeader>

          {alreadyHadAccess ? (
            <div className="space-y-4 mt-2">
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-4">
                <Info className="size-5 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium">{form.full_name}</span> ya tenía cuenta
                    con ese email y contraseña propia, así que se la dejamos como está.
                    Ya quedó agregada al equipo con el rol elegido.
                  </p>
                  <p className="text-muted-foreground">
                    Si perdió la contraseña, entrá al menú <span className="font-mono">⋯</span> de
                    la lista y usá &laquo;Regenerar contraseña&raquo;.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={reset} className="w-full">Entendido</Button>
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

      <AccessCredentialDialog
        credential={credential}
        orgName={orgName}
        onClose={() => { setCredential(null); reset(); }}
      />
    </>
  );
}
