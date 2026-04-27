"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createUnit, updateUnit, type UnitInput } from "@/lib/actions/units";
import { UNIT_STATUSES, UNIT_STATUS_META } from "@/lib/constants";
import type { Unit, Owner } from "@/lib/types/database";

interface UnitFormDialogProps {
  children: React.ReactNode;
  unit?: Unit;
  owners?: Owner[];
}

export function UnitFormDialog({ children, unit }: UnitFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!unit;

  const initialForm: UnitInput = {
    code: unit?.code ?? "",
    name: unit?.name ?? "",
    address: unit?.address ?? "",
    neighborhood: unit?.neighborhood ?? "",
    floor: unit?.floor ?? "",
    apartment: unit?.apartment ?? "",
    bedrooms: unit?.bedrooms ?? null,
    bathrooms: unit?.bathrooms ?? null,
    max_guests: unit?.max_guests ?? 2,
    size_m2: unit?.size_m2 ?? null,
    base_price: unit?.base_price ?? null,
    base_price_currency: unit?.base_price_currency ?? "ARS",
    cleaning_fee: unit?.cleaning_fee ?? null,
    default_commission_pct: unit?.default_commission_pct ?? 20,
    status: unit?.status ?? "disponible",
    description: unit?.description ?? "",
    notes: unit?.notes ?? "",
  };
  const [form, setForm] = useState<UnitInput>(initialForm);

  function set<K extends keyof UnitInput>(key: K, value: UnitInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && unit) {
          await updateUnit(unit.id, form);
          toast.success("Unidad actualizada");
        } else {
          await createUnit(form);
          toast.success("Unidad creada");
          setForm(initialForm);
        }
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar unidad" : "Nueva unidad"}</DialogTitle>
          <DialogDescription>
            Cargá los datos de la unidad. El estado define en qué columna del Kanban aparece.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2">
          <Tabs defaultValue="basico" className="w-full">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="basico">Básico</TabsTrigger>
              <TabsTrigger value="caracteristicas">Características</TabsTrigger>
              <TabsTrigger value="precios">Precios</TabsTrigger>
            </TabsList>

            <TabsContent value="basico" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Código *</Label>
                  <Input
                    id="code"
                    required
                    value={form.code}
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                    placeholder="NUE-401"
                    autoFocus
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input
                    id="name"
                    required
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Loft Nueva Córdoba"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  value={form.address ?? ""}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Av. Hipólito Yrigoyen 555"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="neighborhood">Barrio</Label>
                  <Input
                    id="neighborhood"
                    value={form.neighborhood ?? ""}
                    onChange={(e) => set("neighborhood", e.target.value)}
                    placeholder="Nueva Córdoba"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="floor">Piso</Label>
                  <Input
                    id="floor"
                    value={form.floor ?? ""}
                    onChange={(e) => set("floor", e.target.value)}
                    placeholder="4°"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apartment">Depto</Label>
                  <Input
                    id="apartment"
                    value={form.apartment ?? ""}
                    onChange={(e) => set("apartment", e.target.value)}
                    placeholder="B"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">Estado inicial</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v as UnitInput["status"])}>
                  <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <span className="status-dot" style={{ backgroundColor: UNIT_STATUS_META[s].color }} />
                          {UNIT_STATUS_META[s].label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Descripción para huéspedes / promoción"
                  rows={3}
                />
              </div>
            </TabsContent>

            <TabsContent value="caracteristicas" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bedrooms">Dormitorios</Label>
                  <Input
                    id="bedrooms"
                    type="number"
                    min="0"
                    value={form.bedrooms ?? ""}
                    onChange={(e) => set("bedrooms", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bathrooms">Baños</Label>
                  <Input
                    id="bathrooms"
                    type="number"
                    min="0"
                    value={form.bathrooms ?? ""}
                    onChange={(e) => set("bathrooms", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_guests">Capacidad max.</Label>
                  <Input
                    id="max_guests"
                    type="number"
                    min="1"
                    value={form.max_guests ?? ""}
                    onChange={(e) => set("max_guests", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="size_m2">Superficie (m²)</Label>
                  <Input
                    id="size_m2"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.size_m2 ?? ""}
                    onChange={(e) => set("size_m2", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas internas</Label>
                <Textarea
                  id="notes"
                  value={form.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Acceso, llaves, observaciones..."
                  rows={3}
                />
              </div>
            </TabsContent>

            <TabsContent value="precios" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="base_price_currency">Moneda</Label>
                  <Select
                    value={form.base_price_currency}
                    onValueChange={(v) => set("base_price_currency", v)}
                  >
                    <SelectTrigger id="base_price_currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS — Pesos</SelectItem>
                      <SelectItem value="USD">USD — Dólares</SelectItem>
                      <SelectItem value="EUR">EUR — Euros</SelectItem>
                      <SelectItem value="USDT">USDT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="base_price">Precio por noche</Label>
                  <Input
                    id="base_price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.base_price ?? ""}
                    onChange={(e) => set("base_price", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cleaning_fee">Fee limpieza</Label>
                  <Input
                    id="cleaning_fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cleaning_fee ?? ""}
                    onChange={(e) => set("cleaning_fee", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="default_commission_pct">Comisión Apart Cba (%)</Label>
                  <Input
                    id="default_commission_pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.default_commission_pct}
                    onChange={(e) => set("default_commission_pct", Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                La comisión por defecto se puede sobreescribir en cada reserva.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? "Guardar cambios" : "Crear unidad"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
