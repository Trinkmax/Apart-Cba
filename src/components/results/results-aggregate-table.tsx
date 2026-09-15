import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
import { monthNameLower, TOL, type AggregateView, type ResultsMode } from "@/lib/finance/results-issues";
import type { AggregateRow, OwnerBridge } from "@/lib/finance/results-reconciliation";
import { SegmentedNav } from "./results-mode-nav";
import {
  AGGREGATE_VIEW_META,
  AGGREGATE_VIEW_ORDER,
  NEGATIVE_TEXT,
  RESULT_BUCKET_META,
  formatPct,
  formatSignedPct,
  resultsHref,
  signedMoney,
} from "./results-meta";
import { CurrencyChip, Hint, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Reparto del mes por depto, propietario o canal (`?vista=`).
 *
 * Cada celda de plata muestra lo liquidado y conciliado; si hay reservas sin
 * liquidar, abajo en gris "≈ +{estimado}". "Paga el huésped" es siempre el
 * total del calendario. La diferencia de tarifa no tiene estimado: sin
 * liquidación no hay tarifa del propietario contra la cual medirla.
 *
 * Server component: el selector de vista son links.
 */
export function ResultsAggregateTable({
  byUnit,
  byOwner,
  byChannel,
  vista,
  year,
  month,
  mode,
  baseCurrency,
}: {
  byUnit: AggregateRow[];
  byOwner: AggregateRow[];
  byChannel: AggregateRow[];
  vista: AggregateView;
  year: number;
  month: number;
  mode: ResultsMode;
  baseCurrency: string;
}) {
  const source = vista === "depto" ? byUnit : vista === "propietario" ? byOwner : byChannel;
  // Ya vienen por "Paga el huésped" descendente; la moneda base va primero
  // para que un USD grande no quede mezclado entre los pesos.
  const rows = [...source].sort(
    (a, b) => Number(a.currency !== baseCurrency) - Number(b.currency !== baseCurrency),
  );
  const multiCurrency = rows.some((r) => r.currency !== baseCurrency);
  // El documento del propietario no se parte por modo: con un filtro de modo
  // la columna mentiría, así que se oculta.
  const showSettlement = vista === "propietario" && mode === "todos";
  const monthLabel = monthNameLower(month);
  const cols = vista === "canal" ? 8 : vista === "propietario" ? (showSettlement ? 9 : 8) : 9;

  const selector = (
    <SegmentedNav
      label="Agrupar por"
      items={AGGREGATE_VIEW_ORDER.map((v) => ({
        key: v,
        label: AGGREGATE_VIEW_META[v].label,
        href: resultsHref(year, month, { modo: mode, vista: v }),
        active: v === vista,
      }))}
    />
  );

  return (
    <ResultsSection
      title="Reparto del mes"
      subtitle="Montos de las reservas liquidadas sin errores. En gris (≈), lo estimado de las que faltan liquidar."
      actions={selector}
    >
      {vista === "propietario" && mode !== "todos" && (
        <p className="text-xs text-muted-foreground">
          La liquidación se ve con{" "}
          <Link
            href={resultsHref(year, month, { vista })}
            scroll={false}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Todos
          </Link>
        </p>
      )}
      <ResultsTable
        height="normal"
        stickyFirstCol
        className={vista === "canal" ? "min-w-[980px]" : showSettlement ? "min-w-[1180px]" : "min-w-[1060px]"}
      >
        <thead>
          <tr>
            <Th>{vista === "depto" ? "Depto" : vista === "propietario" ? "Propietario" : "Canal"}</Th>
            <Th align="right">Reservas</Th>
            <Th align="right">Paga el huésped</Th>
            {vista === "canal" && <Th align="right">Plataformas</Th>}
            <Th align="right">Dif. tarifa</Th>
            <Th align="right">Tu comisión</Th>
            <Th align="right">Limpieza y gastos</Th>
            <Th align="right">{vista === "propietario" ? "Neto de las reservas del mes" : "Neto al propietario"}</Th>
            {vista !== "canal" && <Th align="right">Otros cargos del mes</Th>}
            {vista === "depto" && <Th>Estado</Th>}
            {showSettlement && <Th>Liquidación de {monthLabel}</Th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols} className="px-3 py-8 text-center text-sm text-muted-foreground">
                Sin reservas para mostrar en este mes.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="transition-colors hover:bg-muted/30">
                <Td className="max-w-[16rem] align-top">
                  <FirstCell row={r} vista={vista} multiCurrency={multiCurrency} />
                </Td>
                <Td align="right" className="align-top">
                  {r.bookings > 0 ? r.bookings : <span className="text-muted-foreground">—</span>}
                </Td>
                <Td align="right" className="align-top font-semibold">
                  {r.bookings > 0 ? (
                    formatMoney(r.guest_total, r.currency)
                  ) : (
                    <span className="font-normal text-muted-foreground">—</span>
                  )}
                </Td>
                {vista === "canal" && (
                  <FlowCell settled={r.settled.channel} estimated={r.estimated.channel} currency={r.currency} />
                )}
                <DiffCell row={r} />
                <FlowCell settled={r.settled.commission} estimated={r.estimated.commission} currency={r.currency} />
                <FlowCell settled={r.settled.expenses_net} estimated={r.estimated.expenses} currency={r.currency} />
                <FlowCell
                  settled={r.settled.owner_net}
                  estimated={r.estimated.owner_net}
                  currency={r.currency}
                  strong
                />
                {vista !== "canal" && <OtherChargesCell value={r.other_charges_net} currency={r.currency} />}
                {vista === "depto" && (
                  <Td className="align-top">
                    <StateChips row={r} />
                  </Td>
                )}
                {showSettlement && (
                  <Td className="align-top">
                    <SettlementCell row={r} year={year} month={month} />
                  </Td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </ResultsTable>
    </ResultsSection>
  );
}

function FirstCell({ row, vista, multiCurrency }: { row: AggregateRow; vista: AggregateView; multiCurrency: boolean }) {
  const chip = multiCurrency ? <CurrencyChip currency={row.currency} /> : null;

  if (vista === "canal") {
    const meta = row.source ? BOOKING_SOURCE_META[row.source] : undefined;
    return (
      <>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: meta?.color ?? "#64748b" }} aria-hidden />
          <span className="font-semibold">{row.label}</span>
          {chip}
        </div>
        <div className="mt-0.5 text-[11px]">
          {row.channel_pct === null ? (
            <Link
              href="/dashboard/configuracion/comisiones"
              className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-px font-medium text-amber-800 hover:underline dark:text-amber-200"
            >
              Sin comisión
            </Link>
          ) : (
            <span className="text-muted-foreground tabular-nums">{formatPct(row.channel_pct)}</span>
          )}
        </div>
      </>
    );
  }

  const href =
    vista === "depto"
      ? row.unit_id
        ? `/dashboard/unidades/${row.unit_id}`
        : null
      : row.owner_id
        ? `/dashboard/propietarios/${row.owner_id}`
        : null;

  return (
    <>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {href ? (
          <Link href={href} className="font-semibold hover:underline">
            {row.label}
          </Link>
        ) : (
          <span className="font-semibold italic text-muted-foreground">{row.label}</span>
        )}
        {chip}
      </div>
      {row.sublabel && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={row.sublabel}>
          {row.sublabel}
        </div>
      )}
    </>
  );
}

