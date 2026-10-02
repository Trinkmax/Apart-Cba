"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, History, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateTile, PeriodPill } from "@/components/rentals/ui";
import type { BoardRow, PreviousDebtRow } from "@/lib/rentals/server/collections-queries";
import { CHARGE_STATE_META, formatContractNumber } from "@/lib/rentals/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { diffDays } from "@/lib/rentals/ymd";
import { cn } from "@/lib/utils";
import { groupRows, matchesSearch, multiMoney, type BoardGroupKey } from "./board-helpers";
import { ReceiptMenu } from "./receipt-actions";
import { RegisterPaymentButton } from "./register-payment-button";
import { ReminderMenu } from "./reminder-menu";

const GROUP_META: Record<BoardGroupKey, { label: string; color: string; hint: string }> = {
  vencido: { label: "Vencidos", color: CHARGE_STATE_META.vencido.color, hint: "Pasó el vencimiento y queda saldo" },
  pendiente: { label: "Por cobrar", color: CHARGE_STATE_META.pendiente.color, hint: "Todavía están en fecha" },
  parcial: { label: "Pagaron una parte", color: CHARGE_STATE_META.parcial.color, hint: "En fecha, con saldo" },
  pagado: { label: "Pagados", color: CHARGE_STATE_META.pagado.color, hint: "Mes cobrado completo" },
};

const contractHref = (id: string) => `/dashboard/alquileres/contratos/${id}?tab=cuenta`;

