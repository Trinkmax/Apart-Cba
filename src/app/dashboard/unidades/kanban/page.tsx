import { redirect } from "next/navigation";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listBookingsInRange } from "@/lib/actions/bookings";
import { listAccounts } from "@/lib/actions/cash";
import { listScheduleInRange } from "@/lib/actions/payment-schedule";
import { listDateMarksInRange } from "@/lib/actions/date-marks";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { PmsBoard } from "@/components/units/pms/pms-board";

export default async function PmsGridPage() {
  const { organization, role } = await getCurrentOrg();
  // El calendario muestra reservas como bloques en el grid; roles sin
  // acceso a reservas (mantenimiento / limpieza) van a la lista plana.
  if (!can(role, "bookings", "view")) redirect("/dashboard/unidades");

  // Ventana por defecto: 14 días atrás + 75 días hacia adelante = ~90 días
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 14);
  const end = new Date(today);
  end.setDate(today.getDate() + 75);

  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);

  const canViewMoney = can(role, "payments", "view");
  const canEditBookings = can(role, "bookings", "update");
  const [units, bookings, accounts, schedule, dateMarks] = await Promise.all([
    listUnitsEnriched(),
    listBookingsInRange(startISO, endISO),
    canViewMoney ? listAccounts() : Promise.resolve([]),
    listScheduleInRange(startISO, endISO).catch(() => []),
    listDateMarksInRange(startISO, endISO).catch(() => []),
  ]);

  return (
    <PmsBoard
      initialUnits={units}
      initialBookings={bookings}
      accounts={accounts}
      initialSchedule={schedule}
      initialDateMarks={dateMarks}
      canEditDateMarks={can(role, "date_marks", "create")}
      canEditBookings={canEditBookings}
      canViewMoney={canViewMoney}
      organizationId={organization.id}
      startISO={startISO}
      days={90}
      orgCurrency={organization.default_currency ?? "ARS"}
    />
  );
}
