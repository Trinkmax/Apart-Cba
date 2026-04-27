import { Boxes } from "lucide-react";
import {
  listAmenities,
  listInventoryMovements,
  listUnitAmenities,
} from "@/lib/actions/amenities";
import { listUnitsEnriched } from "@/lib/actions/units";
import { InventoryWorkspace } from "@/components/amenities/inventory-workspace";

export default async function InventarioPage() {
  const [amenities, units, unitAmenities, movements] = await Promise.all([
    listAmenities(),
    listUnitsEnriched(),
    listUnitAmenities(),
    listInventoryMovements({ limit: 100 }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Boxes className="size-5 text-primary" />
            Inventario
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {amenities.length} ítems en el catálogo · {units.length} unidades
          </p>
        </div>
      </div>

      <InventoryWorkspace
        amenities={amenities}
        units={units.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
        unitAmenities={unitAmenities}
        movements={movements}
      />
    </div>
  );
}
