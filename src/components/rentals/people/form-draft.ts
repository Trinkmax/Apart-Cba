/**
 * Borradores de los formularios de Alquileres (alta de propiedad y de persona).
 * Funciones puras: saber si el formulario tiene algo tipeado y (de)serializar
 * lo que se guarda en sessionStorage. La parte con React vive en use-form-draft.ts.
 *
 * Por qué existe: cerrar el diálogo tiraba en silencio todo lo cargado (el
 * 05/10 la primera propiedad se tipeó cuatro veces y nunca llegó a guardarse).
 * Ahora se pregunta antes de cerrar y, si la pestaña se recarga o se navega,
 * al volver a abrir "Nueva …" aparece lo escrito hasta que se guarda o se descarta.
 */

const DRAFT_VERSION = 1;

/** Una clave por organización, usuario y tipo de formulario: nunca se cruzan borradores. */
export function draftStorageKey(kind: string, organizationId: string, userId: string): string {
  return `apartcba.alquileres.borrador.${kind}.${organizationId}.${userId}`;
}

/** Saca el `key` de las filas (es un id de React, no algo que la persona tipeó). */
export function withoutRowKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return withoutRowKeys(row);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (k !== "key") out[k] = withoutRowKeys(v);
      return out;
    });
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = withoutRowKeys(v);
    return out;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    // Un campo ausente, undefined o null es lo mismo: "no hay nada".
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (!deepEqual(ra[k] ?? null, rb[k] ?? null)) return false;
    }
    return true;
  }
  return false;
}

/** ¿Los dos estados tienen lo mismo cargado? Ignora los ids de fila y el orden de las claves. */
export function sameFormValues(a: unknown, b: unknown): boolean {
  return deepEqual(withoutRowKeys(a), withoutRowKeys(b));
}

export function encodeDraft(form: unknown, now: Date = new Date()): string {
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: now.toISOString(), form: withoutRowKeys(form) });
}

export interface DecodedDraft {
  savedAt: string;
  form: Record<string, unknown>;
}

/** Lo guardado, o null si no hay, está roto o es de otra versión del formulario. */
export function decodeDraft(raw: string | null | undefined): DecodedDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; form?: unknown } | null;
    if (!parsed || parsed.v !== DRAFT_VERSION || typeof parsed.savedAt !== "string") return null;
    const form = parsed.form;
    if (!form || typeof form !== "object" || Array.isArray(form)) return null;
    return { savedAt: parsed.savedAt, form: form as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Arreglo por campo: devuelve el valor ya validado, o undefined para dejar el vacío. */
export type DraftFieldFix<T> = { [K in keyof T]?: (stored: unknown) => T[K] | undefined };

/**
 * Arma el estado del formulario desde lo guardado, campo por campo: sólo los
 * campos que el formulario conoce y con el mismo tipo. Un borrador viejo o
 * tocado a mano no puede romper el formulario: lo que no encaja queda vacío.
 * Las listas (filas) y los valores de un menú necesitan su `fix`.
 */
export function mergeDraft<T extends object>(blank: T, stored: Record<string, unknown>, fixes: DraftFieldFix<T> = {}): T {
  const out = { ...blank };
  for (const k of Object.keys(blank) as (keyof T & string)[]) {
    if (!(k in stored)) continue;
    const value = stored[k];
    const fix = fixes[k];
    if (fix) {
      const fixed = fix(value);
      if (fixed !== undefined) out[k] = fixed;
      continue;
    }
    const base = blank[k];
    if (Array.isArray(base) || value === null || value === undefined) continue;
    if (typeof value === typeof base) out[k] = value as T[typeof k];
  }
  return out;
}

/** `fix` para un campo de menú: sólo vale si es una de las opciones. */
export function oneOf<V extends string>(options: readonly V[]): (stored: unknown) => V | undefined {
  return (stored) => (typeof stored === "string" && (options as readonly string[]).includes(stored) ? (stored as V) : undefined);
}
