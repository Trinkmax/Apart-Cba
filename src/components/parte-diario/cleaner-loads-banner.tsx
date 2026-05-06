import { Users } from "lucide-react";
import type { ParteDiarioCleanerLoad } from "@/lib/types/database";

interface CleanerLoadsBannerProps {
  loads: ParteDiarioCleanerLoad[];
}

/**
 * Banner horizontal compacto que muestra la carga del equipo del día.
 * Ubicado entre la fila CH IN/OUT y la fila de servicio (Mant/Sucios/Tareas)
 * para dar contexto antes de asignar.
 */
export function CleanerLoadsBanner({ loads }: CleanerLoadsBannerProps) {
  if (loads.length === 0) return null;
  const max = Math.max(...loads.map((l) => l.count), 1);

  return (
    <section className="rounded-2xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <Users className="size-4 text-cyan-500" />
          <h2 className="text-sm font-semibold">Carga del equipo</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            tareas asignadas hoy
          </span>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 ml-auto">
          {loads.map((l) => (
            <li key={l.user_id} className="flex items-center gap-2 min-w-[160px]">
              <span className="text-xs font-medium truncate flex-1">{l.full_name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{ width: `${(l.count / max) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums w-5 text-right text-muted-foreground">
                  {l.count}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
