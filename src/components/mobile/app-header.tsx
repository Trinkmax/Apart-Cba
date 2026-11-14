"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { LiveIndicator } from "@/components/realtime/live-indicator";
import type { Notification, UserRole } from "@/lib/types/database";
import { routeMeta, screenTitle, type ScreenLink, type ShellContext } from "./routes";
import { usePreviousScreen, useShellPathname } from "./shell-store";

/*
 * La barra de arriba del celular (nov-2026), a la manera de iOS:
 * - Arriba de todo es transparente y sin título: el h1 de cada página hace de
 *   «título grande». Cuando ese h1 se va para arriba, el título aparece chico
 *   en el centro y la barra se vuelve vidrio (`data-title`, `data-scrolled`).
 * - En una sub-pantalla (una ficha, un detalle): «‹ {pantalla anterior}».
 * - A la derecha, la campana de avisos y el puntito de "en vivo".
 * - Debajo, en las pantallas de una sección, la fila de sub-pestañas.
 * Mide 3.5 rem como la TopBar de siempre: los `top-[3.5rem]` siguen sirviendo.
 * En la compu no se ve.
 */

export type AppHeaderProps = {
  role: UserRole;
  rentalsEnabled: boolean;
  notifications: Notification[];
  unreadCount: number;
  /** Números en las sub-pestañas (Solicitudes sin responder). */
  subtabBadges?: Record<string, number>;
};

export function AppHeader({ role, rentalsEnabled, notifications, unreadCount, subtabBadges }: AppHeaderProps) {
  const pathname = useShellPathname();
  const ctx = React.useMemo<ShellContext>(() => ({ role, rentalsEnabled }), [role, rentalsEnabled]);
  const meta = React.useMemo(() => routeMeta(pathname, ctx), [pathname, ctx]);
  const ref = React.useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = React.useState(false);
  // El título chico de cada pantalla: atado a la ruta, así al cambiar de
  // pantalla arranca escondido sin tener que resetearlo en un efecto.
  const [titleState, setTitleState] = React.useState<{ path: string; visible: boolean } | null>(null);
  const titleVisible = meta.fullHeight || (titleState?.path === pathname && titleState.visible);

  // Vidrio cuando el contenido pasa por debajo (la ventana es la que scrollea).
  React.useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setScrolled(window.scrollY > 4);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // El título chico aparece cuando el h1 de la página sale de vista. La página
  // llega después que la barra: se busca el h1 un ratito y se lo observa.
  React.useEffect(() => {
    if (meta.fullHeight) return;
    const path = pathname;
    let io: IntersectionObserver | null = null;
    let tries = 0;
    let timer = 0;
    const attach = () => {
      const h1 = document.querySelector<HTMLElement>("[data-shell-main] h1");
      if (!h1) {
        if (++tries < 12) timer = window.setTimeout(attach, 120);
        else setTitleState({ path, visible: true });
        return;
      }
      const offset = ref.current?.getBoundingClientRect().height ?? 56;
      io = new IntersectionObserver(
        ([entry]) =>
          setTitleState({ path, visible: !entry.isIntersecting && entry.boundingClientRect.top < offset }),
        { rootMargin: `-${Math.round(offset)}px 0px 0px 0px`, threshold: 0 },
      );
      io.observe(h1);
    };
    timer = window.setTimeout(attach, 0);
    return () => {
      window.clearTimeout(timer);
      io?.disconnect();
    };
  }, [pathname, meta.fullHeight]);

  return (
    <header
      ref={ref}
      className="lg-appheader sticky top-0 z-30 md:hidden"
      style={{ paddingTop: "var(--safe-t)" }}
      data-scrolled={scrolled || meta.fullHeight ? "" : undefined}
      data-title={titleVisible ? "" : undefined}
      // Los lee mobile-shell.css con `~` sobre el <main> hermano (vienen ya en el HTML del servidor).
      data-subtabs={meta.subtabs.length > 1 ? "" : undefined}
      data-fullheight={meta.fullHeight ? "" : undefined}
    >
      <div className="relative flex h-[var(--appbar-h)] items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center">
          {meta.kind === "sub" ? <BackButton parent={meta.parent} ctx={ctx} /> : null}
        </div>
        <div className="lg-appheader-title pointer-events-none absolute inset-x-24 flex justify-center">
          <span className="truncate text-[17px] font-semibold tracking-tight text-foreground">{meta.title}</span>
        </div>
        <div className="flex flex-1 items-center justify-end gap-0.5">
          <LiveIndicator className="mr-1" />
          <NotificationsBell initialNotifications={notifications} initialUnreadCount={unreadCount} />
        </div>
      </div>
      {meta.subtabs.length > 1 ? (
        <SectionTabs subtabs={meta.subtabs} active={meta.subtab} badges={subtabBadges} />
      ) : null}
    </header>
  );
}

