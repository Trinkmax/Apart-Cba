import Link from "next/link";
import { Wrench, AlertTriangle, Building2, Clock } from "lucide-react";
import { getSession } from "@/lib/actions/auth";
import { listTickets } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatTimeAgo } from "@/lib/format";
import type { MaintenanceTicket, Unit } from "@/lib/types/database";

type T = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

export default async function MobileTicketsPage() {
  const session = await getSession();
  if (!session) return null;

  const all = (await listTickets({ openOnly: true })) as T[];
  const mine = all.filter((t) => t.assigned_to === session.userId);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Wrench className="size-5 text-orange-500" />
        <h1 className="text-xl font-semibold">Mis tickets</h1>
      </div>

      {mine.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Wrench className="size-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">Sin tickets asignados</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {mine.map((t) => {
            const pm = TICKET_PRIORITY_META[t.priority];
            const sm = TICKET_STATUS_META[t.status];
            return (
              <Link key={t.id} href={`/dashboard/mantenimiento/${t.id}`}>
                <Card className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-snug">{t.title}</div>
                    <Badge className="text-[10px] gap-1 font-normal shrink-0" style={{ color: pm.color, backgroundColor: pm.color + "15", borderColor: pm.color + "30" }}>
                      <AlertTriangle size={9} />
                      {pm.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Building2 size={11} />
                    <span className="font-mono">{t.unit.code}</span>
                    <span>· {t.unit.name}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock size={10} /> {formatTimeAgo(t.opened_at)}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{sm.label}</Badge>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
