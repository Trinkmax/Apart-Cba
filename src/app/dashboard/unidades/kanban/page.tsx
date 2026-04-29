import { listUnitsEnriched } from "@/lib/actions/units";
import { listBookingsInRange } from "@/lib/actions/bookings";
import { listAccounts } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { PmsBoard } from "@/components/units/pms/pms-board";

export default async function PmsGridPage() {
  // Ventana por defecto: 14 días atrás + 75 días hacia adelante = ~90 días
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 14);
  const end = new Date(today);
  end.setDate(today.getDate() + 75);

  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);

  const [units, bookings, accounts, { organization }] = await Promise.all([
    listUnitsEnriched(),
    listBookingsInRange(startISO, endISO),
    listAccounts(),
    getCurrentOrg(),
  ]);

  return (
    <PmsBoard
      initialUnits={units}
      initialBookings={bookings}
      accounts={accounts}
      organizationId={organization.id}
      startISO={startISO}
      days={90}
      orgCurrency={organization.default_currency ?? "ARS"}
    />
  );
}
