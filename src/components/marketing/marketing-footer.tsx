import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const LINKS = [
  { href: "/legal/terminos", label: "Términos" },
  { href: "/legal/privacidad", label: "Privacidad" },
  { href: "/login", label: "Ingresar" },
] as const;

export function MarketingFooter() {
  return (
    <footer className="border-t border-border px-5 py-10 md:px-8">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-2">
          <Logo brand="rentos" variant="dark" size="sm" className="self-start" />
          <p className="text-xs text-muted-foreground">
            Software de gestión para alquileres temporarios. Hecho en Córdoba, Argentina.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
