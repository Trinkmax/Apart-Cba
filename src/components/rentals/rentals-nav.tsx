"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BanknoteArrowUp,
  Building,
  FileCheck,
  FilePenLine,
  HandCoins,
  KeyRound,
  LayoutGrid,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import {
  activeRentalsSection,
  RENTALS_BASE,
  RENTALS_SECTIONS,
  type RentalsNavCounts,
  type RentalsSectionKey,
} from "@/lib/rentals/nav";

const ICONS: Record<RentalsSectionKey, LucideIcon> = {
  resumen: LayoutGrid,
  contratos: FilePenLine,
  cobranzas: HandCoins,
  comprobantes: FileCheck,
  ajustes: TrendingUp,
  rendiciones: BanknoteArrowUp,
  propiedades: Building,
  personas: UsersRound,
};

/** Qué pestañas llevan contador y cómo se lee (rosa = deuda, ámbar = para revisar, violeta = ajustes). */
const BADGES: Partial<Record<RentalsSectionKey, { tone: string; describe: (n: number) => string }>> = {
  cobranzas: {
    tone: "bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
    describe: (n) => `${n} ${n === 1 ? "inquilino con deuda vencida" : "inquilinos con deuda vencida"}`,
  },
  comprobantes: {
    tone: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    describe: (n) => `${n} para revisar`,
  },
  ajustes: {
    tone: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    describe: (n) => `${n} ${n === 1 ? "ajuste para confirmar o avisar" : "ajustes para confirmar o avisar"}`,
  },
};

/**
 * Barra de pestañas del módulo Tradicionales. El menú lateral tiene una sola
 * entrada; acá se recorren las secciones. Las fichas marcan su sección (un
 * contrato → Contratos) y los contadores llegan por streaming: la barra se
 * pinta al instante y los números aparecen apenas están, sin frenar la página.
 */
export function RentalsNav({ counts }: { counts: Promise<RentalsNavCounts> }) {
  const pathname = usePathname();
  const active = activeRentalsSection(pathname);
  const listRef = useRef<HTMLUListElement>(null);
  const firstRun = useRef(true);
  // Qué bordes tienen más pestañas escondidas: ahí (y sólo ahí) se esfuma.
  const [edges, setEdges] = useState({ left: false, right: false });
  const frame = useRef(0);

  function measureEdges() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const left = list.scrollLeft > 4;
      const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 4;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    });
  }

  // En el celular la barra se desliza: la pestaña activa queda a la vista.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (list && el && list.scrollWidth > list.clientWidth) {
      const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, left), behavior: firstRun.current ? "auto" : "smooth" });
    }
    firstRun.current = false;
    measureEdges();
  }, [active]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => measureEdges());
    ro.observe(list);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const fade = `linear-gradient(to right, transparent, #000 ${edges.left ? 24 : 0}px, #000 calc(100% - ${edges.right ? 32 : 0}px), transparent)`;

  return (
    <div className="border-b bg-background/70">
      <div className="page-x mx-auto flex max-w-[1400px] items-stretch gap-1">
        <Link
          href={RENTALS_BASE}
          className="my-2 hidden shrink-0 items-center gap-2 rounded-md pr-2 text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:flex"
        >
          <span className="flex size-6 items-center justify-center rounded-md text-white shadow-sm" style={{ backgroundColor: RENTALS_ACCENT }} aria-hidden>
            <KeyRound size={13} />
          </span>
          Tradicionales
        </Link>
        <span aria-hidden className="my-3 mr-2 hidden w-px shrink-0 bg-border md:block" />
        <nav aria-label="Secciones de Tradicionales" className="min-w-0 flex-1">
          <ul
            ref={listRef}
            onScroll={measureEdges}
            className="relative flex h-12 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={edges.left || edges.right ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
          >
            {RENTALS_SECTIONS.map((s) => {
              const Icon = ICONS[s.key];
              const isActive = s.key === active;
              const badge = BADGES[s.key];
              return (
                <li key={s.key} className="flex">
                  <Link
                    href={s.href}
                    aria-current={isActive ? "page" : undefined}
                    data-active={isActive ? "true" : undefined}
                    className={cn(
                      "relative my-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-3",
                      isActive ? "font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon size={15} className="shrink-0" style={isActive ? { color: RENTALS_ACCENT } : undefined} aria-hidden />
                    {s.label}
                    {badge && (
                      <Suspense fallback={null}>
                        <CountBadge counts={counts} section={s.key as keyof RentalsNavCounts} tone={badge.tone} describe={badge.describe} />
                      </Suspense>
                    )}
                    <span
                      aria-hidden
                      className={cn("absolute inset-x-2 -bottom-1.5 h-0.5 rounded-full transition-opacity", isActive ? "opacity-100" : "opacity-0")}
                      style={{ backgroundColor: RENTALS_ACCENT }}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function CountBadge({
  counts,
  section,
  tone,
  describe,
}: {
  counts: Promise<RentalsNavCounts>;
  section: keyof RentalsNavCounts;
  tone: string;
  describe: (n: number) => string;
}) {
  const n = use(counts)[section];
  if (!n) return null;
  return (
    <span title={describe(n)} className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums", tone)}>
      <span aria-hidden>{n > 99 ? "99+" : n}</span>
      <span className="sr-only">{describe(n)}</span>
    </span>
  );
}
