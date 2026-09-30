import Link from "next/link";
import { Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArchShape } from "@/components/marketplace/brand/brand-shapes";

export const metadata = {
  title: "No encontramos esta página",
  robots: { index: false },
};

/**
 * 404 de la web (unidades despublicadas, links viejos, slugs mal escritos).
 * Se muestra adentro del layout de la web, con header y footer.
 */
export default function MarketplaceNotFound() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div aria-hidden className="relative flex h-36 w-32 items-end justify-center">
          <ArchShape className="absolute inset-0 rounded-b-2xl bg-leaf-200" />
          <ApartLogo variant="symbol" title={null} className="relative mb-7 h-16 text-forest-700" />
          <span className="absolute bottom-4 h-1.5 w-10 rounded-full bg-forest-700/15" />
        </div>

        <p className="mt-8 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">
          Error 404
        </p>
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
  );
}
