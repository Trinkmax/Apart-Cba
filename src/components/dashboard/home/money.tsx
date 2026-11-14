import RevenueChart from "@/components/dashboard/revenue-chart-lazy";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * La plata de los últimos 30 días. Cada monto lleva su moneda escrita: antes
 * "$ 115.993.604,03" y "$53,414.92" iban uno arriba del otro y no se sabía que
 * el segundo eran dólares.
 */

type ByCurrency = Record<string, number>;

export function MoneyCard({
  collected,
  reserved,
  pending,
  daily,
  className,
}: {
  collected: ByCurrency;
  reserved: ByCurrency;
  pending: ByCurrency;
  daily: Array<{ date: string; amount: number; collected: number; currency: string }>;
  className?: string;
}) {
  const collectedEntries = sorted(collected);
  const reservedEntries = sorted(reserved);
  const pendingEntries = sorted(pending).filter(([, v]) => v > 0);

  return (
    <section className={cn("rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">Cobrado en los últimos 30 días</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Lo que entró en Caja por reservas y cobros extra</p>
          <div className="mt-3 flex flex-wrap items-end gap-x-7 gap-y-2">
            {collectedEntries.length === 0 ? (
              <span className="text-[14px] text-muted-foreground">Todavía no hay cobros registrados.</span>
            ) : (
              collectedEntries.map(([cur, val], i) => (
                <Amount key={cur} currency={cur} value={val} big={i === 0} tone="emerald" />
              ))
            )}
          </div>
        </div>

        <dl className="grid min-w-[12rem] gap-3 sm:text-right">
          <div>
            <dt className="text-[12px] text-muted-foreground">Reservado · salidas de ±30 días</dt>
            <dd className="mt-1 grid gap-0.5 sm:justify-items-end">
              {reservedEntries.length === 0 ? (
                <span className="text-[14px] text-muted-foreground">—</span>
              ) : (
                reservedEntries.map(([cur, val]) => <Amount key={cur} currency={cur} value={val} />)
              )}
            </dd>
          </div>
          {pendingEntries.length > 0 ? (
            <div>
              <dt className="text-[12px] text-muted-foreground">Saldo por cobrar</dt>
              <dd className="mt-1 grid gap-0.5 sm:justify-items-end">
                {pendingEntries.map(([cur, val]) => (
                  <Amount key={cur} currency={cur} value={val} tone="amber" />
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="mt-5">
        <RevenueChart data={daily} />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:pl-[60px]">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-emerald-500" aria-hidden />
            Cobrado por día
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-[1.5px] border-dashed border-[oklch(0.45_0.10_195)]" aria-hidden />
            Reservado por día de entrada
          </span>
        </div>
      </div>
    </section>
  );
}

function Amount({
  currency,
  value,
  big,
  tone,
}: {
  currency: string;
  value: number;
  big?: boolean;
  tone?: "emerald" | "amber";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">{currency}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          big ? "text-[30px] leading-none tracking-[-0.02em]" : "text-[15px]",
          tone === "emerald" && "text-emerald-700 dark:text-emerald-400",
          tone === "amber" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {formatMoney(value, currency)}
      </span>
    </span>
  );
}

/** ARS primero (la moneda de la casa), después el resto por monto. */
function sorted(m: ByCurrency): Array<[string, number]> {
  return Object.entries(m).sort(([a, x], [b, y]) => (a === "ARS" ? -1 : b === "ARS" ? 1 : y - x));
}
