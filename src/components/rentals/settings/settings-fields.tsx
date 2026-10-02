import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Piezas del formulario de Configuración → Alquileres (mismo lenguaje que el resto de Configuración). */

export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  id,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-lg border bg-card p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0d9488]/12 text-[#0d9488]">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  help,
  children,
  className,
  error,
}: {
  label: string;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  error?: string | null;
}) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      ) : help ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}

/** Input con sufijo ("%", "días", "$") pegado a la derecha. */
export function SuffixInput({
  id,
  value,
  onChange,
  suffix,
  prefix,
  inputMode = "decimal",
  placeholder,
  invalid,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  prefix?: string;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
      <Input
        id={id}
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn("h-10 tabular-nums", prefix && "pl-7", suffix && "pr-14")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** Fila de opciones tipo chip (3 meses · 4 meses · …). */
export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 rounded-md border px-3 text-xs font-medium transition-colors",
            o.value === value ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
