"use client";

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
  return (
    <nav aria-label="Textos legales" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
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
