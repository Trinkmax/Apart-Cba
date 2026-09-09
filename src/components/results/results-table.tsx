import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Primitivas de tabla para Resultados (server components, sin "use client").
 *
 * La tabla scrollea adentro de su contenedor en los DOS ejes: horizontal para
 * que en el celular la página no se desborde con 10 columnas, y vertical para
 * que una tabla larga no estire la fila del grid. Sin el scroll vertical, "Por
 * canal" (3 filas) al lado de "Por propietario" (58) dejaba dos pantallas de
 * hueco blanco: el grid le da a las dos columnas la altura de la más alta.
 *
 * Con el tope, las dos columnas miden lo mismo y cada una scrollea lo suyo.
 * El encabezado queda fijo arriba (`Th` es sticky), así una tabla de 58 filas
 * sigue siendo legible sin volver a subir a leer los títulos.
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
  // h-full + flex: deja que la tabla se estire hasta el alto de la fila del
  // grid, para que las dos columnas terminen a la misma altura.
  return (
    <section className="space-y-2 min-w-0 h-full flex flex-col">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * `height` topea el alto del recuadro: "normal" ≈ 12 filas, "tall" para la
 * tabla de detalle, que va a ancho completo y no comparte fila con nadie.
 *
 * El tope se aplica SÓLO desde `xl`, que es donde vive el grid de dos
 * columnas. Abajo de ese breakpoint las tablas se apilan y no hay hueco que
 * arreglar; capar ahí metería un scroll adentro de otro scroll, que en el
 * celular es exactamente lo que uno no quiere.
 */
export function ResultsTable({
  children,
  className,
  height = "normal",
}: {
  children: ReactNode;
  className?: string;
  height?: "normal" | "tall";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-auto flex-1",
        height === "tall" ? "xl:max-h-[40rem]" : "xl:max-h-[32rem]",
      )}
    >
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
        "px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap",
        // sticky + fondo OPACO (no bg-muted/40): con transparencia las filas
        // se ven por debajo del encabezado al scrollear. El borde inferior lo
        // despega del contenido cuando la tabla está scrolleada.
        "sticky top-0 z-10 bg-muted border-b",
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
