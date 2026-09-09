import Link from "next/link";
import { Info } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettledUnitRow } from "@/lib/settlements/settled-model";
import { RESULT_BUCKET_META } from "./results-meta";
import { CurrencyChip, Deduction, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Por departamento — la pregunta que no tenía respuesta en ninguna pantalla:
 * "¿cuánto produjo cada depto y cuánto terminó yendo a su dueño?". Los números
 * salen de las líneas de la liquidación (`settlement_lines.unit_id`), no de una
 * proyección: incluyen los ajustes y los gastos que se cargaron a mano.
 *
 * Una unidad con co-propietarios se liquida en un documento por cabeza; acá se
 * suman en una sola fila y se listan los dos nombres, porque lo que produjo el
 * departamento no depende de entre cuántos se reparta.
 */
export function ResultsSettledByUnitTable({
  rows,
  multiCurrency,
}: {
  rows: SettledUnitRow[];
  multiCurrency: boolean;
}) {
  const hasChannel = rows.some((r) => r.channel > 0);
  const hasInferred = rows.some((r) => r.inferred);

  return (
    <ResultsSection
      title="Por departamento"
      subtitle="Lo que produjo cada depto en el mes y lo que se le transfirió a su dueño, según la liquidación."
    >
      <ResultsTable className={hasChannel ? "min-w-[840px]" : "min-w-[760px]"}>
        <thead>
          <tr>
            <Th>Departamento</Th>
            <Th>Propietario</Th>
            <Th align="right">Ingreso bruto</Th>
            {hasChannel && <Th align="right">Plataformas</Th>}
            <Th align="right">Comisión</Th>
            <Th align="right">Gastos</Th>
            <Th align="right">A transferir</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={`${r.unit_id ?? "none"}|${r.currency}`} className="hover:bg-muted/30 transition-colors">
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-2 min-w-0">
                  {r.unit_id ? (
                    <Link href={`/dashboard/unidades/${r.unit_id}`} className="font-medium hover:underline">
                      {r.unit_code}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground italic">Sin asignar</span>
                  )}
                  {r.inferred && (
                    <span
                      title="Incluye cargos que se cargaron sin elegir departamento. Como la liquidación tiene una sola unidad, se imputaron acá."
                      className="text-muted-foreground"
                    >
                      <Info size={12} />
                    </span>
                  )}
                  {multiCurrency && <CurrencyChip currency={r.currency} />}
                </span>
                {r.unit_name && (
                  <span className="block text-[11px] text-muted-foreground truncate max-w-[220px]">{r.unit_name}</span>
                )}
              </Td>
              <Td className="whitespace-nowrap">
                <span className="text-xs text-muted-foreground">
                  {r.owners.length === 0
                    ? "—"
                    : r.owners.map((o, i) => (
                        <span key={o.owner_id ?? `x${i}`}>
                          {i > 0 && ", "}
                          {o.owner_id ? (
                            <Link href={`/dashboard/propietarios/${o.owner_id}`} className="hover:underline">
                              {o.owner_name}
                            </Link>
                          ) : (
                            o.owner_name
                          )}
                        </span>
                      ))}
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
            </tr>
          ))}
        </tbody>
      </ResultsTable>
      {hasInferred && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0" />
          Los deptos marcados incluyen cargos que se cargaron sin elegir departamento. Como esas liquidaciones
          tienen una sola unidad, se imputaron ahí.
        </p>
      )}
    </ResultsSection>
  );
}
