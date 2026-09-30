import { cn } from "@/lib/utils";

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
