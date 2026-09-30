import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

/**
 * Preguntas frecuentes con `<details>` nativo: se abre con teclado, funciona
 * sin JavaScript y los buscadores leen las respuestas.
 */
export function FaqList({ items, className }: { items: FaqItem[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-cream-300 rounded-3xl bg-paper px-5 shadow-apart-sm ring-1 ring-cream-300 sm:px-8", className)}>
      {items.map((item) => (
        <details key={item.q} className="group py-1">
          <summary
            className={cn(
              "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-xl py-4 text-left",
              "text-base font-bold text-forest-700 outline-none sm:text-[1.0625rem]",
              "focus-visible:ring-[3px] focus-visible:ring-forest-500/40 [&::-webkit-details-marker]:hidden",
            )}
          >
            {item.q}
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-forest-700 transition-transform duration-300 group-open:rotate-45 group-open:bg-coral-100 group-open:text-coral-800 motion-reduce:transition-none"
            >
              <Plus className="size-4" />
            </span>
          </summary>
          <div className="pb-5 pr-2 text-[0.9375rem] leading-relaxed text-ink-700 sm:pr-12 [&_a]:font-semibold [&_a]:text-forest-700 [&_a]:underline [&_a]:decoration-forest-700/30 [&_a]:underline-offset-4 [&_p+p]:mt-3">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  );
}
