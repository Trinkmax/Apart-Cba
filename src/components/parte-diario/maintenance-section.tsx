import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { SectionShell } from "./section-shell";
import type { ParteDiarioMaintenanceRow } from "@/lib/types/database";
import type { ParteDiarioSectionKey } from "@/lib/constants";

interface MaintenanceSectionProps {
  sectionKey: Extract<ParteDiarioSectionKey, "tareas_pendientes" | "arreglos">;
  rows: ParteDiarioMaintenanceRow[];
  showPriority: boolean;
  emptyMessage: string;
}

export function MaintenanceSection({
  sectionKey,
  rows,
  showPriority,
  emptyMessage,
}: MaintenanceSectionProps) {
  return (
    <SectionShell
      sectionKey={sectionKey}
      count={rows.length}
      isEmpty={rows.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {rows.map((row) => (
          <li
            key={row.ticket_id}
            className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {row.unit_code}
                </span>
                <span className="text-sm font-medium text-foreground truncate">{row.title}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {row.assigned_to_name ? `Asignado a ${row.assigned_to_name}` : "Sin asignar"}
                {row.status !== "abierto" && ` · ${TICKET_STATUS_META[row.status].label}`}
              </p>
            </div>
            {showPriority ? (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-current/30 shrink-0"
                style={{
                  color: TICKET_PRIORITY_META[row.priority].color,
                  backgroundColor: TICKET_PRIORITY_META[row.priority].color + "1a",
                }}
              >
                {TICKET_PRIORITY_META[row.priority].label}
              </span>
            ) : (
              <span
                className={cn(
                  "size-2 rounded-full shrink-0",
                  row.status === "esperando_repuesto" ? "bg-amber-500" : "bg-blue-500",
                )}
                title={TICKET_STATUS_META[row.status].label}
              />
            )}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
