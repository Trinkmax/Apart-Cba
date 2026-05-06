"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  MinusCircle,
  Plus,
  Sparkles,
  User2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useRealtimeRows } from "@/hooks/use-realtime-rows";
import { ConciergeDetailDialog } from "./concierge-detail-dialog";
import { ConciergeFormDialog } from "./concierge-form-dialog";

type Member = { user_id: string; full_name: string | null };

type CR = ConciergeRequest & {
  unit: Pick<Unit, "id" | "code" | "name"> | null;
  guest: Pick<Guest, "id" | "full_name"> | null;
  assignee?: Member | null;
  has_alert?: boolean;
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
  { key: "cancelada", label: STATUS_META.cancelada.label, color: STATUS_META.cancelada.color, icon: MinusCircle, emptyText: "Canceladas" },
];

interface Props {
  organizationId: string;
  initialRequests: CR[];
  units: Pick<Unit, "id" | "code" | "name">[];
  members?: Member[];
}

export function ConciergeBoard({ organizationId, initialRequests, units, members = [] }: Props) {
  const [requests, setRequests] = useState<CR[]>(initialRequests);
  const [openId, setOpenId] = useState<string | null>(null);

  const unitsById = useMemo(() => {
    const m = new Map<string, Pick<Unit, "id" | "code" | "name">>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  const membersById = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  const enrich = useCallback(
    (row: ConciergeRequest): CR => ({
      ...row,
      unit: row.unit_id ? unitsById.get(row.unit_id) ?? null : null,
      // El payload de realtime no trae el join de guests; lo hidratará la
      // prop en la próxima revalidación. No hacemos un fetch puntual para
      // mantener el path crítico instantáneo.
      guest: null,
      assignee: row.assigned_to ? membersById.get(row.assigned_to) ?? null : null,
      has_alert: false,
    }),
    [unitsById, membersById]
  );

  const onInsert = useCallback(
    (row: ConciergeRequest) => {
      setRequests((cur) => (cur.some((r) => r.id === row.id) ? cur : [enrich(row), ...cur]));
    },
    [enrich]
  );
  const onUpdate = useCallback(
    (row: ConciergeRequest) => {
      setRequests((cur) =>
        cur.map((r) => {
          if (r.id !== row.id) return r;
          const assigneeChanged = r.assigned_to !== row.assigned_to;
          return {
            ...r,
            ...row,
            unit: row.unit_id ? unitsById.get(row.unit_id) ?? r.unit : null,
            guest: r.guest,
            assignee: assigneeChanged
              ? row.assigned_to
                ? membersById.get(row.assigned_to) ?? null
                : null
              : r.assignee,
            has_alert: r.has_alert,
          };
        })
      );
    },
    [unitsById, membersById]
  );
  const onDelete = useCallback((id: string) => {
    setRequests((cur) => cur.filter((r) => r.id !== id));
  }, []);

  useRealtimeRows<ConciergeRequest>({
    table: "concierge_requests",
    organizationId,
    onInsert,
    onUpdate,
    onDelete,
  });

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
        xlCols={5}
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

      {/* FAB siempre visible — vía garantizada para crear tareas */}
      <ConciergeFormDialog units={units} members={members}>
        <Button
          size="lg"
          className="fixed bottom-6 right-6 z-40 h-14 rounded-full shadow-lg hover:shadow-xl gap-2 px-5"
        >
          <Plus size={18} /> Nueva tarea
        </Button>
      </ConciergeFormDialog>
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
      {request.has_alert && (
        <span
          className="absolute right-2 top-2 flex items-center justify-center size-5 rounded-full bg-primary/15 text-primary shadow-sm"
          title="Esta tarea tiene una alerta activa"
        >
          <Bell size={11} />
        </span>
      )}
      <div className="p-3 pl-4">
        <div className={cn(
          "font-medium text-sm leading-snug line-clamp-2",
          request.has_alert && "pr-7"
        )}>{request.description}</div>
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
