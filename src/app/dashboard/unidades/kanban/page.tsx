import { redirect } from "next/navigation";
import { listUnitsEnriched } from "@/lib/actions/units";
import { listBookingsInRange } from "@/lib/actions/bookings";
import { listAccounts } from "@/lib/actions/cash";
import { listScheduleInRange } from "@/lib/actions/payment-schedule";
import { listDateMarksInRange } from "@/lib/actions/date-marks";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { PmsBoard } from "@/components/units/pms/pms-board";
import { isoAddDays } from "@/components/units/pms/pms-constants";

export default async function PmsGridPage() {
  const { organization, role } = await getCurrentOrg();
  // El calendario muestra reservas como bloques en el grid; roles sin
  // acceso a reservas (mantenimiento / limpieza) van a la lista plana.
  if (!can(role, "bookings", "view")) redirect("/dashboard/unidades");

  // Ventana por defecto: 14 días atrás + 90 columnas (última ≈ hoy+75).
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 14);
  const end = new Date(today);
  end.setDate(today.getDate() + 75);

  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10); // última columna (inclusive)

  // Cota EXCLUSIVA de check-in para bookings = startISO + 90 días (≈ hoy+76).
  // `listBookingsInRange` filtra `check_in_date < to` (exclusivo), y el board
  // deriva su `loadedTo`/`initialWindowEnd` de `days={90}` con `isoAddDays`. Usamos
  // EL MISMO helper string-based acá (no aritmética de `Date` nativa) para que la
  // cota de la fetch y la frontera de purga del board nunca diverjan — si usaran
  // algoritmos distintos podrían correrse un día en zonas horarias con DST.
  const bookingsEndISO = isoAddDays(startISO, 90);

  const canViewMoney = can(role, "payments", "view");
  const canRegisterExpense = can(role, "cash", "create");
  const canEditBookings = can(role, "bookings", "update");
  const [units, bookings, accounts, schedule, dateMarks] = await Promise.all([
    listUnitsEnriched(),
    listBookingsInRange(startISO, bookingsEndISO),
    canViewMoney || canRegisterExpense ? listAccounts() : Promise.resolve([]),
    listScheduleInRange(startISO, endISO).catch(() => []),
    listDateMarksInRange(startISO, endISO).catch(() => []),
  ]);
  const expenseDefaultId = accounts.find((a) => a.is_expense_default)?.id ?? null;

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
      canRegisterExpense={canRegisterExpense}
      expenseDefaultId={expenseDefaultId}
      organizationId={organization.id}
      startISO={startISO}
      days={90}
      orgCurrency={organization.default_currency ?? "ARS"}
    />
  );
}
