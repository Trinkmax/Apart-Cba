import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { monthLabelOf } from "@/lib/rentals/labels";
import { monthOf } from "@/lib/rentals/ymd";
import { cn } from "@/lib/utils";
import { monthParam, relativeMonthLabel, shiftBoardMonth } from "./board-helpers";

const BASE = "/dashboard/alquileres/cobranzas";

export function cobranzasHref(month: string): string {
  return `${BASE}?mes=${monthParam(month)}`;
}

/** ← mes → de Cobranzas (misma silueta que el de Resultados). */
export function CollectionsMonthNav({ month, today }: { month: string; today: string }) {
  const current = monthOf(today);
  const eyebrow = relativeMonthLabel(month, current);
  return (
    <div className="flex items-center gap-2">
      <nav className="inline-flex items-center gap-1 rounded-lg border bg-card p-1" aria-label="Elegir mes">
        <Link
          href={cobranzasHref(shiftBoardMonth(month, -1))}
          scroll={false}
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
          aria-label="Mes anterior"
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="min-w-[7.5rem] px-1.5 text-center">
          {eyebrow && <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-none">{eyebrow}</p>}
          <p className={cn("text-xs font-semibold leading-tight", eyebrow && "mt-0.5")}>{monthLabelOf(month)}</p>
        </div>
        <Link
          href={cobranzasHref(shiftBoardMonth(month, 1))}
          scroll={false}
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
          aria-label="Mes siguiente"
        >
          <ChevronRight size={16} />
        </Link>
      </nav>
      {month !== current && (
        <Link href={cobranzasHref(current)} scroll={false} className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
          Este mes
        </Link>
      )}
    </div>
  );
}
