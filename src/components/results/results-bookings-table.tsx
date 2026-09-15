"use client";

import { Fragment, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Info, X } from "lucide-react";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import {
  INFO_FLAG_TEXT,
  REVIEW_EXTRA_META,
  REVIEW_GROUP_META,
  TOL,
  monthNameLower,
  shortDate,
  type AggregateView,
  type InfoFlag,
  type ResultsMode,
  type ReviewGroup,
} from "@/lib/finance/results-issues";
import type { Coverage, OrphanRow } from "@/lib/finance/results-reconciliation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultsOrphanRowsTable } from "./results-orphan-rows-table";
import {
  COVERAGE_META,
  NEGATIVE_TEXT,
  RESULT_BUCKET_META,
  WARN_ROW_BORDER,
  WARN_TEXT,
  formatSignedPct,
  signedMoney,
  type ResultsRowView,
} from "./results-meta";
import { CurrencyChip, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Detalle por reserva (`#detalle`): la conciliación fila por fila.
 *
 * Cada fila pone lado a lado lo que pagó el huésped (calendario) y la tarifa
 * del propietario (su liquidación), con la diferencia en el medio. Una fila se
 * expande con un click para ver la cuenta completa, las porciones de
 * liquidación y el reparto entre co-dueños. La fila NO es un link: el código
 * de la reserva y el aviso sí lo son.
 *
 * Filtro, moneda y pestaña viven en la URL (`filtro`, `moneda`, `tab`) para
 * que el panel "Para revisar" y los KPIs puedan mandar acá ya filtrado. El
 * cambio se ve al instante (useOptimistic) mientras el router reemplaza la URL
 * sin mover el scroll.
 */

/** Mismos tonos que los KPIs y el reparto (results-meta.ts): un balde, un color. */
const TONE = {
  channel: RESULT_BUCKET_META.channel.text,
  diffPositive: RESULT_BUCKET_META.diff.text,
  negative: NEGATIVE_TEXT,
  commission: RESULT_BUCKET_META.commission.text,
  expenses: RESULT_BUCKET_META.expenses.text,
  owner: RESULT_BUCKET_META.owner.text,
  warn: WARN_TEXT,
} as const;

// ── Filtros ─────────────────────────────────────────────────────────────────

type StateFilter = "con_aviso" | "sin_liquidar" | "de_mas" | "sin_conciliar";
type ParsedFilter =
  | { kind: "none" }
  | { kind: "estado"; value: StateFilter }
  | { kind: "aviso"; group: ReviewGroup }
  | { kind: "saldo" };

/**
 * Los predicados cuentan lo MISMO que el número desde el que se llega: "Sin
 * liquidar" y "Sin conciliar" de la tarjeta y del cierre dejan afuera las filas
 * fuera de los totales (`computeTotals`). `hidden`: no es un chip propio, sólo
 * llega por link y se muestra como chip removible.
 */
const STATE_CHIPS: Array<{ value: StateFilter; label: string; hidden?: boolean; test: (r: ResultsRowView) => boolean }> = [
  { value: "con_aviso", label: "Con aviso", test: (r) => r.level === "revisar" },
  {
    value: "sin_liquidar",
    label: "Sin liquidar",
    test: (r) => r.coverage !== "liquidada" && !r.excluded_from_totals,
  },
  { value: "de_mas", label: "Se liquidó de más", test: (r) => r.outcome === "liquidado_de_mas" },
  {
    value: "sin_conciliar",
    label: "Sin conciliar",
    hidden: true,
    test: (r) => (r.outcome === "sin_conciliar" || r.outcome === "liquidado_de_mas") && !r.excluded_from_totals,
  },
];

function parseFilter(raw: string | null): ParsedFilter {
  if (!raw) return { kind: "none" };
  if (raw === "flag:saldo") return { kind: "saldo" };
  if (raw.startsWith("aviso:")) {
    const group = raw.slice("aviso:".length);
    if (Object.hasOwn(REVIEW_GROUP_META, group)) return { kind: "aviso", group: group as ReviewGroup };
    return { kind: "none" };
  }
  if (raw.startsWith("estado:")) {
    const value = raw.slice("estado:".length);
    const chip = STATE_CHIPS.find((c) => c.value === value);
    if (chip) return { kind: "estado", value: chip.value };
  }
  return { kind: "none" };
}

function matchesFilter(r: ResultsRowView, f: ParsedFilter): boolean {
  switch (f.kind) {
    case "none":
      return true;
    case "saldo":
      return r.flags.includes("saldo_huesped");
    case "aviso":
      return r.issues.some((i) => i.group === f.group);
    case "estado":
      return STATE_CHIPS.find((c) => c.value === f.value)?.test(r) ?? true;
  }
}

// ── Orden ───────────────────────────────────────────────────────────────────

function atStake(r: ResultsRowView): number {
  return r.issues.reduce((a, i) => Math.max(a, Math.abs(i.at_stake)), 0);
}

/** "A revisar" primero, por monto en juego; después la diferencia más grande. */
function compareRows(a: ResultsRowView, b: ResultsRowView): number {
  const ra = a.level === "revisar" ? 0 : 1;
  const rb = b.level === "revisar" ? 0 : 1;
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const d = atStake(b) - atStake(a);
    if (d !== 0) return d;
  }
  return (
    Math.abs(b.settled?.rate_diff ?? 0) - Math.abs(a.settled?.rate_diff ?? 0) ||
    b.guest_total - a.guest_total ||
    a.key.localeCompare(b.key)
  );
}

