import { Star } from "lucide-react";
import { SnapRail } from "@/components/marketplace/brand/snap-rail";
import { cn } from "@/lib/utils";
import type { Review } from "@/lib/types/database";

/**
 * Mismo valor que MOBILE_RAIL_ITEM (brand/snap-rail). Copiado a propósito:
 * éste es un server component y un string exportado por un módulo "use client"
 * llega al server como referencia de cliente (una función), no como texto:
 * cn() lo descartaría sin avisar y la tarjeta perdería su ancho en el riel.
 */
const RAIL_ITEM = "max-lg:w-[80%] max-lg:max-w-[22rem] max-lg:shrink-0 max-lg:snap-start";

function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "America/Argentina/Cordoba" });
}

/** Reseñas reales publicadas. Sin reseñas, la sección no se muestra (la página no la monta). */
export function ReviewsBlock({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length;
  return (
    <div>
      <p className="flex items-center gap-2 text-[0.9375rem] text-ink-700">
        <Star className="size-4 fill-coral-500 stroke-coral-600" aria-hidden />
        <span className="font-bold text-forest-700 tabular-nums">{avg.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</span>
        <span>
          · {reviews.length === 1 ? "1 reseña" : `${reviews.length} reseñas`}
        </span>
      </p>
      {/* Por debajo de lg, riel con snap (la siguiente asomada); desde lg, la grilla de 2 de siempre. */}
      <SnapRail as="ul" label="Reseñas" className="mt-5 lg:grid lg:grid-cols-2 lg:gap-4">
        {reviews.slice(0, 6).map((r) => (
          <li key={r.id} className={cn("rounded-3xl bg-paper p-5 ring-1 ring-cream-300", RAIL_ITEM)}>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf-200 text-sm font-bold text-forest-700">
                {r.guest_name_snapshot.trim().charAt(0).toUpperCase() || "H"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-bold text-forest-700">{r.guest_name_snapshot}</p>
                <p className="text-xs text-ink-500">{monthYear(r.created_at)}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-0.5" aria-label={`${r.rating} de 5`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  aria-hidden
                  className={cn("size-3.5", i < r.rating ? "fill-coral-500 stroke-coral-600" : "stroke-cream-400")}
                />
              ))}
            </div>
            {r.comment ? <p className="mt-2 line-clamp-6 text-[0.9375rem] leading-relaxed text-ink-700">{r.comment}</p> : null}
            {r.host_response ? (
              <div className="mt-3 border-l-2 border-leaf-300 pl-3">
                <p className="text-xs font-bold text-forest-700">Respuesta del equipo</p>
                <p className="mt-0.5 line-clamp-4 text-[0.8125rem] text-ink-500">{r.host_response}</p>
              </div>
            ) : null}
          </li>
        ))}
      </SnapRail>
    </div>
  );
}
