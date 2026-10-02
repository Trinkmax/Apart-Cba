"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Calculator, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { parseAmountInput } from "@/lib/format";
import { INDEX_CODES, INDEX_META, indexFrequency, type IndexCode } from "@/lib/rentals/indices";
import { ROUNDING_LABEL } from "@/lib/rentals/labels";
import { addMonthsToMonth, isYmd, monthOf } from "@/lib/rentals/ymd";
import type { RentalRounding } from "@/lib/types/database";
import { calculateAdjustment } from "@/lib/actions/rentals-indices";
import { monthsUsedLong, shortDate } from "@/components/rentals/adjustments/adjustment-text";
import { calculatorWindows, type CalculatorInput, type CalculatorResult } from "./calculator-model";
import { CalculatorResultView } from "./calculator-result";

const EVERY_PRESETS = [3, 4, 6, 12];

/**
 * Calculadora de ajustes (también para cotizar): monto + fecha de inicio (o del
 * último ajuste) + índice + frecuencia + convención → la cadena de ajustes
 * hasta hoy y el próximo. Calcula sola mientras se escribe, en el servidor,
 * con el mismo motor que los contratos.
 */
export function AdjustmentCalculator({
  today,
  defaults,
}: {
  today: string;
  defaults: { indexCode: IndexCode; every: number; lagMonths: number; rounding: RentalRounding };
}) {
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState(() => addMonthsToMonth(monthOf(today), -12));
  const [indexCode, setIndexCode] = useState<IndexCode>(defaults.indexCode);
  const [every, setEvery] = useState(defaults.every);
  const [lag, setLag] = useState(defaults.lagMonths >= 2 ? 2 : 1);
  const [rounding, setRounding] = useState<RentalRounding>(defaults.rounding);
  const [result, setResult] = useState<{ key: string; input: CalculatorInput; data: CalculatorResult; text: string } | { key: string; error: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);

  const parsedAmount = parseAmountInput(amount);
  const valid = parsedAmount != null && parsedAmount > 0 && isYmd(startDate) && every >= 1 && every <= 12;
  const monthly = indexFrequency(indexCode) === "monthly";
  const key = JSON.stringify([parsedAmount, startDate, indexCode, every, monthly ? lag : 0, rounding]);

  // Ejemplo de la convención con la fecha que eligió la persona.
  const example = useMemo(() => {
    if (!monthly || !isYmd(startDate)) return null;
    const mk = (l: number) => calculatorWindows({ amount: 1, startDate, every, indexCode, lagMonths: l, rounding: "none", today })[0];
    const w = mk(lag);
    if (!w?.fromMonth || !w.toMonth) return null;
    return `Para el ajuste del ${shortDate(w.effectiveDate)} usa la inflación de ${monthsUsedLong(w.fromMonth, w.toMonth)}.`;
  }, [monthly, startDate, every, indexCode, lag, today]);

  useEffect(() => {
    if (!valid) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await calculateAdjustment({ amount: parsedAmount!, startDate, every, indexCode, lagMonths: monthly ? lag : 2, rounding });
        if (id !== seq.current) return;
        setCopied(false);
        setResult(res.ok ? { key, input: res.input, data: res.result, text: res.summaryText } : { key, error: res.error });
      });
    }, 350);
    return () => clearTimeout(t);
  }, [key, valid, parsedAmount, startDate, every, indexCode, monthly, lag, rounding]);

  const current = result && result.key === key && valid ? result : null;

  async function copy() {
    if (!current || "error" in current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      setCopied(true);
      toast.success("Resultado copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <Card className="gap-0 p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Calculator size={15} className="text-[#0d9488]" /> Calculadora de ajustes
        </h2>
        {current && !("error" in current) && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Copiar"}
          </Button>
        )}
      </div>
      <div className="space-y-3.5 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="calc-amount" className="text-xs">Alquiler</Label>
            <Input id="calc-amount" type="text" inputMode="decimal" placeholder="500.000" className="h-10 tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calc-start" className="text-xs">Desde</Label>
            <Input id="calc-start" type="date" className="h-10" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>
        <p className="-mt-1.5 text-[11px] text-muted-foreground">Fecha de inicio del contrato o del último ajuste, con el alquiler de ese momento.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Índice</Label>
            <Select value={indexCode} onValueChange={(v) => setIndexCode(v as IndexCode)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDEX_CODES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {INDEX_META[c].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Redondeo</Label>
            <Select value={rounding} onValueChange={(v) => setRounding(v as RentalRounding)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROUNDING_LABEL) as RentalRounding[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROUNDING_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Se ajusta cada</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {EVERY_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEvery(m)}
                aria-pressed={every === m}
                className={cn(
                  "h-8 min-w-10 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors",
                  every === m ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                {m} meses
              </button>
            ))}
            <Input
              type="number"
              min={1}
              max={12}
              aria-label="Otra frecuencia en meses"
              className="h-8 w-16 text-xs text-center"
              value={EVERY_PRESETS.includes(every) ? "" : every}
              placeholder="otra"
              onChange={(e) => {
                const v = Math.floor(Number(e.target.value));
                if (v >= 1 && v <= 12) setEvery(v);
              }}
            />
          </div>
        </div>
        {monthly && (
          <div className="space-y-1.5">
            <Label className="text-xs">Qué meses del índice usa</Label>
            <div className="inline-flex w-full rounded-lg bg-muted p-1 text-xs">
              {[
                { v: 2, label: "Último dato publicado" },
                { v: 1, label: "Meses del ciclo" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setLag(o.v)}
                  aria-pressed={lag === o.v}
                  className={cn("flex-1 rounded-md px-2 py-1.5 transition-colors", lag === o.v ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {example && <p className="text-[11px] text-muted-foreground">{example}</p>}
          </div>
        )}
      </div>
      <div className="border-t bg-muted/20 px-4 py-4 min-h-36" aria-live="polite">
        {!valid ? (
          <p className="text-sm text-muted-foreground">Cargá el alquiler y la fecha para ver cuánto queda después de cada ajuste.</p>
        ) : !current ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Calculando…
          </p>
        ) : "error" in current ? (
          <p className="text-sm text-rose-700 dark:text-rose-300">{current.error}</p>
        ) : (
          <div className={cn("transition-opacity", pending && "opacity-60")}>
            <CalculatorResultView input={current.input} result={current.data} />
          </div>
        )}
      </div>
    </Card>
  );
}
