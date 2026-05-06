"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionShell } from "./section-shell";
import { assignTicketInDraft } from "@/lib/actions/parte-diario";
import type { ParteDiarioMaintenanceRow } from "@/lib/types/database";

interface MaintenanceSectionProps {
  rows: ParteDiarioMaintenanceRow[];
  assignables: { user_id: string; full_name: string }[];
  canEdit: boolean;
  emptyMessage: string;
}

export function MaintenanceSection({
  rows,
  assignables,
  canEdit,
  emptyMessage,
}: MaintenanceSectionProps) {
  const [renderedRows, setRenderedRows] = useState(rows);
  const [optimistic, setOptimistic] = useState(rows);
  const [pending, startTransition] = useTransition();

  // Sync con server: setState durante render cuando cambian las props.
  if (renderedRows !== rows) {
    setRenderedRows(rows);
    setOptimistic(rows);
  }

  const handleAssign = (ticketId: string, userId: string | null) => {
    setOptimistic((prev) =>
      prev.map((r) =>
        r.ticket_id === ticketId
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
        await assignTicketInDraft(ticketId, userId);
      } catch (err) {
        toast.error("No se pudo asignar", { description: (err as Error).message });
        setOptimistic(rows);
      }
    });
  };

  return (
    <SectionShell
      sectionKey="arreglos"
      count={optimistic.length}
      isEmpty={optimistic.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {optimistic.map((row) => (
          <li
            key={row.ticket_id}
            className="flex items-start gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {row.unit_code}
                </span>
                <span className="text-sm font-medium text-foreground truncate">{row.title}</span>
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-current/30 shrink-0"
                  style={{
                    color: TICKET_PRIORITY_META[row.priority].color,
                    backgroundColor: TICKET_PRIORITY_META[row.priority].color + "1a",
                  }}
                >
                  {TICKET_PRIORITY_META[row.priority].label}
                </span>
              </div>
              {row.status !== "abierto" ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {TICKET_STATUS_META[row.status].label}
                </p>
              ) : null}
              <div className="mt-1.5">
                {canEdit ? (
                  <Select
                    value={row.assigned_to ?? "__none__"}
                    onValueChange={(v) =>
                      handleAssign(row.ticket_id, v === "__none__" ? null : v)
                    }
                    disabled={pending}
                  >
                    <SelectTrigger
                      className="h-7 w-full text-xs"
                      aria-label="Asignar a"
                    >
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
