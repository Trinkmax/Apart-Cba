import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { ORPHAN_REASON_LABEL, shortDate, shortPeriodLabel } from "@/lib/finance/results-issues";
import type { OrphanRow } from "@/lib/finance/results-reconciliation";
import { cn } from "@/lib/utils";
import { CurrencyChip, ResultsTable, Td, Th } from "./results-table";

/**
 * Pestaña "En la liquidación sin reserva": filas de las liquidaciones del mes
 * que no se pudieron atar a ninguna reserva del calendario (DF-PH TRANDICIONAL,
 * $548.000 por mes sin reserva). No suman en ninguna fila del detalle, pero sí
 * en la liquidación: por eso van en el puente de la vista por propietario.
 *
 * Todas son del período que se está mirando (la conciliación sólo lista
 * huérfanas del mes), así que el período sale de `year`/`month`.
 */
export function ResultsOrphanRowsTable({
  orphans,
  year,
  month,
  baseCurrency,
}: {
  orphans: OrphanRow[];
  year?: number;
  month?: number;
  baseCurrency?: string;
}) {
  const period = year !== undefined && month !== undefined ? shortPeriodLabel(year, month) : null;
  const sorted = [...orphans].sort(
    (a, b) =>
      Math.abs(b.revenue) - Math.abs(a.revenue) ||
      a.owner_name.localeCompare(b.owner_name) ||
      a.key.localeCompare(b.key),
  );

  return (
    <ResultsTable height="tall" stickyFirstCol className="min-w-[960px]">
      <thead>
        <tr>
          <Th className="left-0 z-20">Liquidación</Th>
          <Th>Depto</Th>
          <Th>Huésped</Th>
          <Th>Fechas</Th>
          <Th align="right">Ingreso</Th>
          <Th align="right">Neto</Th>
          <Th>Motivo</Th>
          <Th>Reserva</Th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
              Todas las filas de reservas de las liquidaciones del mes tienen su reserva en el calendario.
            </td>
          </tr>
        ) : (
          sorted.map((o) => {
            const status = SETTLEMENT_STATUS_META[o.settlement_status];
            const showChip = baseCurrency !== undefined && o.currency !== baseCurrency;
            return (
              <tr key={o.key} className="group hover:bg-muted/30 transition-colors">
                <Td className="sticky left-0 z-[1] bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_30%,var(--card))]">
                  <Link
                    href={`/dashboard/liquidaciones/${o.settlement_id}`}
                    aria-label={`Abrir liquidación de ${o.owner_name}${period ? ` de ${period}` : ""}`}
                    className="block hover:underline"
                  >
                    <span className="block whitespace-nowrap font-medium">{o.owner_name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                      {period && <span>{period}</span>}
                      <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: status?.color }}
                          aria-hidden
                        />
                        {status?.label ?? o.settlement_status}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  {o.unit_code && o.unit_id ? (
                    <Link
                      href={`/dashboard/unidades/${o.unit_id}`}
                      aria-label={`Abrir unidad ${o.unit_code}`}
                      className="font-mono text-xs font-semibold whitespace-nowrap hover:underline"
                    >
                      {o.unit_code}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td>
                  <span
                    className={cn(
                      "block max-w-[14rem] truncate whitespace-nowrap",
                      !o.guest_name && "text-muted-foreground italic",
                    )}
                  >
                    {o.guest_name ?? "Sin huésped"}
                  </span>
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {o.check_in || o.check_out ? (
                    <>
                      {o.check_in ? shortDate(o.check_in) : "—"} → {o.check_out ? shortDate(o.check_out) : "—"}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td align="right" className="font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {formatMoney(o.revenue, o.currency)}
                    {showChip && <CurrencyChip currency={o.currency} />}
                  </span>
                </Td>
                <Td align="right" className="text-emerald-700 dark:text-emerald-300">
                  {formatMoney(o.net, o.currency)}
                </Td>
                <Td>
                  <span className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-300">
                    {ORPHAN_REASON_LABEL[o.reason]}
                  </span>
                </Td>
                <Td>
                  <OrphanBookingLinks orphan={o} />
                </Td>
              </tr>
            );
          })
        )}
      </tbody>
    </ResultsTable>
  );
}

function OrphanBookingLinks({ orphan }: { orphan: OrphanRow }) {
  if (orphan.booking_id) {
    return (
      <Link
        href={`/dashboard/reservas/${orphan.booking_id}`}
        aria-label={`Abrir reserva${orphan.guest_name ? ` de ${orphan.guest_name}` : ""}`}
        className="text-xs font-medium whitespace-nowrap hover:underline"
      >
        Abrir reserva
      </Link>
    );
  }
  if (orphan.reason === "ambigua" && orphan.candidate_booking_ids.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
        {orphan.candidate_booking_ids.map((id, i) => (
          <Link
            key={id}
            href={`/dashboard/reservas/${id}`}
            aria-label={`Abrir reserva candidata ${i + 1}`}
            className="font-medium hover:underline"
          >
            Reserva {i + 1}
          </Link>
        ))}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
