import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import type { SettledOwnerRow } from "@/lib/settlements/settled-model";
import { RESULT_BUCKET_META } from "./results-meta";
import { CurrencyChip, Deduction, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Por propietario, según la liquidación: cuánto produjo, qué se le descontó y
 * cuánto se le transfirió. A diferencia de la tabla de proyección —que estima
 * desde las reservas—, acá los números son los del documento que el propietario
 * recibe, así que incluyen los gastos y ajustes cargados a mano.
 */
export function ResultsSettledByOwnerTable({
  rows,
  multiCurrency,
}: {
  rows: SettledOwnerRow[];
  multiCurrency: boolean;
}) {
  const hasChannel = rows.some((r) => r.channel > 0);

  return (
    <ResultsSection
      title="Por propietario"
      subtitle="Lo que se le transfirió a cada uno y qué se le descontó, según su liquidación del mes."
    >
      <ResultsTable className={hasChannel ? "min-w-[880px]" : "min-w-[800px]"}>
        <thead>
          <tr>
            <Th>Propietario</Th>
            <Th>Unidades</Th>
            <Th align="right">Ingreso bruto</Th>
            {hasChannel && <Th align="right">Plataformas</Th>}
            <Th align="right">Comisión</Th>
            <Th align="right">Gastos</Th>
            <Th align="right">A transferir</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.settlement_id} className="hover:bg-muted/30 transition-colors">
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  {r.owner_id ? (
                    <Link href={`/dashboard/propietarios/${r.owner_id}`} className="font-medium hover:underline">
                      {r.owner_name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.owner_name}</span>
                  )}
                  {multiCurrency && <CurrencyChip currency={r.currency} />}
                  {r.missing_rates.length > 0 && (
                    <span
                      title={`Hay cargos en ${r.missing_rates.join(", ")} sin tipo de cambio cargado: se están contando como 0.`}
                      className="text-amber-600 dark:text-amber-400"
                    >
                      <TriangleAlert size={12} />
                    </span>
                  )}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-xs text-muted-foreground">
                  {r.unit_codes.length > 0 ? r.unit_codes.join(", ") : "—"}
                </span>
              </Td>
              <Td align="right" className="font-semibold">
                {formatMoney(r.gross, r.currency)}
              </Td>
              {hasChannel && (
                <Td align="right">
                  <Deduction value={r.channel} currency={r.currency} tone={RESULT_BUCKET_META.channel.text} />
                </Td>
              )}
              <Td align="right">
                <Deduction value={r.commission} currency={r.currency} tone={RESULT_BUCKET_META.commission.text} />
              </Td>
              <Td align="right">
                <Deduction value={r.expenses} currency={r.currency} tone={RESULT_BUCKET_META.cleaning.text} />
              </Td>
              <Td align="right" className={cn("font-semibold", RESULT_BUCKET_META.owner.text)}>
                {formatMoney(r.net, r.currency)}
              </Td>
              <Td>
                <StatusChip row={r} />
              </Td>
            </tr>
          ))}
        </tbody>
      </ResultsTable>
    </ResultsSection>
  );
}

function StatusChip({ row }: { row: SettledOwnerRow }) {
  const meta = SETTLEMENT_STATUS_META[row.status] ?? { label: row.status, color: "#64748b" };
  return (
    <Link
      href={`/dashboard/liquidaciones/${row.settlement_id}`}
      title={row.paid_at ? "Ya pagada" : "Ver la liquidación"}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:brightness-95 transition whitespace-nowrap"
      style={{ color: meta.color, borderColor: `${meta.color}55`, backgroundColor: `${meta.color}14` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
      {meta.label}
      <ArrowRight size={11} />
    </Link>
  );
}
