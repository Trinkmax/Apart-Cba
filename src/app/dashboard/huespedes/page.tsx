import { Plus } from "lucide-react";
import { listGuests } from "@/lib/actions/guests";
import { Button } from "@/components/ui/button";
import { GuestFormDialog } from "@/components/guests/guest-form-dialog";
import { GuestsListClient } from "@/components/guests/guests-list-client";

export default async function HuespedesPage() {
  const guests = await listGuests();

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Huéspedes</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {guests.length} {guests.length === 1 ? "huésped" : "huéspedes"}
          </p>
        </div>
        <GuestFormDialog>
          <Button className="gap-2 shrink-0">
            <Plus size={16} />
            <span className="hidden sm:inline">Nuevo huésped</span>
            <span className="sm:hidden">Nuevo</span>
          </Button>
        </GuestFormDialog>
      </div>

      <GuestsListClient guests={guests} />
    </div>
  );
}
