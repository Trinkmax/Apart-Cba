"use client";

import { useMemo, useState } from "react";
import {
  WeeklyHistoryTable,
  type HistoryRow,
} from "@/components/shared/weekly-history-table";
import {
  TicketDetailDialog,
  type TicketMember,
} from "./ticket-detail-dialog";
import { TICKET_STATUS_META } from "@/lib/constants";
import type {
  MaintenanceTicket,
  Owner,
  TicketStatus,
  Unit,
  UnitRef,
} from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & {
  unit: UnitRef;
};

interface Props {
  tickets: TicketWithUnit[];
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
  members: TicketMember[];
}

/**
 * Historial de mantenimiento clickeable: la tabla compacta abre el detalle
 * completo del ticket archivado (fotos, notas, responsables, costos, timeline)
 * reutilizando el mismo dialog del tablero activo.
 */
export function ArchivedTicketsHistory({
  tickets: initialTickets,
  units,
  owners,
  members,
}: Props) {
  const [tickets, setTickets] = useState<TicketWithUnit[]>(initialTickets);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows: HistoryRow[] = useMemo(
    () =>
      tickets.map((t) => {
        const meta = TICKET_STATUS_META[t.status as TicketStatus];
        return {
          id: t.id,
          title: t.title,
          subtitle: t.unit ? `${t.unit.code} · ${t.unit.name}` : null,
          statusLabel: meta?.label ?? t.status,
          statusColor: meta?.color ?? "#64748b",
          archivedAt: t.archived_at!,
          primaryDate: t.opened_at,
        };
      }),
    [tickets]
  );

  const selected = selectedId
    ? tickets.find((t) => t.id === selectedId) ?? null
    : null;

  return (
    <>
      <WeeklyHistoryTable
        rows={rows}
        emptyHint="Todavía no hay tickets de mantenimiento archivados."
        onRowClick={setSelectedId}
      />

      <TicketDetailDialog
        ticket={selected}
        units={units}
        owners={owners}
        members={members}
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onUpdated={(updated) =>
          setTickets((cur) =>
            cur.map((t) =>
              t.id === updated.id ? { ...t, ...updated, unit: t.unit } : t
            )
          )
        }
        onDeleted={(id) => {
          setTickets((cur) => cur.filter((t) => t.id !== id));
          setSelectedId(null);
        }}
      />
    </>
  );
}
