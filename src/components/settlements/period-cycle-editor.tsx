"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  CalendarRange,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
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
  formatPeriodCycleShort,
  type PeriodSuggestion,
  type UnitPeriod,
} from "@/lib/settlements/labels";
import {
  setSettlementPeriodCycle,
  type SetSettlementPeriodResult,
} from "@/lib/actions/settlements";

/** Una unidad del documento con el período que tiene guardado (migración 074). */
export interface PeriodEditorUnit {
  id: string;
  code: string;
  name: string;
  /** `null` = no aplica, o el documento no va por departamento. */
  period: UnitPeriod | null;
}

type Mode = "uniform" | "per_unit";

/** Borrador de una fila por depto. `index` null = "no aplica" ese mes. */
interface RowDraft {
  index: number | null;
  cycle: number;
}

type SavePayload = Parameters<typeof setSettlementPeriodCycle>[0];

const clampCycle = (n: number) =>
  Math.min(MAX_PERIOD_CYCLE, Math.max(1, Math.trunc(n) || 1));

/** Un ciclo que muestre el mes elegido aunque el guardado no tenga total. */
const rowFrom = (p: UnitPeriod | null, fallbackCycle: number): RowDraft =>
  p
    ? { index: p.index, cycle: p.cycle ?? Math.max(fallbackCycle, p.index) }
    : { index: null, cycle: fallbackCycle };

/** El mes del ciclo que más se repite (para pasar de "por depto" a uno solo). */
function mostCommon(rows: RowDraft[]): RowDraft | null {
  const counts = new Map<string, { row: RowDraft; n: number }>();
  for (const r of rows) {
    if (r.index == null) continue;
    const key = `${r.index}/${r.cycle}`;
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { row: r, n: 1 });
  }
  let best: { row: RowDraft; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.row ?? null;
}

/**
 * Guarda y avisa. El server devuelve el error como valor (en producción
 * Next.js tapa el texto de toda excepción de una Server Action); el catch
 * queda para lo inesperado (sesión vencida, red).
 */
async function savePeriod(payload: SavePayload): Promise<
  SetSettlementPeriodResult
> {
  try {
    return await setSettlementPeriodCycle(payload);
  } catch {
    return {
      ok: false,
      error: "Se cortó la conexión. Revisá tu internet y volvé a intentar.",
    };
  }
}

/**
 * Casillero del "período que se le paga al propietario".
 *
 * En AR el alquiler se ajusta por IPC cada N meses; cada mes de ese ciclo es
 * un período (1/3, 2/3, 3/3) y el propietario necesita saber cuál está
 * cobrando — después del último, el precio se actualiza.
 *
 * Un propietario con varios deptos tiene cada contrato en un punto distinto
 * del ciclo (migración 074): "Por departamento" carga uno por unidad, y cada
 * bloque del documento muestra el suyo.
 *
 * Vive dentro de la celda "Período" del encabezado del documento: se lee como
 * dato y se edita en el lugar, sin sacar al usuario de la liquidación.
 */
