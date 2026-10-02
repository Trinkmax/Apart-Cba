"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, BadgePercent, ChevronDown, FilePlus2, FileText, HandCoins, MoreHorizontal, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Money, StackedBar, StatusBadge } from "@/components/rentals/ui";
import type { ContractLedger, LedgerCharge, LedgerItem, LedgerPayment } from "@/lib/rentals/server/collections-queries";
import { voidCharge, voidPayment } from "@/lib/actions/rentals-collections";
import { CHARGE_STATE_META, PAYEE_LABEL, formatReceiptNumber } from "@/lib/rentals/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddItemDialog, DiscountDialog, ReasonDialog } from "./charge-dialogs";
import { ExtraChargeDialog } from "./extra-charge-dialog";
import { PaymentDialog } from "./payment-dialog";
import { ReceiptMenu } from "./receipt-actions";
import { RegisterPaymentButton } from "./register-payment-button";
import { ReminderMenu } from "./reminder-menu";

const KIND_CHIP: Record<string, string> = { ingreso: "Ingreso", extra: "Extra", salida: "Salida" };
type Filter = "todo" | "saldo" | "cobros";

/** Saldo de la cuenta después de este movimiento (no lo que debe el cargo). */
function BalanceText({ balance, currency }: { balance: number; currency: string }) {
  if (balance > 0.004) return <span>Saldo: debe {formatMoney(balance, currency)}</span>;
  if (balance < -0.004) return <span className="text-emerald-700 dark:text-emerald-400">Saldo: a favor {formatMoney(-balance, currency)}</span>;
  return <span>Saldo: al día</span>;
}

