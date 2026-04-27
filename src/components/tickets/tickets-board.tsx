"use client";

import { useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Clock, Package, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatTimeAgo, formatMoney } from "@/lib/format";
import { changeTicketStatus } from "@/lib/actions/tickets";
import { cn } from "@/lib/utils";
import type { MaintenanceTicket, Owner, TicketStatus, Unit } from "@/lib/types/database";
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board";
import { TicketDetailDialog } from "./ticket-detail-dialog";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

const COLUMNS: KanbanColumn<TicketStatus>[] = [
  { key: "abierto", label: TICKET_STATUS_META.abierto.label, color: TICKET_STATUS_META.abierto.color, icon: AlertTriangle, emptyText: "Sin tickets abiertos" },
  { key: "en_progreso", label: TICKET_STATUS_META.en_progreso.label, color: TICKET_STATUS_META.en_progreso.color, icon: Wrench, emptyText: "Soltá tickets aquí" },
  { key: "esperando_repuesto", label: TICKET_STATUS_META.esperando_repuesto.label, color: TICKET_STATUS_META.esperando_repuesto.color, icon: Package, emptyText: "Soltá tickets aquí" },
  { key: "resuelto", label: TICKET_STATUS_META.resuelto.label, color: TICKET_STATUS_META.resuelto.color, icon: CheckCircle2, emptyText: "Soltá tickets aquí" },
];

interface Props {
  initialTickets: TicketWithUnit[];
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
}

export function TicketsBoard({ initialTickets, units, owners }: Props) {
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketWithUnit[]>(initialTickets);

  const openTicket = openTicketId ? tickets.find((t) => t.id === openTicketId) ?? null : null;

  return (
    <>
      <KanbanBoard<TicketWithUnit, TicketStatus>
        columns={COLUMNS}
        items={tickets}
        getStatus={(t) => t.status as TicketStatus}
        setItemStatus={(t, s) => ({ ...t, status: s })}
        onMove={async (id, status) => {
          await changeTicketStatus(id, status);
          setTickets((cur) => cur.map((t) => (t.id === id ? { ...t, status } : t)));
        }}
        onCardClick={(t) => setOpenTicketId(t.id)}
        renderCard={(t, { dragging }) => <TicketCard ticket={t} dragging={dragging} />}
        sortFn={(a, b) => {
          const wA = TICKET_PRIORITY_META[a.priority]?.weight ?? 0;
          const wB = TICKET_PRIORITY_META[b.priority]?.weight ?? 0;
          if (wA !== wB) return wB - wA;
          return new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime();
        }}
      />

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

function TicketCard({ ticket, dragging }: { ticket: TicketWithUnit; dragging: boolean }) {
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
