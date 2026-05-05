import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { BookingStatusColorsForm } from "@/components/settings/booking-status-colors-form";

export default async function ColoresPage() {
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") redirect("/dashboard");

  return (
    <div className="page-x page-y space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
          Colores de reservas
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Personalizá el color de cada estado de reserva. Aplica a la leyenda,
          los badges y las barras del calendario PMS.
        </p>
      </div>
      <BookingStatusColorsForm
        initialColors={organization.booking_status_colors ?? null}
      />
    </div>
  );
}
