import Link from "next/link";
import { ArrowUpRight, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Lo que espera a alguien. Sólo aparece lo que tiene algo adentro: una fila en
 * cero no pide nada y enseña a no mirar (la misma regla que los avisos, ver
 * src/lib/alerts/policy.ts). Si no queda nada, lo dice.
 */

export type AttentionItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  /** El número grande ("12", "$ 340.000"). */
  value: string;
  detail?: string | null;
  tone: "rose" | "amber" | "neutral";
};

const TONE = {
  rose: { tile: "bg-rose-500/[0.07] ring-rose-500/20 hover:ring-rose-500/40", icon: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  amber: { tile: "bg-amber-500/[0.07] ring-amber-500/20 hover:ring-amber-500/40", icon: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  neutral: { tile: "bg-muted/35 ring-border/70 hover:ring-foreground/20", icon: "bg-background text-foreground/70 ring-1 ring-border/70" },
} as const;

export function AttentionCard({ items, className }: { items: AttentionItem[]; className?: string }) {
  return (
    <section className={cn("@container rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Para atender</h2>
        {items.length > 0 ? <span className="text-[12px] text-muted-foreground">Tocá uno para ir a resolverlo</span> : null}
      </div>

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-8 text-emerald-500" aria-hidden />
          <p className="text-[15px] font-medium">Todo al día</p>
          <p className="text-[13px] text-muted-foreground">No hay nada esperando una respuesta.</p>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-2.5 @2xl:grid-cols-3">
          {items.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                className={cn("group flex h-full flex-col rounded-2xl p-3.5 ring-1 transition-[box-shadow,background-color] ring-inset", TONE[it.tone].tile)}
              >
                <span className="flex items-center justify-between">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-[10px]", TONE[it.tone].icon)}>
                    <it.icon className="size-4" aria-hidden />
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </span>
                <span className="mt-3 text-[24px] leading-none font-semibold tracking-[-0.015em] tabular-nums">{it.value}</span>
                <span className="mt-1.5 text-[13px] leading-snug font-medium">{it.label}</span>
                {it.detail ? <span className="mt-1 text-[12px] leading-snug text-muted-foreground">{it.detail}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
