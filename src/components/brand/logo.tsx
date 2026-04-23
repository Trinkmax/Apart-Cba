import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showWordmark?: boolean;
  variant?: "default" | "mono" | "sage" | "white";
}

const SIZE_MAP = {
  sm: { icon: 28, text: "text-base", gap: "gap-2", tagline: "text-[8px]" },
  md: { icon: 36, text: "text-lg", gap: "gap-2.5", tagline: "text-[9px]" },
  lg: { icon: 56, text: "text-3xl", gap: "gap-3", tagline: "text-[10px]" },
  xl: { icon: 88, text: "text-5xl", gap: "gap-4", tagline: "text-xs" },
};

/**
 * Apart Cba — heart + house icon outline based on the brand mark.
 * `currentColor` makes it inheritable from parent text color.
 */
export function LogoIcon({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Apart Cba"
    >
      <path d="M50 82 C50 82, 16 60, 16 36 C16 23, 26 15, 35 15 C42 15, 48 19, 50 25 C52 19, 58 15, 65 15 C74 15, 84 23, 84 36 C84 60, 50 82, 50 82 Z" />
      <path d="M34 47 L50 31 L66 47" />
      <path d="M38 47 L38 63 L62 63 L62 47" />
      <path d="M46 63 L46 54 L54 54 L54 63" />
    </svg>
  );
}

export function Logo({
  className,
  size = "md",
  showWordmark = true,
  variant = "default",
}: LogoProps) {
  const s = SIZE_MAP[size];

  // Color del icono (heart+house) según variant
  const iconColorClass =
    variant === "white"
      ? "text-white"
      : variant === "sage"
      ? "text-[var(--brand-sage)]"
      : variant === "mono"
      ? "text-foreground"
      : "text-[var(--brand-sage)] dark:text-[var(--brand-sage-light)]";

  const textColorClass =
    variant === "white"
      ? "text-white"
      : variant === "mono"
      ? "text-foreground"
      : "text-foreground";

  const dotColor = variant === "white" ? "bg-orange-300" : "bg-[var(--brand-coral)]";

  return (
    <div className={cn("flex items-center", s.gap, className)}>
      <LogoIcon size={s.icon} className={cn(iconColorClass, "shrink-0")} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-extralight tracking-[0.18em] uppercase",
              s.text,
              textColorClass
            )}
            style={{ fontFamily: "var(--font-geist-sans), system-ui" }}
          >
            APART
          </span>
          {(size === "lg" || size === "xl") && (
            <div className="flex items-center gap-1.5 mt-1.5 ml-0.5">
              <span
                className={cn(
                  "tracking-[0.22em] uppercase font-light opacity-90",
                  s.tagline,
                  variant === "white" ? "text-white/85" : "text-muted-foreground"
                )}
              >
                Temporarios
              </span>
              <span className={cn("size-1 rounded-full", dotColor)} />
              <span
                className={cn(
                  "tracking-[0.22em] uppercase font-light opacity-90",
                  s.tagline,
                  variant === "white" ? "text-white/85" : "text-muted-foreground"
                )}
              >
                Córdoba
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
