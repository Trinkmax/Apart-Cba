"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, Wrench, CheckCircle2, Package, Building2, Clock } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatTimeAgo, formatMoney } from "@/lib/format";
import { changeTicketStatus } from "@/lib/actions/tickets";
import { cn } from "@/lib/utils";
import type { MaintenanceTicket, Owner, Unit, TicketStatus } from "@/lib/types/database";
import { TicketDetailDialog } from "./ticket-detail-dialog";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

const COLUMNS: {
  key: TicketStatus;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { key: "abierto", icon: AlertTriangle },
  { key: "en_progreso", icon: Wrench },
  { key: "esperando_repuesto", icon: Package },
  { key: "resuelto", icon: CheckCircle2 },
];

interface Props {
  initialTickets: TicketWithUnit[];
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
}

export function TicketsBoard({ initialTickets, units, owners }: Props) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initialTickets);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const map = new Map<TicketStatus, TicketWithUnit[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    tickets.forEach((t) => map.get(t.status as TicketStatus)?.push(t));
    map.forEach((list) =>
      list.sort((a, b) => {
        const wA = TICKET_PRIORITY_META[a.priority]?.weight ?? 0;
        const wB = TICKET_PRIORITY_META[b.priority]?.weight ?? 0;
        if (wA !== wB) return wB - wA;
        return new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime();
      })
    );
    return map;
  }, [tickets]);

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) ?? null : null;
  const openTicket = openTicketId ? tickets.find((t) => t.id === openTicketId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const targetStatus = e.over?.id as TicketStatus | undefined;
    if (!targetStatus) return;
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket || ticket.status === targetStatus) return;

    const prev = tickets;
    setTickets((cur) =>
      cur.map((t) => (t.id === id ? { ...t, status: targetStatus } : t))
    );

    startTransition(async () => {
      try {
        await changeTicketStatus(id, targetStatus);
        router.refresh();
      } catch (err) {
        setTickets(prev);
        toast.error("No se pudo mover el ticket", { description: (err as Error).message });
      }
    });
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const items = grouped.get(col.key) ?? [];
            const meta = TICKET_STATUS_META[col.key];
            return (
              <Column
                key={col.key}
                status={col.key}
                icon={col.icon}
                label={meta.label}
                color={meta.color}
                count={items.length}
              >
                {items.length === 0 ? (
                  <EmptyColumn />
                ) : (
                  items.map((t) => (
                    <DraggableCard
                      key={t.id}
                      ticket={t}
                      isDragging={activeId === t.id}
                      onClick={() => setOpenTicketId(t.id)}
                    />
                  ))
                )}
              </Column>
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTicket ? <TicketCard ticket={activeTicket} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <TicketDetailDialog
        ticket={openTicket}
        units={units}
        owners={owners}
        open={!!openTicket}
        onOpenChange={(o) => !o && setOpenTicketId(null)}
        onUpdated={(updated) =>
          setTickets((cur) =>
            cur.map((t) => (t.id === updated.id ? { ...t, ...updated, unit: t.unit } : t))
          )
        }
        onDeleted={(id) => {
          setTickets((cur) => cur.filter((t) => t.id !== id));
          setOpenTicketId(null);
        }}
      />
    </>
  );
}

// ─── Column ────────────────────────────────────────────────────────────────
function Column({
  status,
  icon: Icon,
  label,
  color,
  count,
  children,
}: {
  status: TicketStatus;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border bg-muted/20 transition-colors",
        isOver && "bg-primary/5 ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="size-7 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: color + "1a", color }}
          >
            <Icon size={14} />
          </span>
          <h3 className="font-semibold text-sm truncate">{label}</h3>
        </div>
        <Badge variant="secondary" className="font-mono shrink-0">
          {count}
        </Badge>
      </div>
      <div className="p-2 space-y-2 flex-1 min-h-[120px]">{children}</div>
    </div>
  );
}

function EmptyColumn() {
  return (
    <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50 italic border border-dashed border-border/40 rounded-lg">
      Soltá tickets aquí
    </div>
  );
}

// ─── Draggable wrapper ─────────────────────────────────────────────────────
function DraggableCard({
  ticket,
  isDragging,
  onClick,
}: {
  ticket: TicketWithUnit;
  isDragging: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Sólo abrir popup en click "limpio" (no drag)
        if (e.detail === 0) return;
        onClick();
      }}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-30")}
    >
      <TicketCard ticket={ticket} />
    </div>
  );
}

// ─── Card visual ───────────────────────────────────────────────────────────
function TicketCard({ ticket, dragging }: { ticket: TicketWithUnit; dragging?: boolean }) {
  const pm = TICKET_PRIORITY_META[ticket.priority];
  return (
    <div
      className={cn(
        "relative bg-card rounded-lg border shadow-sm overflow-hidden transition-all",
        dragging
          ? "shadow-2xl rotate-1 scale-[1.02] border-primary/40"
          : "border-border hover:border-primary/40 hover:shadow-md"
      )}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: pm.color }}
        aria-hidden
      />
      <div className="p-3 pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-sm leading-snug line-clamp-2">{ticket.title}</div>
          <Badge
            className="text-[10px] gap-1 font-medium shrink-0 border"
            style={{
              color: pm.color,
              backgroundColor: pm.color + "15",
              borderColor: pm.color + "40",
            }}
          >
            {pm.label}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground">
          <Building2 size={11} />
          <span className="font-mono font-medium">{ticket.unit.code}</span>
          <span className="truncate">· {ticket.unit.name}</span>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock size={10} /> {formatTimeAgo(ticket.opened_at)}
          </span>
          {ticket.actual_cost !== null && ticket.actual_cost !== undefined && (
            <span className="font-semibold text-foreground tabular-nums">
              {formatMoney(ticket.actual_cost, ticket.cost_currency ?? "ARS")}
            </span>
          )}
        </div>
        {ticket.billable_to === "owner" && (
          <Badge variant="outline" className="mt-2 text-[10px]">
            → Propietario
          </Badge>
        )}
      </div>
    </div>
  );
}
