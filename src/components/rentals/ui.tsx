import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ChevronDown, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { StatusMeta } from "@/lib/rentals/labels";

/**
 * Kit visual del módulo Alquileres. Server-safe (sin estado): lo usan pages y
 * componentes cliente por igual. Sigue los patrones del panel (ver
 * results-kpis.tsx, settlements-list-client.tsx): números tabulares, badges
 * con color hex del META, verde = plata que entra, rosa = deuda/egreso,
 * ámbar = atención.
 */

/** Acento del módulo (teal): distinto del violeta de "mensual" y del celeste de "temporario". */
export const RENTALS_ACCENT = "#0d9488";

export function StatusBadge({ meta, className, compact }: { meta: StatusMeta; className?: string; compact?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-normal gap-1.5 whitespace-nowrap", compact && "h-5 px-1.5 text-[10px]", className)}
      style={{ color: meta.color, backgroundColor: `${meta.color}15`, borderColor: `${meta.color}35` }}
      title={meta.description}
    >
      <span className="status-dot" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </Badge>
  );
}

export type MoneyTone = "neutral" | "in" | "out" | "warn" | "muted";

const TONE_CLASS: Record<MoneyTone, string> = {
  neutral: "",
  in: "text-emerald-700 dark:text-emerald-400",
  out: "text-rose-600 dark:text-rose-400",
  warn: "text-amber-700 dark:text-amber-300",
  muted: "text-muted-foreground",
};

export function Money({
  amount,
  currency = "ARS",
  tone = "neutral",
  className,
  signed,
}: {
  amount: number | null | undefined;
  currency?: string;
  tone?: MoneyTone;
  className?: string;
  /** Muestra "− $ 1.000" en negativos (signo tipográfico, no guion). */
  signed?: boolean;
}) {
  const n = amount ?? 0;
  const text = signed && n < 0 ? `− ${formatMoney(Math.abs(n), currency)}` : formatMoney(amount, currency);
  return <span className={cn("tabular-nums whitespace-nowrap", TONE_CLASS[tone], className)}>{text}</span>;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  backHref,
  backLabel,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {backHref && (
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowRight size={14} className="rotate-180" /> {backLabel ?? "Volver"}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            {Icon && <Icon className="size-5 shrink-0" style={{ color: RENTALS_ACCENT }} />}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children, hint, action, dotColor }: { children: ReactNode; hint?: ReactNode; action?: ReactNode; dotColor?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          {dotColor && <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
          {children}
        </h2>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "in" | "out" | "warn";
  href?: string;
}) {
  const body = (
    <Card className={cn("p-3 sm:p-4 gap-0 h-full", href && "hover:shadow-md hover:border-primary/30 transition-all")}>
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon size={14} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "text-lg sm:text-2xl font-semibold tabular-nums truncate mt-1",
          tone === "in" && "text-emerald-700 dark:text-emerald-400",
          tone === "out" && "text-rose-600 dark:text-rose-400",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{hint}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-8 sm:p-12 items-center text-center gap-3 border-dashed", className)}>
      <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
        <Icon size={22} />
      </div>
      <div>
        <p className="text-base font-semibold">{title}</p>
        {description && <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>}
      </div>
      {action}
    </Card>
  );
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Cuadradito de fecha (día grande + mes) para listas de vencimientos y ajustes. */
export function DateTile({ date, tone = "neutral" }: { date: string; tone?: "neutral" | "in" | "warn" | "out" }) {
  const day = Number(date.slice(8, 10));
  const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? "";
  return (
    <div
      className={cn(
        "shrink-0 w-12 h-12 rounded-lg border flex flex-col items-center justify-center leading-none",
        tone === "neutral" && "bg-muted/50 text-foreground",
        tone === "in" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        tone === "warn" && "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25",
        tone === "out" && "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25",
      )}
    >
      <span className="text-base font-bold tabular-nums">{day}</span>
      <span className="text-[9px] uppercase tracking-wider mt-0.5">{month}</span>
    </div>
  );
}

/** Pastilla "Período 2/3". */
export function PeriodPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap", className)}
      style={{ color: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}12`, borderColor: `${RENTALS_ACCENT}35` }}
    >
      {children}
    </span>
  );
}

/** Barra apilada CSS (sin recharts) para "cobrado / pendiente / vencido". */
export function StackedBar({ segments, className }: { segments: { value: number; color: string; label: string }[]; className?: string }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div
      className={cn("flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}
    >
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => <div key={s.label} className="h-full min-w-[3px]" style={{ flex: `${s.value} 1 0%`, backgroundColor: s.color }} />)}
    </div>
  );
}

/** "Cómo se calcula" plegable, cerrado por defecto (patrón de Resultados). */
export function HowItWorks({ title = "Cómo se calcula", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 sm:px-5 text-[12px] leading-relaxed text-muted-foreground space-y-1.5">{children}</div>
    </details>
  );
}
