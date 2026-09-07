import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResultTotals } from "@/lib/actions/results";
import { RESULT_BUCKET_META, RESULT_BUCKET_ORDER, type ResultBucket } from "./results-meta";

function bucketAmount(t: ResultTotals, b: ResultBucket): number {
  switch (b) {
    case "channel":
      return t.channel_commission;
    case "commission":
      return t.commission;
    case "cleaning":
      return t.cleaning;
    case "owner":
      return t.owner_net;
  }
}

/**
 * Tira de KPIs + barra "cascada" por moneda: cómo el total que paga el
 * huésped se reparte en los cuatro bolsillos. Sin librería de charts: es
 * una barra apilada en CSS, suficiente para leer proporciones de un vistazo.
 */
export function ResultsSummary({ totals }: { totals: ResultTotals[] }) {
  return (
    <div className="space-y-3">
      {totals.map((t) => (
        <CurrencySummary key={t.currency} t={t} showCurrency={totals.length > 1} />
      ))}
    </div>
  );
}

function CurrencySummary({ t, showCurrency }: { t: ResultTotals; showCurrency: boolean }) {
  const cur = t.currency;
  // Un neto negativo (comisiones > total) no se dibuja: la barra muestra
  // sólo partes positivas y se normaliza por su suma.
  const parts = RESULT_BUCKET_ORDER.map((b) => ({
    bucket: b,
    amount: Math.max(0, bucketAmount(t, b)),
  }));
  const partsSum = parts.reduce((a, p) => a + p.amount, 0);
  const pctOf = (amount: number) => (partsSum > 0 ? (amount / partsSum) * 100 : 0);
  const bookingsLabel = t.bookings === 1 ? "1 reserva" : `${t.bookings} reservas`;

  return (
    <Card className="p-4 sm:p-5 gap-4">
      {/* 2 columnas en el celular; en desktop una fila flexible que envuelve
          antes de recortar un importe (los números nunca se truncan). */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:flex lg:flex-wrap lg:gap-x-8 lg:gap-y-4">
        {/* Paga el huésped */}
        <div className="col-span-2 min-w-0 lg:flex-[2_1_240px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            Paga el huésped
            {showCurrency && (
              <span className="rounded-full border px-1.5 py-px text-[9px] font-semibold tabular-nums">{cur}</span>
            )}
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight mt-1 whitespace-nowrap">
            {formatMoney(t.total, cur)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {bookingsLabel} · cobrado{" "}
            <span className="text-emerald-700 dark:text-emerald-300 font-medium">{formatMoney(t.paid, cur)}</span>
            {" · "}pendiente{" "}
            <span className={cn("font-medium", t.pending > 0 ? "text-amber-700 dark:text-amber-300" : "")}>
              {formatMoney(t.pending, cur)}
            </span>
          </div>
        </div>

        {RESULT_BUCKET_ORDER.map((b) => {
          const meta = RESULT_BUCKET_META[b];
          const amount = bucketAmount(t, b);
          return (
            <div key={b} className="min-w-0 lg:flex-[1_1_150px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} aria-hidden />
                <span className="truncate">{meta.label}</span>
              </div>
              <div className={cn("text-lg sm:text-xl font-semibold tabular-nums leading-tight mt-1 whitespace-nowrap", meta.text)}>
                {b === "owner" ? "" : "− "}
                {formatMoney(amount, cur)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {meta.hint ?? `${pctOf(Math.max(0, amount)).toFixed(1)}% del total`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cascada */}
      {partsSum > 0 && (
        <div className="space-y-1.5">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={RESULT_BUCKET_ORDER.map(
              (b) => `${RESULT_BUCKET_META[b].label}: ${formatMoney(bucketAmount(t, b), cur)}`
            ).join(", ")}
          >
            {parts.map((p) =>
              p.amount > 0 ? (
                <div
                  key={p.bucket}
                  className="h-full"
                  style={{
                    width: `${pctOf(p.amount)}%`,
                    backgroundColor: RESULT_BUCKET_META[p.bucket].color,
                  }}
                  title={`${RESULT_BUCKET_META[p.bucket].label}: ${formatMoney(p.amount, cur)}`}
                />
              ) : null
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {parts.map((p) => (
              <span key={p.bucket} className="inline-flex items-center gap-1.5 tabular-nums">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: RESULT_BUCKET_META[p.bucket].color }}
                  aria-hidden
                />
                {RESULT_BUCKET_META[p.bucket].label} {pctOf(p.amount).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