export function PeriodCycleEditor({
  settlementId,
  periodLabel,
  mode: savedMode,
  periodIndex,
  periodCycle,
  periodNote,
  units,
  suggestion,
  editable,
}: {
  settlementId: string;
  /** "Julio 2026" — el mes calendario, no editable acá. */
  periodLabel: string;
  /** Cómo está guardado hoy. */
  mode: "none" | "uniform" | "per_unit";
  periodIndex: number | null;
  periodCycle: number | null;
  periodNote: string | null;
  /** Unidades del documento, en su orden, con su período guardado. */
  units: PeriodEditorUnit[];
  suggestion: PeriodSuggestion | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // "Por departamento" sólo tiene sentido con dos o más unidades — o si ya
  // quedó guardado así (hay que poder deshacerlo aunque hoy quede una).
  const canSplit = units.length >= 2 || savedMode === "per_unit";
  const savedUnits = units.filter((u) => u.period);
  const savedLabel = formatPeriodCycle(periodIndex, periodCycle);

  // ── Sugerencia "seguir el ciclo" ─────────────────────────────────────────
  const suggestedFor = (unitId: string): UnitPeriod | null =>
    suggestion?.units[unitId] ?? suggestion?.uniform ?? null;
  const unitSuggestions = units.flatMap((u) => {
    const s = suggestedFor(u.id);
    return s ? [s] : [];
  });
  // Uno para todo el documento: el uniforme anterior, o el que compartían
  // todos los deptos (si coincidían).
  const uniformSuggestion: UnitPeriod | null =
    suggestion?.uniform ??
    (unitSuggestions.length > 0 &&
    unitSuggestions.length === units.length &&
    unitSuggestions.every(
      (s) =>
        s.index === unitSuggestions[0].index &&
        s.cycle === unitSuggestions[0].cycle,
    )
      ? unitSuggestions[0]
      : null);
  // La anterior iba por depto: se sigue igual (arranca en "Por departamento").
  const previousPerUnit =
    canSplit &&
    !!suggestion &&
    !suggestion.uniform &&
    unitSuggestions.length > 0;

  // ── Borrador del popover ─────────────────────────────────────────────────
  // Se re-siembra en cada apertura para que un cancelar no deje residuos y
  // para tomar valores frescos tras router.refresh.
  const [mode, setMode] = useState<Mode>("uniform");
  const [cycle, setCycle] = useState<number>(DEFAULT_PERIOD_CYCLE);
  const [showTotal, setShowTotal] = useState<boolean>(true);
  const [index, setIndex] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [note, setNote] = useState<string>("");

  function seedDraft() {
    const baseCycle =
      periodCycle ??
      savedUnits.find((u) => u.period?.cycle)?.period?.cycle ??
      uniformSuggestion?.cycle ??
      DEFAULT_PERIOD_CYCLE;
    const nextRows: Record<string, RowDraft> = {};
    for (const u of units) {
      const saved =
        savedMode === "per_unit"
          ? u.period
          : savedMode === "uniform" && periodIndex
            ? { index: periodIndex, cycle: periodCycle }
            : null;
      nextRows[u.id] = rowFrom(saved, baseCycle);
    }
    setRows(nextRows);

    if (savedMode === "per_unit") {
      // Si después pasan a "igual para todos", arrancan con el más repetido.
      const common = mostCommon(Object.values(nextRows));
      setIndex(common?.index ?? null);
      setCycle(common?.cycle ?? baseCycle);
      setShowTotal(
        savedUnits.length === 0 || savedUnits.some((u) => u.period?.cycle),
      );
    } else {
      setIndex(periodIndex);
      setCycle(baseCycle);
      // Sin período guardado arrancamos mostrando el total ("1/3"), que es el
      // caso normal. Con período guardado respetamos cómo quedó.
      setShowTotal(periodIndex != null ? periodCycle != null : true);
    }
    // Sin nada guardado, si el mes anterior iba por depto se sigue igual.
    setMode(
      savedMode === "per_unit" || (savedMode === "none" && previousPerUnit)
        ? "per_unit"
        : "uniform",
    );
    setNote(periodNote ?? "");
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (next === "per_unit") {
      // Mientras las filas no se hayan tocado a mano (vacías, o todas iguales
      // porque vienen del período para todos), arrancan con el elegido arriba:
      // el caso típico es "todos 1/3 menos uno".
      const values = Object.values(rows);
      const untouched = values.every(
        (r) => r.index === values[0]?.index && r.cycle === values[0]?.cycle,
      );
      if (index != null && untouched) {
        const seed = { index, cycle: Math.max(cycle, index) };
        setRows(Object.fromEntries(units.map((u) => [u.id, seed])));
      }
    } else if (index == null) {
      const common = mostCommon(Object.values(rows));
      if (common) {
        setIndex(common.index);
        setCycle(common.cycle);
      }
    }
    setMode(next);
  }

  function applyUniformSuggestion() {
    if (!uniformSuggestion) return;
    setCycle(
      uniformSuggestion.cycle ??
        Math.max(DEFAULT_PERIOD_CYCLE, uniformSuggestion.index),
    );
    setShowTotal(uniformSuggestion.cycle != null);
    setIndex(uniformSuggestion.index);
  }

  function applyUnitSuggestions() {
    setRows((prev) =>
      Object.fromEntries(
        units.map((u) => {
          const s = suggestedFor(u.id);
          const current = prev[u.id]?.cycle ?? cycle;
          // Un depto que el mes pasado no tenía período sigue sin tenerlo.
          return [u.id, s ? rowFrom(s, current) : { index: null, cycle: current }];
        }),
      ),
    );
    setShowTotal(unitSuggestions.some((s) => s.cycle != null));
    setMode("per_unit");
  }

  // ── Validación ───────────────────────────────────────────────────────────
  const previewCycle = showTotal ? cycle : null;
  const previewLabel = formatPeriodCycle(index, previewCycle);
  // Los chips SIEMPRE tienen que llegar al índice elegido: si el valor guardado
  // (o el sugerido) supera el ciclo del borrador, el control quedaría "vacío"
  // mostrando un preview que sí tiene valor. Nunca pisamos `index` al cambiar
  // el ciclo — tipear "1" camino a "12" no puede borrar el mes elegido.
  const chipCount = Math.min(MAX_PERIOD_CYCLE, Math.max(cycle, index ?? 1));
  // Único estado imposible: "Período 4/3". Se avisa y se bloquea el guardado.
  const overflow = showTotal && index != null && index > cycle;

  const draftRows = units.map((u) => ({
    unit: u,
    row: rows[u.id] ?? { index: null, cycle },
  }));
  const chosenRows = draftRows.filter((r) => r.row.index != null);
  const rowsOverflow =
    showTotal && chosenRows.some((r) => (r.row.index ?? 0) > r.row.cycle);

  const canSave =
    mode === "uniform"
      ? index != null && !overflow
      : chosenRows.length > 0 && !rowsOverflow;
  const saveHint =
    mode === "uniform"
      ? index == null
        ? "Elegí qué mes del ciclo estás liquidando"
        : undefined
      : chosenRows.length === 0
        ? "Elegí el mes de al menos un departamento"
        : undefined;
  const hasSaved = savedLabel != null || savedUnits.length > 0;

  function save(clear = false) {
    const trimmedNote = note.trim() || null;
    const payload: SavePayload = clear
      ? { settlement_id: settlementId, index: null, cycle: null, note: null, units: [] }
      : mode === "uniform"
        ? {
            settlement_id: settlementId,
            index,
            cycle: previewCycle,
            note: trimmedNote,
            units: [],
          }
        : {
            settlement_id: settlementId,
            index: null,
            cycle: null,
            note: trimmedNote,
            units: chosenRows.map(({ unit, row }) => ({
              unit_id: unit.id,
              index: row.index as number,
              cycle: showTotal ? row.cycle : null,
            })),
          };
    start(async () => {
      const res = await savePeriod(payload);
      if (!res.ok) {
        toast.error("No se pudo guardar el período", { description: res.error });
        return;
      }
      setOpen(false);
      toast.success(
        clear || !res.label
          ? "Período quitado de la liquidación"
          : `Período actualizado · ${res.label}`,
      );
      router.refresh();
    });
  }

  const cell = (
    <PeriodCell
      periodLabel={periodLabel}
      uniformLabel={savedMode === "uniform" ? savedLabel : null}
      unitChips={
        savedMode === "per_unit"
          ? savedUnits.map((u) => ({
              code: u.code.trim(),
              short: formatPeriodCycleShort(u.period!.index, u.period!.cycle)!,
            }))
          : []
      }
      note={periodNote}
      interactive={editable}
    />
  );

  // Sin permiso de edición mostramos el mismo dato, sin affordance de click.
  if (!editable) return cell;

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
            savedMode === "per_unit" && savedUnits.length > 0
              ? `Período: ${periodLabel}, por departamento. Editar.`
              : savedLabel
                ? `Período: ${periodLabel}, ${savedLabel}. Editar.`
                : `Período: ${periodLabel}, sin período del ciclo de ajuste. Agregar.`
          }
        >
          {cell}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        collisionPadding={12}
        // pb-0: un `sticky` se pega al borde del CONTENIDO del contenedor que
        // scrollea; con padding abajo, el pie quedaba flotando y se veía el
        // texto pasar por debajo.
        className="w-[min(24rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto pb-0"
      >
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

          {canSplit && <ModeSwitch mode={mode} onChange={switchMode} />}

          {suggestion &&
            (mode === "uniform" && uniformSuggestion ? (
              <SuggestionButton onClick={applyUniformSuggestion}>
                Viene de <strong>{suggestion.fromLabel}</strong> · seguir con{" "}
                <strong>
                  {formatPeriodCycle(
                    uniformSuggestion.index,
                    uniformSuggestion.cycle,
                  )}
                </strong>
              </SuggestionButton>
            ) : (mode === "per_unit" && unitSuggestions.length > 0) ||
              (mode === "uniform" && previousPerUnit) ? (
              <SuggestionButton onClick={applyUnitSuggestions}>
                Viene de <strong>{suggestion.fromLabel}</strong> ·{" "}
                {suggestion.uniform ? (
                  <>
                    seguir con{" "}
                    <strong>
                      {formatPeriodCycle(
                        suggestion.uniform.index,
                        suggestion.uniform.cycle,
                      )}
                    </strong>{" "}
                    en todos
                  </>
                ) : (
                  "seguir el ciclo de cada departamento"
                )}
              </SuggestionButton>
            ) : null)}

          {mode === "uniform" ? (
            <>
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
                    onChange={(e) => setCycle(clampCycle(Number(e.target.value)))}
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
            </>
          ) : (
            <Field label="Mes del ciclo de cada departamento">
              <div className="rounded-md border divide-y">
                {draftRows.map(({ unit, row }) => (
                  <div key={unit.id} className="px-2.5 py-2 space-y-1.5">
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-xs font-semibold shrink-0">
                        {unit.code.trim()}
                      </span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        {unit.name}
                      </span>
                    </div>
                    <UnitPeriodControls
                      unitCode={unit.code.trim()}
                      row={row}
                      showTotal={showTotal}
                      onChange={(r) =>
                        setRows((prev) => ({ ...prev, [unit.id]: r }))
                      }
                    />
                  </div>
                ))}
              </div>
            </Field>
          )}

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-[11px] text-muted-foreground leading-tight">
              Mostrar el total del ciclo
              <span className="text-muted-foreground/70">
                {" "}
                {mode === "uniform"
                  ? `(“Período ${index ?? 1}/${cycle}” en vez de “Período ${index ?? 1}”)`
                  : "(“Período 2/3” en vez de “Período 2”)"}
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
              {mode === "uniform" && previewLabel && (
                <span className="text-primary"> · {previewLabel}</span>
              )}
            </div>
            {mode === "uniform" && index == null && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Elegí un mes arriba para agregar el período.
              </div>
            )}
            {mode === "per_unit" && (
              // Lo que va a decir cada bloque. En línea y no en lista: las filas
              // de arriba ya ocupan alto y el botón Guardar tiene que verse.
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {draftRows.map(({ unit, row }) => {
                  const label = formatPeriodCycle(
                    row.index,
                    showTotal ? row.cycle : null,
                  );
                  return (
                    <li key={unit.id} className="whitespace-nowrap">
                      <span className="font-medium">{unit.code.trim()}</span>{" "}
                      {label ? (
                        <span className="font-semibold text-primary">{label}</span>
                      ) : (
                        <span className="text-muted-foreground">no aplica</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {note.trim() && (
              <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                {note.trim()}
              </div>
            )}
          </div>

          {/* Fijo abajo: con varios deptos el popover scrollea y "Guardar"
              no puede quedar escondido debajo de la aclaración. */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-popover px-4 py-3">
            {hasSaved ? (
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
                title={saveHint}
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
 * Período de UNA unidad, en el encabezado de su bloque del documento
 * (migración 074, modo "por departamento"). Se edita en el lugar: quien está
 * revisando las filas de ese depto no tiene que subir al encabezado.
 *
 * Guarda el documento entero (los demás deptos como están): la acción recibe
 * siempre el mapa completo, así no hay dos caminos para escribir lo mismo.
 */
export function UnitPeriodChip({
  settlementId,
  unit,
  units,
  periodNote,
  editable,
}: {
  settlementId: string;
  unit: PeriodEditorUnit;
  /** Todas las unidades del documento con su período guardado. */
  units: PeriodEditorUnit[];
  /** La aclaración del documento: se conserva al guardar. */
  periodNote: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const label = unit.period
    ? formatPeriodCycle(unit.period.index, unit.period.cycle)
    : null;

  // Un depto nuevo arranca con el ciclo que ya usan los otros.
  const usualCycle =
    units.find((u) => u.period?.cycle)?.period?.cycle ?? DEFAULT_PERIOD_CYCLE;
  const [row, setRow] = useState<RowDraft>(() =>
    rowFrom(unit.period, usualCycle),
  );

  if (!editable) {
    return label ? (
      <span className={cn(UNIT_CHIP, "border-primary/25 bg-primary/10 text-primary")}>
        <CalendarRange size={10} />
        {label}
      </span>
    ) : null;
  }

  // Sin total ("Período 2") sólo si así está guardado: es una preferencia del
  // documento, no algo que este chip deba cambiar.
  const keepTotal = unit.period
    ? unit.period.cycle != null
    : !units.some((u) => u.period) || units.some((u) => u.period?.cycle);
  const overflow = keepTotal && row.index != null && row.index > row.cycle;
  const others = units.filter((u) => u.id !== unit.id && u.period);

  function save() {
    const mine =
      row.index != null
        ? [{ unit_id: unit.id, index: row.index, cycle: keepTotal ? row.cycle : null }]
        : [];
    const payload: SavePayload = {
      settlement_id: settlementId,
      index: null,
      cycle: null,
      note: periodNote,
      units: [
        ...others.map((u) => ({
          unit_id: u.id,
          index: u.period!.index,
          cycle: u.period!.cycle,
        })),
        ...mine,
      ],
    };
    start(async () => {
      const res = await savePeriod(payload);
      if (!res.ok) {
        toast.error("No se pudo guardar el período", { description: res.error });
        return;
      }
      setOpen(false);
      toast.success(
        res.label
          ? `Período actualizado · ${res.label}`
          : "Período quitado de la liquidación",
      );
      router.refresh();
    });
  }

  const nextLabel = formatPeriodCycle(row.index, keepTotal ? row.cycle : null);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setRow(rowFrom(unit.period, usualCycle));
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            UNIT_CHIP,
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            label
              ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-dashed text-muted-foreground hover:border-primary/40 hover:text-primary",
          )}
          aria-label={
            label
              ? `${unit.code.trim()}: ${label}. Cambiar.`
              : `${unit.code.trim()}: sin período. Agregar.`
          }
        >
          {label ? <CalendarRange size={10} /> : <Plus size={10} />}
          {label ?? "Período"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-2rem))]"
      >
        <div className="space-y-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {unit.code.trim()}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {unit.name}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Qué mes del ciclo de ajuste se le paga por este departamento.
            </p>
          </div>
          <UnitPeriodControls
            unitCode={unit.code.trim()}
            row={row}
            showTotal={keepTotal}
            onChange={setRow}
          />
          {others.length === 0 && row.index == null && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Es el único depto con período: sin él, la liquidación queda sin
              período (y sin la aclaración).
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground truncate">
              {nextLabel ?? "No aplica este mes"}
            </span>
            <div className="flex items-center gap-2 shrink-0">
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
                disabled={pending || overflow}
                onClick={save}
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

const UNIT_CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold";

/**
 * Mes del ciclo de UN depto: chips 1…N, "de N" (cada cuántos meses se ajusta
 * ese contrato) y "No aplica" (ese mes no se le paga un período: p. ej. se
 * alquiló por noche).
 */
function UnitPeriodControls({
  unitCode,
  row,
  showTotal,
  onChange,
}: {
  unitCode: string;
  row: RowDraft;
  showTotal: boolean;
  onChange: (row: RowDraft) => void;
}) {
  // Mismo criterio que el uniforme: los chips llegan siempre al mes elegido.
  const chipCount = Math.min(MAX_PERIOD_CYCLE, Math.max(row.cycle, row.index ?? 1));
  const overflow = showTotal && row.index != null && row.index > row.cycle;
  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-1.5 flex-wrap"
        role="group"
        aria-label={`Mes del ciclo de ${unitCode}`}
      >
        {Array.from({ length: chipCount }, (_, i) => i + 1).map((n) => (
          <Chip
            key={n}
            active={row.index === n}
            outOfRange={showTotal && n > row.cycle}
            onClick={() => onChange({ ...row, index: n })}
          >
            {n}
          </Chip>
        ))}
        <span className="text-[11px] text-muted-foreground">de</span>
        <Input
          type="number"
          min={1}
          max={MAX_PERIOD_CYCLE}
          inputMode="numeric"
          value={row.cycle}
          onChange={(e) =>
            onChange({ ...row, cycle: clampCycle(Number(e.target.value)) })
          }
          className="h-7 w-12 px-1 text-xs text-center"
          aria-label={`Cada cuántos meses se ajusta ${unitCode}`}
        />
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        <Chip active={row.index == null} onClick={() => onChange({ ...row, index: null })}>
          No aplica
        </Chip>
      </div>
      {overflow && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          No existe un “Período {row.index}/{row.cycle}”: subí el ciclo o elegí
          un mes menor.
        </p>
      )}
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  const options = [
    { value: "uniform", label: "Igual para todos", icon: CalendarRange },
    { value: "per_unit", label: "Por departamento", icon: Building2 },
  ] as const;
  return (
    <div
      role="radiogroup"
      aria-label="Cómo se carga el período"
      className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon size={12} className={mode === value ? "text-primary" : undefined} />
          {label}
        </button>
      ))}
    </div>
  );
}

function SuggestionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
    >
      <Sparkles size={13} className="text-primary mt-0.5 shrink-0" />
      <span className="text-[11px] leading-relaxed">{children}</span>
    </button>
  );
}

/**
 * Celda "Período" del encabezado. Sin período cargado muestra un affordance
 * punteado para que se note que hay algo para completar (y no un hueco mudo).
 * Por departamento muestra el chip del modo y el período de cada uno.
 */
function PeriodCell({
  periodLabel,
  uniformLabel,
  unitChips,
  note,
  interactive,
}: {
  periodLabel: string;
  uniformLabel: string | null;
  unitChips: { code: string; short: string }[];
  note: string | null;
  interactive?: boolean;
}) {
  const perUnit = unitChips.length > 0;
  // Todo <span> a propósito: en modo editable esto vive dentro de un <button>,
  // que sólo admite contenido de tipo phrasing (un <div> ahí es HTML inválido).
  return (
    <>
      <span className="block text-sm font-medium mt-0.5 truncate">
        {periodLabel}
      </span>
      {uniformLabel || perUnit ? (
        <span className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {perUnit ? <Building2 size={10} /> : <CalendarRange size={10} />}
            {perUnit ? "Por departamento" : uniformLabel}
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
      {perUnit && (
        <span className="block text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">
          {unitChips.map((c, i) => (
            <span key={`${c.code}-${i}`}>
              {i > 0 && " · "}
              <span className="font-medium text-foreground/80">{c.code}</span>{" "}
              {c.short}
            </span>
          ))}
        </span>
      )}
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
