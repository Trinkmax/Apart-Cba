import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { listBookings } from "@/lib/actions/bookings";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listAccounts } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import { BookingsListClient } from "@/components/bookings/bookings-list-client";

export default async function ReservasPage() {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) redirect("/dashboard");
  const canCreateBooking = can(role, "bookings", "create");
  const canViewMoney = can(role, "payments", "view");
  const [bookings, units, accounts] = await Promise.all([
    listBookings(),
    listUnitsEnriched(),
    canViewMoney ? listAccounts() : Promise.resolve([]),
  ]);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Reservas</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {bookings.length} reservas registradas
          </p>
        </div>
        {canCreateBooking && (
          <div className="flex items-center gap-2">
            <BookingFormDialog units={units} accounts={accounts} existingBookings={bookings}>
              <Button className="gap-2"><Plus size={16} /> <span className="hidden sm:inline">Nueva reserva</span><span className="sm:hidden">Nueva</span></Button>
            </BookingFormDialog>
          </div>
        )}
      </div>

      <BookingsListClient
        bookings={bookings}
        units={units}
        organizationId={organization.id}
        canViewMoney={canViewMoney}
      />
    </div>
  );
}
