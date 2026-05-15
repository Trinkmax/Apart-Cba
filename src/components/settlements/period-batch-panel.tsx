"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

type Row = {
  owner: { id: string; full_name: string };
  units: number;
  settlement: {
    id: string;
    status: string;
    net_payable: number;
    currency: string;
  } | null;
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
  currency: string;
  rows: Row[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const nowYear = new Date().getFullYear();

  function navigate(next: { year?: number; month?: number; currency?: string }) {
    const y = next.year ?? year;
    const m = next.month ?? month;
    const c = next.currency ?? currency;
    router.push(`/dashboard/liquidaciones/periodo?year=${y}&month=${m}&currency=${c}`);
  }

  function generateAll() {
    start(async () => {
      try {
        const res = await generateSettlementsForPeriod(year, month, currency);
        const ok = res.filter((r) => r.ok).length;
        const skipped = res.length - ok;
        toast.success(`${ok} liquidaciones generadas`, {
          description: skipped
            ? `${skipped} sin cambios (sin unidades o ya cerradas).`
            : "Todas al día.",
        });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  const generated = rows.filter((r) => r.settlement);
  const total = generated
    .filter((r) => r.settlement!.currency === currency)
    .reduce((acc, r) => acc + Number(r.settlement!.net_payable), 0);

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
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Propietario</TableHead>
              <TableHead className="text-center">Unidades</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  No hay propietarios activos.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const st = r.settlement;
              const meta = st
                ? SETTLEMENT_STATUS_META[
                    st.status as keyof typeof SETTLEMENT_STATUS_META
                  ]
                : null;
              return (
                <TableRow key={r.owner.id} className="text-sm">
                  <TableCell className="font-medium">
                    {r.owner.full_name}
                  </TableCell>
                  <TableCell className="text-center tabular-nums text-muted-foreground">
                    {r.units}
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
          {generated.length > 0 && (
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell colSpan={3} className="text-right">
                  Total a transferir ({currency}) · {generated.length} liq.
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(total, currency)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </Card>
  );
}
