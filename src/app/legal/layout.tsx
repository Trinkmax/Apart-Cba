import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            rentOS
          </Link>
          <nav className="text-xs sm:text-sm text-muted-foreground flex gap-4">
            <Link href="/legal/privacidad" className="hover:text-foreground">
              Privacidad
            </Link>
            <Link href="/legal/terminos" className="hover:text-foreground">
              Términos
            </Link>
            <Link href="/legal/eliminacion-de-datos" className="hover:text-foreground">
              Eliminación de datos
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">{children}</main>
      <footer className="border-t border-border mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>© {new Date().getFullYear()} rentOS · Gestión de departamentos temporales</span>
          <span>Córdoba, Argentina</span>
        </div>
      </footer>
    </div>
  );
}
