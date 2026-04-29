import { Plus } from "lucide-react";
import { listGuests } from "@/lib/actions/guests";
import { Button } from "@/components/ui/button";
import { GuestFormDialog } from "@/components/guests/guest-form-dialog";
import { GuestsListClient } from "@/components/guests/guests-list-client";

export default async function HuespedesPage() {
  const guests = await listGuests();

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Huéspedes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {guests.length} {guests.length === 1 ? "huésped" : "huéspedes"} registrados
          </p>
        </div>
        <GuestFormDialog>
          <Button className="gap-2"><Plus size={16} /> Nuevo huésped</Button>
        </GuestFormDialog>
      </div>

      <GuestsListClient guests={guests} />
    </div>
  );
}
