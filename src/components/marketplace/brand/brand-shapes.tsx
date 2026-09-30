import { cn } from "@/lib/utils";

/**
 * El punto coral: la marca lo usa como punto final de sus titulares
 * ("Hacemos lugar.", "Sentite como en casa."). Va pegado a la última palabra.
 */
export function BrandDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-[0.08em] inline-block size-[0.2em] translate-y-[-0.02em] rounded-full bg-coral-500 align-baseline",
        className,
      )}
    />
  );
}

/**
 * Arco lleno (la forma del logo y de las llaves). Decorativo: fondos de
 * secciones, marcos de fotos, números de pasos. El alto lo define quien lo usa.
 */
export function ArchShape({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("rounded-t-full", className)}>{children}</div>;
}

/**
 * Banda de medio arco (tarjetas, carpetas y cartelería de la marca): un aro
 * grueso cortado. Se posiciona con `className` (absolute, tamaño, color vía
 * text-*). Decorativa.
 */
export function ArcBand({
  className,
  thickness = 14,
  sweep = "half",
}: {
  className?: string;
  /** Grosor del aro en unidades del viewBox (100 = ancho total). */
  thickness?: number;
  /** half = medio arco superior; quarter = cuarto de arco. */
  sweep?: "half" | "quarter";
}) {
  const r = 50 - thickness / 2;
  const d =
    sweep === "half"
      ? `M ${thickness / 2} 50 A ${r} ${r} 0 0 1 ${100 - thickness / 2} 50`
      : `M ${thickness / 2} 50 A ${r} ${r} 0 0 1 50 ${thickness / 2}`;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 50"
      className={cn("pointer-events-none block", className)}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
    >
      <path d={d} stroke="currentColor" strokeWidth={thickness} strokeLinecap="butt" />
    </svg>
  );
}

/** Etiqueta chica en mayúsculas espaciadas ("ALQUILERES TEMPORARIOS"). */
export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "font-apart text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Encabezado de sección de la marca: eyebrow opcional, titular en Manrope
 * extrabold con punto coral y bajada en Source Serif itálica.
 */
export function SectionHeading({
  eyebrow,
  title,
  accent,
  dot = true,
  align = "left",
  as: Tag = "h2",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Bajada en serif itálica ("Llegar debe sentirse simple."). */
  accent?: React.ReactNode;
  dot?: boolean;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
      <Tag className="font-apart text-[1.75rem] font-extrabold leading-[1.08] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem] lg:text-[2.75rem]">
        {title}
        {dot ? <BrandDot /> : null}
      </Tag>
      {accent ? (
        <p className="mt-3 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">{accent}</p>
      ) : null}
    </div>
  );
}
