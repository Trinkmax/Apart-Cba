import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import type { ResultByChannel } from "@/lib/actions/results";
import { RESULT_BUCKET_META } from "./results-meta";
import { CurrencyChip, Deduction, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Por canal: cuánto vendió cada plataforma y cuánto se llevó. El "% efectivo"
 * es el promedio ponderado por importe: si una reserva tiene un % corregido a
 * mano, acá se nota.
 */
export function ResultsByChannelTable({
  rows,
  multiCurrency,
}: {
  rows: ResultByChannel[];
  multiCurrency: boolean;
}) {
  return (
    <ResultsSection
      title="Por canal"
      subtitle="Qué vendió cada plataforma y qué se llevó por ello."
    >
      <ResultsTable>
        <thead>
          <tr>
            <Th>Canal</Th>
            <Th align="right">Reservas</Th>
            <Th align="right">Total</Th>
            <Th align="right">% efectivo</Th>
            <Th align="right">Comisión canal</Th>
            <Th align="right">Tu comisión</Th>
            <Th align="right">A propietarios</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const meta = BOOKING_SOURCE_META[r.source] ?? BOOKING_SOURCE_META.otro;
            return (
              <tr key={`${r.source}|${r.currency}`} className="hover:bg-muted/30 transition-colors">
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} aria-hidden />
                    <span className="font-medium">{meta.label}</span>
                    {multiCurrency && <CurrencyChip currency={r.currency} />}
                  </span>
                </Td>
                <Td align="right">{r.bookings}</Td>
                <Td align="right" className="font-semibold">{formatMoney(r.total, r.currency)}</Td>
                <Td align="right" className="text-muted-foreground">
                  {r.channel_pct_effective > 0 ? `${r.channel_pct_effective}%` : "—"}
                </Td>
                <Td align="right">
                  <Deduction value={r.channel_commission} currency={r.currency} tone={RESULT_BUCKET_META.channel.text} />
                </Td>
                <Td align="right">
                  <Deduction value={r.commission} currency={r.currency} tone={RESULT_BUCKET_META.commission.text} />
                </Td>
                <Td align="right" className={`font-semibold ${RESULT_BUCKET_META.owner.text}`}>
                  {formatMoney(r.owner_net, r.currency)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </ResultsTable>
    </ResultsSection>
  );
}
