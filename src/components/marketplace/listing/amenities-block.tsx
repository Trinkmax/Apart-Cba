"use client";

import {
  Accessibility, AirVent, Armchair, ArrowUpDown, Baby, Bath, Bed, Building, Camera, Car, Check, ChefHat,
  Coffee, Droplets, Flame, Home, Laptop, Lock, Mountain, PawPrint, PlayCircle, Shield, Shirt, Siren, Smile,
  Sparkles, TreePalm, Trees, Tv, WashingMachine, Waves, Wifi, Wind, X, type LucideIcon,
} from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { MarketplaceAmenityCategory } from "@/lib/types/database";

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

/** Cuántas se muestran antes de "Ver todas". */
const PREVIEW = 10;

function AmenityRow({ a }: { a: AmenityItem }) {
  const Icon = ICONS[a.icon] ?? Check;
  return (
    <li className="flex items-center gap-3 py-1.5">
      <Icon className="size-5 shrink-0 text-forest-600" strokeWidth={1.75} aria-hidden />
      <span className="text-[0.9375rem] text-ink-900">{a.name}</span>
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
      <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {preview.map((a) => (
          <AmenityRow key={a.code} a={a} />
        ))}
      </ul>
      {amenities.length > PREVIEW ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="mt-5 inline-flex h-11 items-center rounded-full border border-forest-700/25 bg-paper/60 px-5 font-apart text-[0.9375rem] font-semibold text-forest-700 transition-colors hover:border-forest-700/45 hover:bg-paper focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
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