function FlowCell({
  settled,
  estimated,
  currency,
  strong,
}: {
  settled: number;
  estimated: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <Td align="right" className="align-top">
      <div className={cn(strong && "font-semibold", settled < -TOL && NEGATIVE_TEXT)}>
        {settled === 0 ? <span className="font-normal text-muted-foreground">—</span> : formatMoney(settled, currency)}
      </div>
      {estimated > 0 && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">≈ +{formatMoney(estimated, currency)}</div>
      )}
    </Td>
  );
}

function DiffCell({ row }: { row: AggregateRow }) {
  const s = row.settled;
  const has = s.bookings > 0;
  const d = s.rate_diff;
  const base = s.guest_total - s.channel;
  const tone = !has || Math.abs(d) <= TOL ? "text-muted-foreground" : d > 0 ? RESULT_BUCKET_META.diff.text : NEGATIVE_TEXT;
  return (
    <Td align="right" className="align-top">
      <div className={tone}>{has ? signedMoney(d, row.currency) : "—"}</div>
      {has && base > 0 && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatSignedPct((d / base) * 100)}</div>
      )}
      {row.overpaid_excess > 0 && (
        <div className={cn("mt-0.5 text-[11px]", NEGATIVE_TEXT)}>
          de más {formatMoney(row.overpaid_excess, row.currency)}
        </div>
      )}
    </Td>
  );
}

