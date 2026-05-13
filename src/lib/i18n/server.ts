import { getActiveLocale } from "@/lib/actions/marketplace-preferences";
import { t, type TKey } from "./dict";

/**
 * Server-side translator. Returns a `t()` bound to the cookie-resolved locale,
 * so server components can render translated text without prop drilling.
 *
 * Usage:
 *   const t = await getServerT();
 *   <h1>{t("hero.title.part1")}</h1>
 */
export async function getServerT() {
  const locale = await getActiveLocale();
  return (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}
