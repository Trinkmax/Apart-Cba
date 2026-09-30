import Link from "next/link";
import { Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArchShape, BrandDot } from "@/components/marketplace/brand/brand-shapes";

/**
 * Ficha que no existe o ya no se publica (unidad pausada, link viejo, slug mal
 * escrito). Se ve adentro del layout de la web.
 */
export default function ListingNotFound() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div aria-hidden className="relative flex h-36 w-32 items-end justify-center">
          <ArchShape className="absolute inset-0 rounded-b-2xl bg-leaf-200" />
          <ApartLogo variant="symbol" title={null} className="relative mb-7 h-16 text-forest-700" />
        </div>
        <h1 className="mt-8 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]">
          Este departamento ya no está disponible
          <BrandDot />
        </h1>
        <p className="mt-4 font-apart-serif text-xl italic leading-snug text-forest-600">
          Tu lugar en Córdoba, por el tiempo que necesites.
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-700">
          Puede que el link sea viejo o que lo hayamos pausado por un tiempo. Tenemos otros lugares para vos.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <ApartButton asChild variant="cta" size="lg" className="w-full sm:w-auto">
            <Link href="/buscar">
              <Search aria-hidden />
              Ver otros lugares
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
