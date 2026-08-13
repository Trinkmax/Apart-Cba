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
import type { StatementModel, StatementBookingRow } from "@/lib/settlements/statement-model";

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
 *
 * Responde por CONTAINER QUERIES, no por viewport (`@container` en la Card +
 * variantes `@[…]`). El mismo documento se dibuja en tres anchos muy distintos
 * —el panel con sidebar, el link público que el dueño abre en el celular y la
 * landing— y lo que importa es cuánto mide la tarjeta, no la pantalla: con
 * `md:` una liquidación dentro del panel en una laptop angosta se seguía
 * pintando "de escritorio" y la planilla salía cortada.
 *
 * Por debajo de ~50rem la planilla de 8 columnas no entra sin scroll lateral,
 * así que se reemplaza por una lista: una tarjeta por reserva con el neto
 * arriba y el desglose (bruto, comisión, gastos) abajo. Misma información, en
 * vertical, que es como se lee en un teléfono.
 */
export function SettlementStatement({ model }: { model: StatementModel }) {
  const c = model.currency;

  return (
    <Card className="@container overflow-hidden p-0 gap-0">
      {/* Encabezado documento */}
      <div className="brand-gradient text-white px-4 py-4 @[34rem]:px-7 @[34rem]:py-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.12),transparent_60%)]" />
        <div className="relative flex flex-col gap-3 @[34rem]:flex-row @[34rem]:items-start @[34rem]:justify-between @[34rem]:gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] opacity-80">
              Estado de liquidación
            </div>
            <div className="text-lg @[34rem]:text-xl font-bold mt-1 font-mono">
              {model.number}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 @[34rem]:flex-col @[34rem]:items-end @[34rem]:gap-1">
            <div className="text-base @[34rem]:text-lg font-semibold">
              {model.periodLabel}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {model.periodCycleLabel && (
                <span
                  className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "oklch(1 0 0 / 0.22)" }}
                >
                  {model.periodCycleLabel}
                </span>
              )}
              <div
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
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
      </div>

      {/* Datos */}
      <dl className="grid grid-cols-2 gap-px bg-border">
        <div className="bg-card px-4 py-3 min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Propietario
          </dt>
          {/* Sin `truncate`: el nombre del dueño es lo último que se puede
              recortar en su propia liquidación. */}
          <dd className="text-sm font-medium mt-0.5 leading-snug break-words">
            {model.owner.full_name}
          </dd>
        </div>
        <div className="bg-card px-4 py-3 min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Período
          </dt>
          <dd className="text-sm font-medium mt-0.5 leading-snug">
            {model.periodLabel}
          </dd>
          {model.periodCycleLabel && (
            <dd className="mt-1">
              <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {model.periodCycleLabel}
              </span>
            </dd>
          )}
          {model.periodNote && (
            <dd className="text-[11px] text-muted-foreground mt-1 leading-snug">
              {model.periodNote}
            </dd>
          )}
        </div>
      </dl>

      {/* KPIs: 2x2 en angosto, una fila de 4 cuando hay lugar. El neto queda
          siempre en el último casillero — nada de `col-span-2` en angosto, que
          dejaba un hueco gris en la grilla. */}
      <div className="grid grid-cols-2 @[34rem]:grid-cols-4 gap-px bg-border border-y">
        <Kpi label="Bruto" value={formatMoney(model.totals.gross, c)} />
        <Kpi label="Comisión" value={`−${formatMoney(model.totals.commission, c)}`} />
        <Kpi label="Gastos" value={`−${formatMoney(model.totals.deductions, c)}`} />
        <div className="bg-primary/5 px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Neto por pagar
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
      <div className="p-3 @[34rem]:p-6 space-y-5 @[34rem]:space-y-6">
        {model.units.length === 0 && model.otros.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            La liquidación no tiene movimientos.
          </p>
        )}

        {model.units.map((u) => (
          <div key={u.code} className="space-y-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold min-w-0">
                {u.code}{" "}
                <span className="text-muted-foreground font-normal">
                  · {u.name}
                </span>
              </h3>
            </div>

            {/* Ancho: planilla clásica */}
            <div className="hidden @[50rem]:block rounded-lg border overflow-x-auto">
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

            {/* Angosto: una tarjeta por reserva */}
            <div className="@[50rem]:hidden rounded-lg border divide-y overflow-hidden">
              {u.rows.map((b) => (
                <BookingCard key={b.ref_id} row={b} currency={c} />
              ))}

              <div className="bg-muted/40 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Subtotal {u.code}
                  </span>
                  <span className="text-sm font-bold tabular-nums shrink-0">
                    {formatMoney(u.subtotal.net, c)}
                  </span>
                </div>
                <Breakdown
                  gross={u.subtotal.gross}
                  commission={u.subtotal.commission}
                  expenses={u.subtotal.expenses}
                  currency={c}
                />
              </div>
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
                    className="flex items-center gap-3 px-3 @[34rem]:px-4 py-2.5 text-sm"
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
          <div className="rounded-lg bg-muted/40 border p-3 @[34rem]:p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Pagar a
            </div>
            <div className="grid grid-cols-1 @[34rem]:grid-cols-3 gap-3 text-sm">
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
                <div className="font-mono break-all select-all">
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

/** Fila de reserva en vertical, para anchos donde la planilla no entra. */
function BookingCard({ row: b, currency }: { row: StatementBookingRow; currency: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {b.guest}
          {b.mode === "mensual" && (
            <span className="ml-1 text-[10px] text-muted-foreground">mensual</span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Neto
          </span>
          <span className="text-sm font-bold tabular-nums">
            {formatMoney(b.net, currency)}
          </span>
        </span>
      </div>

      <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
        {b.check_in ? formatDate(b.check_in) : "—"} → {b.check_out ? formatDate(b.check_out) : "—"}
        {b.nights ? ` · ${b.nights} ${b.nights === 1 ? "noche" : "noches"}` : ""}
      </div>

      <Breakdown
        gross={b.gross}
        commission={b.commission}
        expenses={b.expenses}
        currency={currency}
      />
    </div>
  );
}

/** Bruto / comisión / gastos en una línea que envuelve si no entra. */
function Breakdown({
  gross,
  commission,
  expenses,
  currency,
}: {
  gross: number;
  commission: number;
  expenses: number;
  currency: string;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
      <span>
        Bruto{" "}
        <span className="font-medium text-foreground">{formatMoney(gross, currency)}</span>
      </span>
      {commission > 0 && (
        <span>
          Comisión{" "}
          <span className="font-medium text-rose-600 dark:text-rose-400">
            −{formatMoney(commission, currency)}
          </span>
        </span>
      )}
      {expenses > 0 && (
        <span>
          Gastos{" "}
          <span className="font-medium text-rose-600 dark:text-rose-400">
            −{formatMoney(expenses, currency)}
          </span>
        </span>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-base @[34rem]:text-lg font-semibold mt-1 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}
