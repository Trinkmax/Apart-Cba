import Link from "next/link";
import { Sparkles, Wrench, Bell, ChevronRight, ClipboardList } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { listCleaningTasks } from "@/lib/actions/cleaning";
import { listTickets } from "@/lib/actions/tickets";
import { listConciergeRequests } from "@/lib/actions/concierge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CleaningTask, MaintenanceTicket } from "@/lib/types/database";

export default async function MobileHome() {
  const session = await getSession();
  if (!session) return null;
  const { organization, role } = await getCurrentOrg();

  const [cleaning, tickets, concierge] = await Promise.all([
    listCleaningTasks({ assignedTo: session.userId }),
    listTickets({ openOnly: true }),
    listConciergeRequests(),
  ]);

  const myCleaning = (cleaning as CleaningTask[]).filter(
    (c) => c.assigned_to === session.userId && ["pendiente", "en_progreso"].includes(c.status)
  );
  const myTickets = (tickets as MaintenanceTicket[]).filter((t) => t.assigned_to === session.userId);
  const pendingConcierge = (concierge as { status: string }[]).filter((c) => c.status === "pendiente").length;

  return (
    <div className="p-4 space-y-4 safe-x">
      <div className="brand-gradient text-white rounded-2xl p-5 shadow-sm">
        <p className="text-sm opacity-80 truncate">{organization.name}</p>
        <h1 className="text-2xl font-semibold mt-1">¡Hola, {session.profile.full_name.split(" ")[0]}!</h1>
        <p className="text-xs opacity-80 mt-1 capitalize">{role}</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Link href="/m/limpieza" className="block tap">
          <Card className="p-4 hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3">
            <div className="size-12 rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
              <Sparkles size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Mis tareas de limpieza</div>
              <div className="text-xs text-muted-foreground">{myCleaning.length} pendientes hoy</div>
            </div>
            {myCleaning.length > 0 && (
              <Badge className="bg-cyan-500 text-white shrink-0">{myCleaning.length}</Badge>
            )}
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </Card>
        </Link>

        <Link href="/m/mantenimiento" className="block tap">
          <Card className="p-4 hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3">
            <div className="size-12 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <Wrench size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Mis tickets asignados</div>
              <div className="text-xs text-muted-foreground">{myTickets.length} abiertos</div>
            </div>
            {myTickets.length > 0 && (
              <Badge className="bg-orange-500 text-white shrink-0">{myTickets.length}</Badge>
            )}
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </Card>
        </Link>

        <Link href="/m/tareas" className="block tap">
          <Card className="p-4 hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3">
            <div className="size-12 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <Bell size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Tareas</div>
              <div className="text-xs text-muted-foreground">{pendingConcierge} pendientes</div>
            </div>
            {pendingConcierge > 0 && (
              <Badge className="bg-purple-500 text-white shrink-0">{pendingConcierge}</Badge>
            )}
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </Card>
        </Link>

        <Link href="/dashboard" className="block tap">
          <Card className="p-4 hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3 border-dashed">
            <div className="size-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <ClipboardList size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Dashboard completo</div>
              <div className="text-xs text-muted-foreground">Vista de escritorio</div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
