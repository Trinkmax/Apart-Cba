"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Piezas chicas de formulario compartidas por Personas y Propiedades: campo
 * con label + error/aviso/ayuda debajo, y un selector segmentado accesible.
 */

export function Field({
  id,
  label,
  required,
  hint,
  error,
  warn,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  warn?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {required && <span className="text-rose-500" aria-hidden> *</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : warn ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{warn}</p>
      ) : hint ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-lg bg-muted p-1 gap-0.5", className)}>
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
              "rounded-md px-3 min-h-8 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-card shadow-sm font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Subtítulo de bloque dentro de un formulario largo. */
export function FormSection({ title, hint, icon, className, children }: { title: string; hint?: ReactNode; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-start gap-2">
        {icon && <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
