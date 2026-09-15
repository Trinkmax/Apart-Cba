import { SETTLEMENT_LINE_META } from "@/lib/settlements/labels";
import { formatMoney } from "@/lib/format";
import { TOL, type AggregateView, type Coverage, type ResultsMode } from "@/lib/finance/results-issues";
import type { ReconciledRow } from "@/lib/finance/results-reconciliation";

/**
 * Vocabulario visual de Resultados.
 *
 * Los cinco baldes en que se parte lo que pagó el huésped, en el orden en que
 * se leen (y se apilan en la barra):
 *
 *   Plataformas · Diferencia de tarifa · Tu comisión · Limpieza y gastos · Neto al propietario
 *
 * Los colores son los MISMOS que las líneas de la liquidación
 * (SETTLEMENT_LINE_META) y que la pantalla de Comisiones: rosa = plataforma,
 * violeta = tu comisión, cian = limpieza y gastos, esmeralda = propietario. La
 * diferencia de tarifa es un violeta CLARO: es plata de la administración,
 * igual que la comisión, pero no sale de un porcentaje.
 *
 * Reglas de color de toda la pantalla:
 *   • negativos y "se liquidó de más" → rosa;
 *   • ámbar SÓLO para avisos (borde de la fila, texto del aviso, saldo del huésped);
 *   • estimados → gris con "≈".
 */
export type ResultBucket = "channel" | "diff" | "commission" | "expenses" | "owner";

export const RESULT_BUCKET_META: Record<
  ResultBucket,
  {
    label: string;
    /** Hex para barras y puntos (style inline). */
    color: string;
    /** Clase de fondo equivalente, para quien no pinte con style. */
    bar: string;
    /** Clase de texto para montos de ese balde. */
    text: string;
  }
