"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parsePercentInput } from "@/lib/format";
import {
  INDEX_CODES,
  INDEX_META,
  MONTHLY_COEFFICIENT_RANGE,
  indexFrequency,
  isCoefficientIndex,
  missingMonths,
  type IndexCode,
} from "@/lib/rentals/indices";
import { deleteManualIndexValue, listManualIndexValues, saveManualIndexValue } from "@/lib/actions/rentals-indices";
import { formatVariation, monthName, shortDate } from "@/components/rentals/adjustments/adjustment-text";

const LEVEL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 6 });
const SOURCE_LABEL: Record<string, string> = { manual: "a mano", indec: "INDEC", bcra: "BCRA", datos_gob: "datos.gob.ar", argentinadatos: "ArgentinaDatos" };

/** Más de +10 % en un mes no es un coeficiente mensual creíble: probablemente pegaron el acumulado del semestre. */
const COEF_SUSPICIOUS = 1.1;

const pctOf = (coef: number) => Math.round((coef - 1) * 10000) / 100;

/**
 * Carga manual de un índice (sólo superadmin): Casa Propia no tiene fuente
 * que se pueda leer sola. De los índices de nivel se guarda el NIVEL, no la
 * variación; de Casa Propia, el coeficiente de cada mes tal como lo publica
 * el Ministerio (la serie los encadena para calcular los ajustes).
 */
export function ManualIndexDialog({ defaultCode = "casa_propia", children }: { defaultCode?: IndexCode; children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<IndexCode>(defaultCode);
  const [period, setPeriod] = useState("");
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<{ period: string; value: number; source: string }[] | null>(null);
  const [reload, setReload] = useState(0);
  const monthly = indexFrequency(code) === "monthly";
  const coef = isCoefficientIndex(code);
  const typed = parsePercentInput(value);
  const gaps = coef && rows ? missingMonths(rows.map((r) => r.period)) : [];

  useEffect(() => {
    if (!open) return;
    let alive = true;
    listManualIndexValues(code).then((res) => {
      if (alive) setRows(res.ok ? res.values : []);
    });
    return () => {
      alive = false;
    };
  }, [open, code, reload]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    // Un solo separador = decimal ("1.234567" o "1,234567"); con miles, es-AR ("12.276,766").
    const n = parsePercentInput(value);
    const key = monthly ? (period ? `${period}-01` : "") : period;
    if (!key) return toast.error(monthly ? "Elegí el mes" : "Elegí el día");
    if (coef) {
      if (n == null || !(n > MONTHLY_COEFFICIENT_RANGE.min && n < MONTHLY_COEFFICIENT_RANGE.max)) {
        return toast.error("Ingresá el coeficiente del mes", {
          description: "Es el número que publica el Ministerio para ese mes, por ejemplo 1,0281 (no el porcentaje). Va entre 0,8 y 1,5.",
        });
      }
    } else if (n == null || n <= 0) {
      return toast.error("Ingresá el valor del índice", { description: "Es el nivel publicado, por ejemplo 1,2345." });
    }
    startTransition(async () => {
      const res = await saveManualIndexValue(code, key, n);
      if (!res.ok) {
        toast.error("No se pudo guardar", { description: res.error });
        return;
      }
      toast.success(`${INDEX_META[code].label} de ${monthly ? monthName(res.period, true) : shortDate(res.period)} guardado`, {
        description: "Los ajustes que lo esperaban se recalculan solos.",
      });
      setValue("");
      setReload((x) => x + 1);
      router.refresh();
    });
  }

  function remove(p: string) {
    startTransition(async () => {
      const res = await deleteManualIndexValue(code, p);
      if (!res.ok) {
        toast.error("No se pudo borrar", { description: res.error });
        return;
      }
      setReload((x) => x + 1);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center">
              <DatabaseZap size={16} />
            </span>
            Cargar un valor de índice
          </DialogTitle>
          <DialogDescription>
            {coef
              ? "Lo ven todas las inmobiliarias. Cargá el coeficiente de cada mes tal como lo publica el Ministerio (por ejemplo 1,0281 = +2,81 % en el mes), no el acumulado del semestre: el ajuste lo calculamos multiplicando los meses."
              : "Lo ven todas las inmobiliarias. Cargá el nivel tal como lo publica la fuente oficial (no el porcentaje)."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Índice</Label>
              <Select value={code} onValueChange={(v) => { setCode(v as IndexCode); setPeriod(""); setRows(null); }}>
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
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="mi-period">{monthly ? "Mes" : "Día"}</Label>
              <Input id="mi-period" type={monthly ? "month" : "date"} className="h-10" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-value">{coef ? "Coeficiente del mes" : "Valor (nivel)"}</Label>
            <Input id="mi-value" type="text" inputMode="decimal" placeholder={coef ? "Ej.: 1,0281" : "Ej.: 1,234567"} className="h-10 tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
            {coef && typed != null && typed >= COEF_SUSPICIOUS && typed < MONTHLY_COEFFICIENT_RANGE.max && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {LEVEL.format(typed)} es {formatVariation(pctOf(typed))} en un solo mes: ¿no es el acumulado del semestre? Cargá el coeficiente de cada mes.
              </p>
            )}
          </div>
          <Button type="submit" className="w-full gap-2" disabled={pending}>
            {pending && <Loader2 size={14} className="animate-spin" />} Guardar valor
          </Button>
        </form>
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Últimos valores</p>
          {gaps.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Falta cargar {gaps.map((g) => monthName(g, true)).join(", ")}: sin {gaps.length === 1 ? "ese mes" : "esos meses"} no se pueden calcular los ajustes que {gaps.length === 1 ? "lo incluyen" : "los incluyen"}.
            </p>
          )}
          {rows == null ? (
            <p className="text-xs text-muted-foreground py-2">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Todavía no hay valores de {INDEX_META[code].label}.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto divide-y rounded-lg border text-xs">
              {rows.map((r) => (
                <li key={r.period} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="capitalize">{monthly ? monthName(r.period, true) : shortDate(r.period)}</span>
                  <span className="ml-auto tabular-nums font-medium">
                    {LEVEL.format(r.value)}
                    {coef && <span className="ml-1.5 font-normal text-muted-foreground">{formatVariation(pctOf(r.value))}</span>}
                  </span>
                  <span className="w-20 text-right text-muted-foreground">{SOURCE_LABEL[r.source] ?? r.source}</span>
                  {r.source === "manual" ? (
                    <button type="button" onClick={() => remove(r.period)} disabled={pending} className="rounded p-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10" aria-label="Borrar valor">
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <span className="w-[21px]" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
