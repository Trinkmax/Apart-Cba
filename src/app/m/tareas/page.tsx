import { CalendarClock, ListTodo, User2 } from "lucide-react";
import { listConciergeRequests } from "@/lib/actions/concierge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  pendiente: "#94a3b8",
  en_progreso: "#3b82f6",
  completada: "#10b981",
};

function formatScheduled(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  const timePart = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

export default async function MobileTareasPage() {
  const all = await listConciergeRequests();
  const active = (all as { status: string }[]).filter((r) =>
    ["pendiente", "en_progreso"].includes(r.status)
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <ListTodo className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">Tareas</h1>
      </div>

      {active.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <ListTodo className="size-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">Sin tareas activas</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {(active as never as Array<{
            id: string;
            description: string;
            status: string;
            created_at: string;
            scheduled_for: string | null;
            unit: { code: string } | null;
            guest: { full_name: string } | null;
            assignee: { full_name: string | null } | null;
          }>).map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium leading-snug">{r.description}</div>
                <Badge
                  className="text-[10px] font-normal"
                  style={{
                    color: STATUS_COLORS[r.status],
                    backgroundColor: STATUS_COLORS[r.status] + "15",
                    borderColor: STATUS_COLORS[r.status] + "30",
                  }}
                >
                  {r.status}
                </Badge>
              </div>
              {(r.assignee || r.scheduled_for) && (
                <div className="flex items-center gap-3 mt-2 text-xs text-foreground/80 flex-wrap">
                  {r.assignee && (
                    <span className="flex items-center gap-1">
                      <User2 size={12} className="text-muted-foreground" />
                      {r.assignee.full_name ?? "—"}
                    </span>
                  )}
                  {r.scheduled_for && (
                    <span className="flex items-center gap-1">
                      <CalendarClock size={12} className="text-muted-foreground" />
                      <span className="tabular-nums">{formatScheduled(r.scheduled_for)}</span>
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                {r.unit && <span className="font-mono">{r.unit.code}</span>}
                {r.guest && <span>· {r.guest.full_name}</span>}
                <span className="ml-auto">{formatTimeAgo(r.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
