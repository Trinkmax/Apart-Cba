import { Plus } from "lucide-react";
import { listBookings } from "@/lib/actions/bookings";
import { listUnitsEnriched } from "@/lib/actions/units";
import { Button } from "@/components/ui/button";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import { BookingsListClient } from "@/components/bookings/bookings-list-client";

export default async function ReservasPage() {
  const [bookings, units] = await Promise.all([listBookings(), listUnitsEnriched()]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reservas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {bookings.length} reservas registradas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BookingFormDialog units={units}>
            <Button className="gap-2"><Plus size={16} /> Nueva reserva</Button>
          </BookingFormDialog>
        </div>
      </div>

      <BookingsListClient bookings={bookings} units={units} />
    </div>
  );
}
