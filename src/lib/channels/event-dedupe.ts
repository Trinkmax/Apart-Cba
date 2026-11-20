/**
 * ¿Un evento «repetido» es de verdad lo último que se vio de esa reserva?
 *
 * La clave de un VEVENT sale de su contenido (UID + fechas + número). Existe
 * para no reprocesar la misma lectura cada cinco minutos, pero la unicidad es
 * contra TODO lo que alguna vez se guardó, no contra lo último. Si un
 * calendario pasa por A → B → A, la tercera lectura trae la clave de la
 * primera: se descartaba por repetida y la fila quedaba en B para siempre, con
 * el barrido intentándolo (y descartándolo) en cada lectura.
 *
 * GAMA de Viaggiato (19/11/2026): Booking publicó 26→30/11 el 13/11, lo acortó
 * a 26→27 el 17/11 y lo volvió a 26→30. El sistema lo tenía 26→27 (y con la
 * reserva cancelada a mano) mientras Booking lo mostraba cerrado hasta el 30:
 * tres noches libres acá y vendidas o cerradas allá. En producción, 38 de 312
 * UIDs de Booking cambiaron la salida al menos una vez y 12 dos veces o más:
 * volver a un estado anterior no es raro.
 *
 * Regla: repetido es sólo lo que coincide con lo ÚLTIMO que se procesó de ese
 * UID en esa conexión. Puro; la lectura y el guardado están en ingest.ts.
 */

/** Lo último que se procesó de un UID. */
export interface StoredEventRef {
  id: string;
  content_hash: string | null;
  processed_at: string | null;
}

/**
 * El evento choca con uno ya procesado (`duplicateOfId`), pero después de ese
 * se procesó otro con OTRO contenido: el calendario volvió a un estado anterior
 * y hay que mirarlo de nuevo.
 */
export function isReturnToEarlierState(
  incomingHash: string | null | undefined,
  duplicateOfId: string,
  latest: StoredEventRef | null | undefined,
): boolean {
  if (!incomingHash || !latest) return false;
  // Lo último que se procesó es justamente este: repetido de verdad.
  if (latest.id === duplicateOfId) return false;
  // Lo último ya tiene este contenido (la variante «sobre-cancelada» de la
  // misma lectura, o una vuelta que ya se guardó).
  if (latest.content_hash === incomingHash) return false;
  return true;
}

/**
 * La clave con la que se guarda la vuelta. Lleva el evento que la precede Y
 * cuándo se procesó: el mismo par A/B puede ir y venir más de una vez
 * (A → B → A → B → A), y un B que quedó «para revisar» se reprocesa con el
 * mismo id. Mientras no se procese nada más de ese UID la clave no cambia, así
 * que un reintento de la misma vuelta sigue siendo un repetido.
 */
export function returnDedupeKey(baseKey: string, latest: Pick<StoredEventRef, "id" | "processed_at">): string {
  const at = latest.processed_at ? Date.parse(latest.processed_at) : NaN;
  return `${baseKey}:vuelve:${latest.id}:${Number.isNaN(at) ? 0 : at}`;
}
