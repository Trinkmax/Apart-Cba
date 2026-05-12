import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg" | "xl";
type LogoVariant = "default" | "light" | "dark";

interface LogoProps {
  className?: string;
  size?: LogoSize;
  showWordmark?: boolean;
  /**
   * - "default": tema-aware. Negro en light mode, blanco en dark mode.
   * - "light":   fuerza la versión BLANCA (para fondos siempre oscuros, ej. brand-gradient hero).
   * - "dark":    fuerza la versión NEGRA (para fondos siempre claros, ej. PDFs).
   */
  variant?: LogoVariant;
}

// Aspect ratios reales del contenido (post-trim de los PNGs en /public/brand/).
const RATIO_WORDMARK = 4.58;
const RATIO_ICON = 2.25;

const HEIGHT_MAP: Record<LogoSize, number> = {
  sm: 22,
  md: 30,
  lg: 44,
  xl: 64,
};

export function Logo({
  className,
  size = "md",
  showWordmark = true,
  variant = "default",
}: LogoProps) {
  const h = HEIGHT_MAP[size];
  const ratio = showWordmark ? RATIO_WORDMARK : RATIO_ICON;
  const w = Math.round(h * ratio);
  const base = showWordmark ? "rentOS" : "ros";

  if (variant !== "default") {
    const src = variant === "light" ? `/brand/${base}-light.png` : `/brand/${base}.png`;
    return (
      <Image
        src={src}
        alt="rentOS"
        width={w}
        height={h}
        priority
        className={cn("object-contain shrink-0", className)}
      />
    );
  }

  return (
    <>
      <Image
        src={`/brand/${base}.png`}
        alt="rentOS"
        width={w}
        height={h}
        priority
        className={cn("object-contain shrink-0 block dark:hidden", className)}
      />
      <Image
        src={`/brand/${base}-light.png`}
        alt=""
        aria-hidden
        width={w}
        height={h}
        priority
        className={cn("object-contain shrink-0 hidden dark:block", className)}
      />
    </>
  );
}