/**
 * «‹ {pantalla anterior}». Si en esta visita hubo una pantalla antes, vuelve
 * ahí (`router.back()`) y dice cuál; si no (llegó por link directo), lleva al
 * padre estructural. Es un link de verdad: antes del JS también funciona.
 */
function BackButton({ parent, ctx }: { parent: { href: string; label: string } | null; ctx: ShellContext }) {
  const router = useRouter();
  const previous = usePreviousScreen();
  if (!previous && !parent) return null;
  const label = previous ? screenTitle(previous.pathname, ctx) : parent!.label;
  const href = previous ? `${previous.pathname}${previous.search}` : parent!.href;
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (!previous) return;
        e.preventDefault();
        haptic("selection");
        router.back();
      }}
      className="lg-icon-btn -ml-1 flex h-10 max-w-[42vw] items-center gap-0.5 rounded-full pr-2.5 pl-1 text-[16px] font-medium text-[oklch(0.43_0.085_152)] dark:text-[oklch(0.86_0.09_150)]"
    >
      <ChevronLeft className="size-6 shrink-0" strokeWidth={2.4} aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * Las sub-pestañas de una sección: pastillas con un indicador de vidrio que
 * se desliza con el resorte de iOS. Scroll horizontal si no entran; la elegida
 * siempre queda a la vista.
 */
function SectionTabs({
  subtabs,
  active,
  badges,
}: {
  subtabs: ScreenLink[];
  active: string | null;
  badges?: Record<string, number>;
}) {
  const pathname = useShellPathname();
  // La sub-pestaña tocada se enciende ya y vale sólo en la ruta donde se tocó.
  const [pendingState, setPendingState] = React.useState<{ id: string; path: string } | null>(null);
  const pending = pendingState && pendingState.path === pathname ? pendingState.id : null;
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState<{ x: number; w: number } | null>(null);
  const shown = pending ?? active;

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const el = row.querySelector<HTMLElement>(`[data-subtab="${shown}"]`);
      if (!el) {
        setIndicator(null);
        return;
      }
      setIndicator({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const el = row.querySelector<HTMLElement>(`[data-subtab="${shown}"]`);
    if (el) {
      const left = el.offsetLeft - 16;
      const right = el.offsetLeft + el.offsetWidth + 16;
      if (left < row.scrollLeft) row.scrollTo({ left, behavior: "smooth" });
      else if (right > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right - row.clientWidth, behavior: "smooth" });
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [shown, subtabs]);

  return (
    <nav aria-label="Sub-secciones" className="relative">
      <div
        ref={rowRef}
        className="no-scrollbar relative flex h-[2.875rem] items-center gap-1 overflow-x-auto px-3 pb-1.5"
      >
        {indicator ? (
          <span
            aria-hidden
            className="lg-subtabs-indicator lg-surface absolute top-[3px] left-0 h-[34px] rounded-full"
            style={{ transform: `translate3d(${indicator.x}px,0,0)`, width: indicator.w }}
          />
        ) : null}
        {subtabs.map((s) => {
          const on = s.id === shown;
          const badge = badges?.[s.id];
          return (
            <Link
              key={s.id}
              href={s.href}
              data-subtab={s.id}
              aria-current={s.id === active ? "page" : undefined}
              onClick={() => {
                if (s.id !== shown) {
                  haptic("selection");
                  setPendingState({ id: s.id, path: pathname });
                }
              }}
              className={cn(
                "relative z-[1] flex h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] whitespace-nowrap transition-colors duration-150 select-none [-webkit-tap-highlight-color:transparent]",
                on ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {s.label}
              {badge ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#e5533d] px-1 text-[11px] font-bold text-white tabular-nums">
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
