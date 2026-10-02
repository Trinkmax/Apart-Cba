import { ArrowRight, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatMoney, getInitials } from "@/lib/format";
import { StackedBar } from "@/components/rentals/ui";
import { GenerateStatementDialog } from "./generate-statement-dialog";
import type { PendingBoard, PendingOwnerCard } from "./types";

/**
 * "Para rendir": una tarjeta por propietario (y moneda) con lo cobrado y no
 * rendido, los descuentos y el neto a transferir, lista para generar.
 */
export function PendingOwners({ board, today, brandColor }: { board: PendingBoard; today: string; brandColor: string | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {board.cards.map((card) => (
        <PendingCard key={`${card.ownerId}-${card.currency}`} card={card} cutoff={board.cutoff} today={today} brandColor={brandColor} />
      ))}
    </div>
  );
}

function PendingCard({ card, cutoff, today, brandColor }: { card: PendingOwnerCard; cutoff: string; today: string; brandColor: string | null }) {
  const c = card.currency;
  const t = card.totals;
  const positive = t.net > 0;
  const rows: { label: string; value: string; neg?: boolean }[] = [
    { label: "Cobrado", value: formatMoney(t.collected, c) },
    { label: "Honorarios", value: t.fees ? `−${formatMoney(t.fees, c)}` : "—", neg: !!t.fees },
    { label: "IVA", value: t.vat ? `−${formatMoney(t.vat, c)}` : "—", neg: !!t.vat },
    { label: "Gastos", value: t.expenses ? `−${formatMoney(t.expenses, c)}` : "—", neg: !!t.expenses },
  ];
  if (t.other) rows.push({ label: "Otros", value: t.other < 0 ? `−${formatMoney(-t.other, c)}` : formatMoney(t.other, c), neg: t.other < 0 });

  return (
    <Card className="gap-3 p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {getInitials(card.ownerName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{card.ownerName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {card.properties[0] ?? "Sin propiedad"}
              {card.properties.length > 1 ? ` y ${card.properties.length - 1} más` : ""}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{positive ? "Neto a transferir" : "A favor de la inmobiliaria"}</div>
          <div className={positive ? "text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400" : "text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400"}>
            {formatMoney(Math.abs(t.net), c)}
          </div>
        </div>
      </div>

      <StackedBar
        segments={[
          { label: "Neto", value: Math.max(0, t.net), color: "#10b981" },
          { label: "Honorarios", value: t.fees, color: "#7c3aed" },
          { label: "IVA", value: t.vat, color: "#a78bfa" },
          { label: "Gastos", value: t.expenses, color: "#06b6d4" },
        ]}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={r.neg ? "tabular-nums text-rose-600 dark:text-rose-400" : "tabular-nums font-medium"}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {!positive && (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Los descuentos superan lo cobrado. Conviene esperar al próximo cobro: los gastos se descuentan de ahí.
        </p>
      )}

      {!card.hasBankData && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          <CircleAlert size={13} className="mt-px shrink-0" /> No tiene CBU ni alias cargados: sumalos en su ficha para transferirle.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-[11px] text-muted-foreground">
          {card.collectedCount} {card.collectedCount === 1 ? "cobro" : "cobros"}
          {card.lastPaidAt ? ` · último ${formatDate(card.lastPaidAt)}` : ""}
          {c !== "ARS" ? ` · ${c}` : ""}
        </span>
        <GenerateStatementDialog ownerId={card.ownerId} ownerName={card.ownerName} currency={c} defaultCutoff={cutoff} today={today} brandColor={brandColor}>
          <Button size="sm" className="gap-1.5">
            Generar rendición <ArrowRight size={14} />
          </Button>
        </GenerateStatementDialog>
      </div>
    </Card>
  );
}
