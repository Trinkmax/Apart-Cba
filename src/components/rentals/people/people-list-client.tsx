"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, ChevronRight, Search, SearchX, ShieldCheck, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/format";
import { formatContractNumber } from "@/lib/rentals/labels";
import { Money } from "@/components/rentals/ui";
import { docLabel, foldText } from "./person-helpers";
import type { PersonContractLink, PersonListItem } from "./person-types";

type Filter = "todas" | "inquilinos" | "garantes" | "deuda" | "sin_contrato";
const FILTER_LABEL: Record<Filter, string> = {
  todas: "Todas",
  inquilinos: "Inquilinos",
  garantes: "Garantes",
  deuda: "Con deuda",
  sin_contrato: "Sin contrato vigente",
};

const isLive = (l: PersonContractLink) => l.status === "vigente";
const overdueOf = (it: PersonListItem) => it.links.filter((l) => l.role === "inquilino" && isLive(l)).reduce((s, l) => s + l.overdue, 0);

function matches(it: PersonListItem, f: Filter): boolean {
  switch (f) {
    case "inquilinos":
      return it.links.some((l) => l.role === "inquilino" && isLive(l));
    case "garantes":
      return it.links.some((l) => l.role === "garante" && isLive(l));
    case "deuda":
      return overdueOf(it) > 0.004;
    case "sin_contrato":
      return !it.links.some(isLive);
    default:
      return true;
  }
}

function RoleChip({ link }: { link: PersonContractLink }) {
  const tenant = link.role === "inquilino";
  const draft = link.status === "borrador";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] max-w-full",
        draft
          ? "border-dashed text-muted-foreground"
          : tenant
            ? "border-teal-600/30 bg-teal-600/10 text-teal-800 dark:text-teal-200"
            : "border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200",
      )}
    >
      {tenant ? <KeyRound size={11} className="shrink-0" /> : <ShieldCheck size={11} className="shrink-0" />}
      <span className="truncate">
        {tenant ? "Inquilino" : "Garante"}
        {draft ? " (borrador)" : ""} · {link.property?.address ?? formatContractNumber(link.number)}
        {!tenant && link.tenant_name ? ` · de ${link.tenant_name}` : ""}
      </span>
      {!tenant && link.overdue > 0.004 && <span className="font-semibold text-rose-600 dark:text-rose-400 shrink-0">· debe</span>}
    </span>
  );
}

export function PeopleListClient({ items }: { items: PersonListItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  const indexed = useMemo(
    () =>
      items.map((it) => ({
        it,
        hay: foldText(
          [it.person.full_name, it.person.doc_number, it.person.tax_id, it.person.email, it.person.phone, it.person.employer, ...it.links.map((l) => l.property?.address)]
            .filter(Boolean)
            .join(" "),
        ),
      })),
    [items],
  );
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of Object.keys(FILTER_LABEL) as Filter[]) c[f] = items.filter((it) => matches(it, f)).length;
    return c;
  }, [items]);
  const words = foldText(q).split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D+/g, "");
  const visible = indexed
    .filter(({ it, hay }) => matches(it, filter) && (words.every((w) => hay.includes(w)) || (digits.length >= 3 && hay.includes(digits))))
    .map((x) => x.it);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72 shrink-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, DNI, teléfono o mail…" aria-label="Buscar personas" className="pl-8 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto min-w-0 flex-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(Object.keys(FILTER_LABEL) as Filter[])
            .filter((f) => f === "todas" || counts[f] > 0)
            .map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 h-8 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  filter === f
                    ? f === "deuda"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      : "border-foreground bg-foreground text-background"
                    : "bg-card text-muted-foreground border-input hover:text-foreground hover:bg-accent/40",
                )}
              >
                {FILTER_LABEL[f]}
                <span className="tabular-nums text-[10px] font-normal opacity-60">{counts[f]}</span>
              </button>
            ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed gap-2 items-center">
          <SearchX className="size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground">Probá con otro nombre, el DNI o el teléfono.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 gap-0">
          <ul className="divide-y">
            {visible.map((it) => {
              const p = it.person;
              const overdue = overdueOf(it);
              const currency = it.links.find((l) => l.role === "inquilino" && isLive(l))?.currency ?? "ARS";
              const contact = [docLabel(p.doc_type, p.doc_number), p.phone, p.email].filter(Boolean).join(" · ");
              return (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/alquileres/personas/${p.id}`}
                    className="group flex items-start sm:items-center gap-3 p-3 sm:p-4 hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "size-9 sm:size-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                        p.person_type === "juridica" ? "bg-slate-500/15 text-slate-700 dark:text-slate-300" : "bg-primary/10 text-primary",
                      )}
                    >
                      {p.person_type === "juridica" ? <Building2 size={16} /> : getInitials(p.full_name)}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{p.full_name}</span>
                        {!p.active && <span className="text-[10px] rounded-full border px-1.5 text-muted-foreground shrink-0">Archivada</span>}
                      </span>
                      {contact && <span className="block text-xs text-muted-foreground truncate">{contact}</span>}
                      {overdue > 0.004 && (
                        <span className="sm:hidden block text-xs font-medium text-rose-600 dark:text-rose-400">
                          Debe <Money amount={overdue} currency={currency} tone="out" />
                        </span>
                      )}
                      {it.links.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {it.links.slice(0, 3).map((l) => (
                            <RoleChip key={`${l.contract_id}-${l.role}`} link={l} />
                          ))}
                          {it.links.length > 3 && <span className="text-[11px] text-muted-foreground self-center">+{it.links.length - 3}</span>}
                        </span>
                      ) : (
                        <span className="block text-[11px] text-muted-foreground">
                          {it.past_contracts ? `Sin contrato vigente · ${it.past_contracts} anterior${it.past_contracts === 1 ? "" : "es"}` : "Sin contratos todavía"}
                        </span>
                      )}
                    </span>
                    <span className="hidden sm:flex flex-col items-end shrink-0 gap-0.5">
                      {overdue > 0.004 ? (
                        <>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Debe</span>
                          <Money amount={overdue} currency={currency} tone="out" className="text-sm font-semibold" />
                        </>
                      ) : it.links.some((l) => l.role === "inquilino" && isLive(l)) ? (
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Al día</span>
                      ) : null}
                    </span>
                    <ChevronRight size={16} className="text-muted-foreground/50 group-hover:text-foreground self-center shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
