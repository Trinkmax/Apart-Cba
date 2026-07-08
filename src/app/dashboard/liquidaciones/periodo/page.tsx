import { redirect } from "next/navigation";

/**
 * La vista "Por período" se unificó dentro de `/dashboard/liquidaciones` (tab
 * client-side). Esta ruta queda solo como redirect para no romper bookmarks ni
 * enlaces viejos: conserva año/mes/moneda y fuerza el tab de período.
 */
export default async function LiquidacionesPeriodoRedirect({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; currency?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  params.set("tab", "periodo");
  if (sp.year) params.set("year", sp.year);
  if (sp.month) params.set("month", sp.month);
  if (sp.currency) params.set("currency", sp.currency);
  redirect(`/dashboard/liquidaciones?${params.toString()}`);
}
