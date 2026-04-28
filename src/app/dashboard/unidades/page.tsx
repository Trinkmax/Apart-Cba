import Link from "next/link";
import { Plus, Hotel } from "lucide-react";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { UnitFormDialog } from "@/components/units/unit-form-dialog";
import { UnitsGrid } from "@/components/units/units-grid";

export default async function UnidadesPage() {
  const [units, owners] = await Promise.all([listUnitsEnriched(), listOwners()]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Unidades</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {units.length} {units.length === 1 ? "unidad" : "unidades"} activas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/unidades/kanban">
            <Button variant="outline" className="gap-2">
              <Hotel size={16} /> Calendario
            </Button>
          </Link>
          <UnitFormDialog owners={owners}>
            <Button className="gap-2">
              <Plus size={16} /> Nueva unidad
            </Button>
          </UnitFormDialog>
        </div>
      </div>

      <UnitsGrid
        units={units}
        emptyCta={
          <UnitFormDialog owners={owners}>
            <Button className="gap-2">
              <Plus size={16} /> Crear primera unidad
            </Button>
          </UnitFormDialog>
        }
      />
    </div>
  );
}
