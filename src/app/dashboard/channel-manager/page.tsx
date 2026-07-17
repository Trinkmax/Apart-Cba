import { redirect } from "next/navigation";

/**
 * Ruta legacy — el Channel Manager fue reemplazado por Canales de venta.
 * Redirección permanente para bookmarks y enlaces guardados.
 */
export default function ChannelManagerRedirect() {
  redirect("/dashboard/canales");
}
