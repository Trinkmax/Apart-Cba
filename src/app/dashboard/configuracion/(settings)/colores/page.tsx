import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { BookingStatusColorsForm } from "@/components/settings/booking-status-colors-form";

export default async function ColoresPage() {
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") redirect("/dashboard");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          Colores de reservas
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Personalizá el color de cada estado de reserva. Aplica a la leyenda,
          los badges y las barras del calendario PMS.
        </p>
      </header>
      <BookingStatusColorsForm
        initialColors={organization.booking_status_colors ?? null}
      />
    </section>
  );
}
