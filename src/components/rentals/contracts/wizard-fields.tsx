"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RENTALS_ACCENT } from "@/components/rentals/ui";

/** Piezas chicas del asistente de contratos: campo con ayuda/error, chips, interruptor, importe. */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-[12px] text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
}

/** Elección única con chips grandes (mejor que un select cuando hay pocas opciones). */
export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  columns,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: ChipOption<T>[];
  ariaLabel: string;
  /** Con hint conviene una grilla de tarjetas. */
  columns?: 2 | 3;
}) {
  const cards = options.some((o) => o.hint);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(cards ? cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2") : "flex flex-wrap gap-1.5")}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              cards ? "px-3 py-2.5 min-h-[3.25rem]" : "h-10 px-3.5 text-sm font-medium",
              active ? "shadow-sm" : "bg-card hover:bg-accent/40 text-foreground/80 hover:text-foreground",
            )}
            style={active ? { borderColor: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}12`, color: "inherit" } : undefined}
          >
            {cards ? (
              <>
                <span className="block text-sm font-medium">{o.label}</span>
                {o.hint && <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{o.hint}</span>}
              </>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleRow({
  checked,
  onChange,
  title,
  description,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  id: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

/** Importe en formato argentino ("500.000,50"): texto, nunca type=number. */
export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  invalid,
  placeholder = "0,00",
  large,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  invalid?: boolean;
  placeholder?: string;
  large?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{currency === "USD" ? "US$" : "$"}</span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn("tabular-nums", currency === "USD" ? "pl-10" : "pl-7", large ? "h-11 text-lg" : "h-10", invalid && "border-rose-500 focus-visible:ring-rose-500/30")}
      />
    </div>
  );
}

export function StepIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children && <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>}
    </div>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] leading-snug",
        tone === "info" && "bg-muted/40",
        tone === "warn" && "border-amber-500/30 bg-amber-500/[0.07] text-amber-900 dark:text-amber-100",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-900 dark:text-emerald-100",
      )}
    >
      <Info size={14} className="mt-0.5 shrink-0 opacity-70" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
