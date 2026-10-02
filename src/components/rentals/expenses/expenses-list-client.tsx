"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Ban, Eye, MoreHorizontal, Paperclip, Pencil, Undo2, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/rentals/labels";
import { getExpenseFileUrl } from "@/lib/actions/rentals-expenses";
import type { RentalExpense } from "@/lib/types/database";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { canPayFromCaja, EXPENSE_STATE_META, expenseDisplayState, expenseLockReason, expensePaymentLabel, type ExpenseDisplayState } from "./expense-meta";
import { CATEGORY_ICON } from "./expense-form-fields";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { PayExpenseDialog, UnpayExpenseDialog, VoidExpenseDialog } from "./expense-action-dialogs";
import type { ExpenseListItem } from "./types";

type Filter = "activos" | "a_descontar" | "a_cobrar" | "sin_pagar" | "anulados";

function matches(item: ExpenseListItem, f: Filter, state: ExpenseDisplayState): boolean {
  const e = item.expense;
  if (f === "anulados") return state === "anulado";
  if (state === "anulado") return false;
  if (f === "a_descontar") return state === "a_descontar";
  if (f === "a_cobrar") return state === "a_cobrar";
  if (f === "sin_pagar") return e.paid_by === "pendiente" && !e.cash_movement_id;
  return true;
}

const FILTER_LABEL: Record<Filter, string> = {
  activos: "Todos",
  a_descontar: "A descontar",
  a_cobrar: "A cobrar",
  sin_pagar: "Sin pagar",
  anulados: "Anulados",
};

/** Lista de gastos con estado y acciones (editar, pagar desde Caja, deshacer pago, ver factura, anular). */
export function ExpensesListClient({ items, propertyId, contractId, showContract = true }: { items: ExpenseListItem[]; propertyId: string; contractId?: string | null; showContract?: boolean }) {
  const [filter, setFilter] = useState<Filter>("activos");
  const [paying, setPaying] = useState<RentalExpense | null>(null);
  const [voiding, setVoiding] = useState<ExpenseListItem | null>(null);
  const [unpaying, setUnpaying] = useState<ExpenseListItem | null>(null);
  const [opening, startOpening] = useTransition();

  const withState = items.map((i) => ({ item: i, state: expenseDisplayState(i.expense) }));
  const counts = Object.fromEntries(
    (Object.keys(FILTER_LABEL) as Filter[]).map((f) => [f, withState.filter((x) => matches(x.item, f, x.state)).length]),
  ) as Record<Filter, number>;
  const visible = withState.filter((x) => matches(x.item, filter, x.state));

  function openFile(id: string) {
    startOpening(async () => {
      const res = await getExpenseFileUrl(id);
      if (!res.ok) return void toast.error("No se pudo abrir el archivo", { description: res.error });
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="space-y-2">
      {items.length > 2 && (
        <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label="Filtrar gastos">
          {(Object.keys(FILTER_LABEL) as Filter[])
            .filter((f) => f === "activos" || counts[f] > 0)
            .map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
                  filter === f ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {FILTER_LABEL[f]}
                <span className="tabular-nums text-[10px] opacity-60">{counts[f]}</span>
              </button>
            ))}
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">No hay gastos con este filtro.</Card>
      ) : (
        <Card className="overflow-hidden p-0 gap-0">
          <ul className="divide-y">
            {visible.map(({ item, state }) => (
              <ExpenseRow
                key={item.expense.id}
                item={item}
                state={state}
                propertyId={propertyId}
                contractId={contractId}
                showContract={showContract}
                busy={opening}
                onPay={() => setPaying(item.expense)}
                onUnpay={() => setUnpaying(item)}
                onVoid={() => setVoiding(item)}
                onOpenFile={() => openFile(item.expense.id)}
              />
            ))}
          </ul>
        </Card>
      )}

      <PayExpenseDialog expense={paying} onOpenChange={(o) => !o && setPaying(null)} />
      <VoidExpenseDialog expense={voiding?.expense ?? null} accountName={voiding?.accountName} onOpenChange={(o) => !o && setVoiding(null)} />
      <UnpayExpenseDialog expense={unpaying?.expense ?? null} accountName={unpaying?.accountName} onOpenChange={(o) => !o && setUnpaying(null)} />
    </div>
  );
}