function OtherChargesCell({ value, currency }: { value: number | null; currency: string }) {
  return (
    <Td align="right" className="align-top">
      {value === null || Math.abs(value) < 0.005 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={value < 0 ? NEGATIVE_TEXT : undefined}>{signedMoney(value, currency)}</span>
      )}
    </Td>
  );
}

function StateChips({ row }: { row: AggregateRow }) {
  if (row.bookings === 0 && row.bookings_review === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (row.bookings_estimated === 0 && row.bookings_review === 0) {
    return <span className="text-[11px] text-muted-foreground whitespace-nowrap">Al día</span>;
  }
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {row.bookings_estimated > 0 && (
        <span className="rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          {row.bookings_estimated} sin liquidar
        </span>
      )}
      {row.bookings_review > 0 && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:text-amber-200">
          {row.bookings_review} a revisar
        </span>
      )}
    </div>
  );
}

function SettlementCell({ row, year, month }: { row: AggregateRow; year: number; month: number }) {
  if (!row.owner_id) return <span className="text-muted-foreground">—</span>;
  const b = row.bridge;
  if (!b || b.settlement_ids.length === 0) {
    return (
      <Link
        href={`/dashboard/liquidaciones?tab=periodo&year=${year}&month=${month}`}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        Sin generar <ArrowRight size={11} aria-hidden />
      </Link>
    );
  }
  const status = b.statuses[0];
  const meta = (status && SETTLEMENT_STATUS_META[status]) || { label: status ?? "—", color: "#64748b" };
  const extraDocs = b.settlement_ids.length - 1;

  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Hint
        content={<BridgeBreakdown bridge={b} month={month} />}
        contentClassName="max-w-sm"
        className="font-semibold tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4"
      >
        {formatMoney(b.net_payable, b.currency)}
      </Hint>
      <Link
        href={`/dashboard/liquidaciones/${b.settlement_ids[0]}`}
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:brightness-95"
        style={{ color: meta.color, borderColor: `${meta.color}55`, backgroundColor: `${meta.color}14` }}
      >
        <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
        {meta.label}
        {extraDocs > 0 && <span className="opacity-70">+{extraDocs}</span>}
      </Link>
    </div>
  );
}

/**
 * Puente entre las reservas del mes y lo que dice la liquidación. El primer
 * renglón NO se llama como la columna "Neto de las reservas del mes": la
 * columna suma sólo las filas conciliadas y este renglón todas las porciones
 * (conciliadas, sin conciliar, liquidadas de más, de cualquier período).
 */
function BridgeBreakdown({ bridge: b, month }: { bridge: OwnerBridge; month: number }) {
  const fm = (n: number) => formatMoney(n, b.currency);
  const lines: Array<[string, number]> = [
    ["Reservas del mes, todas sus filas", b.month_rows_net_all_periods],
    ["− liquidado en otros meses", b.month_rows_net_other_periods],
    [`+ reservas de otros meses liquidadas en ${monthNameLower(month)}`, b.other_month_rows_net],
    ["+ filas sin reserva", b.orphans_net],
    ["+ otros cargos", b.other_charges_net],
  ];
  return (
    <div className="space-y-1.5 py-0.5">
      <dl className="space-y-0.5">
        {lines.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt>{label}</dt>
            <dd className="tabular-nums whitespace-nowrap">{fm(value)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-background/25 pt-1 font-semibold">
          <dt>=</dt>
          <dd className="tabular-nums whitespace-nowrap">{fm(b.lines_net)}</dd>
        </div>
      </dl>
      {Math.abs(b.lines_net - b.net_payable) > TOL && <p>El documento dice {fm(b.net_payable)}</p>}
      {b.missing_rate && <p>Falta el tipo de cambio de alguna línea: cuenta 0.</p>}
    </div>
  );
}

