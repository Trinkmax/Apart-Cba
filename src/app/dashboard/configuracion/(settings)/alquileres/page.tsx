import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { getRentalSettings } from "@/lib/actions/rentals-settings";
import { RentalsModuleToggle } from "@/components/rentals/settings/module-toggle";
import { RentalsSettingsForm } from "@/components/rentals/settings/rentals-settings-form";

export const metadata = { title: "Configuración · Alquileres" };

export default async function AlquileresSettingsPage() {
  const { role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");
  const res = await getRentalSettings();

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Alquileres</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Cómo trabaja tu inmobiliaria con los alquileres tradicionales: vencimientos y punitorios, honorarios, índices y
          los datos que van en los recibos. Son los valores con los que arranca cada contrato nuevo.
        </p>
      </header>
      {!res.ok ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{res.error}</p>
      ) : (
        <>
          <RentalsModuleToggle enabled={res.enabled} />
          <RentalsSettingsForm initial={res.settings} />
        </>
      )}
    </section>
  );
}