function whereItWent(item: ExpenseListItem, state: ExpenseDisplayState): { text: string; href?: string; links?: { label: string; href: string }[] } | null {
  const e = item.expense;
  switch (state) {
    case "descontado": {
      const sts = item.statements;
      // Con varios dueños hay una rendición por dueño: se linkean todas.
      if (sts.length > 1) {
        return { text: "En las rendiciones", links: sts.map((s) => ({ label: `N° ${s.number}`, href: `/dashboard/alquileres/rendiciones/${s.id}` })) };
      }
      if (sts.length === 1) return { text: `En la rendición N° ${sts[0].number}`, href: `/dashboard/alquileres/rendiciones/${sts[0].id}` };
      return { text: "Ya se descontó en una rendición", href: e.statement_id ? `/dashboard/alquileres/rendiciones/${e.statement_id}` : undefined };
    }
    case "cobrado":
      return { text: item.chargeLabel ? `En el cargo de ${item.chargeLabel}` : "Ya se le cargó al inquilino" };
    case "a_descontar":
      return { text: "Entra en la próxima rendición" };
    case "a_cobrar":
      return { text: "Se suma al próximo cargo del inquilino" };
    default:
      return null;
  }
}

function ExpenseRow({
  item,
  state,
  propertyId,
  contractId,
  showContract,
  busy,
  onPay,
  onUnpay,
  onVoid,
  onOpenFile,
}: {
  item: ExpenseListItem;
  state: ExpenseDisplayState;
  propertyId: string;
  contractId?: string | null;
  showContract: boolean;
  busy: boolean;
  onPay: () => void;
  onUnpay: () => void;
  onVoid: () => void;
  onOpenFile: () => void;
}) {
  const e = item.expense;
  const Icon = CATEGORY_ICON[e.category];
  const lock = expenseLockReason(e, { statementNumbers: item.statements.map((s) => s.number), chargeLabel: item.chargeLabel });
  const payment = expensePaymentLabel(e, item.accountName);
  const went = whereItWent(item, state);
  const voided = state === "anulado";
  const canPay = canPayFromCaja(e);

  return (
    <li className={cn("flex items-start gap-3 px-3 py-3 sm:px-4", voided && "opacity-60")}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/12 text-cyan-700 dark:text-cyan-400">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("text-sm font-medium leading-snug break-words", voided && "line-through")}>{e.description}</p>
          <Money amount={e.amount} currency={e.currency} className="text-sm font-semibold shrink-0" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[formatDate(e.occurred_on), EXPENSE_CATEGORY_LABEL[e.category], e.provider, showContract ? item.contractNumber : null].filter(Boolean).join(" · ")}
          {e.file_path && (
            <button type="button" onClick={onOpenFile} disabled={busy} className="ml-1.5 inline-flex items-center gap-0.5 text-foreground/80 hover:underline disabled:opacity-60">
              <Paperclip size={11} /> factura
            </button>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge meta={EXPENSE_STATE_META[state]} compact />
          {!voided && (
            <span className={cn("text-[11px]", payment.tone === "in" && "text-emerald-700 dark:text-emerald-400", payment.tone === "warn" && "text-amber-700 dark:text-amber-300", payment.tone === "muted" && "text-muted-foreground")}>
              {payment.label}
            </span>
          )}
          {went &&
            (went.links ? (
              <span className="text-[11px] text-muted-foreground">
                {went.text}{" "}
                {went.links.map((l, i, all) => (
                  <Fragment key={l.href}>
                    {i > 0 && (i === all.length - 1 ? " y " : ", ")}
                    <Link href={l.href} className="hover:text-foreground hover:underline">
                      {l.label}
                    </Link>
                  </Fragment>
                ))}
              </span>
            ) : went.href ? (
              <Link href={went.href} className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                {went.text} <ArrowUpRight size={11} />
              </Link>
            ) : (
              <span className="text-[11px] text-muted-foreground">{went.text}</span>
            ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {!lock && (
          <ExpenseFormDialog propertyId={propertyId} contractId={contractId} expense={e}>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Editar gasto">
              <Pencil size={15} />
            </Button>
          </ExpenseFormDialog>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Más acciones">
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {canPay && (
              <DropdownMenuItem onSelect={onPay} className="gap-2">
                <Wallet size={14} /> Pagar desde Caja
              </DropdownMenuItem>
            )}
            {e.cash_movement_id && (
              <DropdownMenuItem onSelect={onUnpay} className="gap-2">
                <Undo2 size={14} /> Deshacer el pago
              </DropdownMenuItem>
            )}
            {e.file_path && (
              <DropdownMenuItem onSelect={onOpenFile} className="gap-2">
                <Eye size={14} /> Ver factura o foto
              </DropdownMenuItem>
            )}
            {!lock && (
              <>
                {(canPay || e.cash_movement_id || e.file_path) && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={onVoid} className="gap-2 text-rose-600 focus:text-rose-700 dark:text-rose-400">
                  <Ban size={14} /> Anular gasto
                </DropdownMenuItem>
              </>
            )}
            {lock && !voided && <DropdownMenuLabel className="text-[11px] font-normal leading-snug text-muted-foreground">{lock}</DropdownMenuLabel>}
            {voided && <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Gasto anulado.</DropdownMenuLabel>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
