import { redirect } from "next/navigation";
import { listBookingsMonthlyView } from "@/lib/actions/bookings";
import { listScheduleInRange } from "@/lib/actions/payment-schedule";
import { listAccounts } from "@/lib/actions/cash";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { PmsMonthlyBoard } from "@/components/units/pms/pms-monthly-board";

export default async function PmsMonthlyPage() {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) redirect("/dashboard/unidades");

  // Ventana por defecto: 1 mes ATRÁS + mes corriente + 5 adelante = 7 meses.
  // Arrancar un mes antes evita que el mes recién pasado (y sus reservas/cuotas)
  // desaparezca de esta vista — la navegación < / > sólo desplaza sobre los meses
  // ya traídos, así que el mes anterior tiene que venir en el fetch inicial.
  const today = new Date();
  const anchor = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const fromYear = anchor.getFullYear();
  const fromMonth = anchor.getMonth() + 1;
  const monthsForward = 6;
  const totalMonths = fromMonth + monthsForward;
  const toYear = fromYear + Math.floor((totalMonths - 1) / 12);
  const toMonth = ((totalMonths - 1) % 12) + 1;

  const fromISO = `${fromYear}-${String(fromMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(toYear, toMonth, 0).getDate();
  const toISO = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [cells, schedule, accounts] = await Promise.all([
    listBookingsMonthlyView(fromYear, fromMonth, toYear, toMonth),
    listScheduleInRange(fromISO, toISO).catch(() => []),
    listAccounts(),
  ]);

  return (
    <PmsMonthlyBoard
      cells={cells}
      schedule={schedule}
      accounts={accounts}
      fromYear={fromYear}
      fromMonth={fromMonth}
      monthsCount={7}
      orgCurrency={organization.default_currency ?? "ARS"}
    />
  );
}
