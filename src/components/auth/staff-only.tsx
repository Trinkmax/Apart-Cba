import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";

/**
 * Cierra un segmento del dashboard al rol "Propietario" (owner_view).
 *
 * Va en el layout.tsx de cada segmento que un propietario no debe abrir.
 * Hace falta además del guard de /dashboard/layout.tsx: ese layout no se
 * vuelve a renderizar en una navegación del lado del cliente (un <Link>), y
 * el de cada segmento sí, al entrar al segmento. Ver src/lib/auth/route-access.ts.
 */
export async function StaffOnly({ children }: { children: React.ReactNode }) {
  const { role } = await getCurrentOrg();
  if (role === "owner_view") redirect("/dashboard");
  return <>{children}</>;
}
