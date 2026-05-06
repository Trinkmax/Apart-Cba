"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Calendar, UserPlus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionShell } from "./section-shell";
import { assignTareaInDraft } from "@/lib/actions/parte-diario";
import type { ParteDiarioConciergeRow } from "@/lib/types/database";

interface TareasSectionProps {
  rows: ParteDiarioConciergeRow[];
  assignables: { user_id: string; full_name: string }[];
  canEdit: boolean;
  emptyMessage: string;
}

const PRIORITY_COLOR: Record<ParteDiarioConciergeRow["priority"], string> = {
  baja: "#64748b",
  normal: "#3b82f6",
  alta: "#f59e0b",
  urgente: "#ef4444",
};

const PRIORITY_LABEL: Record<ParteDiarioConciergeRow["priority"], string> = {
  baja: "Baja",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

const STATUS_LABEL: Record<ParteDiarioConciergeRow["status"], string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

export function TareasSection({ rows, assignables, canEdit, emptyMessage }: TareasSectionProps) {
  const [renderedRows, setRenderedRows] = useState(rows);
  const [optimistic, setOptimistic] = useState(rows);
  const [pending, startTransition] = useTransition();

  if (renderedRows !== rows) {
    setRenderedRows(rows);
    setOptimistic(rows);
  }

  const handleAssign = (requestId: string, userId: string | null) => {
    setOptimistic((prev) =>
      prev.map((r) =>
        r.request_id === requestId
          ? {
              ...r,
              assigned_to: userId,
              assigned_to_name: userId
                ? assignables.find((a) => a.user_id === userId)?.full_name ?? null
                : null,
            }
          : r,
      ),
    );
    startTransition(async () => {
      try {
        await assignTareaInDraft(requestId, userId);
      } catch (err) {
        toast.error("No se pudo asignar", { description: (err as Error).message });
        setOptimistic(rows);
      }
    });
  };

  return (
    <SectionShell
      sectionKey="tareas_pendientes"
      count={optimistic.length}
      isEmpty={optimistic.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {optimistic.map((row) => (
          <li
            key={row.request_id}
            className="flex items-start gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {row.unit_code ? (
                  <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                    {row.unit_code}
                  </span>
                ) : null}
                <span className="text-sm font-medium text-foreground truncate">
                  {row.description}
                </span>
                {row.priority !== "normal" && row.priority !== "baja" ? (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-current/30 shrink-0"
                    style={{
                      color: PRIORITY_COLOR[row.priority],
                      backgroundColor: PRIORITY_COLOR[row.priority] + "1a",
                    }}
                  >
                    {PRIORITY_LABEL[row.priority]}
                  </span>
                ) : null}
              </div>
              {row.status !== "pendiente" || row.scheduled_for ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {row.status !== "pendiente" ? <span>{STATUS_LABEL[row.status]}</span> : null}
                  {row.scheduled_for ? (
                    <>
                      {row.status !== "pendiente" ? <span>·</span> : null}
                      <Calendar className="size-3" />
                      <span>{row.scheduled_for.slice(0, 10)}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1.5">
                {canEdit ? (
                  <Select
                    value={row.assigned_to ?? "__none__"}
                    onValueChange={(v) =>
                      handleAssign(row.request_id, v === "__none__" ? null : v)
                    }
                    disabled={pending}
                  >
                    <SelectTrigger className="h-7 w-full text-xs" aria-label="Asignar a">
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="__none__">
                        <span className="flex items-center gap-2">
                          <UserPlus className="size-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground italic">Sin asignar</span>
                        </span>
                      </SelectItem>
                      {assignables.map((a) => (
                        <SelectItem key={a.user_id} value={a.user_id}>
                          {a.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground italic">
                    {row.assigned_to_name ?? "Sin asignar"}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
