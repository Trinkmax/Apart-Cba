import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "#modulos", label: "Módulos" },
  { href: "#liquidaciones", label: "Liquidaciones" },
  { href: "#canales", label: "Canales" },
] as const;

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5 md:px-8">
        <Link href="/rentos" className="shrink-0" aria-label="rentOS">
          <Logo brand="rentos" variant="dark" size="sm" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <Button variant="link" size="sm" className="text-muted-foreground" asChild>
            <Link href="/login">Ingresar</Link>
          </Button>
          <Button size="sm" className="rounded-full" asChild>
            <a href="#probar">Probar el panel</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
