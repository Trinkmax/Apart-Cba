import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnitRef } from "@/lib/types/database";

/**
 * Bloque de ubicación y acceso de una unidad para las vistas de detalle de
 * tickets de mantenimiento y tareas de limpieza. El personal de campo lo usa
 * para llegar e ingresar a la unidad sin tener que consultar a administración.
 *
 * Componente presentacional puro (sin hooks) → se puede usar tanto en server
 * como en client components. Sólo muestra los campos que estén cargados.
 */
export function UnitAccessInfo({
  unit,
  className,
}: {
  unit: UnitRef;
  className?: string;
}) {
  const direccion = [unit.address, unit.neighborhood]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(" · ");

  const ubicacionInterna = [
    unit.tower ? `Torre ${unit.tower}` : null,
    unit.floor ? `Piso ${unit.floor}` : null,
    unit.apartment ? `Depto ${unit.apartment}` : null,
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");

  const notas = unit.internal_extra?.trim();
  const vacio = !direccion && !ubicacionInterna && !notas;

  return (
    <div className={cn("rounded-lg border bg-muted/30 p-3 space-y-1.5", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <MapPin size={13} />
        Ubicación y acceso
      </div>

      {vacio ? (
        <p className="text-sm text-muted-foreground italic">
          Esta unidad todavía no tiene dirección cargada.
        </p>
      ) : (
        <div className="space-y-1.5 text-sm">
          {direccion && <p className="font-medium leading-snug">{direccion}</p>}
          {ubicacionInterna && (
            <p className="text-muted-foreground leading-snug">{ubicacionInterna}</p>
          )}
          {notas && (
            <div className="pt-1.5 mt-0.5 border-t">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Notas internas
              </p>
              <p className="whitespace-pre-wrap leading-snug mt-0.5">{notas}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
