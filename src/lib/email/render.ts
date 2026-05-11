/**
 * Sustituye {{path.to.var}} en un template plain-text con valores de un
 * objeto. Escape básico de HTML solo si renderHtml=true.
 *
 * Variables permitidas: lookup nested via "."
 *   { guest: { first_name: "María" } } + "{{guest.first_name}}" → "María"
 *
 * Variables faltantes se dejan literales para que sea obvio en debug.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
  options: { escapeHtml?: boolean } = {}
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as object)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, variables);
    if (value === undefined || value === null) return `{{${path}}}`;
    const str = String(value);
    return options.escapeHtml ? escapeHtml(str) : str;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convierte texto plano a HTML simple: párrafos con <p>, links autodetect,
 * line breaks con <br>.
 */
export function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
