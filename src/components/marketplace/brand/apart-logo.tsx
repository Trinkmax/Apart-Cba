import { cn } from "@/lib/utils";
import { APART_LOCKUP, APART_STACKED, APART_SYMBOL, APART_WORDMARK } from "./apart-logo-paths";

const VARIANTS = {
  lockup: APART_LOCKUP,
  symbol: APART_SYMBOL,
  wordmark: APART_WORDMARK,
  stacked: APART_STACKED,
} as const;

export type ApartLogoVariant = keyof typeof VARIANTS;

/**
 * Logo de apart en SVG vectorial. Toma el color del texto (`currentColor`):
 * `text-forest-700` sobre crema, `text-cream` sobre forest, etc.
 *
 * El tamaño se controla con la altura (`className="h-7"`); el ancho sale del
 * viewBox. `title` se anuncia a lectores de pantalla; sin `title` es decorativo.
 */
export function ApartLogo({
  variant = "lockup",
  className,
  title = "apart",
}: {
  variant?: ApartLogoVariant;
  className?: string;
  /** null = decorativo (aria-hidden). */
  title?: string | null;
}) {
  const { viewBox, d } = VARIANTS[variant];
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block w-auto shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={d} />
    </svg>
  );
}
