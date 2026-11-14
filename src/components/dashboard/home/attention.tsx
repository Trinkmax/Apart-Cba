import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Lo que espera a alguien. Sólo aparece lo que tiene algo adentro: una fila en
 * cero no pide nada y enseña a no mirar (la misma regla que los avisos, ver
 * src/lib/alerts/policy.ts). Si no queda nada, lo dice.
 *
 * Nunca deja un hueco (el dueño, 14/11/2026: cinco tarjetas en una grilla de
 * tres dejaban la sexta vacía). Lo que pide una acción va en tarjetas que se
 * estiran para llenar su fila; los contadores (mantenimiento, limpiezas,
 * tareas) van abajo en una franja que siempre ocupa el ancho entero. Sin nada
 * urgente, los contadores pasan a ser las tarjetas. Las tarjetas también se
 * estiran a lo alto: la fila la comparte con «Unidades ahora».
 */

export type AttentionItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  /** El número grande ("12", "$ 340.000"). */
  value: string;
  detail?: string | null;
  /** Qué hacer al tocarla ("Responder", "Completar"). */
  cta: string;
  /** `neutral` = un contador; lo demás pide una acción. */
  tone: "rose" | "amber" | "neutral";
};

const TONE = {
  rose: {
    tile: "bg-rose-500/[0.07] ring-rose-500/20 hover:ring-rose-500/40",
    icon: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    cta: "text-rose-700 dark:text-rose-300",
  },
  amber: {
    tile: "bg-amber-500/[0.07] ring-amber-500/20 hover:ring-amber-500/40",
    icon: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    cta: "text-amber-800 dark:text-amber-300",
  },
  neutral: {
    tile: "bg-muted/35 ring-border/70 hover:ring-foreground/20",
    icon: "bg-background text-foreground/70 ring-1 ring-border/70",
    cta: "text-foreground/75",
  },
} as const;

export function AttentionCard({ items, className }: { items: AttentionItem[]; className?: string }) {
  const actions = items.filter((it) => it.tone !== "neutral");
  const counters = items.filter((it) => it.tone === "neutral");
  // Sin nada urgente, los contadores ocupan el lugar de las tarjetas.
  const tiles = actions.length > 0 ? actions : counters;
  const strip = actions.length > 0 ? counters : [];

  return (
    <section
      className={cn(
        "@container flex flex-col rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6",
        className,
      )}
    >
      <h2 className="text-[13px] font-semibold">Para atender</h2>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <CheckCircle2 className="size-8 text-emerald-500" aria-hidden />
          <p className="text-[15px] font-medium">Todo al día</p>
          <p className="text-[13px] text-muted-foreground">No hay nada esperando una respuesta.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col gap-2.5">
          <ul className="flex flex-1 flex-wrap gap-2.5">
            {tiles.map((it) => (
              <li key={it.key} className="flex min-w-36 flex-1 basis-[calc(50%-0.3125rem)] @xl:basis-0">
                <AttentionTile item={it} />
              </li>
            ))}
          </ul>

          {strip.length > 0 ? (
            <ul className="grid divide-y divide-border/70 overflow-hidden rounded-2xl bg-muted/35 ring-1 ring-border/70 ring-inset @md:auto-cols-fr @md:grid-flow-col @md:divide-x @md:divide-y-0">
              {strip.map((it) => (
                <li key={it.key}>
                  <Link
                    href={it.href}
                    className="group flex h-full items-center gap-3 px-3.5 py-3 transition-colors hover:bg-muted/70"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-background text-foreground/70 ring-1 ring-border/70">
                      <it.icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2 @md:flex-col @md:items-start @md:gap-1">
                      <span className="text-[18px] leading-none font-semibold tabular-nums">{it.value}</span>
                      <span className="truncate text-[12.5px] leading-snug text-muted-foreground">{it.label}</span>
                    </span>
                    <ArrowUpRight
                      className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AttentionTile({ item: it }: { item: AttentionItem }) {
  const tone = TONE[it.tone];
  return (
    <Link
      href={it.href}
      className={cn(
        "group flex w-full flex-col rounded-2xl p-4 ring-1 transition-[box-shadow,background-color] ring-inset",
        tone.tile,
      )}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-[11px]", tone.icon)}>
        <it.icon className="size-[18px]" aria-hidden />
      </span>
      <span className="mt-3.5 text-[26px] leading-none font-semibold tracking-[-0.015em] tabular-nums">{it.value}</span>
      <span className="mt-1.5 text-[13.5px] leading-snug font-medium">{it.label}</span>
      {it.detail ? <span className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{it.detail}</span> : null}
      {/* Abajo de todo: así, con las tarjetas estiradas, quedan alineadas. */}
      <span className={cn("mt-auto inline-flex items-center gap-1 pt-3.5 text-[12.5px] font-semibold", tone.cta)}>
        {it.cta}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
