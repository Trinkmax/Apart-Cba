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
          : "bg-white/95 backdrop-blur-md border-b border-neutral-200"
      )}
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="flex items-center gap-8 overflow-x-auto py-5 scrollbar-hide -mx-2 px-2 justify-center">
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

            const inactiveClass = hero
              ? "border-transparent text-white/65 hover:text-white"
              : "border-transparent text-neutral-500 hover:text-neutral-900";
            const activeClass = hero
              ? "border-white text-white"
              : "border-neutral-900 text-neutral-900";

            return (
              <Link
                key={cat.id}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1.5 min-w-fit pb-2 -mb-px border-b-2 transition-all",
                  isActive ? activeClass : inactiveClass
                )}
              >
                <Icon size={22} strokeWidth={1.5} />
                <span className="text-[11px] font-medium whitespace-nowrap">{cat.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
