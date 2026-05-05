"use client";

import { History, Loader2 } from "lucide-react";
import { formatDate, formatTimeAgo } from "@/lib/format";

/**
 * Componente genérico de timeline de eventos para tickets/limpieza/conserjería.
 *
 * Estados de `events`:
 *   - `null` → cargando
 *   - `[]`   → ya se hizo fetch y no hay nada
 *   - lista  → render normal
 *
 * El consumidor provee dos callbacks:
 *   - `getDotColor(event)` → color del dot del timeline
 *   - `renderDescription(event)` → JSX con la descripción ("creó", "movió de X a Y", ...)
 */
export interface TimelineEventBase {
  id: string;
  event_type: string;
  created_at: string;
  actor: { full_name: string | null } | null;
}

export function EventTimeline<E extends TimelineEventBase>({
  events,
  getDotColor,
  renderDescription,
}: {
  events: E[] | null;
  getDotColor: (event: E) => string;
  renderDescription: (event: E) => React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        <History size={13} />
        Historial
        {events && events.length > 0 && (
          <span className="text-muted-foreground/60 normal-case tracking-normal">
            · {events.length} evento{events.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {events === null ? (
        <div className="text-xs text-muted-foreground italic flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          Cargando historial...
        </div>
      ) : events.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          Sin eventos registrados aún.
        </div>
      ) : (
        <ol className="relative border-l border-border/60 ml-1.5 space-y-3 pl-4">
          {events.map((ev) => (
            <TimelineRow
              key={ev.id}
              event={ev}
              dotColor={getDotColor(ev)}
              description={renderDescription(ev)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineRow<E extends TimelineEventBase>({
  event,
  dotColor,
  description,
}: {
  event: E;
  dotColor: string;
  description: React.ReactNode;
}) {
  const actorName = event.actor?.full_name?.trim() || "Sistema";
  return (
    <li className="relative">
      <span
        className="absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-background"
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <div className="text-xs leading-snug">
        <span className="font-medium text-foreground">{actorName}</span> {description}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
        {formatDate(event.created_at)} · {formatTimeAgo(event.created_at)}
      </div>
    </li>
  );
}
