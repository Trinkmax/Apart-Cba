/**
 * Los botones de respuesta de Tex (nov-2026). Tocar uno manda su texto como si
 * la persona lo hubiera escrito. Si dos opciones muestran el mismo texto (dos
 * huéspedes «Juan Pérez», dos tramos del mismo contrato), el modelo tiene que
 * adivinar cuál era: justo lo que `choose` existe para evitar. Puro, con tests.
 */

const MAX_REPLIES = 6;
const MAX_LEN = 60;

const fit = (raw: unknown): string => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN).trim();
const key = (s: string) => s.toLocaleLowerCase("es");

/** Respuestas sugeridas a una pregunta: cortas, sin repetidas, como mucho 6. */
export function cleanReplies(items: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items ?? []) {
    const t = fit(raw);
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(t);
    if (out.length === MAX_REPLIES) break;
  }
  return out;
}

/**
 * Un botón por candidato (en el mismo orden), o ninguno. Si dos nombres se
 * repiten, esos botones suman su detalle ("Juan Pérez · 351 555-1234"); si aun
 * así hay dos iguales, o son más de 6, no hay botones: la persona elige
 * escribiendo, con la lista que arma Tex.
 */
export function choiceButtons(options: ReadonlyArray<{ label: string; detail?: string }>): string[] {
  if (options.length === 0 || options.length > MAX_REPLIES) return [];
  const labels = options.map((o) => fit(o.label));
  const count = new Map<string, number>();
  for (const l of labels) count.set(key(l), (count.get(key(l)) ?? 0) + 1);
  const texts = options.map((o, i) => {
    const repeated = (count.get(key(labels[i])) ?? 0) > 1;
    const detail = fit(o.detail);
    return repeated && detail ? fit(`${o.label} · ${detail}`) : labels[i];
  });
  const seen = new Set<string>();
  for (const t of texts) {
    if (!t || seen.has(key(t))) return [];
    seen.add(key(t));
  }
  return texts;
}
