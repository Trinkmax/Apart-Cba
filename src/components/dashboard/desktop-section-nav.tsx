"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/types/database";
import { PendingRequestsBadge } from "@/components/dashboard/pending-requests-badge";
import { SCREEN_ICONS } from "@/components/mobile/icons";
import { desktopNav, routeMeta, type ShellContext } from "@/components/mobile/routes";
import { useShellPathname } from "@/components/mobile/shell-store";

/*
 * Las pestañas de la sección, en la barra de arriba de la compu (nov-2026):
 * la misma anidación que el celular. En una raíz, "Reservas  Calendario |
 * Lista | Solicitudes ② | Huéspedes" con un indicador que se desliza con el
 * resorte de iOS. En una ficha, el camino: "Reservas › Lista › Reserva".
 * No suma alto: vive en la barra que ya existía (el calendario no se achica).
 */

export function DesktopSectionNav({
  role,
  rentalsEnabled,
  pendingRequests,
  canViewChannels,
}: {
  role: UserRole;
  rentalsEnabled: boolean;
  pendingRequests: number;
  canViewChannels: boolean;
}) {
  const pathname = useShellPathname();
  const ctx = React.useMemo<ShellContext>(() => ({ role, rentalsEnabled }), [role, rentalsEnabled]);
  const meta = React.useMemo(() => routeMeta(pathname, ctx), [pathname, ctx]);
  const nav = React.useMemo(() => desktopNav(ctx), [ctx]);
  const section = nav.sections.find((s) => s.id === meta.tab) ?? null;
  const moreRow = meta.tab === "mas" ? nav.groups.flatMap((g) => g.rows).find((r) => r.id === meta.link) : undefined;
  const owner = section ?? moreRow ?? null;
  const Icon = owner ? SCREEN_ICONS[owner.icon] : null;

  // Raíz de una sección con pestañas.
  if (meta.kind === "root" && section && section.subtabs.length > 1) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="hidden shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight xl:flex">
          {Icon ? <Icon size={17} className="text-[oklch(0.5_0.09_152)] dark:text-[oklch(0.8_0.09_150)]" /> : null}
          {section.label}
        </span>
        <SlidingTabs
          key={section.id}
          label={`Pestañas de ${section.label}`}
          items={section.subtabs.map((t) => ({
            id: t.id,
            href: t.href,
            label: t.label,
            badge:
              t.id === "solicitudes" ? (
                <PendingRequestsBadge initialCount={pendingRequests} canViewChannels={canViewChannels} className="ml-1.5" />
              ) : null,
          }))}
          active={meta.subtab}
        />
      </div>
    );
  }

  // Una ficha: el camino de vuelta.
  if (meta.kind === "sub") {
    const crumbs: Array<{ label: string; href?: string }> = [];
    if (section) crumbs.push({ label: section.label, href: section.href });
    else if (moreRow) crumbs.push({ label: moreRow.label, href: moreRow.href });
    if (meta.parent && meta.parent.label !== crumbs[0]?.label) crumbs.push({ label: meta.parent.label, href: meta.parent.href });
    crumbs.push({ label: meta.title });
    return (
      <nav aria-label="Estás en" className="flex min-w-0 flex-1 items-center gap-1 text-[14px]">
        {Icon ? <Icon size={16} className="mr-1 shrink-0 text-muted-foreground" /> : null}
        {crumbs.map((c, i) => (
          <React.Fragment key={`${c.label}-${i}`}>
            {i > 0 ? <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" aria-hidden /> : null}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="truncate rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="truncate px-1.5 font-semibold" aria-current="page">
                {c.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </nav>
    );
  }

  // Una pantalla suelta (Unidades, Avisos…).
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold tracking-tight">
      {Icon ? <Icon size={17} className="shrink-0 text-[oklch(0.5_0.09_152)] dark:text-[oklch(0.8_0.09_150)]" /> : null}
      <span className="truncate">{meta.title}</span>
    </div>
  );
}

type TabItem = { id: string; href: string; label: string; badge?: React.ReactNode };

const FADE_MASK = {
  end: "linear-gradient(to right, #000 calc(100% - 36px), transparent)",
  start: "linear-gradient(to left, #000 calc(100% - 36px), transparent)",
  both: "linear-gradient(to right, transparent, #000 36px, #000 calc(100% - 36px), transparent)",
} as const;

/** Pestañas tipo control segmentado, con una pastilla que se desliza entre ellas. */
function SlidingTabs({ items, active, label }: { items: TabItem[]; active: string | null; label: string }) {
  const pathname = useShellPathname();
  const [pendingState, setPendingState] = React.useState<{ id: string; path: string } | null>(null);
  const pending = pendingState && pendingState.path === pathname ? pendingState.id : null;
  const shown = pending ?? active;
  const rowRef = React.useRef<HTMLElement>(null);
  const [box, setBox] = React.useState<{ x: number; w: number } | null>(null);
  // Si las pestañas no entran, la fila scrollea: un degradé en el borde avisa que hay más.
  const [fade, setFade] = React.useState<"none" | "start" | "end" | "both">("none");

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const find = () => (shown ? row.querySelector<HTMLElement>(`[data-tab="${shown}"]`) : null);
    const updateFade = () => {
      const over = row.scrollWidth > row.clientWidth + 1;
      const atStart = row.scrollLeft <= 1;
      const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
      setFade(!over ? "none" : atStart ? "end" : atEnd ? "start" : "both");
    };
    const measure = () => {
      const el = find();
      const next = el ? { x: el.offsetLeft, w: el.offsetWidth } : null;
      setBox((prev) => (prev && next && prev.x === next.x && prev.w === next.w ? prev : next));
      updateFade();
    };
    measure();
    // Con la ventana angosta la fila scrollea: la pestaña elegida queda a la vista.
    const el = find();
    if (el) {
      const pad = 8;
      if (el.offsetLeft < row.scrollLeft) row.scrollLeft = Math.max(0, el.offsetLeft - pad);
      else if (el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = el.offsetLeft + el.offsetWidth - row.clientWidth + pad;
      }
    }
    updateFade();
    row.addEventListener("scroll", updateFade, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(row);
    return () => {
      row.removeEventListener("scroll", updateFade);
      ro?.disconnect();
    };
  }, [shown, items]);

  return (
    <nav
      ref={rowRef}
      aria-label={label}
      className="no-scrollbar relative flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-black/[0.045] p-1 dark:bg-white/[0.07]"
      style={fade === "none" ? undefined : { maskImage: FADE_MASK[fade], WebkitMaskImage: FADE_MASK[fade] }}
    >
      {box ? (
        <span
          aria-hidden
          className="lg-subtabs-indicator absolute top-1 bottom-1 left-0 rounded-full bg-background shadow-[0_1px_2px_rgba(22,46,36,0.12),0_4px_12px_-6px_rgba(22,46,36,0.25)] dark:bg-white/[0.13]"
          style={{ transform: `translate3d(${box.x}px,0,0)`, width: box.w }}
        />
      ) : null}
      {items.map((t) => {
        const on = t.id === shown;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={t.id === active ? "page" : undefined}
            data-tab={t.id}
            onClick={() => {
              if (t.id !== shown) setPendingState({ id: t.id, path: pathname });
            }}
            className={cn(
              "relative z-[1] flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13.5px] whitespace-nowrap transition-colors duration-150",
              on ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.badge}
          </Link>
        );
      })}
    </nav>
  );
}
