"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Sparkles, Plus, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateSettlement,
  previewSettlement,
} from "@/lib/actions/settlements";
import { formatMoney, formatDate } from "@/lib/format";
import {
  MONTHS,
  SETTLEMENT_STATUS_META,
  formatPeriod,
} from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
import type { Owner } from "@/lib/types/database";

/**
 * El listado del page (`/dashboard/liquidaciones`) llama `listOwners()` que ya
 * trae cada owner con su array `unit_owners`. Tipamos lo mínimo necesario
 * acá para mostrar "(sin unidades)" en el selector y bloquear el botón
 * Generar antes de pegarle al server.
 */
type OwnerWithUnits = Owner & { unit_owners?: { unit?: unknown }[] | null };

/** Lo que devuelve `previewSettlement` (no se exportan tipos desde "use server"). */
type Preview = Awaited<ReturnType<typeof previewSettlement>>;
type PreviewOk = Extract<Preview, { ok: true }>;

/**
 * Autocontenido: renderiza su PROPIO botón disparador (no recibe children
 * desde un Server Component). Mismo patrón que UnitOwnersManager.
 *
 * Al elegir propietario / mes pide una previsualización (dryRun, sin
 * escrituras) y la muestra en el recuadro de abajo: qué reservas entran y,
 * cuando no entra ninguna, por qué — la causa típica es una reserva que ocupa
 * el mes pero hace check-out en el siguiente.
 */
