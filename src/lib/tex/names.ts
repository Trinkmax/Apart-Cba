/** "Ignacio Baldovino" → "Ignacio". Puro (lo usan layouts y Tex). */
export function firstNameOf(fullName: string | null | undefined, fallback = "vos"): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || fallback;
}
