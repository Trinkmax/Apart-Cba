"use client";

import type { ReactNode } from "react";
import {
  Briefcase,
  Building2,
  Hammer,
  HandCoins,
  KeyRound,
  Landmark,
  Receipt,
  ShieldCheck,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/rentals/labels";
import type { RentalExpenseCategory, RentalExpenseChargedTo, RentalExpensePaidBy } from "@/lib/types/database";
import { PAID_BY_LABEL, PAID_BY_OPTIONS } from "./expense-meta";

/** Piezas visuales del formulario de gasto (sin estado propio). */

export const CATEGORY_ICON: Record<RentalExpenseCategory, LucideIcon> = {
  reparacion: Wrench,
  mantenimiento: Hammer,
  expensas_extraordinarias: Building2,
  impuesto: Landmark,
  servicio: Zap,
  seguro: ShieldCheck,
  honorarios_terceros: Briefcase,
  otro: Receipt,
};

const CATEGORY_ORDER: RentalExpenseCategory[] = [
  "reparacion",
  "mantenimiento",
  "expensas_extraordinarias",
  "impuesto",
  "servicio",
  "seguro",
  "honorarios_terceros",
  "otro",
];

export function FieldLabel({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {children}
      </label>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{message}</p>;
}

export function CategoryChips({ value, onChange }: { value: RentalExpenseCategory; onChange: (v: RentalExpenseCategory) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de gasto">
      {CATEGORY_ORDER.map((c) => {
        const Icon = CATEGORY_ICON[c];
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-cyan-600 bg-cyan-600 text-white shadow-sm" : "bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Icon size={14} />
            {EXPENSE_CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

const CHARGED_TO_CARDS: { value: RentalExpenseChargedTo; title: string; hint: string; icon: LucideIcon; tone: string }[] = [
  { value: "propietario", title: "Propietario", hint: "Se descuenta de su rendición", icon: KeyRound, tone: "emerald" },
  { value: "inquilino", title: "Inquilino", hint: "Se suma a su próximo cargo", icon: User, tone: "sky" },
  { value: "inmobiliaria", title: "Inmobiliaria", hint: "Lo absorbe la inmobiliaria", icon: HandCoins, tone: "slate" },
];

const TONE_ACTIVE: Record<string, string> = {
  emerald: "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40",
  sky: "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40",
  slate: "border-slate-500 bg-slate-500/10 ring-1 ring-slate-500/40",
};
const TONE_ICON: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

export function ChargedToPicker({ value, onChange }: { value: RentalExpenseChargedTo; onChange: (v: RentalExpenseChargedTo) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="A cargo de quién">
      {CHARGED_TO_CARDS.map((c) => {
        const active = c.value === value;
        const Icon = c.icon;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.value)}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:gap-2 sm:p-3",
              active ? TONE_ACTIVE[c.tone] : "hover:border-foreground/20 hover:bg-accent/30",
            )}
          >
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_ICON[c.tone])}>
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{c.title}</span>
              <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{c.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PaidByChips({
  chargedTo,
  value,
  onChange,
  disabled,
}: {
  chargedTo: RentalExpenseChargedTo;
  value: RentalExpensePaidBy;
  onChange: (v: RentalExpensePaidBy) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Quién lo pagó">
      {PAID_BY_OPTIONS[chargedTo].map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(p)}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {PAID_BY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
