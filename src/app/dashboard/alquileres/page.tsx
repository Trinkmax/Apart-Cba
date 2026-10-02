import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { can } from "@/lib/permissions";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { getRentalsDashboard } from "@/lib/actions/rentals-dashboard";
import { DashboardHero } from "@/components/rentals/dashboard/dashboard-hero";
import { TodoAgenda } from "@/components/rentals/dashboard/todo-agenda";
import { ExpiringPanel, IndicesPanel, UpcomingAdjustmentsPanel } from "@/components/rentals/dashboard/side-panels";
import { RentalsOnboarding } from "@/components/rentals/dashboard/rentals-onboarding";

export const metadata = { title: "Alquileres" };

/**
 * Resumen de Alquileres tradicionales: ¿cómo vamos este mes? y ¿qué tengo
 * que hacer hoy? — KPIs, agenda por urgencia y, al costado, lo que viene
 * (ajustes, vencimientos) y los índices.
 */
export default async function AlquileresPage() {
  const ctx = await requireRentalsPage();
  const res = await getRentalsDashboard();
  const canCreate = can(ctx.role, "rentals", "create");

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh
        tables={["rental_contracts", "rental_adjustments", "rental_charges", "rental_payments", "rental_proofs", "rental_payment_reports"]}
        label="novedad"
        labelPlural="novedades"
        throttleMs={5_000}
      />
      {!res.ok ? (
        <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">{res.error}</Card>
      ) : (
        <>
          <DashboardHero data={res.data} canCreate={canCreate} />
          {res.data.hasContracts ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
              <TodoAgenda agenda={res.data.agenda} />
              <div className="space-y-4">
                <UpcomingAdjustmentsPanel rows={res.data.upcomingAdjustments} today={res.data.today} />
                <ExpiringPanel rows={res.data.expiring} />
                <IndicesPanel indices={res.data.indices} />
              </div>
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
              <RentalsOnboarding canCreate={canCreate} />
              <IndicesPanel indices={res.data.indices} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