export function CollectionsBoardList({ rows, previousRows, today }: { rows: BoardRow[]; previousRows: PreviousDebtRow[]; today: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<BoardGroupKey, boolean>>({ vencido: true, pendiente: true, parcial: true, pagado: false });
  const [prevOpen, setPrevOpen] = useState(true);
  const filtered = rows.filter((r) => matchesSearch([r.tenantName, r.address, r.propertyCode, formatContractNumber(r.contractNumber)], q));
  const groups = groupRows(filtered);
  const prevFiltered = previousRows.filter((r) => matchesSearch([r.tenantName, r.address, formatContractNumber(r.contractNumber)], q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar inquilino, dirección o contrato"
            className="pl-8 h-9 text-sm"
            aria-label="Buscar en cobranzas"
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} de {rows.length} {rows.length === 1 ? "contrato" : "contratos"}
        </p>
      </div>

      {q && groups.length === 0 && prevFiltered.length === 0 && (
        <Card className="p-8 text-center border-dashed gap-1">
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground">Probá con otro nombre, calle o número de contrato.</p>
        </Card>
      )}

      {groups.map((g) => {
        const meta = GROUP_META[g.key];
        const isOpen = open[g.key];
        return (
          <section key={g.key} className="space-y-2">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              className="sticky top-0 z-10 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 hover:bg-accent/40 min-h-10"
              aria-expanded={isOpen}
            >
              <ChevronRight size={15} className={cn("text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
              <span className="text-sm font-semibold">{meta.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">· {g.rows.length}</span>
              <span className="hidden sm:inline text-[11px] text-muted-foreground">· {meta.hint}</span>
              <span className={cn("ml-auto text-sm font-semibold tabular-nums", g.key === "vencido" && "text-rose-600 dark:text-rose-400", g.key === "pagado" && "text-emerald-700 dark:text-emerald-400")}>
                {multiMoney(g.rows.map((r) => ({ amount: g.key === "pagado" ? r.paid : r.outstanding, currency: r.currency })))}
              </span>
            </button>
            <div className={cn("grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!isOpen}>
              <div className="overflow-hidden">
                <Card className="p-0 gap-0 overflow-hidden">
                  <ul className="divide-y">
                    {g.rows.map((r) => (
                      <BoardRowItem key={r.contractId} row={r} today={today} />
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
          </section>
        );
      })}

      {prevFiltered.length > 0 && <PreviousDebtSection rows={prevFiltered} open={prevOpen} onToggle={() => setPrevOpen((v) => !v)} />}
    </div>
  );
}

function dueTone(r: BoardRow, today: string): "neutral" | "in" | "warn" | "out" {
  if (r.state === "pagado") return "in";
  if (r.state === "vencido") return "out";
  if (r.dueDate && diffDays(today, r.dueDate) <= 3) return "warn";
  return "neutral";
}

function BoardRowItem({ row: r, today }: { row: BoardRow; today: string }) {
  const owes = r.outstanding > 0.004;
  const dueText =
    r.state === "pagado"
      ? "Cobrado"
      : r.dueDate
        ? r.dueDate < today
          ? `Venció hace ${diffDays(r.dueDate, today)} ${diffDays(r.dueDate, today) === 1 ? "día" : "días"}`
          : r.dueDate === today
            ? "Vence hoy"
            : `Vence en ${diffDays(today, r.dueDate)} ${diffDays(today, r.dueDate) === 1 ? "día" : "días"}`
        : "";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4 hover:bg-accent/30 transition-colors">
      {r.dueDate ? <DateTile date={r.dueDate} tone={dueTone(r, today)} /> : <div className="w-12" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={contractHref(r.contractId)} className="text-sm font-medium truncate hover:underline underline-offset-2">
            {r.tenantName}
          </Link>
          {r.periodLabel && <PeriodPill>{r.periodLabel}</PeriodPill>}
          {r.collector === "propietario" && (
            <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground" title="El alquiler lo cobra el propietario directo: no entra a Caja">
              Cobra el dueño
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">
          {r.address} · {formatContractNumber(r.contractNumber)}
          {r.charges.length > 1 ? ` · ${r.charges.length} cargos` : ""}
        </p>
        <p className={cn("text-[11px]", r.state === "vencido" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
          {dueText}
          {r.previousDebt > 0.004 && (
            <span className="text-rose-600 dark:text-rose-400"> · + {formatMoney(r.previousDebt, r.currency)} de meses anteriores</span>
          )}
        </p>
      </div>
      <div className="text-right shrink-0 hidden md:block w-32">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total del mes</p>
        <p className="text-sm tabular-nums">{formatMoney(r.total, r.currency)}</p>
      </div>
      <div className="text-right shrink-0 w-28 sm:w-32">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{owes ? "Saldo" : "Cobrado"}</p>
        <p
          className={cn(
            "text-sm font-semibold tabular-nums",
            !owes ? "text-emerald-700 dark:text-emerald-400" : r.state === "vencido" ? "text-rose-600 dark:text-rose-400" : "",
          )}
        >
          {formatMoney(owes ? r.outstanding : r.paid, r.currency)}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1 basis-full sm:basis-auto shrink-0">
        {owes && (
          <>
            <ReminderMenu contractId={r.contractId} tenantName={r.tenantName} tenantEmail={r.tenantEmail} compact />
            <RegisterPaymentButton contractId={r.contractId} size="sm">
              Cobrar
            </RegisterPaymentButton>
          </>
        )}
        {r.lastPayment && (
          <ReceiptMenu paymentId={r.lastPayment.id} receiptNumber={r.lastPayment.receiptNumber} email={r.tenantEmail} />
        )}
      </div>
    </li>
  );
}

function PreviousDebtSection({ rows, open, onToggle }: { rows: PreviousDebtRow[]; open: boolean; onToggle: () => void }) {
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent/40 min-h-10"
        aria-expanded={open}
      >
        <ChevronRight size={15} className={cn("text-muted-foreground transition-transform", open && "rotate-90")} />
        <History size={14} className="text-rose-500" />
        <span className="text-sm font-semibold">De meses anteriores</span>
        <span className="text-xs text-muted-foreground tabular-nums">· {rows.length}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
          {multiMoney(rows.map((r) => ({ amount: r.amount, currency: r.currency })))}
        </span>
      </button>
      {open && (
        <Card className="p-0 gap-0 overflow-hidden border-rose-500/20">
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.contractId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4 hover:bg-accent/30 transition-colors">
                <div className="min-w-0 flex-1">
                  <Link href={contractHref(r.contractId)} className="text-sm font-medium truncate hover:underline underline-offset-2">
                    {r.tenantName}
                  </Link>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.address} · {formatContractNumber(r.contractNumber)}
                    {r.contractStatus !== "vigente" ? " · contrato terminado" : ""}
                  </p>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 truncate">
                    Debe desde el {formatDate(r.oldestDue)} · {r.labels.join(", ")}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400 shrink-0">{formatMoney(r.amount, r.currency)}</p>
                <div className="flex items-center justify-end gap-1 basis-full sm:basis-auto shrink-0">
                  <ReminderMenu contractId={r.contractId} tenantName={r.tenantName} tenantEmail={r.tenantEmail} compact />
                  <RegisterPaymentButton contractId={r.contractId} size="sm">
                    Cobrar
                  </RegisterPaymentButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
