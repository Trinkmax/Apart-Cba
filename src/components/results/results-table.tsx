import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Primitivas de tabla para Resultados (server components, sin "use client";
 * `Hint`/`InfoHint` renderizan el tooltip cliente de shadcn adentro).
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
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Controles a la derecha del título (p. ej. el selector de vista). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  // min-w-0: como hija de un grid, sin esto la tabla (min-w fijo) empuja la
  // columna y el scroll se va a la página en vez de quedarse en la tabla.
  // h-full + flex: deja que la tabla se estire hasta el alto de la fila del
  // grid, para que las dos columnas terminen a la misma altura.
  return (
    <section className="space-y-2 min-w-0 h-full flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Primera columna fija al scrollear en horizontal (el nombre del depto, del
 * propietario, de la reserva), con fondo OPACO por la misma razón que `Th`.
 *
 * - Las celdas con `colSpan` quedan afuera: una fila expandida o un estado
 *   vacío ocupan todo el ancho y no tienen "primera columna".
 * - El separador es un degradé de 1 px y no un box-shadow, para no pisar el
 *   borde ámbar de aviso que la tabla de detalle pinta en esa misma celda.
 * - El hover se recalcula opaco: el `hover:bg-muted/30` de la fila es
 *   translúcido y la celda fija lo taparía. Lo mismo una fila marcada con
 *   `data-open` (la fila expandida del detalle queda resaltada).
 */
const STICKY_FIRST_COL = cn(
  "[&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20",
  "[&_thead_th:first-child]:bg-[linear-gradient(to_left,var(--border)_1px,transparent_1px)]",
  "[&_tbody_td:first-child:not([colspan])]:sticky [&_tbody_td:first-child:not([colspan])]:left-0",
  "[&_tbody_td:first-child:not([colspan])]:z-[1] [&_tbody_td:first-child:not([colspan])]:bg-card",
  "[&_tbody_td:first-child:not([colspan])]:bg-[linear-gradient(to_left,var(--border)_1px,transparent_1px)]",
  "[&_tbody_tr:hover_td:first-child:not([colspan])]:bg-[color-mix(in_oklab,var(--card),var(--muted)_30%)]",
  "[&_tbody_tr[data-open]_td:first-child:not([colspan])]:bg-[color-mix(in_oklab,var(--card),var(--muted)_30%)]",
);

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
  stickyFirstCol = false,
}: {
  children: ReactNode;
  className?: string;
  height?: "normal" | "tall";
  stickyFirstCol?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-auto flex-1",
        height === "tall" ? "xl:max-h-[40rem]" : "xl:max-h-[32rem]",
      )}
    >
      <table className={cn("w-full text-sm min-w-[640px]", stickyFirstCol && STICKY_FIRST_COL, className)}>
        {children}
      </table>
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

/**
 * Envuelve un texto o monto con un tooltip. Enfocable con teclado. Trae su
 * propio provider para poder usarse suelto desde un server component.
 */
export function Hint({
  content,
  children,
  className,
  contentClassName,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className={cn("max-w-xs text-left leading-snug", contentClassName)}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Ícono (i) con tooltip, para explicar un número sin ocupar lugar. */
export function InfoHint({ content, label = "Más información" }: { content: ReactNode; label?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-left leading-snug">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