> = {
  channel: {
    label: "Plataformas",
    color: SETTLEMENT_LINE_META.channel_commission.color, // rose-500
    bar: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
  diff: {
    label: "Diferencia de tarifa",
    color: "#c4b5fd", // violet-300
    bar: "bg-violet-300",
    text: "text-violet-500 dark:text-violet-300",
  },
  commission: {
    label: "Tu comisión",
    color: "#7c3aed", // violet-600
    bar: "bg-violet-600",
    text: "text-violet-600 dark:text-violet-400",
  },
  expenses: {
    label: "Limpieza y gastos",
    color: SETTLEMENT_LINE_META.cleaning_charge.color, // cyan-500
    bar: "bg-cyan-500",
    text: "text-cyan-700 dark:text-cyan-300",
  },
  owner: {
    label: "Neto al propietario",
    color: SETTLEMENT_LINE_META.booking_revenue.color, // emerald-500
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

export const RESULT_BUCKET_ORDER: ResultBucket[] = ["channel", "diff", "commission", "expenses", "owner"];

/** Negativos y "se liquidó de más". */
export const NEGATIVE_TEXT = "text-rose-600 dark:text-rose-400";
/** Avisos: texto, saldo del huésped. Nunca para otra cosa. */
export const WARN_TEXT = "text-amber-700 dark:text-amber-300";
/**
 * Borde izquierdo de 2 px de una fila con aviso. Va en la PRIMERA CELDA (td),
 * no en el <tr>: con `stickyFirstCol` esa celda tiene fondo opaco y taparía
 * cualquier cosa pintada en la fila. Es un pseudo-elemento, así se mueve con
 * la celda fija.
 */
export const WARN_ROW_BORDER =
  "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-amber-500";
/** Estimados (≈). */
export const ESTIMATE_TEXT = "text-muted-foreground";

/** Punto de cobertura de la leyenda "● liquidada · ◐ en parte · ○ sin liquidar". */
export const COVERAGE_META: Record<Coverage, { glyph: string; label: string }> = {
  liquidada: { glyph: "●", label: "liquidada" },
  parcial: { glyph: "◐", label: "en parte" },
  sin_liquidar: { glyph: "○", label: "sin liquidar" },
};

export const RESULTS_MODE_META: Record<ResultsMode, { label: string }> = {
  todos: { label: "Todos" },
  temporario: { label: "Temporarios" },
  mensual: { label: "Mensuales" },
};
export const RESULTS_MODE_ORDER: ResultsMode[] = ["todos", "temporario", "mensual"];

export const AGGREGATE_VIEW_META: Record<AggregateView, { label: string }> = {
  depto: { label: "Por depto" },
  propietario: { label: "Por propietario" },
  canal: { label: "Por canal" },
};
export const AGGREGATE_VIEW_ORDER: AggregateView[] = ["depto", "propietario", "canal"];

/** `?modo=` de la URL → modo válido (lo desconocido cae en "todos"). */
export function parseResultsMode(value: string | string[] | undefined | null): ResultsMode {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "temporario" || v === "mensual" ? v : "todos";
}

/** `?vista=` de la URL → vista válida (lo desconocido cae en "depto"). */
export function parseAggregateView(value: string | string[] | undefined | null): AggregateView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "propietario" || v === "canal" ? v : "depto";
}

/** Mes anterior / siguiente como (año, mes), sin Date para no pisar la tz. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export interface ResultsHrefOptions {
  modo?: ResultsMode;
  vista?: AggregateView;
  /** "aviso:<ReviewGroup>" | "flag:saldo" | "estado:con_aviso" | "estado:sin_liquidar" | "estado:de_mas" */
  filtro?: string;
  moneda?: string;
  tab?: "huerfanas";
}

/**
 * URL de Resultados. Los valores por defecto (modo=todos, vista=depto) no se
 * escriben, así la URL "limpia" del sidebar y la del home siguen siendo la
 * misma página.
 *
 * `filtro`, `moneda` y `tab` son del detalle de reservas: si viene alguno, el
 * link baja a `#detalle`, que es donde se ve el efecto.
 */
export function resultsHref(year: number, month: number, opts: ResultsHrefOptions = {}): string {
  const params = new URLSearchParams();
  params.set("year", String(year));
  params.set("month", String(month));
  if (opts.modo && opts.modo !== "todos") params.set("modo", opts.modo);
  if (opts.vista && opts.vista !== "depto") params.set("vista", opts.vista);
  if (opts.filtro) params.set("filtro", opts.filtro);
  if (opts.moneda) params.set("moneda", opts.moneda);
  if (opts.tab) params.set("tab", opts.tab);
  const toDetail = Boolean(opts.filtro || opts.moneda || opts.tab);
  return `/dashboard/resultados?${params.toString()}${toDetail ? "#detalle" : ""}`;
}

const PCT_FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/** 12.5 → "12,5%". null → "—". */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${PCT_FORMAT.format(value)}%`;
}

/**
 * Diferencia con signo, igual en KPIs, reparto y detalle:
 * "+$ 30.000,00" · "-$ 980.000,00" (el negativo es el de formatMoney) · "$ 0,00".
 */
export function signedMoney(value: number, currency: string): string {
  if (value > TOL) return `+${formatMoney(value, currency)}`;
  return formatMoney(Math.abs(value) < 0.005 ? 0 : value, currency);
}

/** 11.1 → "+11,1%" · -5 → "-5%" · null → "—". */
export function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatPct(value)}`;
}

/**
 * Lo que el detalle de reservas (cliente) necesita de cada fila. Los campos
 * que la tabla no lee no viajan en el payload RSC, que se vuelve a mandar
 * entero con cada LiveRefresh.
 */
export type ResultsRowView = Omit<
  ReconciledRow,
  "booking_ids" | "unit_id" | "unit_name" | "nights" | "channel_commission" | "parts" | "primary_settlement_id"
>;

export function toResultsRowView(row: ReconciledRow): ResultsRowView {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    booking_ids,
    unit_id,
    unit_name,
    nights,
    channel_commission,
    parts,
    primary_settlement_id,
    ...view
  } = row;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return view;
}
