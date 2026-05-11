import { Plus } from "lucide-react";
import { listTickets } from "@/lib/actions/tickets";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { listCurrentOccupancyByUnit } from "@/lib/actions/bookings";
import { getCurrentOrg } from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { TicketFormDialog } from "@/components/tickets/ticket-form-dialog";
import { TicketsBoard } from "@/components/tickets/tickets-board";
import { HistoryToggle } from "@/components/shared/history-toggle";
import {
  WeeklyHistoryTable,
  type HistoryRow,
} from "@/components/shared/weekly-history-table";
import { TICKET_STATUS_META } from "@/lib/constants";
import type { MaintenanceTicket, TicketStatus, Unit } from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MantenimientoPage({
  searchParams,
}: {
  searchParams: Promise<{ historial?: string }>;
}) {
  const { historial } = await searchParams;
  const showArchived = historial === "1";

  const [{ organization }, tickets, units, owners, occupancyByUnit] = await Promise.all([
    getCurrentOrg(),
    listTickets({ showArchived }),
    listUnitsEnriched(),
    listOwners(),
    listCurrentOccupancyByUnit(),
  ]);

  const open = tickets.filter(
    (t) => !["resuelto", "cerrado"].includes((t as TicketWithUnit).status)
  ).length;

  const historyRows: HistoryRow[] = showArchived
    ? (tickets as TicketWithUnit[]).map((t) => {
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
      })
    : [];

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Mantenimiento {showArchived ? <span className="text-muted-foreground font-normal">· Historial</span> : null}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {showArchived ? (
              <>
                {tickets.length} tickets archivados
                <span className="hidden sm:inline"> · resueltos/cerrados en semanas anteriores</span>
              </>
            ) : (
              <>
                {tickets.length} tickets · {open} abiertos
                <span className="hidden sm:inline">
                  {" "}
                  · arrastrá las cards entre columnas para cambiar el estado
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
          <HistoryToggle basePath="/dashboard/mantenimiento" active={showArchived} />
          {!showArchived && (
            <TicketFormDialog units={units} owners={owners} occupancyByUnit={occupancyByUnit}>
              <Button className="gap-2 shrink-0">
                <Plus size={16} /> Nuevo ticket
              </Button>
            </TicketFormDialog>
          )}
        </div>
      </div>

      {showArchived ? (
        <WeeklyHistoryTable
          rows={historyRows}
          emptyHint="Todavía no hay tickets de mantenimiento archivados."
        />
      ) : (
        <TicketsBoard
          organizationId={organization.id}
          initialTickets={tickets as TicketWithUnit[]}
          units={units.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
          owners={owners}
          occupancyByUnit={occupancyByUnit}
        />
      )}
    </div>
  );
}
