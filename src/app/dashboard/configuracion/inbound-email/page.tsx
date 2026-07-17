import { redirect } from "next/navigation";

/**
 * Ruta legacy — el "Email Parser" desapareció como producto separado.
 * La configuración de email vive dentro de Canales de venta.
 */
export default function InboundEmailRedirect() {
  redirect("/dashboard/canales");
}
