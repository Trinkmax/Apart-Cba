"use client";

import * as React from "react";
import { haptic } from "@/lib/ui/haptics";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { openTex, originOf } from "@/components/mobile/shell-store";

/**
 * Tex al pie del sidebar de la compu (nov-2026): su cara, una línea y el atajo.
 * Colapsado el sidebar, queda sólo la cara.
 */
export function SidebarTexCard() {
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        haptic("impact");
        openTex({ origin: originOf(ref.current) });
      }}
      title="Tex, tu asistente (⌘J)"
      className="group flex w-full items-center gap-2.5 rounded-xl border border-[#cfe5fb] bg-[linear-gradient(135deg,#f3f9ff,#ffffff_60%,#f2fbef)] p-2 text-left transition-shadow hover:shadow-[0_8px_20px_-14px_rgba(26,90,144,0.7)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-none group-data-[collapsible=icon]:p-0 dark:border-[#1d3b57] dark:bg-[linear-gradient(135deg,#0f2234,#141a17_60%,#132116)]"
    >
      <TexAvatar mood="face" className="size-9 shrink-0 transition-transform group-hover:scale-110" />
      <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <span className="block text-[13px] leading-tight font-semibold text-[#0b3d68] dark:text-[#cfe7ff]">
          Preguntale a Tex
        </span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">Consultas, reportes y acciones</span>
      </span>
      <kbd className="rounded-md border border-black/10 bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden dark:border-white/10 dark:bg-white/5">
        ⌘J
      </kbd>
    </button>
  );
}
