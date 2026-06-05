"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Upload, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UnitCombobox } from "@/components/ui/unit-combobox";
import { bulkCreateOtaListings } from "@/lib/actions/ota-listings";
import { fuzzyMatchUnit, parseBulkListingLines } from "@/lib/channel-manager/bulk-listings";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { OtaListing, OtaProvider, Unit } from "@/lib/types/database";

type ImportUnit = Pick<Unit, "id" | "code" | "name"> & { marketplace_title?: string | null };

interface Props {
  units: ImportUnit[];
  existing: Pick<OtaListing, "provider" | "external_listing_id">[];
}

type Row = {
  key: string;
  unitId: string;
  externalId: string;
  externalUrl: string | null;
  raw: string;
  ambiguous: boolean;
};

type RowStatus = "ready" | "no-unit" | "ambiguous" | "no-id" | "dup-existing" | "dup-batch";

const STATUS_META: Record<RowStatus, { label: string; cls: string }> = {
  ready: { label: "Listo", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  "no-unit": { label: "Sin unidad", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  ambiguous: { label: "Elegí unidad", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "no-id": { label: "Sin ID", cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  "dup-existing": { label: "Ya existe", cls: "border-transparent bg-muted text-muted-foreground" },
  "dup-batch": { label: "Repetido", cls: "border-transparent bg-muted text-muted-foreground" },
};

const PLACEHOLDER: Record<OtaProvider, string> = {
  airbnb:
    "Una unidad por línea. Pegá código/nombre + ID (o solo el ID):\nJARDIN-ITU\t50432101\nDiva, airbnb.com/rooms/51234567\n53456789",
  booking:
    "Una unidad por línea (slug de Booking):\nMI-DPTO\tapartcba-deluxe-loft\nOtra unidad, booking.com/hotel/ar/mi-depto.html",
  expedia: "Una unidad por línea: código/nombre + Property ID (o solo el ID).",
  vrbo: "Una unidad por línea: código/nombre + Property ID (o solo el ID).",
  otro: "Una unidad por línea: código/nombre + identificador externo.",
};

export function OtaListingBulkDialog({ units, existing }: Props) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<OtaProvider>("airbnb");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const noUnits = units.length === 0;

  function reset() {
    setText("");
    setRows(null);
    setProvider("airbnb");
  }
  function handleOpenChange(next: boolean) {
    if (next && noUnits) {
      toast.error("Creá una unidad primero");
      return;
    }
    setOpen(next);
    if (!next) reset();
  }

  function handleProvider(next: OtaProvider) {
    setProvider(next);
    setRows(null); // el ID se parsea distinto por proveedor → re-procesar
  }

  function handleProcess() {
    const parsed = parseBulkListingLines(text, provider);
    setRows(
      parsed.map((p, i) => {
        const match = p.unitHint ? fuzzyMatchUnit(p.unitHint, units) : null;
        return {
          key: String(i),
          unitId: match && !match.ambiguous ? match.unitId : "",
          externalId: p.externalId,
          externalUrl: p.externalUrl,
          raw: p.raw,
          ambiguous: match?.ambiguous ?? false,
        };
      }),
    );
  }

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? rs);
  }
  function removeRow(key: string) {
    setRows((rs) => rs?.filter((r) => r.key !== key) ?? rs);
  }

  const computed = useMemo(() => {
    if (!rows) return [];
    const existingIds = new Set(
      existing.filter((e) => e.provider === provider).map((e) => e.external_listing_id),
    );
    const batchSeen = new Set<string>();
    return rows.map((row) => {
      let status: RowStatus;
      const id = row.externalId.trim();
      if (!id) status = "no-id";
      else if (!row.unitId) status = row.ambiguous ? "ambiguous" : "no-unit";
      else if (existingIds.has(id)) status = "dup-existing";
      else if (batchSeen.has(id)) status = "dup-batch";
      else {
        status = "ready";
        batchSeen.add(id);
      }
      return { row, status };
    });
  }, [rows, existing, provider]);

  const readyRows = computed.filter((c) => c.status === "ready");
  const counts = {
    ready: readyRows.length,
    needUnit: computed.filter((c) => c.status === "no-unit" || c.status === "ambiguous").length,
    dup: computed.filter((c) => c.status === "dup-existing" || c.status === "dup-batch").length,
    noId: computed.filter((c) => c.status === "no-id").length,
  };

  function handleImport() {
    if (readyRows.length === 0) return;
    startTransition(async () => {
      const res = await bulkCreateOtaListings({
        provider,
        rows: readyRows.map((c) => ({
          unit_id: c.row.unitId,
          external_listing_id: c.row.externalId.trim(),
          external_listing_url: c.row.externalUrl,
        })),
      });
      if (!res.ok) {
        toast.error("No se pudo importar", { description: res.error });
        return;
      }
      toast.success(`${res.inserted} mapeo${res.inserted === 1 ? "" : "s"} creado${res.inserted === 1 ? "" : "s"}`, {
        description:
          res.skipped > 0
            ? `${res.skipped} omitido${res.skipped === 1 ? "" : "s"} (duplicados o ya existentes)`
            : undefined,
      });
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="gap-2" onClick={() => handleOpenChange(true)}>
        <Upload size={16} /> Importar en masa
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Importar mapeos en masa</DialogTitle>
            <DialogDescription>
              Pegá una unidad por línea, revisá el emparejamiento y confirmá. Solo se importan
              las filas en verde.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Plataforma (todo el lote)</Label>
              <Select value={provider} onValueChange={(v) => handleProvider(v as OtaProvider)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["airbnb", "booking", "expedia", "vrbo", "otro"] as const).map((s) => (
                    <SelectItem key={s} value={s}>{BOOKING_SOURCE_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rows === null ? (
              <>
                <div className="space-y-1.5">
                  <Label>Pegá los listings</Label>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={PLACEHOLDER[provider]}
                    rows={8}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Separá unidad e ID con tab, coma o punto y coma. Si pegás solo el ID, asignás la
                    unidad en el siguiente paso. Acepta URLs completas: extraigo el número de{" "}
                    <span className="font-mono">/rooms/&lt;id&gt;</span>.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button type="button" onClick={handleProcess} disabled={!text.trim()}>
                    Procesar
                  </Button>
                </DialogFooter>
              </>
            ) : computed.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No se detectó ninguna línea válida.
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setRows(null)}>
                    <ArrowLeft size={14} /> Volver al texto
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_8.5rem_6.5rem_2rem] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
                  <span>Unidad</span>
                  <span>ID externo</span>
                  <span>Estado</span>
                  <span />
                </div>
                <div className="max-h-[50vh] space-y-1.5 overflow-y-auto px-1">
                  {computed.map(({ row, status }) => {
                    const meta = STATUS_META[status];
                    return (
                      <div key={row.key} className="grid grid-cols-[1fr_8.5rem_6.5rem_2rem] items-center gap-2">
                        <UnitCombobox
                          units={units}
                          value={row.unitId || null}
                          onChange={(id) => patchRow(row.key, { unitId: id ?? "" })}
                          placeholder="Elegí la unidad"
                        />
                        <Input
                          value={row.externalId}
                          onChange={(e) => patchRow(row.key, { externalId: e.target.value })}
                          placeholder="ID"
                          className="h-9 font-mono text-xs"
                        />
                        <Badge variant="outline" className={`justify-center font-normal ${meta.cls}`}>
                          {meta.label}
                        </Badge>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row.key)}
                          title="Quitar fila"
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
                  <span>
                    <b className="text-emerald-600 dark:text-emerald-400">{counts.ready} listos</b>
                    {counts.needUnit > 0 && <> · {counts.needUnit} sin unidad</>}
                    {counts.dup > 0 && <> · {counts.dup} duplicados</>}
                    {counts.noId > 0 && <> · {counts.noId} sin ID</>}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows(null)}>
                    <ArrowLeft size={14} /> Editar texto
                  </Button>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button type="button" onClick={handleImport} disabled={isPending || counts.ready === 0}>
                    {isPending && <Loader2 className="animate-spin" />}
                    Importar {counts.ready > 0 ? counts.ready : ""}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
