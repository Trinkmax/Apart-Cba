import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResultBookingRow } from "@/lib/actions/results";
import { RESULT_BUCKET_META } from "./results-meta";
import { Deduction, ResultsSection, ResultsTable, Td, Th } from "./results-table";

/**
 * Detalle por reserva: la misma cuenta, fila por fila, para poder auditar
 * cualquier número de arriba. Cada fila lleva al detalle de la reserva; la
 * chip "Sin precio" lleva ahí mismo porque es donde se carga el importe.
 */
export function ResultsBookingsTable({ rows }: { rows: ResultBookingRow[] }) {
  return (
    <ResultsSection
      title="Detalle por reserva"
      subtitle="Temporario: la reserva cuenta en el mes del check-out. Mensual: se prorratea la renta por los días del mes."
    >
      <ResultsTable className="min-w-[900px]">
        <thead>
          <tr>
            <Th>Fechas</Th>
            <Th>Unidad</Th>
            <Th>Huésped</Th>
            <Th>Canal</Th>
            <Th align="right">Total</Th>
            <Th align="right">Canal</Th>
            <Th align="right">Comisión</Th>
            <Th align="right">Limpieza</Th>
            <Th align="right">Neto</Th>
            <Th align="right">Cobrado</Th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const source = BOOKING_SOURCE_META[r.source] ?? BOOKING_SOURCE_META.otro;
            const href = `/dashboard/reservas/${r.booking_id}`;
            return (
              <tr
                key={r.booking_id}
                className={cn(
                  "hover:bg-muted/30 transition-colors",
                  r.missing_price && "bg-amber-500/5"
                )}
              >
                <Td>
                  <Link href={href} className="block hover:underline">
                    <span className="tabular-nums whitespace-nowrap">
                      {formatDate(r.check_in_date, "d MMM")} → {formatDate(r.check_out_date, "d MMM")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {r.mode === "mensual" && r.prorate
                        ? `Mensual · ${r.prorate.days} de ${r.prorate.of} días`
                        : r.nights === 1
                          ? "1 noche"
                          : `${r.nights} noches`}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <Link href={href} className="block hover:underline">
                    <span className="font-mono text-xs font-semibold">{r.unit_code}</span>
                    <span className="block text-[11px] text-muted-foreground truncate max-w-[160px]">{r.unit_name}</span>
                  </Link>
                </Td>
                <Td>
                  <span className={cn("block truncate max-w-[180px]", !r.guest_name && "text-muted-foreground italic")}>
                    {r.guest_name ?? "Sin huésped"}
                  </span>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: source.color }} aria-hidden />
                    <span className="text-xs">{source.label}</span>
                    {r.channel_pct > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{r.channel_pct}%</span>
                    )}
                  </span>
                </Td>
                <Td align="right" className="font-semibold">
                  {r.missing_price ? (
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:border-amber-500/70 transition-colors"
                    >
                      <AlertTriangle size={11} /> Sin precio
                    </Link>
                  ) : (
                    formatMoney(r.total, r.currency)
                  )}
                </Td>
                <Td align="right">
                  <Deduction value={r.channel_commission} currency={r.currency} tone={RESULT_BUCKET_META.channel.text} />
                </Td>
                <Td align="right">
                  <Deduction value={r.commission} currency={r.currency} tone={RESULT_BUCKET_META.commission.text} />
                  {r.commission > 0 && (
                    <span className="block text-[10px] text-muted-foreground">{r.commission_pct}%</span>
                  )}
                </Td>
                <Td align="right">
                  <Deduction value={r.cleaning} currency={r.currency} tone={RESULT_BUCKET_META.cleaning.text} />
                </Td>
                <Td align="right" className={cn("font-semibold", RESULT_BUCKET_META.owner.text)}>
                  {r.missing_price ? <span className="text-muted-foreground">—</span> : formatMoney(r.owner_net, r.currency)}
                </Td>
                <Td align="right">
                  <span className={cn(r.paid > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                    {formatMoney(r.paid, r.currency)}
                  </span>
                  {r.pending > 0 && (
                    <span className="block text-[10px] text-amber-700 dark:text-amber-300 tabular-nums">
                      faltan {formatMoney(r.pending, r.currency)}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </ResultsTable>
    </ResultsSection>
  );
}
