import { CalendarX2, ScrollText } from "lucide-react";
import { cancellationCopy } from "@/lib/marketplace/display";
import { descriptionBlocks } from "@/lib/marketplace/widget-quote";
import type { CancellationPolicy } from "@/lib/types/database";
import { DescriptionBlock } from "./description-block";

/**
 * "Reglas y cancelación" en una línea, para el plegable de celular y tablet:
 * "Cancelación estricta · 8 reglas de la casa". Cada renglón (o viñeta) del
 * texto del equipo cuenta como una regla; con uno solo, no se cuenta.
 */
export function rulesSummary(
  houseRules: string | null,
  policy: CancellationPolicy | null,
  cancellationText: string | null,
): string {
  const cancel = cancellationCopy(policy, cancellationText).title;
  const lines = descriptionBlocks(houseRules).reduce((n, b) => n + (b.kind === "p" ? b.lines.length : b.items.length), 0);
  if (lines === 0) return cancel;
  return `${cancel} · ${lines > 1 ? `${lines} reglas de la casa` : "reglas de la casa"}`;
}

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
