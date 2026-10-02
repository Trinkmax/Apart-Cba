import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { statementClosedWithoutPayout } from "@/lib/rentals/labels";
import { CopyButton } from "./copy-button";
import type { StatementDocModel, StatementGroup } from "./statement-model";

/**
 * Documento "Rendición al propietario" (presentacional, sirve en RSC y en
 * cliente). Misma estética que la liquidación de temporarios
 * (settlement-statement.tsx): banda de marca, grilla de datos con hairlines,
 * franja de KPIs con el neto resaltado y CONTAINER QUERIES — el mismo
 * documento se ve en el panel, en el link público desde el celular y en la
 * vista previa del diálogo de "Generar".
 */

function safeColor(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : RENTALS_ACCENT;
}

function signed(n: number, currency: string): string {
  return n < 0 ? `−${formatMoney(Math.abs(n), currency)}` : formatMoney(n, currency);
}

export function StatementDocument({
  model,
  brandColor,
  orgName,
  showPayments = false,
  audience = "staff",
}: {
  model: StatementDocModel;
  brandColor?: string | null;
  orgName?: string | null;
  /** Detalle interno de cuentas de Caja usadas (sólo en el panel). */
  showPayments?: boolean;
  /** "owner" = el link público: le habla al propietario (sin datos internos del envío ni botones de copiar su CBU). */
  audience?: "staff" | "owner";
}) {
  const brand = safeColor(brandColor);
  const c = model.currency;
  const t = model.totals;
  const owner = audience === "owner";
  const closed = statementClosedWithoutPayout(model.status, t.net);
  const paidOut = model.status === "pagada" && !closed;
  const netLabel =
    t.net < 0
      ? owner
        ? "Saldo a tu cargo"
        : "Saldo a cargo del propietario"
      : paidOut
        ? "Neto transferido"
        : owner
          ? "Neto a cobrar"
          : "Neto a transferir";
  const kpis: { label: string; value: string; tone?: "neg" }[] = [
    { label: "Cobrado", value: formatMoney(t.collected, c) },
    { label: "Honorarios", value: t.fees ? `−${formatMoney(t.fees, c)}` : "—", tone: t.fees ? "neg" : undefined },
    { label: "IVA", value: t.vat ? `−${formatMoney(t.vat, c)}` : "—", tone: t.vat ? "neg" : undefined },
    { label: "Gastos", value: t.expenses ? `−${formatMoney(t.expenses, c)}` : "—", tone: t.expenses ? "neg" : undefined },
  ];
  if (t.other) kpis.push({ label: "Otros", value: signed(t.other, c), tone: t.other < 0 ? "neg" : undefined });
  const oddCount = (kpis.length + 1) % 2 === 1;
  const hasBank = !!(model.owner.bank_name || model.owner.cbu || model.owner.alias_cbu) && t.net > 0 && model.status !== "anulada";
  const stateCell = (() => {
    if (model.status === "anulada") return { label: "Anulada", value: model.voidedAt ? formatDate(model.voidedAt) : "Sí", hint: null };
    if (closed) return { label: "Cerrada", value: model.paidAt ? formatDate(model.paidAt) : "Sí", hint: "sin transferencia" };
    if (paidOut) return { label: "Transferida", value: model.paidAt ? formatDate(model.paidAt) : "Sí", hint: null };
    if (owner) return { label: "Transferencia", value: t.net > 0 ? "Pendiente" : "No corresponde", hint: null };
    return { label: "Enviada", value: model.sentAt ? formatDate(model.sentAt) : "Todavía no", hint: model.sentTo };
  })();

  return (
    <Card className="@container overflow-hidden p-0 gap-0">
      <div className="relative overflow-hidden px-4 py-4 text-white @[34rem]:px-7 @[34rem]:py-5" style={{ backgroundColor: brand }}>
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_30%,oklch(0_0_0/0.22))]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.14),transparent_60%)]" />
        <div className="relative flex flex-col gap-3 @[34rem]:flex-row @[34rem]:items-start @[34rem]:justify-between @[34rem]:gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] opacity-85">{orgName ? `${orgName} · ` : ""}Rendición al propietario</div>
            <div className="mt-1 font-mono text-lg font-bold @[34rem]:text-xl">N° {model.number}</div>
            <div className="mt-0.5 text-sm opacity-90 break-words">{model.owner.full_name}</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 @[34rem]:flex-col @[34rem]:items-end @[34rem]:gap-1">
            <div className="text-base font-semibold @[34rem]:text-lg">{model.periodLabel}</div>
            <div className="text-xs opacity-85">Cobros hasta el {formatDate(model.cutoffDate)}</div>
            <div className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "oklch(1 0 0 / 0.18)" }}>
              <span className="size-1.5 rounded-full" style={{ backgroundColor: model.statusColor }} />
              {model.statusLabel}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-border @[40rem]:grid-cols-4">
        <DataCell label="Propietario" value={model.owner.full_name} />
        <DataCell label="Fecha de corte" value={formatDate(model.cutoffDate)} />
        <DataCell label="Generada" value={formatDate(model.generatedAt)} />
        <DataCell label={stateCell.label} value={stateCell.value} hint={stateCell.hint} />
      </dl>

      <div className={cn("grid grid-cols-2 gap-px border-y bg-border", kpis.length === 5 ? "@[40rem]:grid-cols-6" : "@[34rem]:grid-cols-5")}>
        {kpis.map((k) => (
          <div key={k.label} className="bg-card px-4 py-3.5 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 truncate text-base font-semibold tabular-nums @[34rem]:text-lg", k.tone === "neg" && "text-rose-600 dark:text-rose-400")}>{k.value}</div>
          </div>
        ))}
        <div
          className={cn("bg-card px-4 py-3.5 min-w-0", oddCount && "col-span-2 @[34rem]:col-span-1")}
          style={{ backgroundImage: `linear-gradient(${brand}14, ${brand}14)` }}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{netLabel}</div>
          <div className={cn("mt-1 truncate text-xl font-bold tabular-nums", t.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {formatMoney(Math.abs(t.net), c)}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-3 @[34rem]:space-y-6 @[34rem]:p-6">
        {model.status === "anulada" &&
          (owner ? (
            // Al propietario no le llega el motivo (es interno): sólo que ya no vale.
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-300">
              Esta rendición se anuló{model.voidedAt ? ` el ${formatDate(model.voidedAt)}` : ""} y ya no vale. Si corresponde, vas a recibir una nueva.
            </div>
          ) : (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-300">
              Rendición anulada{model.voidedAt ? ` el ${formatDate(model.voidedAt)}` : ""}
              {model.voidReason ? `: ${model.voidReason}` : "."} Sus cobros y gastos volvieron a quedar para rendir.
            </div>
          ))}

        {model.groups.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">La rendición no tiene renglones.</p>}

        {model.groups.map((g) => (
          <GroupBlock key={g.key} group={g} currency={c} brand={brand} />
        ))}

        {model.notes && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 @[34rem]:px-4">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Notas</div>
            <p className="whitespace-pre-wrap text-sm">{model.notes}</p>
          </div>
        )}

        {closed && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200 @[34rem]:px-4">
            <div className="font-medium">Cerrada{model.paidAt ? ` el ${formatDate(model.paidAt)}` : ""} sin transferencia.</div>
            {t.net < 0 && (
              <p className="mt-0.5 text-xs opacity-90">
                {owner
                  ? `Los gastos superaron lo cobrado: los ${formatMoney(Math.abs(t.net), c)} a tu cargo se descuentan de tu próxima rendición.`
                  : `Los ${formatMoney(Math.abs(t.net), c)} a cargo del propietario se descuentan solos en su próxima rendición.`}
              </p>
            )}
          </div>
        )}

        {paidOut && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 @[34rem]:px-4">
            <div className="font-medium">
              Transferido{model.paidAt ? ` el ${formatDate(model.paidAt)}` : ""}: {formatMoney(Math.abs(t.net), c)}
            </div>
            {showPayments && model.payments.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs opacity-90">
                {model.payments.map((p, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">Desde {p.accountName}</span>
                    <span className="tabular-nums">{formatMoney(p.amount, c)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {hasBank && (
          <div className="rounded-lg border bg-muted/40 p-3 @[34rem]:p-4">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {owner ? (paidOut ? "Te lo transferimos a" : "Te lo transferimos a esta cuenta") : `${paidOut ? "Transferido a" : "Transferir a"} ${model.owner.full_name}`}
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm @[34rem]:grid-cols-3">
              <BankField label="Banco" value={model.owner.bank_name} />
              <BankField label="CBU" value={model.owner.cbu} mono copy={!owner && !paidOut} />
              <BankField label="Alias" value={model.owner.alias_cbu} mono copy={!owner && !paidOut} />
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Se rinde lo cobrado, no lo facturado: cada pago del inquilino entra una sola vez, en la rendición que corresponde a su fecha.
        </p>
      </div>
    </Card>
  );
}

function DataCell({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium leading-snug">{value}</dd>
      {hint && <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function BankField({ label, value, mono, copy }: { label: string; value: string | null; mono?: boolean; copy?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className={cn("min-w-0 break-all font-medium", mono && "select-all font-mono text-xs")}>{value ?? "—"}</span>
        {copy && value && <CopyButton value={value} label={label} className="size-7" />}
      </div>
    </div>
  );
}

function GroupBlock({ group: g, currency, brand }: { group: StatementGroup; currency: string; brand: string }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: brand }} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug">
              {g.label}
              {g.code && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">{g.code}</span>}
              {g.sharePct && (
                <span className="ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: brand, borderColor: `${brand}40`, backgroundColor: `${brand}10` }}>
                  Tu parte: {g.sharePct.toLocaleString("es-AR")} %
                </span>
              )}
            </h3>
            {g.contracts.length > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {g.contracts.map((k) => (k.tenantName ? `${k.number} · Inquilino: ${k.tenantName}` : k.number)).join("  ·  ")}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="divide-y rounded-lg border">
        {g.lines.map((l) => (
          <div key={l.id} className="flex items-start gap-3 px-3 py-2.5 text-sm @[34rem]:px-4">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
            <div className="min-w-0 flex-1">
              <div className="leading-snug break-words">{l.description}</div>
              <div className="text-[11px] text-muted-foreground">{l.kindLabel}</div>
            </div>
            <span className={cn("shrink-0 whitespace-nowrap font-medium tabular-nums", l.sign > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
              {l.sign > 0 ? "+" : "−"}
              {formatMoney(l.amount, currency)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-sm @[34rem]:px-4">
          <span className="text-xs font-medium text-muted-foreground">Subtotal de la propiedad</span>
          <span className="font-semibold tabular-nums">{signed(g.subtotal.net, currency)}</span>
        </div>
      </div>
    </section>
  );
}
