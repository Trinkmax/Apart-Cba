import { ListTodo, Plus } from "lucide-react";
import { listConciergeRequests, listAssignableMembers } from "@/lib/actions/concierge";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { ConciergeBoard } from "@/components/concierge/concierge-board";
import { ConciergeFormDialog } from "@/components/concierge/concierge-form-dialog";

export default async function TareasPage() {
  const [requests, units, members] = await Promise.all([
    listConciergeRequests(),
    listUnitsEnriched(),
    listAssignableMembers(),
  ]);
  const unitsLite = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  const pendientes = (requests as { status: string }[]).filter(
    (r) => r.status === "pendiente"
  ).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ListTodo className="size-5 text-primary" />
            Tareas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {requests.length} tareas · {pendientes} pendientes · arrastrá las cards entre columnas
          </p>
        </div>
        <ConciergeFormDialog units={unitsLite} members={members}>
          <Button className="gap-2">
            <Plus size={16} /> Nueva tarea
          </Button>
        </ConciergeFormDialog>
      </div>

      <ConciergeBoard initialRequests={requests as never} units={unitsLite} members={members} />
    </div>
  );
}
