/**
 * Sustitución de variables tipo {{var_name}} en strings.
 * Soporta paths anidados {{contact.name}} y fallbacks {{var|fallback}}.
 */

export type VarsMap = Record<string, unknown>;

export function renderTemplate(input: string, vars: VarsMap): string {
  if (!input) return "";
  return input.replace(/\{\{\s*([^}|\s]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g, (_, path: string, fallback?: string) => {
    const value = resolvePath(vars, path);
    if (value === undefined || value === null || value === "") {
      return (fallback ?? "").trim();
    }
    return String(value);
  });
}

function resolvePath(obj: VarsMap, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Extrae los nombres de variables {{x}} de un string para validación.
 */
export function extractVariables(input: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([^}|\s]+)/g;
  let m;
  while ((m = re.exec(input))) set.add(m[1]);
  return Array.from(set);
}
