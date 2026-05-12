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

const CATEGORIES = [
  { id: "all", label: "Todo", icon: Sparkles, propertyType: null, vibe: null },
  { id: "apartamento", label: "Departamentos", icon: Building, propertyType: "apartamento", vibe: null },
  { id: "casa", label: "Casas", icon: Home, propertyType: "casa", vibe: null },
  { id: "loft", label: "Lofts", icon: Sofa, propertyType: "loft", vibe: null },
  { id: "playa", label: "Playa", icon: Waves, propertyType: null, vibe: "playa" },
  { id: "montana", label: "Montaña", icon: Mountain, propertyType: null, vibe: "montana" },
  { id: "campo", label: "Campo", icon: TreePine, propertyType: null, vibe: "campo" },
  { id: "ph", label: "PH", icon: Castle, propertyType: "ph", vibe: null },
  { id: "cabana", label: "Cabañas", icon: Palmtree, propertyType: "cabana", vibe: null },
  { id: "diseno", label: "De diseño", icon: ChefHat, propertyType: null, vibe: "diseno" },
  { id: "eventos", label: "Para eventos", icon: PartyPopper, propertyType: null, vibe: "eventos" },
];

export function CategoryChips({ basePath = "/buscar" }: { basePath?: string }) {
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
          ? "bg-transparent"
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
                      : "text-white/55 hover:text-white"
                    : isActive
                      ? "text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900",
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className={cn(
                    "transition-transform duration-300",
                    "group-hover/chip:scale-110",
                    isActive && "scale-110",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[11.5px] font-medium whitespace-nowrap tracking-[-0.005em] transition-opacity",
                    isActive ? "opacity-100" : "opacity-90",
                  )}
                >
                  {cat.label}
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
