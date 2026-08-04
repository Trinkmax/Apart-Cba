"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PERIOD_CYCLE,
  MAX_PERIOD_CYCLE,
  MAX_PERIOD_NOTE_LENGTH,
  PERIOD_CYCLE_PRESETS,
  formatPeriodCycle,
} from "@/lib/settlements/labels";
import { setSettlementPeriodCycle } from "@/lib/actions/settlements";

export interface PeriodCycleSuggestion {
  index: number;
  cycle: number | null;
  /** "Junio 2026 · Período 1/3" — de dónde salió la sugerencia. */
  fromLabel: string;
}

/**
 * Casillero del "período que se le paga al propietario".
 *
 * En AR el alquiler se ajusta por IPC cada N meses; cada mes de ese ciclo es
 * un período (1/3, 2/3, 3/3) y el propietario necesita saber cuál está
 * cobrando — después del último, el precio se actualiza.
 *
 * Vive dentro de la celda "Período" del encabezado del documento: se lee como
 * dato y se edita en el lugar, sin sacar al usuario de la liquidación.
 */
export function PeriodCycleEditor({
  settlementId,
  periodLabel,
  periodIndex,
  periodCycle,
  periodNote,
  suggestion,
  editable,
}: {
  settlementId: string;
  /** "Julio 2026" — el mes calendario, no editable acá. */
  periodLabel: string;
  periodIndex: number | null;
  periodCycle: number | null;
  periodNote: string | null;
  suggestion: PeriodCycleSuggestion | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const savedLabel = formatPeriodCycle(periodIndex, periodCycle);

  // Borrador local del popover. Se re-siembra en cada apertura para que un
  // cancelar no deje residuos y para tomar valores frescos tras router.refresh.
  const [cycle, setCycle] = useState<number>(
    periodCycle ?? suggestion?.cycle ?? DEFAULT_PERIOD_CYCLE,
  );
  const [showTotal, setShowTotal] = useState<boolean>(periodCycle != null);
  const [index, setIndex] = useState<number | null>(periodIndex);
  const [note, setNote] = useState<string>(periodNote ?? "");

  function seedDraft() {
    const seedCycle = periodCycle ?? suggestion?.cycle ?? DEFAULT_PERIOD_CYCLE;
    setCycle(seedCycle);
    // Sin período guardado arrancamos mostrando el total ("1/3"), que es el
    // caso normal. Con período guardado respetamos cómo quedó.
    setShowTotal(periodIndex != null ? periodCycle != null : true);
    setIndex(periodIndex);
    setNote(periodNote ?? "");
  }

  function applySuggestion() {
    if (!suggestion) return;
    setCycle(suggestion.cycle ?? Math.max(DEFAULT_PERIOD_CYCLE, suggestion.index));
    setShowTotal(suggestion.cycle != null);
    setIndex(suggestion.index);
  }

  const previewCycle = showTotal ? cycle : null;
  const previewLabel = formatPeriodCycle(index, previewCycle);

  // Los chips SIEMPRE tienen que llegar al índice elegido: si el valor guardado
  // (o el sugerido) supera el ciclo del borrador, el control quedaría "vacío"
  // mostrando un preview que sí tiene valor. Nunca pisamos `index` al cambiar
  // el ciclo — tipear "1" camino a "12" no puede borrar el mes elegido.
  const chipCount = Math.min(
    MAX_PERIOD_CYCLE,
    Math.max(cycle, index ?? 1),
  );
  // Único estado imposible: "Período 4/3". Se avisa y se bloquea el guardado.
  const overflow = showTotal && index != null && index > cycle;
  const canSave = index != null && !overflow;

  function save(clear = false) {
    start(async () => {
      try {
        const res = await setSettlementPeriodCycle({
          settlement_id: settlementId,
          index: clear ? null : index,
          cycle: clear ? null : previewCycle,
          note: clear ? null : note.trim() || null,
        });
        setOpen(false);
        toast.success(
          clear || !res.label
            ? "Período quitado de la liquidación"
            : `Período actualizado · ${res.label}`,
        );
        router.refresh();
      } catch (e) {
        toast.error("No se pudo guardar el período", {
          description: (e as Error).message,
        });
      }
    });
  }

  // Sin permiso de edición mostramos el mismo dato, sin affordance de click.
  if (!editable) {
    return (
      <PeriodCell
        periodLabel={periodLabel}
        cycleLabel={savedLabel}
        note={periodNote}
      />
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) seedDraft();
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left group/period rounded-md -m-1 p-1 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            savedLabel
              ? `Período: ${periodLabel}, ${savedLabel}. Editar.`
              : `Período: ${periodLabel}, sin período del ciclo de ajuste. Agregar.`
          }
        >
          <PeriodCell
            periodLabel={periodLabel}
            cycleLabel={savedLabel}
            note={periodNote}
            interactive
          />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="space-y-3.5">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarRange size={14} className="text-primary" />
              Período del ciclo de ajuste
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              El alquiler se actualiza por IPC cada cierta cantidad de meses.
              Indicá cuál de esos meses le estás pagando al propietario.
            </p>
          </div>

          {suggestion && (
            <button
              type="button"
              onClick={applySuggestion}
              className="w-full flex items-start gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
            >
              <Sparkles size={13} className="text-primary mt-0.5 shrink-0" />
              <span className="text-[11px] leading-relaxed">
                Viene de <strong>{suggestion.fromLabel}</strong> · seguir con{" "}
                <strong>
                  {formatPeriodCycle(suggestion.index, suggestion.cycle)}
                </strong>
              </span>
            </button>
          )}

          {/* Ciclo */}
          <Field label="Se ajusta cada">
            <div className="flex items-center gap-1.5 flex-wrap">
              {PERIOD_CYCLE_PRESETS.map((p) => (
                <Chip key={p} active={cycle === p} onClick={() => setCycle(p)}>
                  {p}
                </Chip>
              ))}
              <Input
                type="number"
                min={1}
                max={MAX_PERIOD_CYCLE}
                inputMode="numeric"
                value={cycle}
                onChange={(e) =>
                  setCycle(
                    Math.min(
                      MAX_PERIOD_CYCLE,
                      Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                    ),
                  )
                }
                className="h-7 w-14 text-xs text-center"
                aria-label="Cantidad de meses del ciclo"
              />
              <span className="text-[11px] text-muted-foreground">meses</span>
            </div>
          </Field>

          {/* Período dentro del ciclo */}
          <Field label="Estás liquidando el mes">
            <div className="flex items-center gap-1.5 flex-wrap">
              {Array.from({ length: chipCount }, (_, i) => i + 1).map((n) => (
                <Chip
                  key={n}
                  active={index === n}
                  outOfRange={showTotal && n > cycle}
                  onClick={() => setIndex(n)}
                >
                  {n}
                </Chip>
              ))}
            </div>
            {overflow && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                No existe un “Período {index}/{cycle}”: subí el ciclo a{" "}
                {index} o elegí un mes menor.
              </p>
            )}
          </Field>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-[11px] text-muted-foreground leading-tight">
              Mostrar el total del ciclo
              <span className="text-muted-foreground/70">
                {" "}
                (“Período {index ?? 1}/{cycle}” en vez de “Período{" "}
                {index ?? 1}”)
              </span>
            </span>
            <Switch
              checked={showTotal}
              onCheckedChange={setShowTotal}
              aria-label="Mostrar el total del ciclo"
            />
          </label>

          {/* Nota */}
          <Field label="Aclaración (opcional)">
            <Input
              value={note}
              maxLength={MAX_PERIOD_NOTE_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: incluye reintegro de expensas"
              className="h-8 text-xs"
            />
          </Field>

          {/* Preview */}
          <div className="rounded-md border bg-muted/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              En el documento
            </div>
            <div className="text-sm font-semibold mt-0.5">
              {periodLabel}
              {previewLabel && (
                <span className="text-primary"> · {previewLabel}</span>
              )}
            </div>
            {index == null && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Elegí un mes arriba para agregar el período.
              </div>
            )}
            {note.trim() && (
              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                {note.trim()}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            {savedLabel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => save(true)}
              >
                <X size={13} /> Quitar
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={pending || !canSave}
                title={
                  index == null
                    ? "Elegí qué mes del ciclo estás liquidando"
                    : undefined
                }
                onClick={() => save(false)}
              >
                {pending && <Loader2 size={13} className="animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Celda "Período" del encabezado. Sin período cargado muestra un affordance
 * punteado para que se note que hay algo para completar (y no un hueco mudo).
 */
function PeriodCell({
  periodLabel,
  cycleLabel,
  note,
  interactive,
}: {
  periodLabel: string;
  cycleLabel: string | null;
  note: string | null;
  interactive?: boolean;
}) {
  // Todo <span> a propósito: en modo editable esto vive dentro de un <button>,
  // que sólo admite contenido de tipo phrasing (un <div> ahí es HTML inválido).
  return (
    <>
      <span className="block text-sm font-medium mt-0.5 truncate">
        {periodLabel}
      </span>
      {cycleLabel ? (
        <span className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            <CalendarRange size={10} />
            {cycleLabel}
          </span>
          {interactive && (
            <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/period:opacity-100">
              editar
            </span>
          )}
        </span>
      ) : interactive ? (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors group-hover/period:border-primary/40 group-hover/period:text-primary">
          <Plus size={10} /> Agregar período
        </span>
      ) : null}
      {note && (
        <span
          className={cn(
            "block text-[11px] text-muted-foreground mt-1 leading-snug",
            "line-clamp-2",
          )}
        >
          {note}
        </span>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Chip({
  active,
  outOfRange,
  onClick,
  children,
}: {
  active: boolean;
  /** El mes existe en el borrador pero excede el ciclo elegido (ej. 4 con ciclo 3). */
  outOfRange?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 min-w-7 rounded-md border px-2 text-xs font-medium tabular-nums transition-colors",
        active
          ? outOfRange
            ? "bg-amber-500 text-white border-amber-500"
            : "bg-primary text-primary-foreground border-primary"
          : outOfRange
            ? "bg-card text-amber-600 dark:text-amber-400 border-dashed border-amber-400/60 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            : "bg-card text-muted-foreground border-input hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
