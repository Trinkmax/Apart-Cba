import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";
import { isStaleActionText } from "./stale-deploy-text";

/**
 * Una Server Action que REVIENTA en el cliente (no llegó a devolver
 * `{ ok: false }`) casi siempre es una de dos cosas:
 *
 * - Hubo un deploy mientras la pantalla estaba abierta y el servidor nuevo no
 *   reconoce la acción vieja: `UnrecognizedActionError`. Reintentar falla
 *   igual hasta recargar la página. El id de una acción es un hash de su
 *   archivo y su nombre salado con `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; sin
 *   esa variable fija en Vercel, Next genera una clave nueva cada 14 días (o
 *   cuando el build no trae caché) y cambian TODOS los ids. Con la clave fija
 *   sólo pasa con una acción que se renombró, movió o borró. No hay Skew
 *   Protection (plan Hobby).
 * - Se cortó la conexión. Ahí sí sirve reintentar.
 *
 * Decirle "revisá la conexión" a alguien con conexión perfecta lo hace
 * reintentar en loop; por eso los dos casos llevan textos distintos.
 */
export function isStaleDeployError(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error) || isStaleActionText(error);
}

const STALE_TOAST_ID = "stale-deploy";
const STALE_DESCRIPTION =
  "Se actualizó el sistema mientras tenías esto abierto: recargá la página para seguir.";

type ToastError = typeof toast.error;

function showStaleToast(show: ToastError, title: Parameters<ToastError>[0], afterReload?: string) {
  // Un id fijo: si fallan varias acciones a la vez, se ve un solo aviso.
  return show(title, {
    id: STALE_TOAST_ID,
    description: afterReload ? `${STALE_DESCRIPTION} ${afterReload}` : STALE_DESCRIPTION,
    action: { label: "Recargar", onClick: () => window.location.reload() },
    duration: 30_000,
  });
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
    showStaleToast(toast.error, title, copy.afterReload);
    return;
  }
  toast.error(title, { description: copy.retry ?? "Revisá la conexión y probá de nuevo." });
}

/**
 * La red de abajo, para las ~40 pantallas que hacen `toast.error(err.message)`:
 * cualquier toast de error que traiga el texto de Next se muestra como el aviso
 * de deploy nuevo, con «Recargar». Y una acción que nadie atrapó también avisa,
 * en vez de fallar en silencio. Lo monta el `<Toaster />` de la raíz.
 */
export function installStaleDeployGuard(): () => void {
  const original = toast.error;
  const guarded: ToastError = (message, data) => {
    const inTitle = isStaleActionText(message);
    if (inTitle || isStaleActionText(data?.description)) {
      // Si el texto de Next era el título, no dice nada: se reemplaza.
      return showStaleToast(original, inTitle ? "No se guardó" : message);
    }
    return original(message, data);
  };
  toast.error = guarded;

  const onRejection = (event: PromiseRejectionEvent) => {
    if (!isStaleDeployError(event.reason)) return;
    event.preventDefault();
    showStaleToast(original, "No se guardó");
  };
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    if (toast.error === guarded) toast.error = original;
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
