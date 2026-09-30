import { t, type TKey } from "./dict";

/**
 * Traductor del server. La web es es-AR (sin selector de idioma): no lee
 * cookies, así las páginas que lo usan pueden ser estáticas/ISR. Se mantiene
 * async por compatibilidad con quienes hacen `await getServerT()`.
 *
 *   const t = await getServerT();
 *   <h1>{t("hero.title.part1")}</h1>
 */
export async function getServerT() {
  return (key: TKey, vars?: Record<string, string | number>) => t("es-AR", key, vars);
}
