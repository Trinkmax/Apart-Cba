import Link from "next/link";
import { Archive, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Pathname base — el toggle agrega/quita ?historial=1. */
  basePath: string;
  /** Si la vista actual ya está mostrando el historial. */
  active: boolean;
}

/**
 * Toggle "Activo ↔ Historial" para los tableros de Limpieza, Mantenimiento y
 * Tareas. El reset semanal (cron lunes 00:00 ART) mueve las tareas finalizadas
 * al historial sin borrarlas — este botón permite consultarlas.
 */
export function HistoryToggle({ basePath, active }: Props) {
  if (active) {
    return (
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link href={basePath} prefetch={false}>
          <LayoutDashboard className="size-4" />
          Volver al tablero
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
      <Link href={`${basePath}?historial=1`} prefetch={false}>
        <Archive className="size-4" />
        Ver historial
      </Link>
    </Button>
  );
}
