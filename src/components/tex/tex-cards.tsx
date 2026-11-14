"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BedDouble,
  CalendarDays,
  ChartColumn,
  ChevronRight,
  FileText,
  House,
  Inbox,
  KeyRound,
  List,
  Search,
  Sparkles,
  UserRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardIcon, CardTone, TexCard } from "@/lib/tex/types";
import { isInternalHref } from "@/lib/tex/format";

/**
 * Las tarjetas que dibuja la app con lo que devuelven las herramientas de Tex
 * (nov-2026). Tex no copia la lista en el texto: la ve la persona acá, con
 * cada fila linkeada a su pantalla.
 */

const ICON: Record<CardIcon, LucideIcon> = {
  calendar: CalendarDays,
  bed: BedDouble,
  wallet: Wallet,
  chart: ChartColumn,
  broom: Sparkles,
  wrench: Wrench,
  list: List,
  inbox: Inbox,
  bell: Bell,
  file: FileText,
  user: UserRound,
  home: House,
  search: Search,
  key: KeyRound,
};

const TONE_BADGE: Record<CardTone, string> = {
  neutral: "bg-black/[0.05] text-foreground/80 dark:bg-white/10",
  good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  bad: "bg-red-500/12 text-red-700 dark:text-red-300",
  info: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};
const TONE_TEXT: Record<CardTone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-red-700 dark:text-red-300",
  info: "text-sky-700 dark:text-sky-300",
};

function CardShell({
  title,
  icon,
  children,
  footer,
  onNavigate,
}: {
  title: string;
  icon?: CardIcon;
  children: React.ReactNode;
  footer?: { label: string; href: string };
  onNavigate?: () => void;
}) {
  const Icon = icon ? ICON[icon] : null;
  return (
    <section className="tex-msg-in overflow-hidden rounded-[20px] border border-black/[0.06] bg-card shadow-[0_1px_2px_rgba(22,46,36,0.05),0_8px_24px_-14px_rgba(22,46,36,0.25)] dark:border-white/[0.08]">
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        {Icon ? (
          <span className="grid size-7 place-items-center rounded-lg bg-[oklch(0.95_0.025_150)] text-[oklch(0.4_0.07_152)] dark:bg-white/10 dark:text-[oklch(0.86_0.08_150)]">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <h4 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight">{title}</h4>
      </header>
      {children}
      {footer && isInternalHref(footer.href) ? (
        <Link
          href={footer.href}
          onClick={onNavigate}
          className="flex items-center justify-between border-t border-black/[0.05] px-3.5 py-2.5 text-[13.5px] font-medium text-[oklch(0.42_0.08_152)] active:bg-black/[0.03] dark:border-white/[0.06] dark:text-[oklch(0.84_0.09_150)]"
        >
          {footer.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

export function TexCardView({ card, onNavigate }: { card: TexCard; onNavigate?: () => void }) {
  if (card.kind === "link") {
    if (!isInternalHref(card.href)) return null;
    return (
      <Link
        href={card.href}
        onClick={onNavigate}
        className="tex-msg-in flex items-center gap-3 rounded-[20px] border border-black/[0.06] bg-card px-3.5 py-3 shadow-sm active:scale-[0.99] dark:border-white/[0.08]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold">{card.title}</span>
          {card.description ? <span className="block text-[13px] text-muted-foreground">{card.description}</span> : null}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-[oklch(0.5_0.08_152)] px-3 py-1.5 text-[13px] font-semibold text-white">
          {card.cta}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>
    );
  }

  if (card.kind === "stats") {
    return (
      <CardShell title={card.title} icon={card.icon} footer={card.footer} onNavigate={onNavigate}>
        <div className="grid grid-cols-2 gap-px bg-black/[0.05] dark:bg-white/[0.06]">
          {card.tiles.map((t, i) => (
            <div key={i} className="bg-card px-3.5 py-2.5">
              <p className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">{t.label}</p>
              <p className={cn("mt-0.5 text-[19px] leading-tight font-semibold tracking-tight tabular-nums", TONE_TEXT[t.tone ?? "neutral"])}>
                {t.value}
              </p>
              {t.hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{t.hint}</p> : null}
            </div>
          ))}
        </div>
        {card.note ? <p className="px-3.5 py-2.5 text-[12.5px] text-muted-foreground">{card.note}</p> : null}
      </CardShell>
    );
  }

  return (
    <CardShell title={card.title} icon={card.icon} footer={card.footer} onNavigate={onNavigate}>
      {card.rows.length === 0 ? (
        <p className="px-3.5 pb-3.5 text-[13.5px] text-muted-foreground">{card.empty ?? "No hay nada para mostrar."}</p>
      ) : (
        <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
          {card.rows.map((r, i) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium">{r.title}</span>
                    {r.meta ? <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{r.meta}</span> : null}
                  </span>
                  {r.subtitle ? <span className="block truncate text-[12.5px] text-muted-foreground">{r.subtitle}</span> : null}
                </span>
                {r.amount ? (
                  <span className={cn("shrink-0 text-[13.5px] font-semibold tabular-nums", TONE_TEXT[r.amount.tone ?? "neutral"])}>
                    {r.amount.value}
                  </span>
                ) : null}
                {r.badge ? (
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", TONE_BADGE[r.badge.tone])}>
                    {r.badge.label}
                  </span>
                ) : null}
                {isInternalHref(r.href) ? <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden /> : null}
              </>
            );
            return (
              <li key={i}>
                {isInternalHref(r.href) ? (
                  <Link href={r.href} onClick={onNavigate} className="flex items-center gap-2.5 px-3.5 py-2.5 active:bg-black/[0.03] dark:active:bg-white/[0.05]">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {card.more ? (
        <p className="border-t border-black/[0.05] px-3.5 py-2 text-[12.5px] text-muted-foreground dark:border-white/[0.06]">
          y {card.more} más
        </p>
      ) : null}
    </CardShell>
  );
}
