"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { createAmenity, type AmenityInput } from "@/lib/actions/amenities";

const ICONS = ["🧻", "☕", "🧼", "🛏️", "🛁", "🍷", "🧴", "🧹", "📦", "💡", "🍴", "👕"];

export function AmenityFormDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<AmenityInput>({
    name: "",
    category: "Consumibles",
    icon: "📦",
    consumable: true,
    unit_label: "unidades",
    default_par_level: 1,
    notes: "",
  });

  function set<K extends keyof AmenityInput>(k: K, v: AmenityInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createAmenity(form);
        toast.success("Item creado");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuevo item del catálogo</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input required autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Toallas, Café, Papel higiénico..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.category ?? ""} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Consumibles">Consumibles</SelectItem>
                  <SelectItem value="Cocina">Cocina</SelectItem>
                  <SelectItem value="Baño">Baño</SelectItem>
                  <SelectItem value="Dormitorio">Dormitorio</SelectItem>
                  <SelectItem value="Tecnología">Tecnología</SelectItem>
                  <SelectItem value="Otros">Otros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Input value={form.unit_label ?? ""} onChange={(e) => set("unit_label", e.target.value)} placeholder="unidades, rollos…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Icono</Label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => set("icon", icon)}
                  className={`size-9 rounded-md border text-lg transition-all hover:bg-accent ${form.icon === icon ? "ring-2 ring-primary border-primary" : "border-border"}`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Stock mínimo</Label>
              <Input type="number" min="0" value={form.default_par_level ?? 1} onChange={(e) => set("default_par_level", Number(e.target.value))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="consumable" className="cursor-pointer text-xs">Consumible</Label>
              <Switch id="consumable" checked={form.consumable} onCheckedChange={(v) => set("consumable", v)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
