"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, LogIn, LogOut, Sparkles, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import type { TexBrief } from "@/lib/actions/tex";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { openTex, originOf } from "./shell-store";

/**
 * "Tex te cuenta" (nov-2026): lo primero que se ve en Hoy desde el celular.
 * El resumen sale de `getTexBrief` (determinista, sin LLM): entran, salen,
 * sucios con llegada y solicitudes. Cada chip lleva a su pantalla; el botón
 * le pide a Tex el plan del día (si la organización tiene a Tex).
 */
export function TodayBriefCard({ brief, texEnabled }: { brief: TexBrief; texEnabled: boolean }) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const chips: Array<{ label: string; value: number; href: string; icon: typeof LogIn; tone: string }> = [
    {
      label: brief.counts.checkIns === 1 ? "Entra" : "Entran",
      value: brief.counts.checkIns,
      href: "/dashboard/parte-diario",
      icon: LogIn,
      tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
    },
    {
      label: brief.counts.checkOuts === 1 ? "Sale" : "Salen",
      value: brief.counts.checkOuts,
      href: "/dashboard/parte-diario",
      icon: LogOut,
      tone: "text-sky-700 bg-sky-500/10 dark:text-sky-300",
    },
    {
      label: brief.counts.dirty === 1 ? "Sucia" : "Sucias",
      value: brief.counts.dirty,
      href: "/dashboard/limpieza",
      icon: Sparkles,
      tone:
        brief.counts.dirtyWithArrival > 0
          ? "text-red-700 bg-red-500/10 dark:text-red-300"
          : "text-amber-700 bg-amber-500/10 dark:text-amber-300",
    },
    {
      label: brief.counts.requests === 1 ? "Solicitud" : "Solicitudes",
      value: brief.counts.requests,
      href: "/dashboard/reservas-pendientes",
      icon: Inbox,
      tone: "text-violet-700 bg-violet-500/10 dark:text-violet-300",
    },
  ];

  return (
    <section
      aria-label="Resumen de hoy"
      className="relative overflow-hidden rounded-[26px] border border-[#cfe5fb] bg-[linear-gradient(135deg,#f3f9ff_0%,#ffffff_55%,#f2fbef_100%)] p-4 shadow-[0_14px_34px_-22px_rgba(26,90,144,0.55)] dark:border-[#1d3b57] dark:bg-[linear-gradient(135deg,#0f2234_0%,#141a17_60%,#132116_100%)]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold tracking-[0.08em] text-[#1a5a90] uppercase dark:text-[#8cc7f5]">
            {texEnabled ? "Tex te cuenta" : "Hoy"}
          </p>
          <p className="mt-1 text-[19px] leading-snug font-semibold tracking-tight">{brief.headline}</p>
          {brief.lines.map((l) => (
            <p key={l} className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
              {l}
            </p>
          ))}
        </div>
        {texEnabled ? <TexAvatar mood="face" className="-mt-1 -mr-1 size-14 shrink-0" /> : null}
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {chips.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.label}
              href={c.href}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold tabular-nums active:scale-[0.97]",
                c.tone,
                c.value === 0 && "opacity-55",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {c.value} {c.label}
            </Link>
          );
        })}
      </div>

      {texEnabled ? (
        <button
          ref={ref}
          type="button"
          onClick={() => {
            haptic("impact");
            openTex({ origin: originOf(ref.current), prompt: brief.prompt });
          }}
          className="mt-3.5 flex w-full items-center justify-between rounded-2xl bg-[#1a5a90] px-4 py-3 text-[14.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_22px_-14px_rgba(26,90,144,0.9)] active:scale-[0.99] dark:bg-[#2f7fc0]"
        >
          Armame el plan de hoy
          <ArrowRight className="size-4" aria-hidden />
        </button>
      ) : (
        <Link
          href="/dashboard/parte-diario"
          className="mt-3.5 flex w-full items-center justify-between rounded-2xl bg-black/[0.04] px-4 py-3 text-[14.5px] font-semibold dark:bg-white/10"
        >
          Ver el parte del día
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </section>
  );
}
