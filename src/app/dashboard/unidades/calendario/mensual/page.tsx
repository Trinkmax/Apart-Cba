import { listBookingsMonthlyView } from "@/lib/actions/bookings";
import { listScheduleInRange } from "@/lib/actions/payment-schedule";
import { listAccounts } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { PmsMonthlyBoard } from "@/components/units/pms/pms-monthly-board";

export default async function PmsMonthlyPage() {
  // Ventana por defecto: mes corriente + 5 meses hacia adelante (6 meses).
  const today = new Date();
  const fromYear = today.getFullYear();
  const fromMonth = today.getMonth() + 1;
  const monthsForward = 5;
  const totalMonths = fromMonth + monthsForward;
  const toYear = fromYear + Math.floor((totalMonths - 1) / 12);
  const toMonth = ((totalMonths - 1) % 12) + 1;

  const fromISO = `${fromYear}-${String(fromMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(toYear, toMonth, 0).getDate();
  const toISO = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [cells, schedule, accounts, { organization }] = await Promise.all([
    listBookingsMonthlyView(fromYear, fromMonth, toYear, toMonth),
    listScheduleInRange(fromISO, toISO),
    listAccounts(),
    getCurrentOrg(),
  ]);

  return (
    <PmsMonthlyBoard
      cells={cells}
      schedule={schedule}
      accounts={accounts}
      fromYear={fromYear}
      fromMonth={fromMonth}
      monthsCount={6}
      orgCurrency={organization.default_currency ?? "ARS"}
    />
  );
}
