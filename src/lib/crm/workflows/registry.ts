import type { NodeDefinition, NodeCategory } from "./types";
import * as builtin from "./nodes/builtin";
import * as apartcba from "./nodes/apartcba";

const REGISTRY = new Map<string, NodeDefinition>();

function registerAll(modules: Record<string, unknown>[]) {
  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (isNodeDef(value)) REGISTRY.set(value.type, value);
    }
  }
}

function isNodeDef(v: unknown): v is NodeDefinition {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "execute" in v &&
    typeof (v as Record<string, unknown>).execute === "function"
  );
}

registerAll([builtin, apartcba]);

export function getNode(type: string): NodeDefinition | undefined {
  return REGISTRY.get(type);
}

export function listNodes(): NodeDefinition[] {
  return Array.from(REGISTRY.values());
}

export function listNodesByCategory(): Record<NodeCategory, NodeDefinition[]> {
  const grouped: Record<NodeCategory, NodeDefinition[]> = {
    trigger: [],
    messages: [],
    logic: [],
    ai: [],
    actions: [],
    pms: [],
  };
  for (const n of REGISTRY.values()) grouped[n.category].push(n);
  for (const cat of Object.keys(grouped) as NodeCategory[]) {
    grouped[cat].sort((a, b) => a.label.localeCompare(b.label));
  }
  return grouped;
}
