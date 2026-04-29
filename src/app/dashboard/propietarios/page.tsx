import { Plus } from "lucide-react";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { OwnerFormDialog } from "@/components/owners/owner-form-dialog";
import { OwnersListClient } from "@/components/owners/owners-list-client";

export default async function PropietariosPage() {
  const owners = await listOwners();

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Propietarios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dueños de las unidades · {owners.length} {owners.length === 1 ? "propietario" : "propietarios"}
          </p>
        </div>
        <OwnerFormDialog>
          <Button className="gap-2">
            <Plus size={16} />
            Nuevo propietario
          </Button>
        </OwnerFormDialog>
      </div>

      <OwnersListClient owners={owners} />
    </div>
  );
}
