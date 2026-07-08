"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { generateSettlementsForPeriod } from "@/lib/actions/settlements";
import { MONTHS, SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type PeriodSettlement = {
  id: string;
  status: string;
  net_payable: number;
  currency: string;
};

type Row = {
  owner: { id: string; full_name: string };
  units: number;
  settlements: PeriodSettlement[];
};

const CURRENCIES = ["ARS", "USD", "EUR", "USDT"];

export function PeriodBatchPanel({
  year,
  month,
  currency,
  rows,
  canCreate,
}: {
  year: number;
  month: number;
  /** Filtro de vista: "all" o una moneda. */
  currency: string;
  rows: Row[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Transición dedicada a los cambios de período: mantiene la tabla actual
  // visible (sin flash del skeleton) mientras el server trae los datos nuevos.
  const [navPending, startNav] = useTransition();
  const [query, setQuery] = useState("");
  const nowYear = new Date().getFullYear();

  function navigate(next: { year?: number; month?: number; currency?: string }) {
    const y = next.year ?? year;
    const m = next.month ?? month;
    const c = next.currency ?? currency;
    startNav(() => {
      router.push(
        `/dashboard/liquidaciones?tab=periodo&year=${y}&month=${m}&currency=${c}`,
      );
    });
  }

  function generateAll() {
    start(async () => {
      try {
        const res = await generateSettlementsForPeriod(year, month);
        const ok = res.filter((r) => r.ok).length;
        const skipped = res.length - ok;
        toast.success(`${ok} liquidaciones generadas`, {
          description: skipped
            ? `${skipped} sin cambios (sin unidades, ya cerradas o sin reservas).`
            : "Todas al día — una por moneda.",
        });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  // Una fila por liquidación; los propietarios sin ninguna se muestran una vez.
  type DisplayRow = {
    owner: { id: string; full_name: string };
    units: number;
    st: PeriodSettlement | null;
  };
  const display: DisplayRow[] = [];
  for (const r of rows) {
    if (r.settlements.length === 0) {
      display.push({ owner: r.owner, units: r.units, st: null });
    } else {
      for (const st of r.settlements) {
        display.push({ owner: r.owner, units: r.units, st });
      }
    }
  }
  const scoped =
    currency === "all"
      ? display
      : display.filter((d) => !d.st || d.st.currency === currency);
  // El buscador es un "encontrar", no un filtro de alcance: afina las filas
  // visibles por nombre de propietario, pero los totales de abajo siguen
  // reflejando el período completo (según la moneda elegida).
  const q = query.trim().toLowerCase();
  const visible = q
    ? scoped.filter((d) => d.owner.full_name.toLowerCase().includes(q))
    : scoped;

  // Totales por moneda (no se pueden sumar monedas distintas).
  const totalsByCcy = new Map<string, { count: number; sum: number }>();
  for (const d of scoped) {
    if (!d.st) continue;
    const t = totalsByCcy.get(d.st.currency) ?? { count: 0, sum: 0 };
    t.count += 1;
    t.sum += Number(d.st.net_payable);
    totalsByCcy.set(d.st.currency, t);
  }
  const ccyTotals = Array.from(totalsByCcy.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <Card className="overflow-hidden p-0 gap-0">
      <div className="p-4 sm:p-5 border-b flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Año
          </label>
          <Select
            value={String(year)}
            onValueChange={(v) => navigate({ year: Number(v) })}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[nowYear - 1, nowYear, nowYear + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mes
          </label>
          <Select
            value={String(month)}
            onValueChange={(v) => navigate({ month: Number(v) })}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Moneda
          </label>
          <Select
            value={currency}
            onValueChange={(v) => navigate({ currency: v })}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Buscar
          </label>
          <div className="relative w-44 sm:w-52">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Propietario…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>
        <div className="ml-auto">
          {canCreate && (
            <Button
              onClick={generateAll}
              disabled={pending}
              className="gap-2"
            >
              {pending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Generar todas
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "overflow-x-auto transition-opacity",
          navPending && "opacity-60 pointer-events-none",
        )}
        aria-busy={navPending}
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Propietario</TableHead>
              <TableHead className="text-center">Unidades</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  {q
                    ? `Sin resultados para «${query.trim()}».`
                    : "No hay propietarios activos."}
                </TableCell>
              </TableRow>
            )}
            {visible.map((d, i) => {
              const st = d.st;
              const meta = st
                ? SETTLEMENT_STATUS_META[
                    st.status as keyof typeof SETTLEMENT_STATUS_META
                  ]
                : null;
              return (
                <TableRow key={st ? st.id : `${d.owner.id}-none-${i}`} className="text-sm">
                  <TableCell className="font-medium">
                    {d.owner.full_name}
                  </TableCell>
                  <TableCell className="text-center tabular-nums text-muted-foreground">
                    {d.units}
                  </TableCell>
                  <TableCell>
                    {st ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {st.currency}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {meta ? (
                      <Badge
                        className="font-normal gap-1.5"
                        style={{
                          color: meta.color,
                          backgroundColor: meta.color + "15",
                          borderColor: meta.color + "30",
                        }}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        {meta.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Sin generar
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {st
                      ? formatMoney(Number(st.net_payable), st.currency)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {st && (
                      <Link
                        href={`/dashboard/liquidaciones/${st.id}`}
                        className="text-muted-foreground hover:text-foreground inline-flex"
                        aria-label="Ver liquidación"
                      >
                        <ChevronRight size={16} />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {ccyTotals.length > 0 && (
            <TableFooter>
              {ccyTotals.map(([ccy, t]) => (
                <TableRow key={ccy} className="font-semibold">
                  <TableCell colSpan={4} className="text-right">
                    Total a transferir ({ccy}) · {t.count} liq.
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(t.sum, ccy)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableFooter>
          )}
        </Table>
      </div>
    </Card>
  );
}
