import { Plus } from "lucide-react";
import { listTickets } from "@/lib/actions/tickets";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { listCurrentOccupancyByUnit } from "@/lib/actions/bookings";
import { getCurrentOrg } from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { TicketFormDialog } from "@/components/tickets/ticket-form-dialog";
import { TicketsBoard } from "@/components/tickets/tickets-board";
import type { MaintenanceTicket, Unit } from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MantenimientoPage() {
  const [{ organization }, tickets, units, owners, occupancyByUnit] = await Promise.all([
    getCurrentOrg(),
    listTickets(),
    listUnitsEnriched(),
    listOwners(),
    listCurrentOccupancyByUnit(),
  ]);

  const open = tickets.filter(
    (t) => !["resuelto", "cerrado"].includes((t as TicketWithUnit).status)
  ).length;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Mantenimiento</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {tickets.length} tickets · {open} abiertos
            <span className="hidden sm:inline"> · arrastrá las cards entre columnas para cambiar el estado</span>
          </p>
        </div>
        <TicketFormDialog units={units} owners={owners} occupancyByUnit={occupancyByUnit}>
          <Button className="gap-2 justify-self-start sm:justify-self-end shrink-0 w-full sm:w-auto">
            <Plus size={16} /> Nuevo ticket
          </Button>
        </TicketFormDialog>
      </div>

      <TicketsBoard
        organizationId={organization.id}
        initialTickets={tickets as TicketWithUnit[]}
        units={units.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
        owners={owners}
        occupancyByUnit={occupancyByUnit}
      />
    </div>
  );
}
