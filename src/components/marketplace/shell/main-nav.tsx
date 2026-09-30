"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { MAIN_NAV } from "./nav";

type Variant = "desktop" | "mobile";

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
    return (
      <ul className="flex flex-col">
        {MAIN_NAV.map((item) => {
          const active = item.isActive(pathname, modo);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className="group flex min-h-14 items-center justify-between rounded-2xl px-2 text-[1.625rem] font-extrabold tracking-[-0.02em] text-forest-700 outline-none transition-colors hover:bg-forest-700/[0.05] focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
              >
                <span>
                  {item.label}
                  {active ? (
                    <span aria-hidden className="ml-1 inline-block size-2 rounded-full bg-coral-500 align-middle" />
                  ) : null}
                </span>
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
