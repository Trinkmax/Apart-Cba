import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import {
  listBookingsPaged,
  listBookingsForOverlapCheck,
} from "@/lib/actions/bookings";
import { listUnitsForBookingForm } from "@/lib/actions/units";
import { listAccounts } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import { BookingsListClient } from "@/components/bookings/bookings-list-client";
import type { BookingStatus } from "@/lib/types/database";

const PAGE_SIZE = 50;

type PageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ReservasPage({ searchParams }: PageProps) {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) redirect("/dashboard");
  const canCreateBooking = can(role, "bookings", "create");
  const canViewMoney = can(role, "payments", "view");

  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const q = sp.q?.trim() || undefined;
  const status = (sp.status as BookingStatus | undefined) || undefined;

  // La ventana por defecto (90 días + futuro, desactivada al buscar) la
  // resuelve listBookingsPaged internamente — ver su doc.
  const [paged, units, accounts, overlapBookings] = await Promise.all([
    listBookingsPaged({ page, pageSize: PAGE_SIZE, q, status }),
    listUnitsForBookingForm(),
    canViewMoney ? listAccounts() : Promise.resolve([]),
    canCreateBooking
      ? listBookingsForOverlapCheck()
      : Promise.resolve([]),
  ]);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Reservas</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {paged.totalAll} reservas registradas
          </p>
        </div>
        {canCreateBooking && (
          <div className="flex items-center gap-2">
            <BookingFormDialog units={units} accounts={accounts} existingBookings={overlapBookings}>
              <Button className="gap-2"><Plus size={16} /> <span className="hidden sm:inline">Nueva reserva</span><span className="sm:hidden">Nueva</span></Button>
            </BookingFormDialog>
          </div>
        )}
      </div>

      <BookingsListClient
        rows={paged.rows}
        total={paged.total}
        page={paged.page}
        pageSize={paged.pageSize}
        initialQuery={q ?? ""}
        initialStatus={status ?? "all"}
        organizationId={organization.id}
        canViewMoney={canViewMoney}
      />
    </div>
  );
}
