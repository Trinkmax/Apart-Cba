import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArchShape } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import { manrope, sourceSerif } from "./(marketplace)/fonts";

export const metadata: Metadata = {
  title: "No encontramos esta página · apart",
  robots: { index: false },
  // El layout raíz trae los íconos del panel; ésta es una página de la web.
  icons: {
    icon: [
      { url: "/apart/icons/apart-32.png", sizes: "32x32", type: "image/png" },
      { url: "/apart/icons/apart-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apart/icons/apart-apple-180.png", sizes: "180x180" }],
  },
};

/**
 * 404 de las URLs que no matchean ninguna ruta (/lo-que-sea, links viejos
 * tipeados a mano). El de src/app/(marketplace)/not-found.tsx sólo atiende los
 * notFound() de adentro del grupo; sin éste, Next mostraba su 404 en inglés.
 *
 * Vive fuera del layout de la web (sólo tiene el layout raíz), así que es
 * autosuficiente: carga las fuentes de apart y pone `data-apart-root` para que
 * apliquen los tokens de marca (ver globals.css). No importa el layout del
 * grupo ni lee cookies: se sirve estático.
 */
export default function NotFound() {
  return (
    <div
      data-apart-root=""
      className={cn(
        manrope.variable,
        sourceSerif.variable,
        "light font-apart flex min-h-dvh flex-col bg-cream text-ink-900 antialiased",
      )}
    >
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link
          href="/"
          aria-label="apart, ir al inicio"
          className="-ml-1 shrink-0 rounded-lg p-1 outline-none transition-opacity hover:opacity-85 focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
        >
          <ApartLogo variant="lockup" className="h-7 text-forest-700 lg:h-8" title={null} />
        </Link>
      </header>

      <main className="flex flex-1 items-center">
        <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto flex max-w-lg flex-col items-center text-center">
            <div aria-hidden className="relative flex h-36 w-32 items-end justify-center">
              <ArchShape className="absolute inset-0 rounded-b-2xl bg-leaf-200" />
              <ApartLogo variant="symbol" title={null} className="relative mb-7 h-16 text-forest-700" />
              <span className="absolute bottom-4 h-1.5 w-10 rounded-full bg-forest-700/15" />
            </div>

            <p className="mt-8 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">Error 404</p>
            <h1 className="mt-3 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]">
              Este lugar no existe (o ya no está disponible).
            </h1>
            <p className="mt-4 font-apart-serif text-xl italic leading-snug text-forest-600">
              Pero hay otros esperándote en Córdoba.
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <ApartButton asChild variant="cta" size="lg" className="w-full sm:w-auto">
                <Link href="/buscar">
                  <Search aria-hidden />
                  Buscar alojamiento
                </Link>
              </ApartButton>
              <ApartButton asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                <Link href="/">Ir al inicio</Link>
              </ApartButton>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
