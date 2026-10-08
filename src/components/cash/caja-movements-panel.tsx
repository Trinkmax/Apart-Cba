"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, RotateCw, Scale, SearchX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  searchCashMovements,
  type CashMovementListRow,
  type CashSearchResult,
  type CashTotals,
} from "@/lib/actions/cash";
import { isCashSearchActive, parseCashSearch } from "@/lib/cash/search";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashAccount, Unit } from "@/lib/types/database";
import { CashSearchInput } from "./cash-search-input";
import { MovementsList } from "./movements-list";
import { MovementDetailSheet } from "./movement-detail-sheet";

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 220;

type Direction = "all" | "in" | "out";
/** `query`: lo que se buscó para ESTOS resultados (el input puede ir adelante). */
type Results = { query: string; rows: CashMovementListRow[]; total: number; totals: CashTotals };

/**
 * Movimientos del tablero de Caja + la lupa. Sin búsqueda muestra los
 * recientes (vienen del server); con búsqueda consulta TODO el historial de
 * todas las cuentas por depto, persona, concepto o importe, y arriba de los
 * resultados suma cuánto entró y cuánto salió — "¿cuánto le reintegramos a
 * Juan?" se contesta sin calculadora.
 */
export function CajaMovementsPanel({
  recent,
  accounts,
  units,
  initialQuery,
}: {
  recent: CashMovementListRow[];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [direction, setDirection] = useState<Direction>("all");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Cada búsqueda lleva un número: si llega la respuesta de una vieja (la
  // persona siguió tipeando), se descarta.
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = isCashSearchActive(query);
  // El resaltado y el encabezado describen lo que se VE: mientras la persona
  // sigue tipeando, los resultados anteriores quedan atenuados con su texto.
  const tokens = results ? parseCashSearch(results.query).map((t) => t.text) : [];

  function search(q: string, dir: Direction, delay: number, withTotals = true) {
    if (timer.current) clearTimeout(timer.current);
    const id = ++requestId.current;
    setLoadingMore(false);
    if (!isCashSearchActive(q)) {
      setLoading(false);
      setError(null);
      setResults(null);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      let res: CashSearchResult;
      try {
        res = await searchCashMovements({ query: q, direction: dir, offset: 0, limit: PAGE_SIZE, withTotals });
      } catch {
        res = { ok: false, error: "No se pudo buscar. Revisá la conexión y probá de nuevo." };
      }
      if (id !== requestId.current) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const { rows, total, totals } = res;
      setError(null);
      setResults((prev) => ({ query: q.trim(), rows, total, totals: totals ?? prev?.totals ?? [] }));
    }, delay);
  }

  function onQueryChange(next: string) {
    setQuery(next);
    // Una búsqueda nueva arranca mirando todo: un filtro de "sólo egresos"
    // heredado de la anterior escondería resultados sin que se note.
    setDirection("all");
    search(next, "all", DEBOUNCE_MS);
    syncUrl(next);
  }

  function onDirectionChange(next: Direction) {
    setDirection(next);
    // Los totales no dependen de la dirección: se conservan los que hay.
    search(query, next, 0, false);
  }

  // Al entrar con ?q= (volver atrás, recargar, link compartido) y cada vez que
  // la capa en vivo trae movimientos nuevos (`recent` cambia con el refresh),
  // la búsqueda abierta se vuelve a correr para no mostrar resultados viejos.
  useEffect(() => {
    if (!isCashSearchActive(query)) return;
    const t = setTimeout(() => search(query, direction, 0), 0);
    return () => clearTimeout(t);
    // Sólo `recent`: query y direction ya disparan su propia búsqueda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function loadMore() {
    if (!results) return;
    const id = requestId.current;
    setLoadingMore(true);
    let res: CashSearchResult;
    try {
      res = await searchCashMovements({
        query,
        direction,
        offset: results.rows.length,
        limit: PAGE_SIZE,
        withTotals: false,
      });
    } catch {
      res = { ok: false, error: "No se pudieron traer más movimientos." };
    }
    if (id !== requestId.current) return;
    setLoadingMore(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const more = res.rows;
    const total = res.total;
    setResults((prev) => {
      if (!prev) return prev;
      const seen = new Set(prev.rows.map((r) => r.id));
      return { ...prev, total, rows: [...prev.rows, ...more.filter((r) => !seen.has(r.id))] };
    });
  }

  const example = units.find((u) => u.code)?.code;

  return (
    <section aria-label="Movimientos">
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {active ? "Búsqueda en todas las cuentas" : "Movimientos recientes"}
        </h2>
        <CashSearchInput
          value={query}
          onChange={onQueryChange}
          loading={loading}
          className="sm:max-w-[420px]"
        />
      </div>

      {!active ? (
        <MovementsList movements={recent} onSelect={setOpenId} />
      ) : error && !results ? (
        <SearchError message={error} onRetry={() => search(query, direction, 0)} />
      ) : !results ? (
        <ResultsSkeleton />
      ) : (
        <div className="space-y-3">
          <p className="sr-only" aria-live="polite">
            {results.total} {results.total === 1 ? "movimiento encontrado" : "movimientos encontrados"}
          </p>
          {error && <SearchError message={error} onRetry={() => search(query, direction, 0)} compact />}
          {totalCount(results.totals) > 0 && (
            <SearchSummary
              query={results.query}
              totals={results.totals}
              direction={direction}
              onDirection={onDirectionChange}
            />
          )}
          <div className={cn("transition-opacity duration-150", loading && "opacity-60")}>
            {results.rows.length === 0 ? (
              <EmptySearch query={results.query} example={example} />
            ) : (
              <MovementsList movements={results.rows} onSelect={setOpenId} highlight={tokens} />
            )}
          </div>
          {results.rows.length < results.total && (
            <Button
              variant="outline"
              className="w-full"
              onClick={loadMore}
              disabled={loadingMore || loading}
            >
              {loadingMore ? "Cargando…" : `Ver más · quedan ${results.total - results.rows.length}`}
            </Button>
          )}
        </div>
      )}

      <MovementDetailSheet
        open={openId !== null}
        movementId={openId}
        accounts={accounts}
        units={units}
        onClose={() => setOpenId(null)}
      />
    </section>
  );
}

/** Deja la búsqueda en la URL: sobrevive a recargar y a ir y volver de una cuenta. */
function syncUrl(q: string) {
  const url = new URL(window.location.href);
  const clean = q.trim();
  if (clean) url.searchParams.set("q", clean);
  else url.searchParams.delete("q");
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
}

function totalCount(totals: CashTotals) {
  return totals.reduce((n, t) => n + t.count_in + t.count_out, 0);
}

function SearchSummary({
  query,
  totals,
  direction,
  onDirection,
}: {
  query: string;
  totals: CashTotals;
  direction: Direction;
  onDirection: (d: Direction) => void;
}) {
  const countIn = totals.reduce((n, t) => n + t.count_in, 0);
  const countOut = totals.reduce((n, t) => n + t.count_out, 0);
  const all = countIn + countOut;

  return (
    <Card className="gap-0 p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{all}</span>{" "}
        {all === 1 ? "movimiento" : "movimientos"} con «
        <span className="font-medium text-foreground">{query}</span>»
      </p>
      <div role="group" aria-label="Mostrar" className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-2">
        <Segment
          selected={direction === "all"}
          onClick={() => onDirection("all")}
          icon={<Scale size={13} />}
          label="Neto"
          count={all}
          tone="neutral"
          lines={totals.map((t) => ({
            key: t.currency,
            text: formatMoney(t.in - t.out, t.currency),
            negative: t.in - t.out < 0,
          }))}
        />
        <Segment
          selected={direction === "in"}
          onClick={() => onDirection(direction === "in" ? "all" : "in")}
          icon={<ArrowDownToLine size={13} />}
          label="Ingresos"
          count={countIn}
          tone="in"
          lines={totals
            .filter((t) => t.count_in > 0)
            .map((t) => ({ key: t.currency, text: formatMoney(t.in, t.currency) }))}
        />
        <Segment
          selected={direction === "out"}
          onClick={() => onDirection(direction === "out" ? "all" : "out")}
          icon={<ArrowUpFromLine size={13} />}
          label="Egresos"
          count={countOut}
          tone="out"
          lines={totals
            .filter((t) => t.count_out > 0)
            .map((t) => ({ key: t.currency, text: formatMoney(t.out, t.currency) }))}
        />
      </div>
    </Card>
  );
}

function Segment({
  selected,
  onClick,
  icon,
  label,
  count,
  tone,
  lines,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "neutral" | "in" | "out";
  lines: Array<{ key: string; text: string; negative?: boolean }>;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        // Mobile: una fila por opción (etiqueta a la izquierda, importe entero
        // a la derecha). Desde sm: tres tarjetas. La plata nunca se corta.
        "flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color,box-shadow] sm:block",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-default disabled:opacity-50",
        selected
          ? tone === "in"
            ? "border-emerald-400/70 bg-emerald-500/10 ring-1 ring-emerald-400/40 dark:border-emerald-700/70"
            : tone === "out"
            ? "border-rose-400/70 bg-rose-500/10 ring-1 ring-rose-400/40 dark:border-rose-800/70"
            : "border-foreground/30 bg-muted ring-1 ring-foreground/10"
          : "bg-background hover:bg-muted/60 enabled:active:scale-[0.98]",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wide",
          tone === "in"
            ? "text-emerald-700 dark:text-emerald-400"
            : tone === "out"
            ? "text-rose-700 dark:text-rose-400"
            : "text-muted-foreground",
        )}
      >
        {icon}
        <span>{label}</span>
        <span className="pl-1 tabular-nums text-muted-foreground sm:ml-auto">{count}</span>
      </span>
      <span className="block min-w-0 space-y-0.5 text-right sm:mt-1 sm:text-left">
        {lines.length === 0 ? (
          <span className="block text-sm text-muted-foreground">—</span>
        ) : (
          lines.map((l) => (
            <span
              key={l.key}
              className={cn(
                "block truncate text-sm font-semibold tabular-nums sm:text-base",
                tone === "in" && "text-emerald-700 dark:text-emerald-400",
                tone === "out" && "text-rose-700 dark:text-rose-400",
                tone === "neutral" && l.negative && "text-rose-700 dark:text-rose-400",
              )}
              title={l.text}
            >
              {l.text}
            </span>
          ))
        )}
      </span>
    </button>
  );
}

function EmptySearch({ query, example }: { query: string; example?: string }) {
  return (
    <Card className="items-center gap-3 border-dashed p-8 text-center sm:p-10">
      <SearchX className="size-8 text-muted-foreground/60" aria-hidden />
      <div>
        <p className="text-sm font-medium">Nada con «{query}»</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Probá con el código o el nombre del depto{example ? ` (ej. ${example})` : ""}, el nombre del
          huésped, propietario o inquilino, una palabra del concepto o un importe (ej. 15.000).
        </p>
      </div>
    </Card>
  );
}

function SearchError({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex-row items-center justify-between gap-3 border-amber-300/60 bg-amber-50/60 text-sm dark:border-amber-800/50 dark:bg-amber-950/20",
        compact ? "p-3" : "p-4",
      )}
      role="alert"
    >
      <span className="text-amber-900 dark:text-amber-200">{message}</span>
      <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={onRetry}>
        <RotateCw size={13} /> Reintentar
      </Button>
    </Card>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-[108px] w-full rounded-xl" />
      <Card className="gap-0 divide-y overflow-hidden p-0">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}
