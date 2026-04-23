"use client";

import { useState, useTransition } from "react";
import { Loader2, Copy, CheckCircle2, Building2, UserCog } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createOrganizationWithAdmin } from "@/lib/actions/superadmin";

const COLORS = ["#0F766E", "#3B82F6", "#A855F7", "#EC4899", "#F59E0B", "#10B981", "#EF4444", "#1E293B"];

export function CreateOrgDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("org");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [done, setDone] = useState<{ tempPassword: string; email: string } | null>(null);

  const [org, setOrg] = useState({
    name: "",
    slug: "",
    legal_name: "",
    tax_id: "",
    default_currency: "ARS",
    default_commission_pct: 20,
    primary_color: "#0F766E",
    timezone: "America/Argentina/Cordoba",
  });

  const [admin, setAdmin] = useState({
    full_name: "",
    email: "",
    password: "",
    phone: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (admin.password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    startTransition(async () => {
      try {
        const r = await createOrganizationWithAdmin({
          org: {
            ...org,
            slug: org.slug || undefined,
          },
          admin,
        });
        setDone({ tempPassword: r.tempPassword!, email: admin.email });
        toast.success("Organización creada");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function reset() {
    setOpen(false);
    setDone(null);
    setTab("org");
    setOrg({
      name: "", slug: "", legal_name: "", tax_id: "",
      default_currency: "ARS", default_commission_pct: 20,
      primary_color: "#0F766E", timezone: "America/Argentina/Cordoba",
    });
    setAdmin({ full_name: "", email: "", password: "", phone: "" });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{done ? "Organización creada" : "Nueva organización"}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-3 flex-1">
                  <p className="text-sm font-medium">
                    Organización creada con éxito. Pasale al admin estos datos:
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">URL de login</Label>
                    <Input readOnly value={`${typeof window !== "undefined" ? window.location.origin : ""}/login`} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input readOnly value={done.email} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contraseña</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={done.tempPassword} className="font-mono text-xs" />
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(done.tempPassword);
                          toast.success("Copiado");
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={reset} className="w-full">Listo</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-2">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="org" className="gap-2"><Building2 size={14} /> 1. Organización</TabsTrigger>
                <TabsTrigger value="admin" className="gap-2"><UserCog size={14} /> 2. Admin inicial</TabsTrigger>
              </TabsList>

              <TabsContent value="org" className="space-y-4 mt-4">
                <div className="space-y-1.5">
                  <Label>Nombre *</Label>
                  <Input
                    required
                    autoFocus
                    value={org.name}
                    onChange={(e) => setOrg({ ...org, name: e.target.value })}
                    placeholder="Apartments Mendoza"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Slug (URL)</Label>
                    <Input
                      value={org.slug}
                      onChange={(e) => setOrg({ ...org, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                      placeholder="auto-genera del nombre"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tax ID / CUIT</Label>
                    <Input
                      value={org.tax_id}
                      onChange={(e) => setOrg({ ...org, tax_id: e.target.value })}
                      placeholder="20-12345678-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Razón social</Label>
                  <Input
                    value={org.legal_name}
                    onChange={(e) => setOrg({ ...org, legal_name: e.target.value })}
                    placeholder="Apartments Mendoza S.R.L."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Moneda default</Label>
                    <Select value={org.default_currency} onValueChange={(v) => setOrg({ ...org, default_currency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USDT">USDT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Comisión Apart Cba (%)</Label>
                    <Input
                      type="number"
                      min="0" max="100" step="0.01"
                      value={org.default_commission_pct}
                      onChange={(e) => setOrg({ ...org, default_commission_pct: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Color de marca</Label>
                  <div className="flex gap-2 flex-wrap">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setOrg({ ...org, primary_color: c })}
                        className="size-9 rounded-md transition-all"
                        style={{
                          backgroundColor: c,
                          boxShadow: org.primary_color === c ? `0 0 0 2px ${c}, 0 0 0 4px white` : undefined,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={() => setTab("admin")}
                    disabled={!org.name}
                  >
                    Siguiente: Admin inicial →
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="admin" className="space-y-4 mt-4">
                <p className="text-xs text-muted-foreground">
                  Esta cuenta será el administrador principal de <strong>{org.name || "la organización"}</strong>.
                  Va a poder invitar al resto del equipo.
                </p>

                <div className="space-y-1.5">
                  <Label>Nombre completo *</Label>
                  <Input
                    required
                    value={admin.full_name}
                    onChange={(e) => setAdmin({ ...admin, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input
                    required type="email"
                    value={admin.email}
                    onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input
                    value={admin.phone}
                    onChange={(e) => setAdmin({ ...admin, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contraseña inicial (8+ caracteres) *</Label>
                  <Input
                    required type="text"
                    minLength={8}
                    value={admin.password}
                    onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                    placeholder="La verás después para pasarla al usuario"
                    className="font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    El admin debería cambiarla en su primer ingreso.
                  </p>
                </div>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setTab("org")}>
                    ← Volver
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending && <Loader2 className="animate-spin" />}
                    Crear organización
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
