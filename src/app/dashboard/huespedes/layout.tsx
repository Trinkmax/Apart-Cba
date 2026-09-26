import { StaffOnly } from "@/components/auth/staff-only";

// Pantalla de operación interna: el rol "Propietario" no entra (ver StaffOnly).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <StaffOnly>{children}</StaffOnly>;
}
