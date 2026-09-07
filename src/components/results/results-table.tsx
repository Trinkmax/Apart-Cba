import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Primitivas de tabla para Resultados (server components, sin "use client").
 * La tabla scrollea adentro de su contenedor: en el celular la página no se
 * desborda horizontalmente, aunque haya 10 columnas.
 */
export function ResultsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  // min-w-0: como hija de un grid, sin esto la tabla (min-w fijo) empuja la
  // columna y el scroll se va a la página en vez de quedarse en la tabla.
  return (
    <section className="space-y-2 min-w-0">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function ResultsTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <table className={cn("w-full text-sm min-w-[640px]", className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap bg-muted/40",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle",
        align === "right" ? "text-right tabular-nums whitespace-nowrap" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}

/** Importe que se descuenta: "− $ 1.000" en el color del bolsillo. */
export function Deduction({ value, currency, tone }: { value: number; currency: string; tone: string }) {
  if (value === 0) return <span className="text-muted-foreground">—</span>;
  return <span className={tone}>− {formatMoney(value, currency)}</span>;
}

export function CurrencyChip({ currency }: { currency: string }) {
  return (
    <span className="rounded-full border px-1.5 py-px text-[9px] font-semibold tabular-nums text-muted-foreground">
      {currency}
    </span>
  );
}
