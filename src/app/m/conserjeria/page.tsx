import { Bell } from "lucide-react";
import { listConciergeRequests } from "@/lib/actions/concierge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  pendiente: "#94a3b8",
  en_progreso: "#3b82f6",
  completada: "#10b981",
};

export default async function MobileConserjeriaPage() {
  const all = await listConciergeRequests();
  const active = (all as { status: string }[]).filter((r) => ["pendiente", "en_progreso"].includes(r.status));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Bell className="size-5 text-purple-500" />
        <h1 className="text-xl font-semibold">Pedidos huéspedes</h1>
      </div>

      {active.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Bell className="size-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">Sin pedidos activos</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {(active as never as Array<{
            id: string; description: string; status: string; created_at: string;
            unit: { code: string } | null; guest: { full_name: string } | null;
          }>).map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium leading-snug">{r.description}</div>
                <Badge className="text-[10px] font-normal" style={{ color: STATUS_COLORS[r.status], backgroundColor: STATUS_COLORS[r.status] + "15", borderColor: STATUS_COLORS[r.status] + "30" }}>
                  {r.status}
                </Badge>
              </div>
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
