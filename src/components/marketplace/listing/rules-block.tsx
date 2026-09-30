import { CalendarX2, ScrollText } from "lucide-react";
import { cancellationCopy } from "@/lib/marketplace/display";
import type { CancellationPolicy } from "@/lib/types/database";
import { DescriptionBlock } from "./description-block";

/** Reglas de la casa (texto del equipo) y política de cancelación. */
export function RulesBlock({
  houseRules,
  policy,
  cancellationText,
}: {
  houseRules: string | null;
  policy: CancellationPolicy | null;
  /** Texto propio de Configuración → Web y cobros (reemplaza al de la política). */
  cancellationText: string | null;
}) {
  const cancel = cancellationCopy(policy, cancellationText);
  const rules = houseRules?.trim() ? houseRules : null;
  return (
    <div className="grid gap-4">
      {rules ? (
        <div className="rounded-3xl bg-paper p-5 ring-1 ring-cream-300 sm:p-6">
          <p className="flex items-center gap-2 font-bold text-forest-700">
            <ScrollText className="size-5 shrink-0" aria-hidden />
            Reglas de la casa
          </p>
          <div className="mt-3">
            <DescriptionBlock text={rules} />
          </div>
        </div>
      ) : null}
      <div className="rounded-3xl bg-paper p-5 ring-1 ring-cream-300 sm:p-6">
        <p className="flex items-center gap-2 font-bold text-forest-700">
          <CalendarX2 className="size-5 shrink-0" aria-hidden />
          {cancel.title}
        </p>
        <p className="mt-2 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-700">{cancel.body}</p>
      </div>
    </div>
  );
}