// ── Formato ─────────────────────────────────────────────────────────────────

const pctFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

function fmtPct(n: number): string {
  return `${pctFormatter.format(n)}%`;
}

function diffTone(d: number): string {
  if (d > TOL) return TONE.diffPositive;
  if (d < -TOL) return TONE.negative;
  return "text-muted-foreground";
}

/** "2026-05" o "2026-05-01" → "mayo 2026". */
function periodTextOf(raw: string | null | undefined): string | null {
  const m = raw?.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return `${monthNameLower(Number(m[2]))} ${m[1]}`;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

// ── Componente ──────────────────────────────────────────────────────────────

type UrlState = { filtro: string | null; moneda: string | null; tab: "huerfanas" | null };

export function ResultsBookingsTable({
  rows,
  orphans,
  year,
  month,
  mode,
  baseCurrency,
  firstSettlementPeriod,
}: {
  rows: ResultsRowView[];
  orphans: OrphanRow[];
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
  baseCurrency: string;
  /** Opcional: nombra el mes en el aviso "Empezó antes de la primera liquidación cargada". */
  firstSettlementPeriod?: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view: UrlState = {
    filtro: searchParams.get("filtro"),
    moneda: searchParams.get("moneda"),
    tab: searchParams.get("tab") === "huerfanas" ? "huerfanas" : null,
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function update(patch: Partial<UrlState>) {
    // Filtro, moneda y pestaña son SÓLO de este componente: la página no los
    // lee. `history.replaceState` (integrado al router de Next: useSearchParams
    // se entera) cambia la URL sin volver al servidor; un router.replace
    // re-ejecutaría getMonthlyResults entero por cada chip. Se parte de
    // window.location para que dos clicks seguidos no se pisen.
    const params = new URLSearchParams(window.location.search);
    for (const key of ["filtro", "moneda", "tab"] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }

  /** Pestañas con teclado: ←/→ alternan, Inicio/Fin van a la primera/última. */
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const toOrphans = e.key === "End" ? true : e.key === "Home" ? false : !isOrphans;
    update({ tab: toOrphans ? "huerfanas" : null });
    document.getElementById(toOrphans ? "tab-huerfanas" : "tab-reservas")?.focus();
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isOrphans = view.tab === "huerfanas";
  const filter = parseFilter(view.filtro);
  const inCurrency = view.moneda ? rows.filter((r) => r.currency === view.moneda) : rows;
  const visible = inCurrency.filter((r) => matchesFilter(r, filter)).sort(compareRows);
  const panelChipLabel =
    filter.kind === "aviso"
      ? REVIEW_GROUP_META[filter.group].label
      : filter.kind === "saldo"
        ? REVIEW_EXTRA_META.saldo_huesped.label
        : null;
  const hiddenStateChip =
    filter.kind === "estado" ? (STATE_CHIPS.find((c) => c.value === filter.value && c.hidden) ?? null) : null;
  const monthName = monthNameLower(month);

  const subtitle =
    mode === "temporario"
      ? "Cada reserva cuenta en el mes de su check-out. Paga el huésped sale del calendario; la tarifa del propietario, de su liquidación."
      : mode === "mensual"
        ? "Una fila por contrato: la renta del mes prorrateada por noches. La tarifa del propietario sale de su liquidación."
        : "Temporario: cuenta en el mes del check-out. Mensual: la renta del mes prorrateada por noches. La tarifa del propietario sale de su liquidación.";

  return (
    <TooltipProvider delayDuration={200}>
      <div id="detalle" className="min-w-0 scroll-mt-4">
        <ResultsSection title="Detalle por reserva" subtitle={subtitle}>
          <div
            role="tablist"
            aria-label="Detalle del mes"
            className="flex gap-1 overflow-x-auto border-b"
            onKeyDown={onTabKeyDown}
          >
            <TabButton
              id="tab-reservas"
              selected={!isOrphans}
              controls="detalle-reservas"
              onClick={() => update({ tab: null })}
            >
              Reservas ({rows.length})
            </TabButton>
            <TabButton
              id="tab-huerfanas"
              selected={isOrphans}
              controls="detalle-huerfanas"
              onClick={() => update({ tab: "huerfanas" })}
            >
              En la liquidación sin reserva ({orphans.length})
            </TabButton>
          </div>

          {isOrphans ? (
            <div
              id="detalle-huerfanas"
              role="tabpanel"
              aria-labelledby="tab-huerfanas"
              className="flex min-w-0 flex-1 flex-col"
            >
              <ResultsOrphanRowsTable orphans={orphans} year={year} month={month} baseCurrency={baseCurrency} />
            </div>
          ) : (
            <div
              id="detalle-reservas"
              role="tabpanel"
              aria-labelledby="tab-reservas"
              className="flex min-w-0 flex-1 flex-col gap-2"
            >
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <FilterChip active={filter.kind === "none"} onClick={() => update({ filtro: null })}>
                  Todas ({inCurrency.length})
                </FilterChip>
                {STATE_CHIPS.filter((c) => !c.hidden).map((c) => (
                  <FilterChip
                    key={c.value}
                    active={filter.kind === "estado" && filter.value === c.value}
                    onClick={() => update({ filtro: `estado:${c.value}` })}
                  >
                    {c.label} ({inCurrency.filter(c.test).length})
                  </FilterChip>
                ))}
                {panelChipLabel && (
                  <RemovableChip
                    tone="warn"
                    label={`Aviso: ${panelChipLabel}`}
                    onRemove={() => update({ filtro: null })}
                  />
                )}
                {hiddenStateChip && (
                  <RemovableChip
                    label={`${hiddenStateChip.label} (${inCurrency.filter(hiddenStateChip.test).length})`}
                    onRemove={() => update({ filtro: null })}
                  />
                )}
                {view.moneda && (
                  <RemovableChip label={`Moneda: ${view.moneda}`} onRemove={() => update({ moneda: null })} />
                )}
                <span aria-hidden className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[11px] text-muted-foreground">
                  ● liquidada · ◐ en parte · ○ sin liquidar
                </span>
              </div>

              <ResultsTable height="tall" stickyFirstCol className="min-w-[980px]">
                <thead>
                  <tr>
                    <Th className="left-0 z-20">Reserva</Th>
                    <Th align="right">Paga el huésped</Th>
                    <Th align="right">Tarifa del propietario</Th>
                    <Th align="right">Dif. tarifa</Th>
                    <Th align="right">Neto al propietario</Th>
                    <Th align="right">Cobrado</Th>
                    <Th>Aviso</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        {rows.length === 0 ? (
                          `No hay reservas en ${monthName}.`
                        ) : (
                          <>
                            Ninguna reserva con este filtro.{" "}
                            <button
                              type="button"
                              onClick={() => update({ filtro: null, moneda: null })}
                              className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              Ver todas
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    visible.map((row) => (
                      <BookingRow
                        key={row.key}
                        row={row}
                        open={expanded.has(row.key)}
                        onToggle={() => toggle(row.key)}
                        baseCurrency={baseCurrency}
                        firstSettlementPeriod={firstSettlementPeriod ?? null}
                      />
                    ))
                  )}
                </tbody>
              </ResultsTable>
            </div>
          )}
        </ResultsSection>
      </div>
    </TooltipProvider>
  );
}

// ── Controles ───────────────────────────────────────────────────────────────

function TabButton({
  id,
  selected,
  controls,
  onClick,
  children,
}: {
  id: string;
  selected: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  // El panel inactivo no se monta: sólo la pestaña activa apunta a un panel
  // que existe. Tabindex móvil: Tab entra a la activa, las flechas cambian.
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={selected ? controls : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={cn(
        "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
        selected
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RemovableChip({ label, onRemove, tone }: { label: string; onRemove: () => void; tone?: "warn" }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Quitar filtro ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "warn"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:border-amber-500/70 dark:text-amber-200"
          : "bg-muted text-foreground hover:bg-muted/70",
      )}
    >
      {label}
      <X size={12} aria-hidden />
    </button>
  );
}

// ── Fila ────────────────────────────────────────────────────────────────────

function BookingRow({
  row,
  open,
  onToggle,
  baseCurrency,
  firstSettlementPeriod,
}: {
  row: ResultsRowView;
  open: boolean;
  onToggle: () => void;
  baseCurrency: string;
  firstSettlementPeriod: string | null;
}) {
  const detailId = `detalle-fila-${row.key}`;
  const cur = row.currency;
  const source = BOOKING_SOURCE_META[row.source] ?? BOOKING_SOURCE_META.otro;
  const review = row.level === "revisar";
  const guest = row.guest_name ?? "Sin huésped";

  function handleRowClick() {
    // Seleccionar texto (copiar un importe) no tiene que abrir ni cerrar la fila.
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    onToggle();
  }

  return (
    <Fragment>
      <tr
        onClick={handleRowClick}
        data-open={open || undefined}
        className={cn("group cursor-pointer transition-colors", open ? "bg-muted/30" : "hover:bg-muted/30")}
      >
        {/* Reserva (fija y opaca por `stickyFirstCol`; el borde ámbar es un pseudo-elemento) */}
        <Td className={cn(review && WARN_ROW_BORDER)}>
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              aria-label={`${open ? "Ocultar" : "Ver"} detalle de ${row.unit_code} · ${guest}`}
              className="-ml-1 mt-px rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight size={14} aria-hidden className={cn("transition-transform", open && "rotate-90")} />
            </button>
            <div className="min-w-0">
              <Link
                href={`/dashboard/reservas/${row.primary_booking_id}`}
                onClick={stop}
                aria-label={`Abrir reserva ${row.unit_code} · ${guest}`}
                className="font-mono text-xs font-semibold whitespace-nowrap hover:underline"
              >
                {row.unit_code}
              </Link>
              <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: source.color }}
                  title={source.label}
                  aria-hidden
                />
                <span className="sr-only">{source.label} · </span>
                <span className={cn("inline-block max-w-[11rem] truncate", !row.guest_name && "italic")}>{guest}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {shortDate(row.check_in_date)} → {shortDate(row.check_out_date)}
                </span>
              </span>
              {row.mode === "mensual" && row.prorate && (
                <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                  {row.prorate.nights} de {row.prorate.of} noches
                </span>
              )}
            </div>
          </div>
        </Td>

        {/* Paga el huésped */}
        <Td align="right" className={cn("font-semibold", row.guest_total <= 0 && "text-muted-foreground")}>
          <span className="inline-flex items-center gap-1">
            {formatMoney(row.guest_total, cur)}
            {cur !== baseCurrency && <CurrencyChip currency={cur} />}
          </span>
        </Td>

        {/* Tarifa del propietario */}
        <Td align="right">
          <OwnerRateCell row={row} />
        </Td>

        {/* Dif. tarifa */}
        <Td align="right">
          <DiffCell row={row} />
        </Td>

        {/* Neto al propietario */}
        <Td align="right">
          {row.settled ? (
            <>
              <span className={cn("font-semibold", TONE.owner)}>{formatMoney(row.settled.owner_net, cur)}</span>
              {row.estimated && row.estimated.owner_net !== 0 && (
                <span className="block text-[10px] text-muted-foreground">
                  ≈ +{formatMoney(row.estimated.owner_net, cur)}
                </span>
              )}
            </>
          ) : row.estimated ? (
            <span className="text-muted-foreground">≈{formatMoney(row.estimated.owner_net, cur)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>

        {/* Cobrado */}
        <Td align="right">
          <PaidCell row={row} />
        </Td>

        {/* Aviso */}
        <Td>
          <IssueCell row={row} />
        </Td>
      </tr>

      {open && (
        <tr id={detailId} className="bg-muted/30">
          <td colSpan={7} className="px-3 pb-4 pt-1">
            <RowDetail row={row} firstSettlementPeriod={firstSettlementPeriod} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function CoverageDot({ coverage }: { coverage: Coverage }) {
  const meta = COVERAGE_META[coverage];
  return (
    <>
      <span aria-hidden className="text-[11px] leading-none text-foreground/60">
        {meta.glyph}
      </span>
      <span className="sr-only">{meta.label}: </span>
    </>
  );
}

function OwnerRateCell({ row }: { row: ResultsRowView }) {
  const s = row.settled;
  if (!s) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CoverageDot coverage={row.coverage} />—
      </span>
    );
  }
  const other = s.owner_rate_other;
  // Toda la liquidación en otra moneda (TREJO2: reserva en USD, filas en ARS):
  // el número principal es ése, con su chip.
  const onlyOther = other !== null && s.owner_rate === 0;
  const byDates = row.flags.includes("por_fechas");
  const multiPeriod = row.flags.includes("varios_periodos") && row.periods.length > 1;

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <CoverageDot coverage={row.coverage} />
        <span
          className={cn(byDates && "underline decoration-dotted underline-offset-4")}
          title={byDates ? INFO_FLAG_TEXT.por_fechas() : undefined}
        >
          {onlyOther ? formatMoney(other.amount, other.currency) : formatMoney(s.owner_rate, row.currency)}
        </span>
        {onlyOther && <CurrencyChip currency={other.currency} />}
      </span>
      {other && !onlyOther && (
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {formatMoney(other.amount, other.currency)}
          <CurrencyChip currency={other.currency} />
        </span>
      )}
      {multiPeriod && (
        <span className="mt-0.5 flex justify-end">
          <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">
            {row.periods.join("·")}
          </span>
        </span>
      )}
    </>
  );
}

function DiffCell({ row }: { row: ResultsRowView }) {
  const d = row.settled?.rate_diff ?? null;
  if (d === null) return <span className="text-muted-foreground">—</span>;
  const pct = row.settled?.rate_diff_pct ?? null;
  return (
    <>
      <span className={cn("font-medium", diffTone(d))}>{signedMoney(d, row.currency)}</span>
      {pct !== null && (
        <span className={cn("block text-[10px]", Math.abs(d) > TOL ? diffTone(d) : "text-muted-foreground")}>
          {formatSignedPct(pct)}
        </span>
      )}
    </>
  );
}

function PaidCell({ row }: { row: ResultsRowView }) {
  if (row.guest_total <= 0 && row.paid <= 0) return <span className="text-muted-foreground">—</span>;
  if (row.pending <= TOL) {
    return (
      <span className="inline-flex items-center justify-end text-emerald-700 dark:text-emerald-300">
        <Check size={15} aria-hidden />
        <span className="sr-only">Cobrado completo</span>
      </span>
    );
  }
  return (
    <>
      <span className={cn(row.paid > 0 ? "text-foreground" : "text-muted-foreground")}>
        {formatMoney(row.paid, row.currency)}
      </span>
      {/* Ámbar sólo si es un aviso (liquidada con saldo): el saldo de una
          reserva sin liquidar que todavía no salió es lo normal. */}
      <span
        className={cn(
          "block text-[10px] tabular-nums",
          row.flags.includes("saldo_huesped") ? TONE.warn : "text-muted-foreground",
        )}
      >
        Saldo {formatMoney(row.pending, row.currency)}
      </span>
    </>
  );
}

function IssueCell({ row }: { row: ResultsRowView }) {
  const main = row.issues[0];
  if (!main) return <span className="text-muted-foreground">—</span>;
  const label = REVIEW_GROUP_META[main.group].label;
  const more = row.issues.length - 1;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={main.href}
          onClick={stop}
          aria-label={`${label}${more > 0 ? ` y ${more} ${more === 1 ? "aviso más" : "avisos más"}` : ""}. ${main.cta}`}
          className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium hover:underline", TONE.warn)}
        >
          {label}
          {more > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] tabular-nums">+{more}</span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-left">
        <ul className="space-y-1">
          {row.issues.map((i, idx) => (
            <li key={`${i.code}-${idx}`}>{i.detail}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Fila expandida ──────────────────────────────────────────────────────────

function Amount({ value, currency, tone, approx }: { value: number; currency: string; tone?: string; approx?: boolean }) {
  return (
    <span className={cn("font-medium tabular-nums", tone)}>
      {approx ? "≈" : ""}
      {formatMoney(value, currency)}
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground">
      ·
    </span>
  );
}

function RowDetail({ row, firstSettlementPeriod }: { row: ResultsRowView; firstSettlementPeriod: string | null }) {
  const cur = row.currency;
  const s = row.settled;
  const e = row.estimated;
  const channelPctLabel = row.channel_pct === null ? "sin configurar" : fmtPct(row.channel_pct);
  const commissionPctLabel = fmtPct(row.commission_pct);
  const countedSettlements = new Set(row.pieces.filter((p) => p.counted).map((p) => p.settlement_id)).size;
  const flagTexts = row.flags
    .map((f) => infoFlagText(f, countedSettlements, firstSettlementPeriod))
    .filter((t): t is string => Boolean(t));
  const pieceHasChannel = row.pieces.some((p) => p.channel !== 0);

  return (
    <div className="space-y-3 text-xs">
      {/* Avisos (también en el tooltip; acá se leen en el celular) */}
      {row.issues.length > 0 && (
        <ul className="space-y-1">
          {row.issues.map((i, idx) => (
            <li key={`${i.code}-${idx}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={cn("font-medium", TONE.warn)}>{REVIEW_GROUP_META[i.group].label}</span>
              <span className="text-muted-foreground">{i.detail}</span>
              <Link href={i.href} className="font-medium underline-offset-2 hover:underline">
                {i.cta}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* 1 · Descomposición */}
      {s && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span>Plataformas</span>
          <Amount value={s.channel} currency={cur} tone={TONE.channel} />
          <span className="text-muted-foreground">({channelPctLabel})</span>
          <Sep />
          <span>Tu comisión</span>
          <Amount value={s.commission} currency={cur} tone={TONE.commission} />
          <span className="text-muted-foreground">({commissionPctLabel})</span>
          <Sep />
          <span>Limpieza y gastos</span>
          <Amount value={s.expenses} currency={cur} tone={TONE.expenses} />
          <Sep />
          <span>Reintegros</span>
          <Amount value={s.reimbursements} currency={cur} />
          {s.settlement_channel !== 0 && (
            <>
              <Sep />
              <span>Plataforma en la liquidación</span>
              <Amount value={s.settlement_channel} currency={cur} tone={TONE.channel} />
            </>
          )}
        </p>
      )}
      {e && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-muted-foreground">
          <span>Sin liquidar (≈):</span>
          {s && (
            <>
              <span>Paga el huésped</span>
              <Amount value={e.guest_total} currency={cur} approx />
              <Sep />
            </>
          )}
          <span>Plataformas</span>
          <Amount value={e.channel} currency={cur} approx />
          <span>({channelPctLabel})</span>
          <Sep />
          <span>Tu comisión</span>
          <Amount value={e.commission} currency={cur} approx />
          <span>({commissionPctLabel})</span>
          <Sep />
          <span>Limpieza y gastos</span>
          <Amount value={e.expenses} currency={cur} approx />
          <Sep />
          <span>Neto al propietario</span>
          <Amount value={e.owner_net} currency={cur} approx />
        </p>
      )}

      {/* 2 · La cuenta (sólo si la diferencia se pudo calcular) */}
      {s && s.rate_diff !== null && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-md border bg-card px-2.5 py-1.5">
          <Amount value={s.guest_total} currency={cur} />
          <span>pagó el huésped{row.coverage === "parcial" ? ` (parte liquidada, ${fmtPct(row.covered_pct)})` : ""} =</span>
          <Amount value={s.channel} currency={cur} tone={TONE.channel} />
          <span>plataformas +</span>
          <span className={cn("font-medium tabular-nums", diffTone(s.rate_diff))}>
            {formatMoney(s.rate_diff, cur)}
          </span>
          <span>diferencia +</span>
          <Amount value={s.commission} currency={cur} tone={TONE.commission} />
          <span>comisión +</span>
          <Amount value={s.expenses - s.reimbursements} currency={cur} tone={TONE.expenses} />
          <span>limpieza y gastos +</span>
          <Amount value={s.owner_net} currency={cur} tone={TONE.owner} />
          <span>neto</span>
        </p>
      )}

      {/* 3 · Porciones de liquidación */}
      {row.pieces.length > 0 && (
        <DetailTable
          caption="Filas de liquidación"
          head={[
            "Propietario",
            "Período",
            "Estado",
            { label: "Ingreso", right: true },
            ...(pieceHasChannel ? [{ label: "Plataforma", right: true }] : []),
            { label: "Comisión", right: true },
            { label: "Gastos", right: true },
            { label: "Neto", right: true },
            "",
            "",
          ]}
        >
          {row.pieces.map((p) => {
            const status = SETTLEMENT_STATUS_META[p.status];
            return (
              <tr key={p.key} className={cn(!p.counted && "text-muted-foreground")}>
                <DCell className="font-medium">{p.owner_name}</DCell>
                <DCell>{p.period_label}</DCell>
                <DCell>
                  <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: status?.color }} aria-hidden />
                    {status?.label ?? p.status}
                  </span>
                </DCell>
                <DCell right>
                  <span className="inline-flex items-center gap-1">
                    {formatMoney(p.revenue, p.currency)}
                    {p.currency !== cur && <CurrencyChip currency={p.currency} />}
                  </span>
                </DCell>
                {pieceHasChannel && (
                  <DCell right>
                    <span className={TONE.channel}>{formatMoney(p.channel, p.currency)}</span>
                  </DCell>
                )}
                <DCell right>
                  <span className={TONE.commission}>{formatMoney(p.commission, p.currency)}</span>
                </DCell>
                <DCell right>
                  <span className={TONE.expenses}>{formatMoney(p.expenses, p.currency)}</span>
                </DCell>
                <DCell right>
                  <span className={cn("font-medium", TONE.owner)}>{formatMoney(p.net, p.currency)}</span>
                </DCell>
                <DCell>
                  {p.matched_by === "fechas" && <span className="text-muted-foreground">Por fechas</span>}
                  {!p.counted && <span className="ml-1.5 text-muted-foreground">No suma</span>}
                </DCell>
                <DCell>
                  <Link
                    href={p.href}
                    aria-label={`Abrir liquidación de ${p.owner_name} de ${p.period_label}`}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Abrir
                  </Link>
                </DCell>
              </tr>
            );
          })}
        </DetailTable>
      )}

      {/* 4 · Reparto por dueño */}
      {row.owners.length > 1 && (
        <DetailTable
          caption="Reparto por propietario"
          head={[
            "Propietario",
            { label: "%", right: true },
            { label: "Paga", right: true },
            { label: "Tarifa", right: true },
            { label: "Dif.", right: true },
            { label: "Neto", right: true },
            "",
          ]}
        >
          {row.owners.map((o, idx) => (
            <tr key={`${o.owner_id ?? "sin"}-${idx}`}>
              <DCell className="font-medium">{o.owner_name}</DCell>
              <DCell right>{fmtPct(o.share_pct)}</DCell>
              <DCell right>{formatMoney(o.guest_total, cur)}</DCell>
              <DCell right>{o.owner_rate === null ? "—" : formatMoney(o.owner_rate, cur)}</DCell>
              <DCell right>
                {o.rate_diff === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={diffTone(o.rate_diff)}>{signedMoney(o.rate_diff, cur)}</span>
                )}
              </DCell>
              <DCell right>
                {o.has_piece ? (
                  <span className={TONE.owner}>{formatMoney(o.owner_net, cur)}</span>
                ) : (
                  <span className="text-muted-foreground">≈{formatMoney(o.owner_net, cur)}</span>
                )}
              </DCell>
              <DCell>
                {!o.has_piece && (
                  <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">
                    Sin liquidar
                  </span>
                )}
              </DCell>
            </tr>
          ))}
        </DetailTable>
      )}

      {/* 5 · Avisos informativos */}
      {flagTexts.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {flagTexts.map((t) => (
            <li key={t} className="flex items-start gap-1.5">
              <Info size={12} aria-hidden className="mt-px shrink-0" />
              {t}
            </li>
          ))}
        </ul>
      )}

      {/* 6 · Cobros extra */}
      {row.extra_charge_items.length > 0 && (
        <div>
          <p>
            Cobros extra <Amount value={row.extra_charges} currency={cur} />{" "}
            <span className="text-muted-foreground">(aparte, no suman a lo que paga el huésped)</span>
          </p>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {row.extra_charge_items.map((x, idx) => (
              <li key={`${x.ref_id}-${idx}`}>
                {x.description?.trim() || "Sin descripción"} · {formatMoney(x.amount, x.currency)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function infoFlagText(flag: InfoFlag, settlements: number, firstSettlementPeriod: string | null): string | null {
  switch (flag) {
    case "por_fechas":
      return INFO_FLAG_TEXT.por_fechas();
    case "varios_periodos":
      return INFO_FLAG_TEXT.varios_periodos(settlements);
    case "estadia_larga":
      return INFO_FLAG_TEXT.estadia_larga(settlements);
    case "historia_incompleta": {
      const label = periodTextOf(firstSettlementPeriod);
      return label
        ? INFO_FLAG_TEXT.historia_incompleta(label)
        : "Empezó antes de la primera liquidación cargada: no se puede conciliar.";
    }
    case "pieza_en_cero":
      return INFO_FLAG_TEXT.pieza_en_cero();
    case "saldo_huesped":
      return null;
  }
}

type HeadCell = string | { label: string; right?: boolean };

function DetailTable({ caption, head, children }: { caption: string; head: HeadCell[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-xs">
        <caption className="px-2.5 pt-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {caption}
        </caption>
        <thead>
          <tr className="border-b">
            {head.map((h, idx) => {
              const label = typeof h === "string" ? h : h.label;
              const right = typeof h !== "string" && h.right;
              return (
                <th
                  key={`${label}-${idx}`}
                  scope="col"
                  className={cn(
                    "px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap text-muted-foreground",
                    right ? "text-right" : "text-left",
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

function DCell({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return (
    <td
      className={cn(
        "px-2.5 py-1 whitespace-nowrap",
        right ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
