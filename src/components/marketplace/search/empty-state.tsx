import { CalendarDays, FilterX } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ArchShape, BrandDot } from "@/components/marketplace/brand/brand-shapes";
import { WhatsAppIcon } from "@/components/marketplace/shell/whatsapp-icon";
import { cn } from "@/lib/utils";

/**
 * Sin resultados: arco de la marca, qué pasó y qué hacer (quitar filtros,
 * cambiar fechas o escribirnos para que busquemos nosotros).
 */
export function SearchEmptyState({
  onClearFilters,
  onChangeDates,
  whatsappUrl,
  title = "No encontramos lugar con esos filtros",
  description = "Probá sacando algún filtro o con otras fechas. Si no, escribinos y buscamos con vos.",
  className,
}: {
  onClearFilters?: (() => void) | null;
  onChangeDates?: (() => void) | null;
  whatsappUrl?: string | null;
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center font-apart max-lg:py-8", className)}>
      <ArchShape className="relative grid h-28 w-24 place-items-end justify-center bg-leaf-200 pb-4">
        <span aria-hidden className="absolute -right-1 top-3 size-4 rounded-full bg-coral-500" />
        <span aria-hidden className="h-10 w-9 rounded-t-full bg-forest-700/85" />
      </ArchShape>
      <h2 className="mt-6 text-2xl font-extrabold tracking-[-0.025em] text-forest-700 sm:text-[1.75rem]">
        {title}
        <BrandDot />
      </h2>
      <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-ink-600">{description}</p>

      {onClearFilters || onChangeDates ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {onClearFilters ? (
            <ApartButton type="button" variant="secondary" onClick={onClearFilters}>
              <FilterX aria-hidden />
              Quitar filtros
            </ApartButton>
          ) : null}
          {onChangeDates ? (
            <ApartButton type="button" variant="secondary" onClick={onChangeDates}>
              <CalendarDays aria-hidden />
              Cambiar fechas
            </ApartButton>
          ) : null}
        </div>
      ) : null}

      {whatsappUrl ? (
        <div className="mt-8 w-full rounded-3xl bg-paper p-5 shadow-apart-sm ring-1 ring-cream-300">
          <p className="text-[0.9375rem] font-bold text-forest-700">Escribinos y te ayudamos a encontrar lugar.</p>
          <p className="mt-1 text-[0.875rem] text-ink-600">
            Conocemos cada departamento: contanos fechas y cuántos son.
          </p>
          <ApartButton asChild variant="soft" className="mt-4">
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="size-5" />
              Escribinos por WhatsApp
            </a>
          </ApartButton>
        </div>
      ) : null}
    </div>
  );
}
