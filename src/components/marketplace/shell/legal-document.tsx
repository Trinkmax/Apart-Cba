import { BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";

/**
 * Estética de lectura de los textos legales: columna angosta, cuerpo de
 * 16–17 px con interlineado amplio, listas con viñeta coral y links forest.
 * Los estilos van por selector descendiente porque el contenido legal se
 * escribe como HTML plano (p, ul, ol, h3, a, strong) y no se toca.
 */
const PROSE = cn(
  "text-base leading-[1.75] text-ink-700 sm:text-[1.0625rem]",
  "[&_p]:text-pretty [&_strong]:font-semibold [&_strong]:text-ink-900",
  "[&_a]:rounded [&_a]:font-semibold [&_a]:text-forest-700 [&_a]:underline [&_a]:decoration-forest-700/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-forest-700",
  "[&_a]:outline-none [&_a:focus-visible]:ring-[3px] [&_a:focus-visible]:ring-forest-500/30 [&_a]:break-words",
  "[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_li]:pl-1 marker:text-coral-500",
  "[&_h3]:mt-7 [&_h3]:text-[1.0625rem] [&_h3]:font-bold [&_h3]:tracking-[-0.01em] [&_h3]:text-forest-700",
  "[&_code]:rounded-md [&_code]:bg-cream-200 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_code]:text-ink-900",
);

export function LegalArticle({
  title,
  updated,
  children,
}: {
  title: string;
  /** "11 de mayo de 2026" */
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <article className={PROSE}>
      <header className="mb-10 border-b border-cream-300 pb-8">
        <Eyebrow>Legales</Eyebrow>
        <h1 className="mt-3 text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.75rem]">
          {title}
          <BrandDot />
        </h1>
        {updated ? <p className="mt-4 text-[0.9375rem] text-ink-500">Última actualización: {updated}</p> : null}
      </header>
      {children}
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 first-of-type:mt-0">
      <h2 className="mb-4 text-[1.375rem] font-extrabold leading-tight tracking-[-0.02em] text-forest-700 sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Recuadro destacado (resumen) dentro de un texto legal. */
export function LegalCallout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12 rounded-3xl bg-leaf-100 p-5 ring-1 ring-leaf-300 sm:p-7">
      <h2 className="text-lg font-bold text-forest-700">{title}</h2>
      <div className="mt-2 space-y-3 text-forest-800">{children}</div>
    </section>
  );
}

/** Nota al pie del texto (texto secundario). */
export function LegalNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[0.9375rem] leading-relaxed text-ink-500", className)}>{children}</p>;
}
