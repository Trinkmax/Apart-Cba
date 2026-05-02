import { Plus } from "lucide-react";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { OwnerFormDialog } from "@/components/owners/owner-form-dialog";
import { OwnersListClient } from "@/components/owners/owners-list-client";

export default async function PropietariosPage() {
  const owners = await listOwners();

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Propietarios</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {owners.length} {owners.length === 1 ? "propietario" : "propietarios"}
          </p>
        </div>
        <OwnerFormDialog>
          <Button className="gap-2 shrink-0">
            <Plus size={16} />
            <span className="hidden sm:inline">Nuevo propietario</span>
            <span className="sm:hidden">Nuevo</span>
          </Button>
        </OwnerFormDialog>
      </div>

      <OwnersListClient owners={owners} />
    </div>
  );
}
