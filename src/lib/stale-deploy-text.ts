/**
 * El texto con el que Next 16 avisa que el servidor no reconoce una Server
 * Action (`server-action-reducer`): la pantalla se cargó con un deploy y la
 * acción se llamó contra otro.
 *
 * Hace falta reconocerlo como TEXTO porque casi todas las pantallas convierten
 * el error en string antes de mostrarlo (`toast.error(err.message)`), y ahí ya
 * no queda la clase `UnrecognizedActionError` para preguntarle. Apart CBA,
 * 18/11/2026: subir fotos al Marketplace mostró «Server Action "40b7…" was not
 * found on the server» en inglés, sin decir qué hacer.
 */
const STALE_ACTION_TEXT = /Server Action "[^"]*" was not found on the server/;

export function isStaleActionText(value: unknown): boolean {
  if (typeof value === "string") return STALE_ACTION_TEXT.test(value);
  if (value instanceof Error) return STALE_ACTION_TEXT.test(value.message);
  return false;
}
