import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthNameLower, TOL, type AggregateView, type ResultsMode } from "@/lib/finance/results-issues";
import type { MonthClose, ResultTotals } from "@/lib/finance/results-reconciliation";
import {
  NEGATIVE_TEXT,
  RESULT_BUCKET_META,
  WARN_TEXT,
  formatPct,
  resultsHref,
  type ResultBucket,
} from "./results-meta";
import { CurrencyChip, InfoHint } from "./results-table";

/**
 * Cabecera de Resultados. Responde, en este orden, las tres preguntas del dueño:
 *
 *   1. ¿Cuánto pagaron los huéspedes?          → "Paga el huésped" (calendario)
 *   2. ¿Cuánto se le rindió a los propietarios? → "Tarifa del propietario" / "Neto"
 *   3. ¿Cuánto quedó en la administración?      → "Ingreso de la administración"
 *
 * Sólo las reservas liquidadas SIN errores entran en la barra y en los cinco
 * KPIs; lo que falta liquidar va aparte con "≈" y lo que tiene un dato roto
 * no entra en ningún número de negocio (se ve en "Para revisar").
 *
 * Tarjeta completa para la moneda base; las otras monedas, una línea cada una.
 */

interface NavCtx {
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
  /** Con varias monedas, cada link filtra el detalle por la del número clickeado. */
  moneda?: string;
}

