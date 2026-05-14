import Link from "next/link";
import { Plus, Hotel } from "lucide-react";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listOwners } from "@/lib/actions/owners";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { UnitFormDialog } from "@/components/units/unit-form-dialog";
import { UnitsGrid } from "@/components/units/units-grid";

export default async function UnidadesPage() {
  const [units, owners, { role }] = await Promise.all([
    listUnitsEnriched(),
    listOwners(),
    getCurrentOrg(),
  ]);
  const canDelete = can(role, "units", "delete");
  const canCreateUnit = can(role, "units", "create");
  const canViewMoney = can(role, "payments", "view");

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Unidades</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {units.length} {units.length === 1 ? "unidad" : "unidades"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/unidades/kanban" className="hidden sm:block">
            <Button variant="outline" className="gap-2">
              <Hotel size={16} /> Calendario
            </Button>
          </Link>
          {canCreateUnit && (
            <UnitFormDialog owners={owners}>
              <Button className="gap-2 shrink-0">
                <Plus size={16} /> <span className="hidden sm:inline">Nueva unidad</span><span className="sm:hidden">Nueva</span>
              </Button>
            </UnitFormDialog>
          )}
        </div>
      </div>

      <UnitsGrid
        units={units}
        canDelete={canDelete}
        canViewMoney={canViewMoney}
        emptyCta={
          canCreateUnit ? (
            <UnitFormDialog owners={owners}>
              <Button className="gap-2">
                <Plus size={16} /> Crear primera unidad
              </Button>
            </UnitFormDialog>
          ) : null
        }
      />
    </div>
  );
}
