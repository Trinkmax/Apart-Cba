import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg" | "xl";
type LogoVariant = "default" | "light" | "dark";
type LogoBrand = "rentos" | "apart";

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
  /**
   * Marca a renderizar.
   * - "rentos" (default): el brand del PMS/panel staff.
   * - "apart":  ApartCBA — la web pública de alquiler (marketplace).
   */
  brand?: LogoBrand;
}

// Aspect ratios reales del contenido (post-trim de los PNGs en /public/brand/).
// Cada brand tiene su propio lockup (wordmark) e ícono.
const BRANDS: Record<
  LogoBrand,
  {
    alt: string;
    wordmark: { src: string; lightSrc: string; ratio: number };
    icon: { src: string; lightSrc: string; ratio: number };
  }
> = {
  rentos: {
    alt: "rentOS",
    wordmark: { src: "/brand/rentOS.png", lightSrc: "/brand/rentOS-light.png", ratio: 4.58 },
    icon: { src: "/brand/ros.png", lightSrc: "/brand/ros-light.png", ratio: 2.25 },
  },
  apart: {
    alt: "ApartCBA",
    wordmark: {
      src: "/brand/apart/apart-wordmark.png",
      lightSrc: "/brand/apart/apart-wordmark-light.png",
      ratio: 3.971,
    },
    icon: {
      src: "/brand/apart/apart-icon.png",
      lightSrc: "/brand/apart/apart-icon-light.png",
      ratio: 1.087,
    },
  },
};

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
  brand = "rentos",
}: LogoProps) {
  const h = HEIGHT_MAP[size];
  const { alt, ...parts } = BRANDS[brand];
  const part = showWordmark ? parts.wordmark : parts.icon;
  const w = Math.round(h * part.ratio);

  if (variant !== "default") {
    const src = variant === "light" ? part.lightSrc : part.src;
    return (
      <Image
        src={src}
        alt={alt}
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
        src={part.src}
        alt={alt}
        width={w}
        height={h}
        priority
        className={cn("object-contain shrink-0 block dark:hidden", className)}
      />
      <Image
        src={part.lightSrc}
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
