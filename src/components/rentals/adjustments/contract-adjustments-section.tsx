import { CalendarClock, Lock, TrendingUp } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { listContractAdjustments } from "@/lib/actions/rentals-adjustments";
import { can } from "@/lib/permissions";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import { ADJUSTMENT_METHOD_LABEL } from "@/lib/rentals/labels";
import { Card } from "@/components/ui/card";
import { EmptyState, Money, SectionTitle } from "@/components/rentals/ui";
import { AdjustmentCard } from "./adjustment-card";
import { formatVariation, frequencyLabel, shortDate } from "./adjustment-text";
import type { AdjustmentView } from "./adjustment-view";

/**
 * Pestaña "Ajustes" de la ficha del contrato: cómo se actualiza, cuánto subió
 * desde el inicio y cada ajuste (lo que hay que resolver, lo que viene y lo
 * que ya rige) con las mismas tarjetas y acciones que /ajustes.
 */
export async function ContractAdjustmentsSection({ contractId }: { contractId: string }) {
  const [res, { role }] = await Promise.all([listContractAdjustments(contractId), getCurrentOrg()]);
  if (!res.ok) {
    return <Card className="p-4 text-sm text-muted-foreground border-dashed">{res.error}</Card>;
  }
  const { contract: c, items, today, autoApply } = res;
  const canEdit = can(role, "rentals", "update");

  if (c.method === "sin_ajuste") {
    return (
      <EmptyState
        icon={Lock}
        title="Este contrato no se ajusta"
        description={
          <>
            El alquiler queda fijo en <Money amount={c.currentRent} currency={c.currency} /> hasta el final del contrato.
          </>
        }
      />
    );
  }
  if (c.status === "borrador") {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Los ajustes se arman al activar el contrato"
        description="Cuando el contrato esté vigente vas a ver acá cada ajuste con su fecha, el índice que usa y el monto nuevo."
      />
    );
  }

  const index = c.indexCode && isIndexCode(c.indexCode) ? INDEX_META[c.indexCode] : null;
  const how =
    c.method === "indice" && index
      ? `${index.label} ${frequencyLabel(c.every)}${index.frequency === "monthly" ? ` · ${c.lagMonths >= 2 ? "último dato publicado" : "meses del ciclo"}` : ""}`
      : c.method === "porcentaje_fijo" && c.fixedPct != null
        ? `${formatVariation(c.fixedPct)} ${frequencyLabel(c.every)}`
        : `${ADJUSTMENT_METHOD_LABEL[c.method]} · ${frequencyLabel(c.every)}`;
  const totalPct = c.initialRent > 0 ? Math.round((c.currentRent / c.initialRent - 1) * 10000) / 100 : null;

  const toResolve = items.filter((a) => a.status === "calculado" || a.status === "pendiente_manual" || (a.status === "pendiente_indice" && a.effectiveDate <= today));
  const resolveIds = new Set(toResolve.map((a) => a.id));
  const upcoming = items.filter((a) => !resolveIds.has(a.id) && a.effectiveDate > today);
  const past = items.filter((a) => !resolveIds.has(a.id) && a.effectiveDate <= today).reverse();
  const applied = items.filter((a) => a.status === "aplicado").length;
  const next = upcoming[0] ?? null;

  const group = (title: string, list: AdjustmentView[], hint?: string, dot?: string) =>
    list.length > 0 && (
      <section className="space-y-2.5">
        <SectionTitle hint={hint} dotColor={dot}>
          {title}
        </SectionTitle>
        <div className="space-y-3">
          {list.map((a) => (
            <AdjustmentCard key={a.id} adj={a} today={today} canEdit={canEdit} showContract={false} autoApply={autoApply} />
          ))}
        </div>
      </section>
    );

  return (
    <div className="space-y-5">
      <Card className="gap-0 p-0 overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <div className="bg-card px-4 py-3 min-w-0 col-span-2 sm:col-span-1">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp size={12} /> Cómo se ajusta
            </dt>
            <dd className="text-sm font-medium mt-0.5 leading-snug">{how}</dd>
          </div>
          <div className="bg-card px-4 py-3 min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Alquiler inicial</dt>
            <dd className="text-sm font-medium mt-0.5">
              <Money amount={c.initialRent} currency={c.currency} />
            </dd>
          </div>
          <div className="bg-card px-4 py-3 min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Hoy paga</dt>
            <dd className="text-sm font-semibold mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <Money amount={c.currentRent} currency={c.currency} />
              {totalPct != null && totalPct !== 0 && <span className="text-[11px] font-normal text-muted-foreground">{formatVariation(totalPct)}</span>}
            </dd>
          </div>
          <div className="bg-card px-4 py-3 min-w-0 col-span-2 sm:col-span-1">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Ajustes</dt>
            <dd className="text-sm font-medium mt-0.5">
              {applied} de {items.length} aplicados{next ? ` · próximo ${shortDate(next.effectiveDate)}` : ""}
            </dd>
          </div>
        </dl>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Todavía no hay ajustes calculados"
          description="Se calculan solos todas las noches con los índices publicados. Si el contrato se acaba de activar, volvé en un rato."
        />
      ) : (
        <>
          {group("Para resolver", toResolve, "Ajustes que ya rigen o están por regir y necesitan que alguien haga algo.", "#f59e0b")}
          {group("Próximos", upcoming)}
          {group("Ya rigen", past)}
        </>
      )}
    </div>
  );
}