/** Cuenta corriente del contrato: extracto con saldo corrido, acciones por cargo y por cobro. */
export function LedgerView({ ledger }: { ledger: ContractLedger }) {
  const router = useRouter();
  const { contract, totals } = ledger;
  const currency = contract.currency;
  const [filter, setFilter] = useState<Filter>("todo");
  const [showVoided, setShowVoided] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [addFor, setAddFor] = useState<LedgerCharge | null>(null);
  const [discountFor, setDiscountFor] = useState<{ charge: LedgerCharge; item: LedgerItem } | null>(null);
  const [voidChargeFor, setVoidChargeFor] = useState<LedgerCharge | null>(null);
  const [voidPaymentFor, setVoidPaymentFor] = useState<LedgerPayment | null>(null);
  const [payFor, setPayFor] = useState<LedgerCharge | null>(null);

  const balanceById = new Map(ledger.movements.map((m) => [m.id, m.balance]));
  const chargeById = new Map(ledger.charges.map((c) => [c.id, c]));
  const paymentById = new Map(ledger.payments.map((p) => [p.id, p]));
  const voidedCount = ledger.charges.filter((c) => c.voided).length + ledger.payments.filter((p) => p.voided).length;
  const canCharge = contract.status !== "borrador";

  const rows = [...ledger.movements]
    .reverse()
    .filter((m) => {
      const voided = m.type === "charge" ? chargeById.get(m.id)?.voided : paymentById.get(m.id)?.voided;
      if (voided && !showVoided) return false;
      if (filter === "cobros") return m.type === "payment";
      if (filter === "saldo") return m.type === "charge" && (chargeById.get(m.id)?.outstanding ?? 0) > 0.004;
      return true;
    });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const paidPart = totals.paid;
  const overdue = totals.overdue;
  const upcoming = Math.max(0, Math.round((totals.outstanding - totals.overdue) * 100) / 100);
  // Rojo sólo si algo ya venció: los cargos se generan días antes del vencimiento
  // y un inquilino al día no puede verse "en deuda" medio mes (igual que el
  // resumen del contrato y la lista, que lo muestran neutro como "a vencer").
  const owes = totals.balance > 0.004;
  const late = overdue > 0.004;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5 gap-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Wallet size={13} /> Saldo de la cuenta
            </p>
            <p
              className={cn(
                "mt-1.5 text-3xl font-bold leading-none tracking-tight tabular-nums",
                owes ? (late ? "text-rose-600 dark:text-rose-400" : "text-foreground") : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {owes
                ? formatMoney(totals.balance, currency)
                : totals.balance < -0.004
                  ? `A favor ${formatMoney(-totals.balance, currency)}`
                  : "Al día"}
              {owes && !late && <span className="ml-2 text-sm font-medium tracking-normal text-muted-foreground">a vencer</span>}
            </p>
            <p className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
              <span>
                Vencido <Money amount={overdue} currency={currency} tone={overdue > 0 ? "out" : "muted"} />
              </span>
              <span className="text-muted-foreground/50">·</span>
              <span>
                Por vencer <Money amount={upcoming} currency={currency} />
              </span>
              {totals.credit > 0.004 && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>
                    Saldo a favor <Money amount={totals.credit} currency={currency} tone="in" />
                  </span>
                </>
              )}
            </p>
          </div>
          {canCharge && (
            <div className="flex flex-wrap items-center gap-2">
              <ReminderMenu contractId={contract.id} tenantName={contract.tenantName} tenantEmail={contract.tenantEmail} />
              <ExtraChargeDialog contractId={contract.id} currency={currency} today={ledger.today}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FilePlus2 size={14} /> Nuevo cargo
                </Button>
              </ExtraChargeDialog>
              <RegisterPaymentButton contractId={contract.id} size="sm" />
            </div>
          )}
        </div>
        {totals.billed > 0 && (
          <div className="mt-4 space-y-1.5">
            <StackedBar
              segments={[
                { value: paidPart, color: "#10b981", label: "Cobrado" },
                { value: overdue, color: "#f43f5e", label: "Vencido" },
                { value: upcoming, color: "#94a3b8", label: "Por vencer" },
              ]}
            />
            <p className="text-[11px] text-muted-foreground">
              De {formatMoney(totals.billed, currency)} facturados desde el inicio, se cobraron {formatMoney(paidPart, currency)}.
            </p>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filtrar movimientos">
          {([
            { k: "todo", label: "Todo" },
            { k: "saldo", label: "Con saldo" },
            { k: "cobros", label: "Cobros" },
          ] as const).map((f) => (
            <button
              key={f.k}
              type="button"
              role="tab"
              aria-selected={filter === f.k}
              onClick={() => setFilter(f.k)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors min-h-8",
                filter === f.k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {voidedCount > 0 && (
          <button type="button" onClick={() => setShowVoided((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground min-h-8">
            {showVoided ? "Ocultar anulados" : `Ver anulados (${voidedCount})`}
          </button>
        )}
      </div>

      {ledger.movements.length === 0 ? (
        <Card className="p-8 items-center text-center gap-2 border-dashed">
          <FileText size={22} className="text-muted-foreground" />
          <p className="text-sm font-medium">Todavía no hay movimientos</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Los cargos del alquiler se generan solos unos días antes de cada período. También podés crear un cargo aparte con &quot;Nuevo cargo&quot;.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">No hay movimientos con este filtro.</Card>
      ) : (
        <Card className="p-0 gap-0 overflow-hidden">
          <ul className="divide-y">
            {rows.map((m) => {
              const balance = balanceById.get(m.id) ?? 0;
              if (m.type === "charge") {
                const c = chargeById.get(m.id);
                if (!c) return null;
                return (
                  <ChargeRow
                    key={m.id}
                    charge={c}
                    currency={currency}
                    balance={balance}
                    expanded={expanded.has(c.id)}
                    onToggle={() => toggle(c.id)}
                    onAdd={() => setAddFor(c)}
                    onDiscount={(item) => setDiscountFor({ charge: c, item })}
                    onVoid={() => setVoidChargeFor(c)}
                    onPay={canCharge ? () => setPayFor(c) : undefined}
                  />
                );
              }
              const p = paymentById.get(m.id);
              if (!p) return null;
              return (
                <PaymentRow key={m.id} payment={p} currency={currency} balance={balance} tenantEmail={contract.tenantEmail} onVoid={() => setVoidPaymentFor(p)} />
              );
            })}
          </ul>
        </Card>
      )}

      {addFor && (
        <AddItemDialog open onOpenChange={(o) => !o && setAddFor(null)} chargeId={addFor.id} chargeLabel={addFor.label} currency={currency} />
      )}
      {discountFor && (
        <DiscountDialog
          open
          onOpenChange={(o) => !o && setDiscountFor(null)}
          item={discountFor.item}
          chargeLabel={discountFor.charge.label}
          currency={currency}
        />
      )}
      <ReasonDialog
        open={!!voidChargeFor}
        onOpenChange={(o) => !o && setVoidChargeFor(null)}
        title="Anular cargo"
        description={voidChargeFor ? `${voidChargeFor.label} · ${formatMoney(voidChargeFor.subtotal, currency)}` : undefined}
        warning={
          voidChargeFor?.kind === "mensual" ? (
            <>
              Un cargo mensual anulado <strong>se vuelve a generar</strong> con los valores actuales del contrato (sin los conceptos que le agregaste a
              mano). Si este mes no se cobra, mejor <strong>bonificá</strong> el alquiler.
            </>
          ) : undefined
        }
        confirmLabel="Anular cargo"
        placeholder="Ej: se cargó por error"
        onConfirm={async (reason) => {
          if (!voidChargeFor) return { ok: false as const, error: "No encontramos el cargo." };
          const res = await voidCharge(voidChargeFor.id, reason);
          if (!res.ok) return res;
          toast.success("Cargo anulado", { description: res.regenerated ? "Se volvió a generar con los valores actuales del contrato." : undefined });
          router.refresh();
          return { ok: true as const };
        }}
      />
      <ReasonDialog
        open={!!voidPaymentFor}
        onOpenChange={(o) => !o && setVoidPaymentFor(null)}
        title="Anular cobro"
        description={voidPaymentFor ? `Recibo N° ${formatReceiptNumber(voidPaymentFor.receiptNumber)} · ${formatMoney(voidPaymentFor.amount, currency)}` : undefined}
        warning={
          voidPaymentFor ? (
            <>
              Se deshace la imputación, se borra el ingreso de Caja{voidPaymentFor.statementNumber ? "" : " (si lo hubo)"} y el recibo queda marcado como anulado.
              Los intereses por mora que se condonaron o se cargaron con este cobro (y siguen sin pagar) también se deshacen.
              {voidPaymentFor.statementNumber
                ? ` Este cobro ya está en la rendición N° ${String(voidPaymentFor.statementNumber).padStart(4, "0")}: primero hay que anular esa rendición.`
                : ""}
            </>
          ) : undefined
        }
        confirmLabel="Anular cobro"
        placeholder="Ej: la transferencia fue rechazada"
        onConfirm={async (reason) => {
          if (!voidPaymentFor) return { ok: false as const, error: "No encontramos el cobro." };
          const res = await voidPayment(voidPaymentFor.id, reason);
          if (!res.ok) return res;
          toast.success("Cobro anulado", { description: "El saldo del inquilino ya está actualizado." });
          router.refresh();
          return { ok: true as const };
        }}
      />
      {payFor && (
        <PaymentDialog
          contractId={contract.id}
          open
          onOpenChange={(o) => !o && setPayFor(null)}
          preferChargeIds={[payFor.id]}
        />
      )}
    </div>
  );
}

function ChargeRow({
  charge: c,
  currency,
  balance,
  expanded,
  onToggle,
  onAdd,
  onDiscount,
  onVoid,
  onPay,
}: {
  charge: LedgerCharge;
  currency: string;
  balance: number;
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onDiscount: (item: LedgerItem) => void;
  onVoid: () => void;
  onPay?: () => void;
}) {
  const meta = CHARGE_STATE_META[c.state];
  const open = !c.voided && c.outstanding > 0.004;
  return (
    <li className={cn("px-3 py-3 sm:px-4", c.voided && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className="size-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
          aria-hidden
        >
          <FileText size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={onToggle} className="text-sm font-medium text-left hover:underline underline-offset-2" aria-expanded={expanded}>
              {c.label}
            </button>
            <StatusBadge meta={meta} compact />
            {KIND_CHIP[c.kind] && (
              <span className="rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">{KIND_CHIP[c.kind]}</span>
            )}
          </div>
          <p className={cn("text-[11px] mt-0.5", c.state === "vencido" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
            {c.voided
              ? `Anulado${c.voidReason ? `: ${c.voidReason}` : ""}`
              : c.state === "pagado"
                ? `Pagado · vencía el ${formatDate(c.dueDate)}`
                : `${c.state === "vencido" ? "Venció" : "Vence"} el ${formatDate(c.dueDate)}`}
            {!c.voided && c.paid > 0 && open && ` · cobrado ${formatMoney(c.paid, currency)}`}
          </p>
          <button type="button" onClick={onToggle} className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground min-h-6">
            <ChevronDown size={12} className={cn("transition-transform", expanded && "rotate-180")} />
            {expanded ? "Ocultar detalle" : `Ver detalle (${c.items.length})`}
          </button>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-sm font-semibold tabular-nums", c.voided && "line-through")}>{formatMoney(c.subtotal, currency)}</p>
          {open && (
            <p className={cn("text-[11px] tabular-nums", c.state === "vencido" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
              debe {formatMoney(c.outstanding, currency)}
            </p>
          )}
          <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
            <BalanceText balance={balance} currency={currency} />
          </p>
        </div>
        {!c.voided && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${c.label}`}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {open && onPay && (
                <DropdownMenuItem onSelect={onPay}>
                  <HandCoins size={14} /> Cobrar este cargo
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onAdd}>
                <Plus size={14} /> Agregar concepto
              </DropdownMenuItem>
              {!c.hasPayments && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onVoid}>
                    <Ban size={14} /> Anular cargo…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {expanded && (
        <ul className="mt-2 ml-11 rounded-lg border bg-muted/30 divide-y animate-fade-in">
          {c.items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium leading-snug">{i.description}</p>
                <p className="text-[10px] text-muted-foreground">
                  {i.kindLabel} · para {PAYEE_LABEL[i.payee].toLowerCase()}
                  {i.originalAmount != null && i.originalAmount > i.amount && (
                    <> · bonificado {formatMoney(i.originalAmount - i.amount, currency)}{i.discountReason ? ` (${i.discountReason})` : ""}</>
                  )}
                  {i.waivedAmount > 0 && <> · condonado {formatMoney(i.waivedAmount, currency)} al cobrar</>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-right">
                  <p className="text-xs tabular-nums font-medium">{formatMoney(i.amount, currency)}</p>
                  {i.paid > 0 && <p className="text-[10px] tabular-nums text-emerald-700 dark:text-emerald-400">cobrado {formatMoney(i.paid, currency)}</p>}
                </div>
                {!c.voided && i.outstanding > 0.004 && (
                  <Button variant="ghost" size="icon-sm" onClick={() => onDiscount(i)} aria-label={`Bonificar ${i.description}`} title="Bonificar">
                    <BadgePercent size={13} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PaymentRow({
  payment: p,
  currency,
  balance,
  tenantEmail,
  onVoid,
}: {
  payment: LedgerPayment;
  currency: string;
  balance: number;
  tenantEmail: string | null;
  onVoid: () => void;
}) {
  const imputed = p.allocations.reduce<{ label: string; amount: number }[]>((acc, a) => {
    const prev = acc.find((x) => x.label === a.chargeLabel);
    if (prev) prev.amount += a.amount;
    else acc.push({ label: a.chargeLabel, amount: a.amount });
    return acc;
  }, []);
  return (
    <li className={cn("px-3 py-3 sm:px-4", p.voided && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "size-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5",
            p.voided ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
          )}
          aria-hidden
        >
          <HandCoins size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">
              Cobro · recibo <span className="font-mono">{formatReceiptNumber(p.receiptNumber)}</span>
            </span>
            {p.voided && <StatusBadge meta={{ label: "Anulado", color: "#64748b" }} compact />}
            {p.statementNumber != null && !p.voided && (
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-px text-[10px] font-medium text-violet-700 dark:text-violet-300">
                Rendido · N° {String(p.statementNumber).padStart(4, "0")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatDate(p.paidAt)} · {p.methodLabel}
            {p.accountName ? ` · ${p.accountName}` : ""}
            {p.reference ? ` · ref. ${p.reference}` : ""}
            {p.payerName ? ` · pagó ${p.payerName}` : ""}
          </p>
          {imputed.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              Imputado a {imputed.map((x) => `${x.label} (${formatMoney(x.amount, currency)})`).join(", ")}
            </p>
          )}
          {p.unallocated > 0.004 && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">Saldo a favor sin usar: {formatMoney(p.unallocated, currency)}</p>
          )}
          {p.voided && p.voidReason && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">Motivo: {p.voidReason}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400", p.voided && "line-through text-muted-foreground")}>
            − {formatMoney(p.amount, currency)}
          </p>
          <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">
            <BalanceText balance={balance} currency={currency} />
          </p>
        </div>
        <ReceiptMenu paymentId={p.id} receiptNumber={p.receiptNumber} email={tenantEmail} voided={p.voided} onVoid={onVoid} />
      </div>
    </li>
  );
}
