"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle2, Clock, Sparkles, User2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { changeConciergeStatus } from "@/lib/actions/concierge";
import { formatMoney, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ConciergePriority,
  ConciergeRequest,
  ConciergeStatus,
  Guest,
  Unit,
} from "@/lib/types/database";
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board";
import { ConciergeDetailDialog } from "./concierge-detail-dialog";

type Member = { user_id: string; full_name: string | null };

type CR = ConciergeRequest & {
  unit: Pick<Unit, "id" | "code" | "name"> | null;
  guest: Pick<Guest, "id" | "full_name"> | null;
  assignee?: Member | null;
};

function formatScheduled(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  const timePart = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

const STATUS_META: Record<ConciergeStatus, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "#94a3b8" },
  en_progreso: { label: "En progreso", color: "#3b82f6" },
  completada: { label: "Completada", color: "#10b981" },
  rechazada: { label: "Rechazada", color: "#ef4444" },
  cancelada: { label: "Cancelada", color: "#64748b" },
};

const PRIORITY_META: Record<ConciergePriority, { color: string; weight: number }> = {
  baja: { color: "#64748b", weight: 1 },
  normal: { color: "#3b82f6", weight: 2 },
  alta: { color: "#f59e0b", weight: 3 },
  urgente: { color: "#ef4444", weight: 4 },
};

const COLUMNS: KanbanColumn<ConciergeStatus>[] = [
  { key: "pendiente", label: STATUS_META.pendiente.label, color: STATUS_META.pendiente.color, icon: Clock, emptyText: "Sin tareas pendientes" },
  { key: "en_progreso", label: STATUS_META.en_progreso.label, color: STATUS_META.en_progreso.color, icon: Sparkles, emptyText: "Soltá tareas aquí" },
  { key: "completada", label: STATUS_META.completada.label, color: STATUS_META.completada.color, icon: CheckCircle2, emptyText: "Soltá tareas aquí" },
  { key: "rechazada", label: STATUS_META.rechazada.label, color: STATUS_META.rechazada.color, icon: X, emptyText: "Rechazadas" },
];

interface Props {
  initialRequests: CR[];
  units: Pick<Unit, "id" | "code" | "name">[];
  members?: Member[];
}

export function ConciergeBoard({ initialRequests, units, members = [] }: Props) {
  const [requests, setRequests] = useState<CR[]>(initialRequests);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? requests.find((r) => r.id === openId) ?? null : null;

  return (
    <>
      <KanbanBoard<CR, ConciergeStatus>
        columns={COLUMNS}
        items={requests}
        getStatus={(r) => r.status}
        setItemStatus={(r, s) => ({ ...r, status: s })}
        onMove={async (id, status) => {
          await changeConciergeStatus(id, status);
          setRequests((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
        }}
        onCardClick={(r) => setOpenId(r.id)}
        renderCard={(r, { dragging }) => <ConciergeCard request={r} dragging={dragging} />}
        sortFn={(a, b) => {
          const wA = PRIORITY_META[a.priority]?.weight ?? 0;
          const wB = PRIORITY_META[b.priority]?.weight ?? 0;
          if (wA !== wB) return wB - wA;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }}
      />

      <ConciergeDetailDialog
        request={open}
        units={units}
        members={members}
        open={!!open}
        onOpenChange={(o) => !o && setOpenId(null)}
        onUpdated={(updated) =>
          setRequests((cur) =>
            cur.map((r) =>
              r.id === updated.id
                ? {
                    ...r,
                    ...updated,
                    unit: r.unit,
                    guest: r.guest,
                    assignee:
                      updated.assigned_to && updated.assigned_to !== r.assigned_to
                        ? members.find((m) => m.user_id === updated.assigned_to) ?? null
                        : updated.assigned_to
                          ? r.assignee ?? null
                          : null,
                  }
                : r
            )
          )
        }
        onDeleted={(id) => {
          setRequests((cur) => cur.filter((r) => r.id !== id));
          setOpenId(null);
        }}
      />
    </>
  );
}

function ConciergeCard({ request, dragging }: { request: CR; dragging: boolean }) {
  const pm = PRIORITY_META[request.priority];
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
        <div className="font-medium text-sm leading-snug line-clamp-2">{request.description}</div>
        {(request.unit || request.guest) && (
          <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
            {request.unit && <span className="font-mono font-medium">{request.unit.code}</span>}
            {request.unit && request.guest && <span>·</span>}
            {request.guest && <span className="truncate">{request.guest.full_name}</span>}
          </div>
        )}
        {(request.assignee || request.scheduled_for) && (
          <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
            {request.assignee && (
              <span className="flex items-center gap-1 text-foreground/80">
                <User2 size={11} className="text-muted-foreground" />
                <span className="font-medium truncate max-w-[120px]">
                  {request.assignee.full_name ?? "—"}
                </span>
              </span>
            )}
            {request.scheduled_for && (
              <span className="flex items-center gap-1 text-foreground/80">
                <CalendarClock size={11} className="text-muted-foreground" />
                <span className="tabular-nums">{formatScheduled(request.scheduled_for)}</span>
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span>{formatTimeAgo(request.created_at)}</span>
          {request.cost !== null && request.cost !== undefined && (
            <span className="font-semibold text-foreground tabular-nums">
              {formatMoney(request.cost, request.cost_currency ?? "ARS")}
            </span>
          )}
        </div>
        {request.charge_to_guest && (
          <Badge variant="outline" className="mt-2 text-[10px]">
            → Cobrar al huésped
          </Badge>
        )}
      </div>
    </div>
  );
}
