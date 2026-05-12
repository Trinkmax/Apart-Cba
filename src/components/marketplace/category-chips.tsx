"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const activeType = params.get("tipo");

  return (
    <div className="border-b border-neutral-200 bg-white">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="flex items-center gap-8 overflow-x-auto py-5 scrollbar-hide -mx-2 px-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive =
              (cat.id === "all" && !activeType) || activeType === cat.propertyType;
            const params = new URLSearchParams();
            if (cat.propertyType) params.set("tipo", cat.propertyType);
            const href = `${basePath}${params.toString() ? `?${params}` : ""}`;
            return (
              <Link
                key={cat.id}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1.5 min-w-fit pb-2 -mb-px border-b-2 transition-all",
                  isActive
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900"
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
