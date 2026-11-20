/**
 * «SAL648 · SALGUERO II», o «GAMA» a secas cuando el código y el nombre son lo
 * mismo. En Viaggiato todas las unidades se llaman igual que su código: los
 * avisos decían «GAMA · GAMA». Puro.
 */
export function unitDisplay(
  code: string | null | undefined,
  name: string | null | undefined,
  fallback = "Una unidad",
): string {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  if (!c && !n) return fallback;
  if (!c) return n;
  if (!n || n.toLowerCase() === c.toLowerCase()) return c;
  return `${c} · ${n}`;
}
