import { Calendar } from "lucide-react";
import { SectionShell } from "./section-shell";
import type { ParteDiarioConciergeRow } from "@/lib/types/database";

interface TareasSectionProps {
  rows: ParteDiarioConciergeRow[];
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

export function TareasSection({ rows, emptyMessage }: TareasSectionProps) {
  return (
    <SectionShell
      sectionKey="tareas_pendientes"
      count={rows.length}
      isEmpty={rows.length === 0}
      emptyMessage={emptyMessage}
    >
      <ul className="divide-y">
        {rows.map((row) => (
          <li
            key={row.request_id}
            className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {row.unit_code ? (
                  <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                    {row.unit_code}
                  </span>
                ) : null}
                <span className="text-sm font-medium text-foreground truncate">
                  {row.description}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                <span>
                  {row.assigned_to_name ? `Asignado a ${row.assigned_to_name}` : "Sin asignar"}
                </span>
                {row.status !== "pendiente" ? (
                  <>
                    <span>·</span>
                    <span>{STATUS_LABEL[row.status]}</span>
                  </>
                ) : null}
                {row.scheduled_for ? (
                  <>
                    <span>·</span>
                    <Calendar className="size-3" />
                    <span>{row.scheduled_for.slice(0, 10)}</span>
                  </>
                ) : null}
              </p>
            </div>
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
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
