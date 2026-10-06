import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";

/**
 * Una Server Action que REVIENTA en el cliente (no llegó a devolver
 * `{ ok: false }`) casi siempre es una de dos cosas:
 *
 * - Hubo un deploy mientras la pantalla estaba abierta. Los ids de las
 *   acciones cambian en cada build y no hay Skew Protection (plan Hobby), así
 *   que el servidor nuevo no reconoce la acción vieja: `UnrecognizedActionError`.
 *   Reintentar falla igual hasta recargar la página.
 * - Se cortó la conexión. Ahí sí sirve reintentar.
 *
 * Decirle "revisá la conexión" a alguien con conexión perfecta lo hace
 * reintentar en loop; por eso los dos casos llevan textos distintos.
 */
export function isStaleDeployError(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error);
}

type ActionFailureCopy = {
  /** Qué hacer si fue la conexión. Default: "Revisá la conexión y probá de nuevo." */
  retry?: string;
  /** Qué pasa al recargar (p. ej. "Lo que cargaste vuelve a aparecer."). */
  afterReload?: string;
};

/** Toast para el `catch` de una Server Action: distingue deploy nuevo de conexión. */
export function toastActionFailure(error: unknown, title: string, copy: ActionFailureCopy = {}): void {
  if (isStaleDeployError(error)) {
    toast.error(title, {
      description: `Se actualizó el sistema mientras tenías esto abierto: recargá la página para seguir.${
        copy.afterReload ? ` ${copy.afterReload}` : ""
      }`,
      action: { label: "Recargar", onClick: () => window.location.reload() },
      duration: 30_000,
    });
    return;
  }
  toast.error(title, { description: copy.retry ?? "Revisá la conexión y probá de nuevo." });
}
