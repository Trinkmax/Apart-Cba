import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import type { ResultByOwner } from "@/lib/actions/results";
import type { SettlementStatus } from "@/lib/types/database";
import { RESULT_BUCKET_META } from "./results-meta";
import { CurrencyChip, Deduction, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Por propietario: la respuesta directa a "¿cuánto le tengo que pagar a cada
 * uno?". El chip de estado dice si ya existe la liquidación de ese mes y
 * lleva a ella; si no existe, lleva a generarla para el período.
 */
export function ResultsByOwnerTable({
  rows,
  year,
  month,
  multiCurrency,
}: {
  rows: ResultByOwner[];
  year: number;
  month: number;
  multiCurrency: boolean;
}) {
  return (
    <ResultsSection
      title="Por propietario"
      subtitle="Lo que le queda a cada uno después de plataformas, tu comisión y la limpieza."
    >
      <ResultsTable className="min-w-[760px]">
        <thead>
          <tr>
            <Th>Propietario</Th>
            <Th>Unidades</Th>
            <Th align="right">Reservas</Th>
            <Th align="right">Total</Th>
            <Th align="right">Canal</Th>
            <Th align="right">Comisión</Th>
            <Th align="right">Limpieza</Th>
            <Th align="right">Neto</Th>
            <Th>Liquidación</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={`${r.owner_id ?? "none"}|${r.currency}`} className="hover:bg-muted/30 transition-colors">
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  {r.owner_id ? (
                    <Link href={`/dashboard/propietarios/${r.owner_id}`} className="font-medium hover:underline">
                      {r.owner_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground italic">Sin propietario asignado</span>
                  )}
                  {multiCurrency && <CurrencyChip currency={r.currency} />}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-xs text-muted-foreground">{r.unit_codes.join(", ")}</span>
              </Td>
              <Td align="right">{r.bookings}</Td>
              <Td align="right" className="font-semibold">{formatMoney(r.total, r.currency)}</Td>
              <Td align="right">
                <Deduction value={r.channel_commission} currency={r.currency} tone={RESULT_BUCKET_META.channel.text} />
              </Td>
              <Td align="right">
                <Deduction value={r.commission} currency={r.currency} tone={RESULT_BUCKET_META.commission.text} />
              </Td>
              <Td align="right">
                <Deduction value={r.cleaning} currency={r.currency} tone={RESULT_BUCKET_META.cleaning.text} />
              </Td>
              <Td align="right" className={`font-semibold ${RESULT_BUCKET_META.owner.text}`}>
                {formatMoney(r.owner_net, r.currency)}
              </Td>
              <Td>
                <SettlementChip owner={r} year={year} month={month} />
              </Td>
            </tr>
          ))}
        </tbody>
      </ResultsTable>
    </ResultsSection>
  );
}

function SettlementChip({ owner, year, month }: { owner: ResultByOwner; year: number; month: number }) {
  if (!owner.owner_id) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const s = owner.settlement;
  if (!s) {
    return (
      <Link
        href={`/dashboard/liquidaciones?tab=periodo&year=${year}&month=${month}`}
        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors whitespace-nowrap"
      >
        Sin generar <ArrowRight size={11} />
      </Link>
    );
  }
  const meta = SETTLEMENT_STATUS_META[s.status as SettlementStatus] ?? {
    label: s.status,
    color: "#64748b",
  };
  return (
    <Link
      href={`/dashboard/liquidaciones/${s.id}`}
      title={`Neto liquidado: ${formatMoney(s.net_payable, s.currency)}`}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium hover:brightness-95 transition whitespace-nowrap"
      style={{
        color: meta.color,
        borderColor: `${meta.color}55`,
        backgroundColor: `${meta.color}14`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
      {meta.label}
      <ArrowRight size={11} />
    </Link>
  );
}
