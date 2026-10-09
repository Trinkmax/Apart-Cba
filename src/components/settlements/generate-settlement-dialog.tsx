"use client";

import { useRef, useState, useTransition } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  AlertTriangle,
  Info,
  PencilLine,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createBlankSettlement,
  generateSettlement,
  previewSettlement,
} from "@/lib/actions/settlements";
import { formatMoney, formatDate } from "@/lib/format";
import {
  MONTHS,
  SETTLEMENT_STATUS_META,
  formatPeriod,
} from "@/lib/settlements/labels";
import { settlementRegenerateHint } from "@/lib/settlements/payment-undo";
import { isStaleDeployError, toastActionFailure } from "@/lib/action-failure";
import { cn } from "@/lib/utils";
import {
  OwnerUnitPicker,
  type OwnerUnitSelection,
  type PickerOwner,
} from "./owner-unit-picker";

/** Lo que devuelve `previewSettlement` (no se exportan tipos desde "use server"). */
type Preview = Awaited<ReturnType<typeof previewSettlement>>;
type PreviewOk = Extract<Preview, { ok: true }>;

/** Cómo se arma: con las reservas del sistema, o en blanco para cargarla a mano (073). */
type Mode = "auto" | "blank";

/**
 * Autocontenido: renderiza su PROPIO botón disparador (no recibe children
 * desde un Server Component). Mismo patrón que UnitOwnersManager.
 *
 * Se elige de quién (buscando propietario o unidad), el mes y cómo se arma:
 *  • Con las reservas: pide una previsualización (dryRun, sin escrituras) y
 *    la muestra abajo: qué reservas entran y, cuando no entra ninguna, por
 *    qué — la causa típica es una reserva que ocupa el mes pero hace check-out
 *    en el siguiente.
 *  • Desde cero: crea la liquidación vacía (origin='manual') y lleva al
 *    detalle para cargarla con «Agregar reserva» / «Agregar cargo». Nunca se
 *    regenera, así que lo cargado a mano no se duplica con las reservas.
 */
export function GenerateSettlementDialog({
  owners,
}: {
  owners: PickerOwner[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [previewPending, startPreview] = useTransition();
  const router = useRouter();
  const now = new Date();
  const [selection, setSelection] = useState<OwnerUnitSelection | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [mode, setMode] = useState<Mode>("auto");
  const [preview, setPreview] = useState<Preview | null>(null);
  // Contador de pedidos: si el usuario cambia el mes dos veces seguidas, la
  // respuesta del primero puede llegar después que la del segundo. Sólo se
  // acepta la última.
  const previewReq = useRef(0);

  const ownerId = selection?.ownerId ?? "";
  const selectedOwner = owners.find((o) => o.id === ownerId);
  const selectedOwnerUnitCount = selectedOwner?.unit_owners?.length ?? 0;
  const selectedOwnerHasNoUnits =
    !!selectedOwner && selectedOwnerUnitCount === 0;
  const existing = preview && preview.ok ? preview.existing : null;

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
    setPreview(null);
    startPreview(async () => {
      try {
        const res = await previewSettlement(next.ownerId, next.year, next.month);
        if (id !== previewReq.current) return; // respuesta vieja
        setPreview(res);
      } catch (e) {
        if (id !== previewReq.current) return;
        // Antes quedaba null y el recuadro mostraba "Calculando qué entra…"
        // para siempre. Generar no depende de la previsualización: se avisa
        // y se puede generar igual (salvo con un deploy nuevo, que pide
        // recargar para todo).
        setPreview({
          ok: false,
          reason: "unknown",
          message: isStaleDeployError(e)
            ? "Se actualizó el sistema mientras tenías esto abierto: recargá la página para seguir."
            : "No se pudo calcular qué entra (revisá la conexión). Podés generarla igual.",
        });
      }
    });
  }

  function onSelectionChange(next: OwnerUnitSelection) {
    setSelection(next);
    loadPreview({ ownerId: next.ownerId, year, month });
  }
  function onYearChange(v: number) {
    setYear(v);
    loadPreview({ ownerId, year: v, month });
  }
  function onMonthChange(v: number) {
    setMonth(v);
    loadPreview({ ownerId, year, month: v });
  }

  function openSettlement(id: string) {
    setOpen(false);
    router.push(`/dashboard/liquidaciones/${id}`);
  }

  function handleGenerate() {
    if (!ownerId) {
      toast.error("Elegí el propietario o la unidad");
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
        openSettlement(result.settlement.id);
      } catch (e) {
        // Reservado para errores inesperados (red, deploy nuevo). Los errores
        // de negocio (sin unidades, ya cerrada, etc.) llegan como result.ok=false.
        toastActionFailure(e, "No se pudo generar la liquidación");
      }
    });
  }

  function handleCreateBlank() {
    if (!ownerId) {
      toast.error("Elegí el propietario o la unidad");
      return;
    }
    if (existing) {
      openSettlement(existing.id);
      return;
    }
    startTransition(async () => {
      try {
        const result = await createBlankSettlement({ ownerId, year, month });
        if (!result.ok) {
          const settlementId = result.settlementId;
          toast.error("No se creó la liquidación", {
            description: result.message,
            action: settlementId
              ? { label: "Abrir", onClick: () => openSettlement(settlementId) }
              : undefined,
          });
          return;
        }
        toast.success("Liquidación en blanco creada", {
          description: `Cargá las reservas y los cargos de ${formatPeriod(year, month)}.`,
        });
        openSettlement(result.settlementId);
      } catch (e) {
        toastActionFailure(e, "No se pudo crear la liquidación");
      }
    });
  }

  const showPreview = !!ownerId && !selectedOwnerHasNoUnits;
  const label = formatPeriod(year, month);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Cada vez que se abre arranca limpio: la previsualización y el modo
        // de la vez anterior no tienen por qué valer para la próxima.
        if (!o) {
          setSelection(null);
          setPreview(null);
          setMode("auto");
        }
      }}
    >
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
          <DialogDescription className="sr-only">
            Elegí de quién, el mes y si se arma con las reservas o desde cero.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Propietario o unidad</Label>
            <OwnerUnitPicker
              owners={owners}
              value={selection}
              onChange={onSelectionChange}
            />
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
          </div>

          <div className="space-y-1.5">
            <Label id="settlement-mode-label">¿Cómo la armás?</Label>
            <div
              role="radiogroup"
              aria-labelledby="settlement-mode-label"
              className="grid grid-cols-2 gap-2"
            >
              <ModeOption
                selected={mode === "auto"}
                onSelect={() => setMode("auto")}
                icon={<Sparkles size={14} />}
                title="Con las reservas"
                text="El sistema la arma con las reservas, mantenimientos y gastos del mes."
              />
              <ModeOption
                selected={mode === "blank"}
                onSelect={() => setMode("blank")}
                icon={<PencilLine size={14} />}
                title="Desde cero"
                text="Arranca vacía y cargás vos las reservas, gastos y ajustes."
              />
            </div>
          </div>

          {mode === "auto" ? (
            <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-[11px] text-muted-foreground space-y-2">
              <p>
                Las temporarias entran en el mes del check-out; las mensuales
                se prorratean por días. Se genera en{" "}
                <span className="font-semibold text-foreground">ARS</span>: lo
                que esté en USD (u otra moneda) se incluye y el tipo de cambio
                se carga en el detalle.
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
          ) : (
            <BlankSummary
              ownerName={selectedOwner?.full_name.trim() ?? null}
              label={label}
              existing={existing}
              checking={showPreview && (previewPending || !preview)}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {mode === "auto" && existing?.origin !== "manual" ? (
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
          ) : existing ? (
            <Button onClick={() => openSettlement(existing.id)} className="gap-2">
              Abrir la de {label} <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              onClick={handleCreateBlank}
              disabled={isPending || selectedOwnerHasNoUnits || !ownerId}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <PencilLine size={14} />
              )}
              Crear en blanco
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  selected,
  onSelect,
  icon,
  title,
  text,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          selected ? "text-primary" : "text-foreground",
        )}
      >
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
        {text}
      </span>
    </button>
  );
}

