"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { readLastSearch, searchHrefFromListingQuery } from "@/components/marketplace/search/last-search";
import { cn } from "@/lib/utils";

/** ¿La página anterior fue la búsqueda de este mismo sitio? (sólo cargas completas) */
function cameFromSearch(): boolean {
  try {
    if (!document.referrer || window.history.length < 2) return false;
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin && ref.pathname.startsWith("/buscar");
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};
/** La última búsqueda de la pestaña o, si no hay, /buscar con las fechas de la ficha. */
const clientHref = () => readLastSearch() ?? searchHrefFromListingQuery(window.location.search);
/** En el server (la ficha es estática) no hay storage ni query: /buscar a secas. */
const serverHref = () => "/buscar";

/**
 * "← Seguir buscando": vuelve a la búsqueda con las mismas fechas, huéspedes,
 * barrio y filtros. Si la ficha se abrió con una carga completa desde /buscar,
 * vuelve atrás (conserva también el scroll).
 */
export function BackLink({ className }: { className?: string }) {
  const router = useRouter();
  const href = useSyncExternalStore(noopSubscribe, clientHref, serverHref);
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (cameFromSearch()) {
          e.preventDefault();
          router.back();
        }
      }}
      className={cn(
        "-ml-2 inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-semibold text-forest-700",
        "transition-colors hover:text-forest-800 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
        className,
      )}
    >
      <ArrowLeft className="size-4 transition-transform duration-200 motion-safe:group-hover:-translate-x-0.5" aria-hidden />
      Seguir buscando
    </Link>
  );
}
