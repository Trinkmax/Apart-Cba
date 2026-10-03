import { StaffOnly } from "@/components/auth/staff-only";
import { RentalsNav } from "@/components/rentals/rentals-nav";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadRentalsNavCounts } from "@/lib/rentals/server/nav-counts";

// Alquileres tradicionales ("Tradicionales" en el menú): sólo staff (no
// propietarios) y sólo si la org tiene el módulo encendido
// (organizations.rentals_enabled, migración 068).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const ctx = await requireRentalsPage("view");
  // Sin await: la barra de pestañas se pinta ya y los contadores llegan por
  // streaming (RentalsNav los lee con use() dentro de un Suspense).
  const counts = loadRentalsNavCounts(ctx);
  return (
    <StaffOnly>
      {/* El aviso "N novedades · actualizar" (fijo arriba) baja para no tapar las pestañas. */}
      <div style={{ "--live-pill-top": "7.75rem" } as React.CSSProperties}>
        <RentalsNav counts={counts} />
        {children}
      </div>
    </StaffOnly>
  );
}
