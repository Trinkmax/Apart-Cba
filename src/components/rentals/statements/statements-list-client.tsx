"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, getInitials } from "@/lib/format";
import { formatStatementNumber, monthLabelOf, STATEMENT_STATUS_META, statementClosedWithoutPayout, statementStatusMeta } from "@/lib/rentals/labels";
import type { RentalStatementStatus } from "@/lib/types/database";
import { StatusBadge } from "@/components/rentals/ui";
import type { StatementListItem } from "./types";

const STATUS_ORDER: RentalStatementStatus[] = ["borrador", "emitida", "pagada", "anulada"];

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Lista de rendiciones: buscador, chips por estado y grupos por mes de corte. */
export function StatementsListClient({ items }: { items: StatementListItem[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RentalStatementStatus | null>(null);
  const query = norm(q.trim());
  const searched = items.filter((i) => !query || norm(`${i.ownerName} ${formatStatementNumber(i.number)} ${i.number}`).includes(query));
  const visible = searched.filter((i) => !status || i.status === status);
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, searched.filter((i) => i.status === s).length])) as Record<RentalStatementStatus, number>;
  const anyClosed = searched.some((i) => statementClosedWithoutPayout(i.status, i.net));

  const groups: { key: string; label: string; items: StatementListItem[] }[] = [];
  for (const i of visible) {
    const key = i.cutoffDate.slice(0, 7);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: monthLabelOf(i.cutoffDate), items: [] }));
    g.items.push(i);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar propietario o N°…" className="h-9 pl-8 text-sm" aria-label="Buscar rendiciones" />
        </div>
        <div className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label="Filtrar por estado">
          {STATUS_ORDER.filter((s) => counts[s] > 0 || status === s).map((s) => {
            const meta = STATEMENT_STATUS_META[s];
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(active ? null : s)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  !active && "border-input bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
                style={active ? { color: meta.color, backgroundColor: `${meta.color}15`, borderColor: `${meta.color}40` } : undefined}
              >
                {s === "pagada" && anyClosed ? "Pagada o cerrada" : meta.label}
                <span className="text-[10px] font-normal tabular-nums opacity-60">{counts[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="border-dashed p-8 text-center sm:p-12">
          <FileText className="mx-auto mb-3 size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="mt-1 text-xs text-muted-foreground">Probá con otro nombre o sacá el filtro de estado.</p>
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-1.5">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cobros hasta {g.label} <span className="font-normal opacity-70">· {g.items.length}</span>
            </h3>
            <Card className="gap-0 overflow-hidden p-0">
              <ul className="divide-y">
                {g.items.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}

function Row({ item: i }: { item: StatementListItem }) {
  const meta = statementStatusMeta(i.status, i.net);
  const voided = i.status === "anulada";
  const closed = statementClosedWithoutPayout(i.status, i.net);
  const eyebrow =
    i.status === "pagada" && i.paidAt
      ? `${closed ? "Cerrada" : "Pagada"} ${formatDate(i.paidAt)}`
      : i.sentAt && !voided
        ? `Enviada ${formatDate(i.sentAt)}`
        : i.net < 0
          ? "A cargo del propietario"
          : "Neto";
  return (
    <li>
      <Link href={`/dashboard/alquileres/rendiciones/${i.id}`} className="group flex items-center gap-3 p-3 transition-colors hover:bg-accent/30 sm:p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary sm:size-10">{getInitials(i.ownerName)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("truncate text-sm font-medium", voided && "text-muted-foreground line-through")}>{i.ownerName}</p>
            <StatusBadge meta={meta} compact className="hidden sm:inline-flex" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            N° {formatStatementNumber(i.number)} · corte {formatDate(i.cutoffDate)}
            {i.currency !== "ARS" ? ` · ${i.currency}` : ""}
          </p>
          <StatusBadge meta={meta} compact className="mt-1 sm:hidden" />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-muted-foreground sm:text-xs">{eyebrow}</div>
          <div className={cn("text-sm font-semibold tabular-nums sm:text-base", voided ? "text-muted-foreground" : i.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {formatMoney(Math.abs(i.net), i.currency)}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </Link>
    </li>
  );
}
