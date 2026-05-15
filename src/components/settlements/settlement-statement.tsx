import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SETTLEMENT_LINE_META } from "@/lib/settlements/labels";
import type { StatementModel } from "@/lib/settlements/statement-model";

function Neg({ n, currency }: { n: number; currency: string }) {
  if (!n) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-rose-600 dark:text-rose-400 tabular-nums">
      −{formatMoney(n, currency)}
    </span>
  );
}

/**
 * Documento "estado de cuenta": header, datos, KPIs, planilla por unidad
 * con subtotales, otros cargos y datos bancarios. Presentacional (RSC).
 */
export function SettlementStatement({ model }: { model: StatementModel }) {
  const c = model.currency;

  return (
    <Card className="overflow-hidden p-0 gap-0">
      {/* Encabezado documento */}
      <div className="brand-gradient text-white px-5 sm:px-7 py-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.12),transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] opacity-80">
              Estado de liquidación
            </div>
            <div className="text-lg sm:text-xl font-bold mt-1 font-mono">
              {model.number}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base sm:text-lg font-semibold">
              {model.periodLabel}
            </div>
            <div
              className="inline-flex items-center gap-1.5 text-[11px] font-medium mt-1 px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "oklch(1 0 0 / 0.16)" }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: model.statusColor }}
              />
              {model.statusLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Datos */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        {[
          ["Propietario", model.owner.full_name],
          ["Período", model.periodLabel],
          ["Moneda", model.currency],
          ["Generada", formatDate(model.generated_at, "dd/MM/yyyy HH:mm")],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {k}
            </dt>
            <dd className="text-sm font-medium mt-0.5 truncate">{v}</dd>
          </div>
        ))}
      </dl>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-y">
        <Kpi label="Bruto" value={formatMoney(model.totals.gross, c)} />
        <Kpi label="Comisión" value={`−${formatMoney(model.totals.commission, c)}`} />
        <Kpi label="Gastos" value={`−${formatMoney(model.totals.deductions, c)}`} />
        <div className="bg-primary/5 px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Neto a transferir
          </div>
          <div
            className={cn(
              "text-xl font-bold mt-1 tabular-nums",
              model.totals.net >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {formatMoney(model.totals.net, c)}
          </div>
        </div>
      </div>

      {/* Planilla por unidad */}
      <div className="p-4 sm:p-6 space-y-6">
        {model.units.length === 0 && model.otros.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            La liquidación no tiene movimientos.
          </p>
        )}

        {model.units.map((u) => (
          <div key={u.code} className="space-y-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">
                {u.code}{" "}
                <span className="text-muted-foreground font-normal">
                  · {u.name}
                </span>
              </h3>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="h-9">Ingreso</TableHead>
                    <TableHead className="h-9">Egreso</TableHead>
                    <TableHead className="h-9">Huésped</TableHead>
                    <TableHead className="h-9 text-center">Noches</TableHead>
                    <TableHead className="h-9 text-right">Bruto</TableHead>
                    <TableHead className="h-9 text-right">Comisión</TableHead>
                    <TableHead className="h-9 text-right">Gastos</TableHead>
                    <TableHead className="h-9 text-right">Neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {u.rows.map((b) => (
                    <TableRow key={b.ref_id} className="text-sm">
                      <TableCell className="whitespace-nowrap">
                        {b.check_in ? formatDate(b.check_in) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {b.check_out ? formatDate(b.check_out) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {b.guest}
                        {b.mode === "mensual" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            mensual
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {b.nights ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(b.gross, c)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Neg n={b.commission} currency={c} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Neg n={b.expenses} currency={c} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {formatMoney(b.net, c)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={4} className="text-right">
                      Subtotal {u.code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(u.subtotal.gross, c)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Neg n={u.subtotal.commission} currency={c} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Neg n={u.subtotal.expenses} currency={c} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(u.subtotal.net, c)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
        ))}

        {/* Otros cargos */}
        {model.otros.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">Otros cargos</h3>
            </div>
            <div className="rounded-lg border divide-y">
              {model.otros.map((o, i) => {
                const lm = SETTLEMENT_LINE_META[o.line_type];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm"
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: lm?.color ?? "#64748b" }}
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {o.description}
                      {o.unitCode && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground font-mono">
                          {o.unitCode}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums font-medium shrink-0",
                        o.sign === "+"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {o.sign === "+" ? "+" : "−"}
                      {formatMoney(o.amount, c)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pagar a */}
        {(model.owner.bank_name || model.owner.cbu || model.owner.alias_cbu) && (
          <div className="rounded-lg bg-muted/40 border p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Pagar a
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Banco</div>
                <div className="font-medium">
                  {model.owner.bank_name ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">CBU</div>
                <div className="font-mono text-xs break-all select-all">
                  {model.owner.cbu ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Alias</div>
                <div className="font-mono select-all">
                  {model.owner.alias_cbu ?? "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-base sm:text-lg font-semibold mt-1 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}
