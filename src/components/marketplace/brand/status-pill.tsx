import { cn } from "@/lib/utils";
import type { StageTone } from "@/lib/marketplace/guest-stage";

const TONES: Record<StageTone, string> = {
  info: "bg-leaf-100 text-forest-700 ring-leaf-300",
  action: "bg-coral-100 text-coral-800 ring-coral-200",
  ok: "bg-forest-700 text-cream ring-forest-700",
  muted: "bg-cream-200 text-ink-600 ring-cream-300",
  error: "bg-[#fdecea] text-[#b42318] ring-[#f6c8c3]",
};

/** Pastilla de estado ("Esperando confirmación", "Falta la seña", "Asegurada"). */
export function StatusPill({
  tone,
  children,
  className,
  pulse = false,
}: {
  tone: StageTone;
  children: React.ReactNode;
  className?: string;
  /** Punto que late: para estados que esperan algo (confirmación, pago). */
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {pulse ? (
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {children}
    </span>
  );
}
