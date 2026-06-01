"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UnitCombobox } from "@/components/ui/unit-combobox";
import { createOtaListing, updateOtaListing } from "@/lib/actions/ota-listings";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { OtaListing, OtaProvider, Unit } from "@/lib/types/database";

interface Props {
  units: Pick<Unit, "id" | "code" | "name">[];
  editing?: OtaListing | null;
  triggerVariant?: "primary" | "icon";
}

const HINT_BY_PROVIDER: Record<OtaProvider, { label: string; placeholder: string; help: string }> = {
  airbnb: {
    label: "ID de Airbnb",
    placeholder: "Ej: 50432101",
    help: "Es el número en la URL del listing: airbnb.com/rooms/<este número>",
  },
  booking: {
    label: "Slug de Booking",
    placeholder: "Ej: apartcba-deluxe-loft",
    help: "Es el slug en la URL: booking.com/hotel/ar/<este slug>.html",
  },
  expedia: {
    label: "ID de Expedia",
    placeholder: "Property ID",
    help: "ID numérico del listing en Expedia",
  },
  vrbo: {
    label: "ID de VRBO",
    placeholder: "Property ID",
    help: "ID del listing en VRBO",
  },
  otro: {
    label: "Identificador externo",
    placeholder: "Cualquier ID estable",
    help: "Texto libre que la OTA incluya consistentemente en sus emails",
  },
};

const EMPTY_FORM = {
  unit_id: "",
  provider: "airbnb" as OtaProvider,
  external_listing_id: "",
  external_listing_url: "",
  external_account_email: "",
  label: "",
};

export function OtaListingDialog({ units, editing = null, triggerVariant = "primary" }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [form, setForm] = useState(EMPTY_FORM);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(
        editing
          ? {
              unit_id: editing.unit_id,
              provider: editing.provider,
              external_listing_id: editing.external_listing_id,
              external_listing_url: editing.external_listing_url ?? "",
              external_account_email: editing.external_account_email ?? "",
              label: editing.label ?? "",
            }
          : EMPTY_FORM,
      );
    }
  }

  const noUnits = units.length === 0;
  const hint = HINT_BY_PROVIDER[form.provider];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        unit_id: form.unit_id,
        provider: form.provider,
        external_listing_id: form.external_listing_id.trim(),
        external_listing_url: form.external_listing_url.trim() || null,
        external_account_email: form.external_account_email.trim() || null,
        label: form.label.trim() || null,
      };
      const res = editing
        ? await updateOtaListing({ id: editing.id, ...payload })
        : await createOtaListing(payload);
      if (!res.ok) {
        toast.error("No se pudo guardar", { description: res.error });
        return;
      }
      toast.success(editing ? "Mapeo actualizado" : "Mapeo creado");
      setOpen(false);
      if (!editing) setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  return (
    <>
      {triggerVariant === "primary" ? (
        <Button
          type="button"
          className="gap-2"
          disabled={noUnits}
          onClick={() => {
            if (noUnits) {
              toast.error("Creá una unidad primero");
              return;
            }
            handleOpenChange(true);
          }}
        >
          <Plus size={16} /> Mapear listing
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => handleOpenChange(true)}
          title="Editar mapeo"
        >
          <Pencil size={14} />
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar mapeo" : "Mapear listing externo"}</DialogTitle>
            <DialogDescription>
              Asociá una unidad con su listing en una OTA. Cuando llegue una reserva por email,
              el sistema usa este mapeo para identificar la unidad correcta.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <UnitCombobox
                units={units}
                value={form.unit_id}
                onChange={(id) => setForm((f) => ({ ...f, unit_id: id ?? "" }))}
                placeholder="Elegí la unidad"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plataforma</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm((f) => ({ ...f, provider: v as OtaProvider }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["airbnb", "booking", "expedia", "vrbo", "otro"] as const).map((s) => (
                    <SelectItem key={s} value={s}>{BOOKING_SOURCE_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{hint.label}</Label>
              <Input
                required
                value={form.external_listing_id}
                onChange={(e) => setForm((f) => ({ ...f, external_listing_id: e.target.value }))}
                placeholder={hint.placeholder}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">{hint.help}</p>
            </div>

            <div className="space-y-1.5">
              <Label>URL del listing (opcional)</Label>
              <Input
                type="url"
                value={form.external_listing_url}
                onChange={(e) => setForm((f) => ({ ...f, external_listing_url: e.target.value }))}
                placeholder="https://airbnb.com/rooms/..."
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email de la cuenta en la OTA (opcional)</Label>
              <Input
                type="email"
                value={form.external_account_email}
                onChange={(e) => setForm((f) => ({ ...f, external_account_email: e.target.value }))}
                placeholder="host@ejemplo.com"
              />
              <p className="text-[11px] text-muted-foreground">
                Útil si tenés varias cuentas de host en la misma OTA.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Etiqueta (opcional)</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Cuenta principal, secundaria…"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {editing ? "Guardar" : "Mapear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
