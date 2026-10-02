import { StaffOnly } from "@/components/auth/staff-only";
import { requireRentalsPage } from "@/lib/rentals/server/access";

// Alquileres tradicionales: sólo staff (no propietarios) y sólo si la org tiene
// el módulo encendido (organizations.rentals_enabled, migración 068).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRentalsPage("view");
  return <StaffOnly>{children}</StaffOnly>;
}