/** Trama del tramo "sin liquidar" (estimado). */
const HATCH =
  "bg-muted text-muted-foreground/60 bg-[repeating-linear-gradient(135deg,currentColor_0_1.5px,transparent_1.5px_4px)]";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ResultsKpis({
  totals,
  close,
  baseCurrency,
  year,
  month,
  mode,
  vista,
}: {
  totals: ResultTotals[];
  close: MonthClose[];
  baseCurrency: string;
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
}) {
  const nav: NavCtx = { year, month, mode, vista };
  // Una moneda que sólo tiene filas excluidas (USD cargado como ARS, moneda
  // cruzada) no tiene nada que sumar: no se muestra como tarjeta ni línea.
  const withBookings = totals.filter((t) => t.bookings > 0);
  // Si la org no vendió nada en su moneda base este mes, la tarjeta completa
  // es para la moneda que sí tiene reservas (mejor que una tarjeta en cero).
  const main = withBookings.find((t) => t.currency === baseCurrency) ?? withBookings[0] ?? null;
  const others = withBookings.filter((t) => t !== main);
  const excludedOnly = totals.reduce((a, t) => a + (t.bookings === 0 ? t.excluded_bookings : 0), 0);
  // Con más de una moneda en juego, "Sin liquidar 7" (ARS) tiene que abrir un
  // filtro que cuente sólo ARS: si no, el chip de destino suma también las USD.
  const multiCurrency = new Set([...totals.map((t) => t.currency), ...close.map((c) => c.currency)]).size > 1;
  const navFor = (currency: string): NavCtx => (multiCurrency ? { ...nav, moneda: currency } : nav);
  // Cierre: la moneda base siempre (la de los documentos, aunque el mes sólo
  // tenga reservas en otra), más cualquier otra moneda que tenga liquidaciones.
  const baseClose =
    close.find((c) => c.currency === baseCurrency) ?? close.find((c) => c.currency === main?.currency) ?? null;
  const closeRows = [...(baseClose ? [baseClose] : []), ...close.filter((c) => c !== baseClose && c.settlements > 0)];

  return (
    <div className="space-y-2.5">
      {main ? (
        <MainCard
          t={main}
          showCurrency={main.currency !== baseCurrency || others.length > 0}
          nav={navFor(main.currency)}
        />
      ) : excludedOnly > 0 ? (
        <Card className="flex-row flex-wrap items-center justify-between gap-3 p-4">
          <p className={cn("flex items-center gap-2 text-sm", WARN_TEXT)}>
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {excludedOnly === 1
              ? "La única reserva del mes tiene el importe a revisar: no se suma hasta corregirla."
              : `Las ${excludedOnly} reservas del mes tienen el importe a revisar: no se suman hasta corregirlas.`}
          </p>
          <Link
            href={resultsHref(year, month, { modo: mode, vista, filtro: "aviso:importe_reserva" })}
            className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            Ver reservas <ArrowRight className="size-3" aria-hidden />
          </Link>
        </Card>
      ) : null}

      {others.map((t) => (
        <CurrencyLine key={t.currency} t={t} nav={nav} />
      ))}

      {/* El documento del propietario no se parte por modo: con Temporarios o
          Mensuales la franja mezclaría propietarios filtrados con liquidaciones
          y transferencias de todo el mes. */}
      {mode === "todos" ? (
        closeRows.map((c) => (
          <CloseStrip key={c.currency} c={c} nav={navFor(c.currency)} showCurrency={closeRows.length > 1 || multiCurrency} />
        ))
      ) : close.length > 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Cierre de {monthNameLower(month)}</span>: se ve con{" "}
          <Link
            href={resultsHref(year, month, { vista })}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Todos
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ── Tarjeta de la moneda base ────────────────────────────────────────────────

function MainCard({ t, showCurrency, nav }: { t: ResultTotals; showCurrency: boolean; nav: NavCtx }) {
  const fm = (n: number) => formatMoney(n, t.currency);
  const bothModes = nav.mode === "todos" && t.by_mode.temporario > 0 && t.by_mode.mensual > 0;

  return (
    <Card className="gap-0 p-4 sm:p-5">
      <div className="grid gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end">
        {/* 1 · Lo que pagó el huésped: el número que manda, del calendario. */}
        <div className="min-w-0">
          <Eyebrow>
            Paga el huésped
            {showCurrency && <CurrencyChip currency={t.currency} />}
          </Eyebrow>
          <div className="mt-1.5 text-3xl font-bold leading-none tracking-tight tabular-nums whitespace-nowrap">
            {fm(t.guest_total)}
          </div>
          <Dotted
            className="mt-2.5 text-xs text-muted-foreground"
            items={[
              plural(t.bookings, "reserva", "reservas"),
              <>
                Cobrado <Amount>{fm(t.paid)}</Amount>
              </>,
              // Gris: el saldo de las reservas que todavía no salieron es lo
              // normal. El ámbar queda para el aviso "Liquidadas con saldo".
              <span key="saldo">
                Saldo <Amount>{fm(t.pending)}</Amount>
              </span>,
            ]}
          />
          {bothModes && (
            <Dotted
              className="mt-1 text-xs text-muted-foreground"
              items={[
                <>
                  Temporarios <Amount>{fm(t.by_mode.temporario)}</Amount>
                </>,
                <>
                  Mensuales <Amount>{fm(t.by_mode.mensual)}</Amount>
                </>,
              ]}
            />
          )}
          {t.excluded_bookings > 0 && (
            <Link
              href={resultsHref(nav.year, nav.month, {
                modo: nav.mode,
                vista: nav.vista,
                filtro: "aviso:importe_reserva",
                moneda: nav.moneda,
              })}
              className={cn("mt-2 inline-flex items-center gap-1.5 text-xs hover:underline", WARN_TEXT)}
            >
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
              No incluye {plural(t.excluded_bookings, "reserva", "reservas")} con importe a revisar
            </Link>
          )}
        </div>

        {/* 2 · Cobertura: cuánto de eso ya está liquidado. */}
        <CoverageBar t={t} nav={nav} />
      </div>

      <SettledBlock t={t} nav={nav} />
    </Card>
  );
}

function CoverageBar({ t, nav }: { t: ResultTotals; nav: NavCtx }) {
  const fm = (n: number) => formatMoney(n, t.currency);
  const segments: Array<{
    key: string;
    label: string;
    count: number;
    amount: number;
    approx: boolean;
    swatch: string;
    filtro?: string;
  }> = [
    {
      key: "settled",
      label: "Liquidadas",
      count: t.settled.bookings,
      amount: t.parts.settled,
      approx: false,
      swatch: "bg-foreground/75",
    },
    {
      key: "estimated",
      label: "Sin liquidar",
      count: t.estimated.bookings,
      amount: t.parts.estimated,
      approx: true,
      swatch: HATCH,
      filtro: "estado:sin_liquidar",
    },
    {
      key: "unreconciled",
      label: "Sin conciliar",
      count: t.unreconciled_bookings,
      amount: t.parts.unreconciled,
      approx: false,
      swatch: "bg-muted-foreground/35",
      // Mismo predicado que `unreconciled_bookings` (no "Con aviso", que deja
      // afuera historia_incompleta y suma parciales conciliadas).
      filtro: "estado:sin_conciliar",
    },
  ];
  const sum = segments.reduce((a, s) => a + Math.max(0, s.amount), 0);
  const shown = segments.filter((s) => s.key === "settled" || s.count > 0 || s.amount > 0);

  return (
    <div className="min-w-0 space-y-2">
      <Eyebrow>Cuánto está liquidado</Eyebrow>
      <div
        className={cn("flex h-2 w-full gap-[2px] overflow-hidden rounded-full", sum <= 0 && "bg-muted")}
        role="img"
        aria-label={shown.map((s) => `${s.label}: ${s.approx ? "≈" : ""}${fm(s.amount)}`).join(", ")}
      >
        {sum > 0 &&
          segments.map((s) =>
            s.amount > 0 ? (
              <div
                key={s.key}
                className={cn("h-full min-w-[3px]", s.swatch)}
                style={{ flex: `${s.amount} 1 0%` }}
                title={`${s.label}: ${s.approx ? "≈ " : ""}${fm(s.amount)}`}
              />
            ) : null,
          )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {shown.map((s) => {
          const body = (
            <>
              <span className={cn("size-2 shrink-0 rounded-[2px]", s.swatch)} aria-hidden />
              <span className="text-muted-foreground">
                {s.label} {s.count}
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                ·
              </span>
              <span className="font-medium tabular-nums">
                {s.approx ? "≈" : ""}
                {fm(s.amount)}
              </span>
            </>
          );
          return (
            <li key={s.key} className="whitespace-nowrap">
              {s.filtro && s.count > 0 ? (
                <Link
                  href={resultsHref(nav.year, nav.month, {
                    modo: nav.mode,
                    vista: nav.vista,
                    filtro: s.filtro,
                    moneda: nav.moneda,
                  })}
                  className="inline-flex items-center gap-1.5 rounded-sm hover:underline"
                >
                  {body}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SettledBlock({ t, nav }: { t: ResultTotals; nav: NavCtx }) {
  const fm = (n: number) => formatMoney(n, t.currency);
  const s = t.settled;
  // Con menos de la mitad liquidada, la diferencia del mes es un dato parcial:
  // se achica y se dice por qué, para que nadie la lea como el margen del mes.
  const partial = s.bookings > 0 && t.settled_share < 0.5;
  const buckets: Array<{ key: ResultBucket; amount: number }> = [
    { key: "channel", amount: s.channel },
    { key: "diff", amount: s.rate_diff },
    { key: "commission", amount: s.commission },
    { key: "expenses", amount: s.expenses_net },
    { key: "owner", amount: s.owner_net },
  ];
  const ownerRate = round2(s.commission + s.expenses_net + s.owner_net);

  return (
    <div className="mt-5 space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reservas liquidadas
        </h3>
        {s.bookings > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {s.bookings} de {t.bookings} · {fm(t.parts.settled)}
          </span>
        )}
      </div>

      {s.bookings === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ninguna reserva del mes está liquidada sin errores todavía: no hay diferencia de tarifa para mostrar.
        </p>
      ) : (
        <>
          <StackedBar buckets={buckets} currency={t.currency} />

          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 sm:gap-y-4 md:grid-cols-3 xl:grid-cols-5">
            {buckets.map((b) =>
              b.key === "diff" ? (
                <Kpi
                  key={b.key}
                  bucket={b.key}
                  amount={b.amount}
                  currency={t.currency}
                  labelExtra={
                    <InfoHint content="Lo que pagó el huésped por encima de la tarifa del propietario. Solo cuenta reservas liquidadas sin errores." />
                  }
                  amountClassName={partial ? "text-base font-medium text-muted-foreground xl:text-base" : undefined}
                  amountSuffix={
                    partial ? (
                      <span className="rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                        Parcial
                      </span>
                    ) : null
                  }
                >
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {formatPct(t.rate_diff_pct)} sobre lo cobrado sin plataformas
                  </p>
                  {partial && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Solo {s.bookings} de {t.bookings} reservas están liquidadas
                    </p>
                  )}
                </Kpi>
              ) : (
                <Kpi key={b.key} bucket={b.key} amount={b.amount} currency={t.currency} />
              ),
            )}
          </div>

          {/* 3 · Lo que quedó en la administración, y de qué está hecha la
              tarifa del propietario. La limpieza recuperada va aparte a
              propósito: pasa por la administración pero no es ganancia. */}
          <div className="grid gap-4 rounded-lg border bg-muted/40 p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="flex" aria-hidden>
                  <Dot color={RESULT_BUCKET_META.diff.color} />
                  <Dot color={RESULT_BUCKET_META.commission.color} className="-ml-0.5" />
                </span>
                Ingreso de la administración
              </div>
              <div
                className={cn(
                  "mt-1 text-2xl font-bold leading-tight tabular-nums whitespace-nowrap",
                  t.admin_income < -TOL && NEGATIVE_TEXT,
                )}
              >
                {fm(t.admin_income)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Diferencia de tarifa + Tu comisión</div>
            </div>
            <dl className="grid gap-3 text-xs sm:grid-cols-2 md:border-l md:pl-5">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Tarifa del propietario</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{fm(ownerRate)}</dd>
                <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Tu comisión + limpieza y gastos + neto
                </dd>
              </div>
              <div className="min-w-0 sm:max-w-[17rem]">
                <dt className="text-muted-foreground">Limpieza y gastos recuperados</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{fm(s.expenses_net)}</dd>
                <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Plata que se descuenta al propietario para pagar limpieza y gastos: no es ganancia
                </dd>
              </div>
            </dl>
          </div>
        </>
      )}

      {t.estimated.bookings > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Sin liquidar (≈):</span>
          <Dotted
            items={[
              <>Plataformas ≈{fm(t.estimated.channel)}</>,
              <>Tu comisión ≈{fm(t.estimated.commission)}</>,
              <>Limpieza y gastos ≈{fm(t.estimated.expenses)}</>,
              <>Neto al propietario ≈{fm(t.estimated.owner_net)}</>,
            ]}
          />
          <InfoHint
            label="Cómo se estima"
            content="Calculado sobre lo que paga el huésped. Cuando se liquide con la tarifa del propietario, la comisión y el neto bajan y aparece la diferencia."
          />
        </div>
      )}

      {t.overpaid.bookings > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2">
          <p className={cn("text-sm", NEGATIVE_TEXT)}>
            Se liquidó de más: <span className="font-semibold tabular-nums whitespace-nowrap">{fm(t.overpaid.excess)}</span>{" "}
            en {plural(t.overpaid.bookings, "reserva", "reservas")}
          </p>
          <Link
            href={resultsHref(nav.year, nav.month, {
              modo: nav.mode,
              vista: nav.vista,
              filtro: "estado:de_mas",
              moneda: nav.moneda,
            })}
            className={cn("inline-flex items-center gap-1 text-xs font-medium hover:underline", NEGATIVE_TEXT)}
          >
            Ver <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Barra apilada de lo liquidado: Plataformas · Diferencia · Comisión · Limpieza
 * y gastos · Neto. Suma `parts.settled`; un negativo se recorta a 0 para que
 * no rompa el dibujo (el número real se ve en su KPI). Los tramos se reparten
 * con flex-grow, así los 2 px de separación no desbordan la barra.
 */
function StackedBar({ buckets, currency }: { buckets: Array<{ key: ResultBucket; amount: number }>; currency: string }) {
  const parts = buckets.map((b) => ({ ...b, v: Math.max(0, b.amount) }));
  const sum = parts.reduce((a, p) => a + p.v, 0);
  if (sum <= 0) return null;
  const pct = (v: number) => formatPct((v / sum) * 100);
  return (
    <div
      className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
      role="img"
      aria-label={parts
        .map((p) => `${RESULT_BUCKET_META[p.key].label}: ${formatMoney(p.amount, currency)} (${pct(p.v)})`)
        .join(", ")}
    >
      {parts.map((p) =>
        p.v > 0 ? (
          <div
            key={p.key}
            className="h-full min-w-[3px]"
            style={{ flex: `${p.v} 1 0%`, backgroundColor: RESULT_BUCKET_META[p.key].color }}
            title={`${RESULT_BUCKET_META[p.key].label}: ${formatMoney(p.amount, currency)} (${pct(p.v)})`}
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * Un KPI. El punto de color es la leyenda de la barra; el monto va en tinta
 * (rosa sólo si es negativo). En el celular: rótulo a la izquierda, monto a
 * la derecha, una fila por KPI.
 */
function Kpi({
  bucket,
  amount,
  currency,
  labelExtra,
  amountClassName,
  amountSuffix,
  children,
}: {
  bucket: ResultBucket;
  amount: number;
  currency: string;
  labelExtra?: ReactNode;
  amountClassName?: string;
  amountSuffix?: ReactNode;
  children?: ReactNode;
}) {
  const meta = RESULT_BUCKET_META[bucket];
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0 sm:block sm:border-b-0 sm:py-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
        <Dot color={meta.color} />
        {meta.label}
        {labelExtra}
      </div>
      <div className="text-right sm:text-left">
        <div className="flex items-center justify-end gap-1.5 sm:mt-1 sm:justify-start">
          <span
            className={cn(
              "text-lg font-semibold leading-tight tabular-nums whitespace-nowrap xl:text-xl",
              amount < -TOL && NEGATIVE_TEXT,
              amountClassName,
            )}
          >
            {formatMoney(amount, currency)}
          </span>
          {amountSuffix}
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Otras monedas y cierre ───────────────────────────────────────────────────

function CurrencyLine({ t, nav }: { t: ResultTotals; nav: NavCtx }) {
  const fm = (n: number) => formatMoney(n, t.currency);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-xs">
      <CurrencyChip currency={t.currency} />
      <Dotted
        className="min-w-0 flex-1 text-muted-foreground"
        items={[
          plural(t.bookings, "reserva", "reservas"),
          <>
            Paga el huésped <Amount>{fm(t.guest_total)}</Amount>
          </>,
          <>
            Ingreso de la administración <Amount>{fm(t.admin_income)}</Amount>
          </>,
          <>
            Neto al propietario <Amount>{fm(t.settled.owner_net)}</Amount>
            {t.estimated.owner_net > 0 && <span>≈ +{fm(t.estimated.owner_net)}</span>}
          </>,
        ]}
      />
      <Link
        href={resultsHref(nav.year, nav.month, { modo: nav.mode, vista: nav.vista, moneda: t.currency })}
        className="inline-flex items-center gap-1 font-medium hover:underline"
      >
        Ver <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * "Cierre de {mes}": el estado de los documentos del período. Los netos salen
 * de las líneas de las liquidaciones de este mes (no de la cabecera, que es
 * cache) y "Pagadas" usa `paid_at`, igual que lo transferido.
 */
function CloseStrip({ c, nav, showCurrency }: { c: MonthClose; nav: NavCtx; showCurrency: boolean }) {
  const fm = (n: number) => formatMoney(n, c.currency);
  const settlementsHref = `/dashboard/liquidaciones?tab=periodo&year=${nav.year}&month=${nav.month}`;
  const item = "whitespace-nowrap";
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
        Cierre de {monthNameLower(nav.month)}
        {showCurrency && <CurrencyChip currency={c.currency} />}
      </span>
      <Link href={settlementsHref} className={cn(item, "hover:text-foreground hover:underline")}>
        Liquidaciones <Strong>{c.settlements}</Strong> de{" "}
        {plural(c.owners_with_bookings, "propietario", "propietarios")}
      </Link>
      <span className={item}>
        Pagadas <Strong>{c.settlements_paid}</Strong> · <Strong>{fm(c.net_paid)}</Strong> transferido
      </span>
      <span className={item}>
        Pendiente de transferir <Strong>{fm(c.net_pending)}</Strong>
      </span>
      {c.bookings_not_settled > 0 ? (
        <Link
          href={resultsHref(nav.year, nav.month, {
            modo: nav.mode,
            vista: nav.vista,
            filtro: "estado:sin_liquidar",
            moneda: nav.moneda,
          })}
          className={cn(item, "hover:text-foreground hover:underline")}
        >
          Reservas sin liquidar <Strong>{c.bookings_not_settled}</Strong>
        </Link>
      ) : (
        <span className={item}>
          Reservas sin liquidar <Strong>0</Strong>
        </span>
      )}
      {c.extra_charges > 0 && (
        <span>
          Cobros extra <Strong>{fm(c.extra_charges)}</Strong> (aparte, no suman a lo que paga el huésped)
        </span>
      )}
    </div>
  );
}

// ── Piezas chicas ────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full ring-2 ring-card", className)}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

function Amount({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-medium tabular-nums whitespace-nowrap text-foreground", className)}>{children}</span>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-foreground">{children}</span>;
}

/** Lista "a · b · c" que se envuelve sin partir ningún ítem (ni ningún monto). */
function Dotted({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 tabular-nums", className)}>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          )}
          <span className="inline-flex items-baseline gap-1">{it}</span>
        </span>
      ))}
    </p>
  );
}
