"use client";

import {
  Accessibility, AirVent, Armchair, ArrowUpDown, Baby, Bath, Bed, Building, Camera, Car, Check, ChefHat,
  Coffee, Droplets, Flame, Home, Laptop, Lock, Mountain, PawPrint, PlayCircle, Shield, Shirt, Siren, Smile,
  Sparkles, TreePalm, Trees, Tv, WashingMachine, Waves, Wifi, Wind, X, type LucideIcon,
} from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { MarketplaceAmenityCategory } from "@/lib/types/database";
import { cn } from "@/lib/utils";

// marketplace_amenities.icon guarda el nombre lucide (seed de la migración
// 016). Mapa explícito: `import * as Icons` rompería el tree-shaking.
const ICONS: Record<string, LucideIcon> = {
  Accessibility, AirVent, Armchair, ArrowUpDown, Baby, Bath, Bed, Building, Camera, Car, ChefHat, Coffee,
  Droplets, Flame, Home, Laptop, Lock, Mountain, PawPrint, PlayCircle, Shield, Shirt, Siren, Smile, Sparkles,
  TreePalm, Trees, Tv, WashingMachine, Waves, Wifi, Wind,
};

const CATEGORY_LABELS: Record<MarketplaceAmenityCategory, string> = {
  esencial: "Lo esencial",
  comodidad: "Comodidades",
  exterior: "Exterior",
  familia: "Para familias",
  seguridad: "Seguridad",
  accesibilidad: "Accesibilidad",
};
const CATEGORY_ORDER: MarketplaceAmenityCategory[] = ["esencial", "comodidad", "exterior", "familia", "seguridad", "accesibilidad"];

export interface AmenityItem {
  code: string;
  name: string;
  icon: string;
  category: MarketplaceAmenityCategory;
}

/** Cuántas se muestran antes de "Ver todas" (escritorio). */
const PREVIEW = 10;
/** En celular y tablet (< lg), menos: 3 filas de a 2 (el resto, en "Ver las N"). */
const PREVIEW_COMPACT = 6;

/**
 * En la grilla de la ficha, por debajo de lg cada comodidad es una baldosa
 * (fondo papel, de a 2 por fila). En el diálogo, siempre un renglón.
 */
const TILE =
  "max-lg:min-h-14 max-lg:gap-2.5 max-lg:rounded-2xl max-lg:bg-paper max-lg:px-3 max-lg:py-2 max-lg:ring-1 max-lg:ring-cream-300";

function AmenityRow({ a, className }: { a: AmenityItem; className?: string }) {
  const Icon = ICONS[a.icon] ?? Check;
  return (
    <li className={cn("flex items-center gap-3 py-1.5", className)}>
      <Icon className="size-5 shrink-0 text-forest-600" strokeWidth={1.75} aria-hidden />
      <span className="text-[0.9375rem] text-ink-900 max-lg:text-[0.875rem] max-lg:leading-snug">{a.name}</span>
    </li>
  );
}

/** Comodidades de la unidad con íconos; "Ver todas" abre el listado por categoría. */
export function AmenitiesBlock({ amenities }: { amenities: AmenityItem[] }) {
  if (amenities.length === 0) return null;
  const preview = amenities.slice(0, PREVIEW);
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: amenities.filter((a) => a.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-1 max-lg:gap-2 max-sm:grid-cols-2 sm:grid-cols-2">
        {preview.map((a, i) => (
          <AmenityRow key={a.code} a={a} className={cn(TILE, i >= PREVIEW_COMPACT && "max-lg:hidden")} />
        ))}
      </ul>
      {amenities.length > PREVIEW_COMPACT ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={cn(
                "mt-5 inline-flex h-11 items-center rounded-full border border-forest-700/25 bg-paper/60 px-5 font-apart text-[0.9375rem] font-semibold text-forest-700 transition-colors hover:border-forest-700/45 hover:bg-paper focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                "max-lg:mt-4 max-lg:w-full max-lg:justify-center",
                // En escritorio el botón existe sólo si hay más de PREVIEW (como siempre).
                amenities.length <= PREVIEW && "lg:hidden",
              )}
            >
              Ver las {amenities.length} comodidades
            </button>
          </DialogTrigger>
          <DialogContent
            showCloseButton={false}
            className="max-h-[85dvh] overflow-y-auto rounded-3xl border-cream-300 bg-paper p-0 font-apart sm:max-w-lg"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cream-300 bg-paper/95 px-6 py-4 backdrop-blur-md">
              <div>
                <DialogTitle className="font-apart text-lg font-extrabold text-forest-700">Comodidades</DialogTitle>
                <DialogDescription className="text-[0.8125rem] text-ink-500">Todo lo que tiene este lugar.</DialogDescription>
              </div>
              <DialogClose
                aria-label="Cerrar"
                className="flex size-11 items-center justify-center rounded-full text-forest-700 hover:bg-forest-700/[0.06] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
              >
                <X className="size-5" aria-hidden />
              </DialogClose>
            </div>
            <div className="space-y-6 px-6 pt-4 pb-7">
              {grouped.map((g) => (
                <section key={g.cat}>
                  <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">{CATEGORY_LABELS[g.cat]}</h3>
                  <ul className="mt-2 divide-y divide-cream-200">
                    {g.items.map((a) => (
                      <AmenityRow key={a.code} a={a} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
