"use client";

import { AlertTriangle, CheckCircle2, Loader2, PiggyBank, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { PaymentPreview } from "@/lib/rentals/server/payments";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Número que se vuelve "esqueleto" mientras el servidor recalcula (las etiquetas quedan quietas). */
function Num({ loading, children, className }: { loading: boolean; children: ReactNode; className?: string }) {
  if (loading) return <span className="inline-block h-4 w-20 rounded bg-muted animate-pulse align-middle" aria-hidden />;
  return <span className={cn("tabular-nums whitespace-nowrap", className)}>{children}</span>;
}

export function PaymentPreviewPanel({
  preview,
  loading,
  amount,
  paidAt,
  waive,
  lateFeeHint,
  error,
}: {
  preview: PaymentPreview | null;
  loading: boolean;
  amount: number | null;
  paidAt: string;
  waive: boolean;
  lateFeeHint: string | null;
  error: string | null;
}) {
  const currency = preview?.currency ?? "ARS";
  const money = (n: number) => formatMoney(n, currency);
  const allocatedBy = new Map<string, number>();
  const allocatedItem = new Map<string, number>();
  for (const a of preview?.allocations ?? []) {
    allocatedBy.set(a.chargeId, r2((allocatedBy.get(a.chargeId) ?? 0) + a.amount));
    const key = a.itemId ?? `nuevo:${a.newItemIndex}`;
    allocatedItem.set(key, r2((allocatedItem.get(key) ?? 0) + a.amount));
  }
  const allocated = r2([...allocatedBy.values()].reduce((s, v) => s + v, 0));
  const stillOwes = preview ? Math.max(0, r2(preview.totalDebt - allocated)) : 0;
  // Los intereses del día son los mismos se condonen o no (sólo cambia si se cobran):
  // así, mientras el servidor recalcula después de tocar "Condonar", la vista
  // anterior ya muestra los montos correctos en vez de un "no hay nada" falso.
  const feeLines = preview ? (preview.lateFees.length ? preview.lateFees : preview.waivedLateFees) : [];
  const waivedTotal = r2(feeLines.reduce((s, f) => s + f.amount, 0));

  return (
    <section className="rounded-xl border bg-muted/30 p-3 sm:p-4 space-y-3 min-w-0" aria-live="polite" aria-busy={loading}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Scale size={13} /> Cómo se imputa
        </h3>
        {loading && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> Calculando…
          </span>
        )}
      </div>

      {error && <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}

      {!preview && !error && (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {preview && preview.charges.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card px-3 py-4 text-center">
          <CheckCircle2 size={20} className="mx-auto text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-medium mt-1.5">No debe nada al {formatDate(paidAt)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Si cobrás igual, todo queda como saldo a favor para lo próximo que venza.</p>
        </div>
      )}

      {preview && feeLines.length > 0 && !waive && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Intereses por mora al {formatDate(paidAt)}
          </p>
          {feeLines.map((f) => (
            <div key={f.chargeId} className="flex items-start justify-between gap-3 text-xs text-amber-900 dark:text-amber-100">
              <span className="min-w-0">
                {f.chargeLabel}: {f.daysLate} {f.daysLate === 1 ? "día" : "días"} de atraso sobre {money(f.base)}
                {f.alreadyBilled > 0 && <span className="opacity-75"> (ya se habían cargado o condonado {money(f.alreadyBilled)})</span>}
              </span>
              <Num loading={loading} className="font-semibold">
                {money(f.amount)}
              </Num>
            </div>
          ))}
          {lateFeeHint && <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">Lo fija el contrato: {lateFeeHint}. Podés condonarlos abajo.</p>}
        </div>
      )}
      {preview && waive && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 space-y-1.5 text-xs text-emerald-800 dark:text-emerald-200">
          {feeLines.length > 0 ? (
            <>
              <p className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 size={13} /> Condonás <Num loading={loading}>{money(waivedTotal)}</Num> de intereses por mora
              </p>
              {feeLines.map((f) => (
                <div key={f.chargeId} className="flex items-start justify-between gap-3 text-emerald-900 dark:text-emerald-100">
                  <span className="min-w-0">
                    {f.chargeLabel}: {f.daysLate} {f.daysLate === 1 ? "día" : "días"} de atraso al {formatDate(paidAt)}
                  </span>
                  <Num loading={loading} className="line-through decoration-emerald-700/50">
                    {money(f.amount)}
                  </Num>
                </div>
              ))}
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                No se cobran y quedan anotados en la cuenta, así el próximo pago no los vuelve a sumar.
              </p>
            </>
          ) : (
            <p>Al {formatDate(paidAt)} no hay intereses por mora para condonar.</p>
          )}
        </div>
      )}

      {preview && preview.charges.length > 0 && (
        <ul className="space-y-2">
          {preview.charges.map((c) => {
            const got = allocatedBy.get(c.id) ?? 0;
            const pct = c.outstanding > 0 ? Math.min(100, Math.round((got / c.outstanding) * 100)) : 0;
            const overdue = c.dueDate < paidAt;
            return (
              <li key={c.id} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug truncate">{c.label}</p>
                    <p className={cn("text-[11px]", overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                      {overdue ? "Venció" : "Vence"} el {formatDate(c.dueDate)} · debe {money(c.outstanding)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Num loading={loading} className={cn("text-sm font-semibold", got > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                      {got > 0 ? `+ ${money(got)}` : "—"}
                    </Num>
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ width: `${loading ? 0 : pct}%` }}
                  />
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {c.items.map((i) => {
                    const part = allocatedItem.get(i.itemId) ?? 0;
                    return (
                      <li key={i.itemId} className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <span className="truncate">{i.description}</span>
                        <span className="tabular-nums whitespace-nowrap">
                          {loading ? "…" : part > 0 ? `${money(part)} de ${money(i.outstanding)}` : money(i.outstanding)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <dl className="rounded-lg bg-card border divide-y text-sm">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Debe hoy</dt>
            <dd><Num loading={loading}>{money(preview.totalDebt)}</Num></dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Este cobro</dt>
            <dd><Num loading={loading} className="font-medium">{money(amount ?? 0)}</Num></dd>
          </div>
          {stillOwes > 0.004 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-rose-500/5">
              <dt className="font-medium text-rose-700 dark:text-rose-300">Queda debiendo</dt>
              <dd><Num loading={loading} className="font-semibold text-rose-700 dark:text-rose-300">{money(stillOwes)}</Num></dd>
            </div>
          ) : preview.remainder > 0.004 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-emerald-500/5">
              <dt className="font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"><PiggyBank size={14} /> Saldo a favor</dt>
              <dd><Num loading={loading} className="font-semibold text-emerald-700 dark:text-emerald-300">{money(preview.remainder)}</Num></dd>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-emerald-500/5">
              <dt className="font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"><CheckCircle2 size={14} /> Queda al día</dt>
              <dd className="text-xs text-emerald-700/80 dark:text-emerald-300/80">sin saldo pendiente</dd>
            </div>
          )}
        </dl>
      )}
      {preview && preview.remainder > 0.004 && stillOwes <= 0.004 && (
        <p className="text-[11px] text-muted-foreground">El saldo a favor se descuenta solo del próximo cargo que se genere.</p>
      )}
    </section>
  );
}
