import { Plus } from "lucide-react";
import { listTickets } from "@/lib/actions/tickets";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { TicketFormDialog } from "@/components/tickets/ticket-form-dialog";
import { TicketsBoard } from "@/components/tickets/tickets-board";
import type { MaintenanceTicket, Unit } from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MantenimientoPage() {
  const [tickets, units, owners] = await Promise.all([
    listTickets(),
    listUnitsEnriched(),
    listOwners(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mantenimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tickets.length} tickets · {tickets.filter((t) => !["resuelto", "cerrado"].includes((t as TicketWithUnit).status)).length} abiertos
          </p>
        </div>
        <TicketFormDialog units={units} owners={owners}>
          <Button className="gap-2"><Plus size={16} /> Nuevo ticket</Button>
        </TicketFormDialog>
      </div>

      <TicketsBoard tickets={tickets as TicketWithUnit[]} />
    </div>
  );
}
