import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Variante plegable de DetailSection para celular y tablet: un <details>
 * cerrado (sin JS) con el título y un resumen de una línea ("Seña de 1 noche ·
 * el resto, al llegar"). Quien la usa la esconde desde lg (`lg:hidden`) y deja
 * la DetailSection de siempre con `hidden lg:block`: el escritorio no cambia.
 * El <summary> es una grilla con hijos directos (ícono, h2, resumen, flecha)
 * para que el h2 no quede adentro de un span.
 */
export function DetailDisclosure({
  id,
  title,
  summary,
  icon: Icon,
  children,
  className,
}: {
  id: string;
  title: React.ReactNode;
  summary: React.ReactNode;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details id={id} className={cn("group scroll-mt-28 border-t border-cream-300 pt-6 md:pt-8", className)}>
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="col-start-1 row-span-2 row-start-1 flex size-11 items-center justify-center rounded-t-full rounded-b-xl bg-leaf-200 text-forest-700"
        >
          <Icon className="size-5" />
        </span>
        <h2
          id={`${id}-title`}
          className="col-start-2 row-start-1 font-apart text-[1.375rem] font-extrabold leading-tight tracking-[-0.02em] text-forest-700 sm:text-[1.625rem]"
        >
          {title}
        </h2>
        <span className="col-start-2 row-start-2 text-[0.875rem] leading-snug text-ink-500">{summary}</span>
        <span
          aria-hidden
          className="col-start-3 row-span-2 row-start-1 flex size-11 items-center justify-center rounded-full bg-paper text-forest-700 shadow-apart-sm ring-1 ring-cream-300 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-180"
        >
          <ChevronDown className="size-5" />
        </span>
      </summary>
      <div className="pt-5 motion-safe:group-open:animate-in motion-safe:group-open:fade-in-0 motion-safe:group-open:slide-in-from-top-2 motion-safe:group-open:duration-300">
        {children}
      </div>
    </details>
  );
}

/** Sección de la columna de la ficha: titular forest con separador arriba. */
export function DetailSection({
  id,
  title,
  accent,
  children,
  className,
}: {
  id: string;
  title: React.ReactNode;
  /** Bajada en serif itálica (frase de marca). */
  accent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cn("scroll-mt-28 border-t border-cream-300 pt-8 md:pt-10", className)}>
      <h2
        id={`${id}-title`}
        className="font-apart text-[1.375rem] font-extrabold leading-tight tracking-[-0.02em] text-forest-700 sm:text-[1.625rem]"
      >
        {title}
      </h2>
      {accent ? <p className="mt-1.5 font-apart-serif text-[1.0625rem] italic text-forest-600">{accent}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
