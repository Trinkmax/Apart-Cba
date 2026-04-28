"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createIcalFeed, type IcalFeedInput } from "@/lib/actions/ical";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { Unit } from "@/lib/types/database";

interface Props {
  units: Pick<Unit, "id" | "code" | "name">[];
}

export function IcalFeedDialog({ units }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<IcalFeedInput>({
    unit_id: "",
    source: "airbnb",
    label: "",
    feed_url: "",
  });

  const noUnits = units.length === 0;

  function set<K extends keyof IcalFeedInput>(k: K, v: IcalFeedInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createIcalFeed(form);
        toast.success("Feed conectado", {
          description: "Sincronizá ahora para importar las reservas existentes",
        });
        setOpen(false);
        setForm({ unit_id: "", source: "airbnb", label: "", feed_url: "" });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        className="gap-2"
        disabled={noUnits}
        onClick={() => {
          if (noUnits) {
            toast.error("Creá una unidad primero", {
              description: "Andá a Unidades y agregá un departamento antes de conectar feeds",
            });
            return;
          }
          setOpen(true);
        }}
        title={noUnits ? "Creá una unidad antes de conectar feeds" : undefined}
      >
        <Plus size={16} /> Conectar feed
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar feed iCal</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Select value={form.unit_id} onValueChange={(v) => set("unit_id", v)} required>
                <SelectTrigger><SelectValue placeholder="Elegí la unidad" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="font-mono text-xs mr-2">{u.code}</span>{u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Plataforma</Label>
              <Select value={form.source} onValueChange={(v) => set("source", v as IcalFeedInput["source"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["airbnb", "booking", "expedia", "vrbo", "otro"] as const).map((s) => (
                    <SelectItem key={s} value={s}>{BOOKING_SOURCE_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>URL del feed iCal</Label>
              <Input
                required
                type="url"
                value={form.feed_url}
                onChange={(e) => set("feed_url", e.target.value)}
                placeholder="https://www.airbnb.com/calendar/ical/..."
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Etiqueta (opcional)</Label>
              <Input
                value={form.label ?? ""}
                onChange={(e) => set("label", e.target.value)}
                placeholder="Cuenta principal, secundaria…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Conectar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
