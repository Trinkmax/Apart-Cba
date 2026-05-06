import { permanentRedirect } from "next/navigation";

export default function LegacyCrmConfigRedirect() {
  permanentRedirect("/dashboard/configuracion/mensajeria");
}
