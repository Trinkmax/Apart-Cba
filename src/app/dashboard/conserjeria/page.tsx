import { Bell, Plus } from "lucide-react";
import { listConciergeRequests } from "@/lib/actions/concierge";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { ConciergeBoard } from "@/components/concierge/concierge-board";
import { ConciergeFormDialog } from "@/components/concierge/concierge-form-dialog";

export default async function ConserjeriaPage() {
  const [requests, units] = await Promise.all([listConciergeRequests(), listUnitsEnriched()]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="size-5 text-primary" />
            Conserjería
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pedidos del huésped: late check-out, toallas extra, transfer, tours
          </p>
        </div>
        <ConciergeFormDialog units={units}>
          <Button className="gap-2"><Plus size={16} /> Nuevo pedido</Button>
        </ConciergeFormDialog>
      </div>

      <ConciergeBoard requests={requests as never} />
    </div>
  );
}
