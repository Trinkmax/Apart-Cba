"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building,
  Home,
  Sofa,
  Palmtree,
  Mountain,
  Waves,
  Castle,
  TreePine,
  ChefHat,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";
import type { TKey } from "@/lib/i18n/dict";

const CATEGORIES: Array<{
  id: string;
  labelKey: TKey;
  icon: typeof Sparkles;
  propertyType: string | null;
  vibe: string | null;
}> = [
  { id: "all", labelKey: "cat.all", icon: Sparkles, propertyType: null, vibe: null },
  { id: "apartamento", labelKey: "cat.apartamento", icon: Building, propertyType: "apartamento", vibe: null },
  { id: "casa", labelKey: "cat.casa", icon: Home, propertyType: "casa", vibe: null },
  { id: "loft", labelKey: "cat.loft", icon: Sofa, propertyType: "loft", vibe: null },
  { id: "playa", labelKey: "cat.playa", icon: Waves, propertyType: null, vibe: "playa" },
  { id: "montana", labelKey: "cat.montana", icon: Mountain, propertyType: null, vibe: "montana" },
  { id: "campo", labelKey: "cat.campo", icon: TreePine, propertyType: null, vibe: "campo" },
  { id: "ph", labelKey: "cat.ph", icon: Castle, propertyType: "ph", vibe: null },
  { id: "cabana", labelKey: "cat.cabana", icon: Palmtree, propertyType: "cabana", vibe: null },
  { id: "diseno", labelKey: "cat.diseno", icon: ChefHat, propertyType: null, vibe: "diseno" },
  { id: "eventos", labelKey: "cat.eventos", icon: PartyPopper, propertyType: null, vibe: "eventos" },
];

export function CategoryChips({ basePath = "/buscar" }: { basePath?: string }) {
  const t = useT();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeTipo = searchParams.get("tipo");
  const activeVibe = searchParams.get("vibe");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    const tick = setTimeout(onScroll, 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(tick);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // En el home, sobre el hero: variant "hero" (transparente, texto blanco).
  // En cualquier otro caso: solid bar arriba.
  const isHome = pathname === "/";
  const hero = isHome && !scrolled;

  return (
    <div
      className={cn(
        "sticky top-20 z-30 transition-all duration-300",
        hero
          ? // Transparent on hero — chips ride directly on the hero's
            // letterbox darkening (see HomeHero `top` overlay). The labels rely
            // on text-shadow + drop-shadow for legibility against the photo.
            "bg-transparent"
          : "bg-white/85 backdrop-blur-xl border-b border-neutral-200/80",
      )}
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="flex items-center gap-6 md:gap-9 overflow-x-auto no-scrollbar scroll-snap-x py-4 md:py-5 -mx-2 px-2 justify-start md:justify-center">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive =
              cat.id === "all"
                ? !activeTipo && !activeVibe
                : cat.propertyType
                  ? activeTipo === cat.propertyType
                  : cat.vibe
                    ? activeVibe === cat.vibe
                    : false;
            const next = new URLSearchParams();
            if (cat.propertyType) next.set("tipo", cat.propertyType);
            if (cat.vibe) next.set("vibe", cat.vibe);
            const href = `${basePath}${next.toString() ? `?${next}` : ""}`;

            return (
              <Link
                key={cat.id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group/chip relative flex flex-col items-center gap-1.5 min-w-fit pb-2.5 transition-colors duration-200",
                  hero
                    ? isActive
                      ? "text-white"
                      : "text-white/80 hover:text-white"
                    : isActive
                      ? "text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900",
                  // Crisp label legibility against bright hero imagery.
                  hero && "[text-shadow:0_1px_4px_rgb(0_0_0/0.45)]",
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className={cn(
                    "transition-transform duration-300",
                    "group-hover/chip:scale-110",
                    isActive && "scale-110",
                    hero && "drop-shadow-[0_1px_3px_rgb(0_0_0/0.35)]",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[11.5px] font-medium whitespace-nowrap tracking-[-0.005em] transition-opacity",
                    isActive ? "opacity-100" : "opacity-95",
                  )}
                >
                  {t(cat.labelKey)}
                </span>
                {/* Animated underline — slides in for the active chip, hovers for inactive */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] rounded-full transition-all duration-300",
                    hero ? "bg-white" : "bg-neutral-900",
                    isActive
                      ? "w-full opacity-100"
                      : "w-0 opacity-0 group-hover/chip:w-1/3 group-hover/chip:opacity-40",
                  )}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
