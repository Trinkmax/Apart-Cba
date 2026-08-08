import { permanentRedirect } from "next/navigation";

/**
 * Ruta legacy — "Organización" dejó de ser un módulo aparte y ahora es la
 * pestaña General del módulo único de Configuración.
 */
export default function OrganizacionRedirect() {
  permanentRedirect("/dashboard/configuracion");
}
