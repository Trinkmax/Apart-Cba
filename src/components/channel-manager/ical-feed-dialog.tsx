"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Copy, Check, ArrowLeftRight } from "lucide-react";
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
import { UnitCombobox } from "@/components/ui/unit-combobox";
import { createIcalFeed, type IcalFeedInput } from "@/lib/actions/ical";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { Unit } from "@/lib/types/database";

interface Props {
  units: Pick<Unit, "id" | "code" | "name">[];
  /** Feeds ya conectados — para ocultar unidades ya vinculadas a esa plataforma. */
  connectedFeeds?: { unitId: string; source: string }[];
  /** unitId → link .ics de export, para la sincronización bidireccional. */
  exportUrlByUnit?: Record<string, string>;
}

export function IcalFeedDialog({ units, connectedFeeds = [], exportUrlByUnit = {} }: Props) {
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

  // Al cambiar de plataforma reseteamos la unidad: la lista disponible cambia.
  function changeSource(v: IcalFeedInput["source"]) {
    setForm((f) => ({ ...f, source: v, unit_id: "" }));
  }

  // Ocultamos las unidades que ya tienen un feed de ESTA plataforma, así la
  // lista se va achicando a medida que conectás y no las repetís.
  const connectedForSource = useMemo(() => {
    const ids = new Set<string>();
    for (const c of connectedFeeds) if (c.source === form.source) ids.add(c.unitId);
    return ids;
  }, [connectedFeeds, form.source]);

  const availableUnits = useMemo(
    () => units.filter((u) => !connectedForSource.has(u.id)),
    [units, connectedForSource],
  );

  const sourceLabel = BOOKING_SOURCE_META[form.source].label;

  // Link .ics de la unidad elegida — para pegar en Airbnb (Paso 2, sync bidireccional).
  const [copiedExport, setCopiedExport] = useState(false);
  const selectedExportUrl = form.unit_id ? exportUrlByUnit[form.unit_id] : undefined;

  function copyExport() {
    if (!selectedExportUrl) return;
    navigator.clipboard.writeText(selectedExportUrl);
    setCopiedExport(true);
    toast.success("Link copiado", {
      description: "Pegalo en Airbnb → Paso 2 («Enlace a otro sitio web»)",
    });
    setTimeout(() => setCopiedExport(false), 2000);
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
              <UnitCombobox
                units={availableUnits}
                value={form.unit_id}
                onChange={(id) => set("unit_id", id ?? "")}
                placeholder="Elegí la unidad"
              />
              {availableUnits.length === 0 ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ Todas las unidades ya están conectadas a {sourceLabel}.
                </p>
              ) : connectedForSource.size > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {availableUnits.length} sin conectar · {connectedForSource.size} ya en {sourceLabel}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Plataforma</Label>
              <Select value={form.source} onValueChange={(v) => changeSource(v as IcalFeedInput["source"])}>
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

            {selectedExportUrl && (
              <div className="rounded-lg border border-dashed bg-muted/40 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <ArrowLeftRight className="size-4 shrink-0 text-primary mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-medium">Sync bidireccional:</span>{" "}
                    <span className="text-muted-foreground">
                      copiá este link y pegalo en Airbnb →{" "}
                      <b className="font-medium text-foreground/80">Paso 2</b>{" "}
                      («Enlace a otro sitio web»).
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    readOnly
                    value={selectedExportUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="font-mono text-[11px] h-8"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyExport}
                    className="gap-1.5 shrink-0 h-8"
                  >
                    {copiedExport ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copiar
                  </Button>
                </div>
              </div>
            )}

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
