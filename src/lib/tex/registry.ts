/**
 * Qué herramientas ve cada rol y cómo se le presentan al modelo (nov-2026).
 * Puro: recibe la lista (src/lib/tex/tools/index.ts) por parámetro, así se
 * prueba sin importar las server actions.
 */
import { z } from "zod/v4";
import { can, isAdminLevel } from "@/lib/permissions";
import type { UserRole } from "@/lib/types/database";
import type { TexTool } from "./tool";

/** Las herramientas que el rol puede usar, en el orden de la lista (orden fijo = caché estable). */
export function toolsForRole(tools: readonly TexTool[], role: UserRole): TexTool[] {
  return tools.filter((t) => {
    if (t.roles && !t.roles.includes(role)) return false;
    if (t.adminLevel && !isAdminLevel(role)) return false;
    if (t.resource === "*") return true;
    return can(role, t.resource, t.action);
  });
}

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };
  eager_input_streaming: true;
};

/** JSON Schema para el modelo (sin `$schema`, que no aporta y no siempre se acepta). */
export function inputJsonSchema(tool: TexTool): AnthropicToolDef["input_schema"] {
  // `io: "input"`: un campo con `.default()` es opcional para el modelo.
  const raw = z.toJSONSchema(tool.input, { target: "draft-2020-12", unrepresentable: "any", io: "input" }) as Record<
    string,
    unknown
  >;
  const { $schema: _drop, ...schema } = raw;
  void _drop;
  if (schema.type !== "object") {
    throw new Error(`La herramienta ${tool.name} tiene que recibir un objeto.`);
  }
  return schema as AnthropicToolDef["input_schema"];
}

export function anthropicTools(tools: readonly TexTool[]): AnthropicToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputJsonSchema(t),
    // Con streaming, los inputs llegan a medida que se generan; el servidor ya
    // no los valida: los valida Zod antes de correr nada.
    eager_input_streaming: true as const,
  }));
}

/** Cuenta los `anyOf`/`oneOf`/`type: [...]` de un schema (el tope de Anthropic en modo estricto es 16). */
export function countUnions(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  if (Array.isArray(schema)) return schema.reduce((n: number, s) => n + countUnions(s), 0);
  const o = schema as Record<string, unknown>;
  let n = 0;
  if (Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) n += 1;
  if (Array.isArray(o.type)) n += 1;
  for (const v of Object.values(o)) n += countUnions(v);
  return n;
}
