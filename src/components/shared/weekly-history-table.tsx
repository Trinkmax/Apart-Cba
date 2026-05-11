import { Archive } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export interface HistoryRow {
  id: string;
  title: string;
  subtitle?: string | null;
  statusLabel: string;
  statusColor: string;
  archivedAt: string;
  /** Fecha relevante de la tarea (scheduled_for / opened_at) para la columna "Fecha". */
  primaryDate?: string | null;
}

interface Props {
  rows: HistoryRow[];
  emptyHint: string;
}

/**
 * Tabla compacta read-only para el historial semanal de Limpieza / Mantenimiento /
 * Tareas. Lo que el cron de lunes 00:00 ART movió a archived_at aparece acá,
 * ordenado por fecha de archivo descendente.
 */
export function WeeklyHistoryTable({ rows, emptyHint }: Props) {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
        <Archive className="mx-auto mb-3 size-8 opacity-40" />
        <p>{emptyHint}</p>
        <p className="mt-1 text-xs">
          El reset semanal corre los lunes a las 00:00 ART.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unidad / Título</TableHead>
            <TableHead className="hidden sm:table-cell">Estado final</TableHead>
            <TableHead className="hidden md:table-cell">Fecha</TableHead>
            <TableHead className="text-right">Archivada</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <div className="leading-tight">{r.title}</div>
                {r.subtitle ? (
                  <div className="text-xs text-muted-foreground">{r.subtitle}</div>
                ) : null}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: `${r.statusColor}1a`,
                    color: r.statusColor,
                  }}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: r.statusColor }}
                  />
                  {r.statusLabel}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {r.primaryDate ? formatDateTime(r.primaryDate) : "—"}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                {formatDateTime(r.archivedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
