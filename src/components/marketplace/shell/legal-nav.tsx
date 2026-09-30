"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LEGAL_LINKS = [
  { href: "/legal/terminos", label: "Términos y condiciones" },
  { href: "/legal/privacidad", label: "Privacidad" },
  { href: "/legal/eliminacion-de-datos", label: "Eliminación de datos" },
] as const;

/** Pestañas entre los textos legales (píldoras; la actual en forest). */
export function LegalNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // En celular la fila se corta (a 360 px "Eliminación de datos" queda afuera):
  // la pestaña actual se trae a la vista moviendo sólo la fila, nunca la página.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    if (box.left >= navBox.left && box.right <= navBox.right) return;
    nav.scrollBy({ left: box.left - navBox.left - (navBox.width - box.width) / 2 });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Textos legales"
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max gap-2">
        {LEGAL_LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-full px-4 text-[0.9375rem] font-semibold outline-none transition-colors",
                  "focus-visible:ring-[3px] focus-visible:ring-forest-500/30",
                  active
                    ? "bg-forest-700 text-cream"
                    : "bg-paper text-forest-700 ring-1 ring-cream-300 hover:bg-leaf-100",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
