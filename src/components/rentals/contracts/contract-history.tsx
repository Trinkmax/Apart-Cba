"use client";

import { EventTimeline } from "@/components/shared/event-timeline";

/** Historial legible del contrato (rental_events) con el timeline compartido del panel. */

export interface ContractHistoryEvent {
  id: string;
  event_type: string;
  summary: string;
  actor_name: string | null;
  created_at: string;
}

function dotColor(type: string): string {
  if (type.includes("anul") || type.includes("rescind") || type.includes("rechaz")) return "#ef4444";
  if (type.includes("pago") || type.includes("cobro") || type.includes("recibo")) return "#10b981";
  if (type.includes("ajuste")) return "#3b82f6";
  if (type.includes("comprobante") || type.includes("aviso")) return "#a855f7";
  if (type.includes("finaliz") || type.includes("renov")) return "#6366f1";
  if (type.includes("intim") || type.includes("mora")) return "#f97316";
  return "#0d9488";
}

export function ContractHistory({ events }: { events: ContractHistoryEvent[] }) {
  const items = events.map((e) => ({
    id: e.id,
    event_type: e.event_type,
    created_at: e.created_at,
    summary: e.summary,
    actor: { full_name: e.actor_name },
  }));
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <EventTimeline
        events={items}
        getDotColor={(e) => dotColor(e.event_type)}
        renderDescription={(e) => <span className="text-muted-foreground">· {e.summary}</span>}
      />
    </div>
  );
}
