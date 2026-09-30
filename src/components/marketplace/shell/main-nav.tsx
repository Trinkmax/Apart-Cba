"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight, BedDouble, CalendarRange, House, KeyRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV } from "./nav";

type Variant = "desktop" | "mobile";

/** Íconos del menú de celular (por href de MAIN_NAV). */
const MOBILE_ICONS: Record<string, LucideIcon> = {
  "/buscar": BedDouble,
  "/buscar?modo=mes": CalendarRange,
  "/como-reservar": KeyRound,
  "/propietarios": House,
};

function NavLinksView({
  pathname,
  modo,
  variant,
  onNavigate,
}: {
  pathname: string;
  modo: string | null;
  variant: Variant;
  onNavigate?: () => void;
}) {
  if (variant === "mobile") {
    // Sólo lo usa el menú de celular (la hoja se monta al abrirse, así que la
    // entrada escalonada corre cada vez que se abre).
    return (
      <ul className="flex flex-col gap-1.5">
        {MAIN_NAV.map((item, i) => {
          const active = item.isActive(pathname, modo);
          const Icon = MOBILE_ICONS[item.href] ?? ArrowUpRight;
          return (
            <li
              key={item.href}
              className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:fill-mode-[both] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ animationDelay: `${120 + i * 60}ms` }}
            >
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex min-h-16 items-center gap-4 rounded-3xl py-2 pl-2 pr-3 text-[1.5rem] font-extrabold tracking-[-0.02em] text-forest-700 outline-none transition-colors",
                  "hover:bg-forest-700/[0.05] focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                  active && "bg-paper shadow-apart-sm ring-1 ring-cream-300 hover:bg-paper",
                )}
              >
                {/* Ícono en arco (la forma de la marca); el activo, en forest. */}
                <span
                  aria-hidden
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-t-full rounded-b-xl transition-colors",
                    active ? "bg-forest-700 text-cream" : "bg-leaf-200 text-forest-700",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  {item.label}
                  {active ? (
                    <span aria-hidden className="ml-1 inline-block size-2 rounded-full bg-coral-500 align-middle" />
                  ) : null}
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="size-5 shrink-0 text-forest-600/60 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="flex items-center gap-1">
      {MAIN_NAV.map((item) => {
        const active = item.isActive(pathname, modo);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-11 items-center rounded-full px-3.5 text-[0.9375rem] font-semibold outline-none transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                active ? "text-forest-700" : "text-ink-700 hover:text-forest-700",
                // Subrayado coral fino: visible en el activo, insinuado al pasar.
                "after:absolute after:inset-x-3.5 after:bottom-2 after:h-[2px] after:origin-left after:rounded-full after:bg-coral-500 after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.22,1,0.36,1)]",
                active ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100 motion-reduce:after:transition-none",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NavLinksWithParams(props: { variant: Variant; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const modo = useSearchParams()?.get("modo") ?? null;
  return <NavLinksView pathname={pathname} modo={modo} {...props} />;
}

/**
 * Navegación principal. Lee `?modo` para marcar "Por mes" en /buscar: como
 * `useSearchParams` obliga a un límite de Suspense en páginas estáticas, el
 * fallback es la misma lista (sin el `modo`), así el HTML inicial ya la trae.
 */
export function MainNav({ variant, onNavigate }: { variant: Variant; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <Suspense fallback={<NavLinksView pathname={pathname} modo={null} variant={variant} onNavigate={onNavigate} />}>
      <NavLinksWithParams variant={variant} onNavigate={onNavigate} />
    </Suspense>
  );
}
