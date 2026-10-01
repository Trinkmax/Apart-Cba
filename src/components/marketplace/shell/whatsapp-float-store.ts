/**
 * El link del botón flotante de WhatsApp. El botón vive en el layout de la web
 * y no sabe en qué página está: la página que sabe de qué se habla (la ficha,
 * con las fechas y huéspedes elegidos; el seguimiento de una reserva, con su
 * código) publica acá su link mientras está montada y lo retira al irse. Sin
 * nada publicado, el botón usa el saludo general del sitio.
 *
 * Sólo lo escriben efectos del navegador: en el server nunca cambia (null).
 */

type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function getWhatsAppTopicUrl(): string | null {
  return current;
}

export function subscribeWhatsAppTopic(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publica el link con contexto de la página (null = el saludo general). */
export function setWhatsAppTopicUrl(url: string | null): void {
  if (url === current) return;
  current = url;
  for (const listener of listeners) listener();
}

/**
 * Lo retira sólo si sigue siendo el suyo: al navegar, la página nueva puede
 * publicar el suyo antes de que la vieja termine de desmontarse.
 */
export function clearWhatsAppTopicUrl(url: string | null): void {
  if (current === url) setWhatsAppTopicUrl(null);
}