export function GenerateSettlementDialog({
  owners,
}: {
  owners: OwnerWithUnits[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [previewPending, startPreview] = useTransition();
  const router = useRouter();
  const now = new Date();
  const [ownerId, setOwnerId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Contador de pedidos: si el usuario cambia el mes dos veces seguidas, la
  // respuesta del primero puede llegar después que la del segundo. Sólo se
  // acepta la última.
  const previewReq = useRef(0);

  const selectedOwner = owners.find((o) => o.id === ownerId);
  const selectedOwnerUnitCount = selectedOwner?.unit_owners?.length ?? 0;
  const selectedOwnerHasNoUnits =
    !!selectedOwner && selectedOwnerUnitCount === 0;

  function loadPreview(next: { ownerId: string; year: number; month: number }) {
    if (!next.ownerId) {
      setPreview(null);
      return;
    }
    const owner = owners.find((o) => o.id === next.ownerId);
    if (owner && (owner.unit_owners?.length ?? 0) === 0) {
      // Sin unidades no hay nada que previsualizar; la UI ya lo explica.
      setPreview(null);
      return;
    }
    const id = ++previewReq.current;
    startPreview(async () => {
      try {
        const res = await previewSettlement(next.ownerId, next.year, next.month);
        if (id !== previewReq.current) return; // respuesta vieja
        setPreview(res);
      } catch {
        if (id !== previewReq.current) return;
        setPreview(null);
      }
    });
  }

  function onOwnerChange(v: string) {
    setOwnerId(v);
    loadPreview({ ownerId: v, year, month });
  }
  function onYearChange(v: number) {
    setYear(v);
    loadPreview({ ownerId, year: v, month });
  }
  function onMonthChange(v: number) {
    setMonth(v);
    loadPreview({ ownerId, year, month: v });
  }

  function handleGenerate() {
    if (!ownerId) {
      toast.error("Seleccioná un propietario");
      return;
    }
    if (selectedOwnerHasNoUnits) {
      toast.error("Sin unidades asignadas", {
        description:
          "Asigná al menos una unidad a este propietario antes de generar la liquidación.",
      });
      return;
    }
    startTransition(async () => {
      try {
        const result = await generateSettlement(ownerId, year, month);
        if (!result.ok) {
          toast.error("No se pudo generar la liquidación", {
            description: result.message,
          });
          return;
        }
        if (result.lines.length === 0) {
          toast.success("Liquidación generada (vacía)", {
            description: emptyReason(
              preview && preview.ok ? preview : null,
              year,
              month,
            ),
          });
        } else {
          toast.success("Liquidación generada", {
            description: `${result.lines.length} líneas · neto: ${formatMoney(Number(result.settlement.net_payable), "ARS")}`,
          });
        }
        setOpen(false);
        router.push(`/dashboard/liquidaciones/${result.settlement.id}`);
      } catch (e) {
        // Reservado para errores inesperados (red, DB caída). Los errores de
        // negocio (sin unidades, ya cerrada, etc.) llegan como result.ok=false.
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  const showPreview = !!ownerId && !selectedOwnerHasNoUnits;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus size={16} />
          <span className="hidden sm:inline">Generar liquidación</span>
          <span className="sm:hidden">Generar</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Generar liquidación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Propietario</Label>
            <Select value={ownerId} onValueChange={onOwnerChange}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir..." />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o) => {
                  const count = o.unit_owners?.length ?? 0;
                  return (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="flex items-center gap-2">
                        <span>{o.full_name}</span>
                        {count === 0 && (
                          <span className="text-[10px] text-rose-600 dark:text-rose-400">
                            (sin unidades)
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedOwnerHasNoUnits && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                Este propietario no tiene unidades asignadas. Asigná al menos
                una antes de generar la liquidación.
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Año</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => onYearChange(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(
                    (y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Mes</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => onMonthChange(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="col-span-3 text-[11px] text-muted-foreground leading-snug">
              Las reservas temporarias entran en el mes del check-out; las
              mensuales se prorratean por días.
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-[11px] text-muted-foreground space-y-2">
            <p>
              La liquidación se genera en{" "}
              <span className="font-semibold text-foreground">ARS</span>. Si hay
              reservas o cargos en USD (u otra moneda), se incluyen y podés
              cargar el tipo de cambio del día en el detalle para convertirlos
              al total.
            </p>
            {showPreview && (
              <PreviewSummary
                preview={preview}
                pending={previewPending}
                year={year}
                month={month}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isPending || selectedOwnerHasNoUnits}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Por qué la liquidación quedó vacía, con lo que sabemos de la previsualización. */
function emptyReason(p: PreviewOk | null, year: number, month: number): string {
  const label = formatPeriod(year, month);
  const outside = p?.stats.temporarioCheckoutOutside.length ?? 0;
  if (outside > 0) {
    return `Sin reservas con check-out en ${label}: ${outside} ${
      outside === 1 ? "reserva ocupa" : "reservas ocupan"
    } el mes pero se ${outside === 1 ? "liquida" : "liquidan"} en el mes del check-out.`;
  }
  return `Sin reservas, mantenimientos ni gastos para liquidar en ${label}.`;
}

function PreviewSummary({
  preview,
  pending,
  year,
  month,
}: {
  preview: Preview | null;
  pending: boolean;
  year: number;
  month: number;
}) {
  if (pending || !preview) {
    return (
      <p className="flex items-center gap-1.5 border-t pt-2">
        <Loader2 size={12} className="animate-spin" />
        Calculando qué entra…
      </p>
    );
  }
  if (!preview.ok) {
    // "sin unidades" ya se explica arriba; el resto son errores raros.
    if (preview.reason === "no_units") return null;
    return (
      <p className="border-t pt-2 text-rose-600 dark:text-rose-400">
        {preview.message}
      </p>
    );
  }

  const label = formatPeriod(year, month);
  const { stats } = preview;
  const outside = stats.temporarioCheckoutOutside;
  const currencies = Object.entries(preview.byCurrency).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const existingMeta = preview.existing
    ? SETTLEMENT_STATUS_META[preview.existing.status]
    : null;
  const existingClosed =
    !!preview.existing && preview.existing.status !== "borrador";
  // Regenerar sólo pisa borradores; para cualquier otro estado (anulada
  // incluida — el índice único ignora el status) el camino es ELIMINAR la
  // liquidación desde su detalle. Si está pagada ni eso: primero hay que
  // anular el pago en Caja.
  const existingPaid = preview.existing?.status === "pagada";

  return (
    <div className="border-t pt-2 space-y-1.5">
      {preview.bookings > 0 ? (
        <>
          <p className="text-foreground">
            <span className="font-semibold">
              {preview.bookings}{" "}
              {preview.bookings === 1 ? "reserva" : "reservas"}
            </span>{" "}
            · {preview.lines} líneas
            {stats.ticketCount > 0 && ` · ${stats.ticketCount} mantenimiento${stats.ticketCount === 1 ? "" : "s"}`}
            {stats.expenseCount > 0 && ` · ${stats.expenseCount} gasto${stats.expenseCount === 1 ? "" : "s"}`}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
            {currencies.map(([ccy, t]) => (
              <span key={ccy}>
                Neto{" "}
                <span
                  className={cn(
                    "font-semibold",
                    t.net >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {formatMoney(t.net, ccy)}
                </span>
                {t.channelCommission > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    (canal −{formatMoney(t.channelCommission, ccy)})
                  </span>
                )}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-foreground font-medium">
            Sin reservas para liquidar en {label}.
          </p>
          {outside.length > 0 && (
            <>
              <p>
                {outside.length}{" "}
                {outside.length === 1
                  ? "reserva ocupa el mes pero hace"
                  : "reservas ocupan el mes pero hacen"}{" "}
                check-out en otro mes: las temporarias se liquidan en el mes
                del check-out.
              </p>
              <ul className="space-y-0.5">
                {outside.slice(0, 3).map((b) => (
                  <li key={b.id} className="flex items-center gap-1.5 tabular-nums">
                    <span className="font-mono text-foreground">{b.unitCode}</span>
                    <span>
                      {formatDate(b.check_in_date, "dd/MM")} →{" "}
                      {formatDate(b.check_out_date, "dd/MM")}
                    </span>
                    {b.guest_name && (
                      <span className="truncate">· {b.guest_name}</span>
                    )}
                  </li>
                ))}
                {outside.length > 3 && (
                  <li>… y {outside.length - 3} más.</li>
                )}
              </ul>
            </>
          )}
          {preview.lines > 0 && (
            <p>
              Igual entran{" "}
              {[
                stats.ticketCount > 0 &&
                  `${stats.ticketCount} mantenimiento${stats.ticketCount === 1 ? "" : "s"}`,
                stats.expenseCount > 0 &&
                  `${stats.expenseCount} gasto${stats.expenseCount === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" y ")}
              .
            </p>
          )}
          {preview.lines === 0 && outside.length === 0 && (
            <p className="flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              Se va a crear una liquidación en cero. Podés generarla igual y
              cargarle reservas o cargos a mano.
            </p>
          )}
        </>
      )}

      {preview.existing && (
        <p
          className={cn(
            "flex items-start gap-1.5 pt-1",
            existingClosed
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground",
          )}
        >
          {existingClosed ? (
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={12} className="mt-0.5 shrink-0" />
          )}
          <span>
            {existingClosed ? (
              <>
                Ya existe una liquidación{" "}
                <span className="font-medium">
                  {existingMeta?.label.toLowerCase() ?? preview.existing.status}
                </span>{" "}
                de {label} para este propietario: no se puede regenerar.{" "}
                {existingPaid
                  ? "Si hace falta rehacerla, primero anulá el pago en Caja y después eliminala desde su detalle."
                  : "Eliminala desde su detalle si hace falta rehacerla."}
              </>
            ) : (
              <>
                Ya hay un borrador de {label}: se regenera. Los ajustes
                manuales se conservan.
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