/** El recuadro de "Desde cero": qué va a pasar, o que ya hay una para ese mes. */
function BlankSummary({
  ownerName,
  label,
  existing,
  checking,
}: {
  ownerName: string | null;
  label: string;
  existing: PreviewOk["existing"];
  checking: boolean;
}) {
  if (existing) {
    const meta = SETTLEMENT_STATUS_META[existing.status];
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2.5 text-[11px] text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
        <p className="flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>
            {ownerName ?? "Este propietario"} ya tiene la liquidación de {label}{" "}
            ({meta?.label.toLowerCase() ?? existing.status}
            {existing.origin === "manual" ? ", armada a mano" : ""}). Hay una
            por mes: abrila y cargale lo que falte.
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-[11px] text-muted-foreground space-y-1.5">
      <p>
        Se crea <span className="font-medium text-foreground">vacía</span> y te
        lleva al detalle para cargar las reservas (huésped, fechas, bruto,
        comisión) y los cargos.
      </p>
      <p>
        Nunca se completa sola con las reservas del sistema: «Regenerar» y
        «Generar todas» no la tocan. Se revisa, se envía y al registrar el pago
        impacta en Caja como cualquier otra.
      </p>
      {checking && (
        <p className="flex items-center gap-1.5 border-t pt-1.5">
          <Loader2 size={12} className="animate-spin" />
          Revisando si ya hay una de {label}…
        </p>
      )}
    </div>
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
  const existingManual = preview.existing?.origin === "manual";
  // Regenerar sólo pisa borradores (el índice único ignora el status, así que
  // tampoco se crea otra al lado). Para el resto, settlementRegenerateHint
  // dice el camino real: una pagada sale con «Anular el pago» desde su
  // estado; sin pago, Borrador desde el mismo estado o el tacho de la lista.

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
            existingClosed || existingManual
              ? "text-amber-700 dark:text-amber-300"
              : "text-muted-foreground",
          )}
        >
          {existingClosed || existingManual ? (
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={12} className="mt-0.5 shrink-0" />
          )}
          <span>
            {existingManual ? (
              <>
                Ya hay una liquidación de {label} armada a mano: no se
                regenera con las reservas del sistema (duplicaría lo cargado).{" "}
                <Link
                  href={`/dashboard/liquidaciones/${preview.existing.id}`}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Abrirla
                </Link>
              </>
            ) : existingClosed ? (
              <>
                Ya existe una liquidación{" "}
                <span className="font-medium">
                  {existingMeta?.label.toLowerCase() ?? preview.existing.status}
                </span>{" "}
                de {label} para este propietario: no se puede regenerar.{" "}
                {settlementRegenerateHint(preview.existing.status)}{" "}
                <Link
                  href={`/dashboard/liquidaciones/${preview.existing.id}`}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Abrir la liquidación
                </Link>
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
