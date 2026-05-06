import type { CrmWorkflowGraph } from "@/lib/types/database";
import { getNode } from "./registry";

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateWorkflowGraph(graph: CrmWorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  const { nodes, edges } = graph;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    errors.push({ code: "graph_invalid", message: "Grafo malformado." });
    return errors;
  }

  const triggerNodes = nodes.filter((n) => {
    const def = getNode(n.type);
    return def?.isTrigger;
  });
  if (triggerNodes.length === 0) {
    errors.push({ code: "no_trigger", message: "El workflow necesita al menos un nodo trigger." });
  }
  if (triggerNodes.length > 1) {
    errors.push({ code: "multiple_triggers", message: "Solo puede haber un nodo trigger por workflow." });
  }

  // Validar config de cada nodo
  for (const node of nodes) {
    const def = getNode(node.type);
    if (!def) {
      errors.push({ code: "unknown_node", message: `Tipo de nodo desconocido: ${node.type}`, nodeId: node.id });
      continue;
    }
    const parsed = def.configSchema.safeParse(node.data?.config ?? {});
    if (!parsed.success) {
      errors.push({
        code: "invalid_config",
        message: `Config inválida en "${def.label}": ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        nodeId: node.id,
      });
    }
  }

  // Edges sin source/target en grafo
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ code: "edge_dangling", message: "Edge con source inexistente.", edgeId: edge.id });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ code: "edge_dangling", message: "Edge con target inexistente.", edgeId: edge.id });
    }
  }

  // Validar handles de output específicos por nodo
  for (const node of nodes) {
    const def = getNode(node.type);
    if (!def) continue;
    const validHandles = new Set(def.outputs.map((o) => o.id));
    const outgoing = edges.filter((e) => e.source === node.id);
    for (const e of outgoing) {
      const handle = e.sourceHandle ?? "next";
      if (!validHandles.has(handle)) {
        errors.push({
          code: "invalid_edge_handle",
          message: `Edge desde "${def.label}" usa handle desconocido: ${handle}`,
          edgeId: e.id,
        });
      }
    }
    // condition exige edges en yes y no
    if (def.type === "condition") {
      const handles = outgoing.map((e) => e.sourceHandle ?? "next");
      if (!handles.includes("yes") || !handles.includes("no")) {
        errors.push({
          code: "condition_missing_branch",
          message: 'Nodo "Condición" debe tener edges en "Sí" y "No".',
          nodeId: node.id,
        });
      }
    }
  }

  // Cycle detection (simple DFS, ignorando loops intencionales del nodo loop)
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        // ciclo: si pasa por nodo loop, OK; si no, error.
        const inLoop = nodes.find((n) => n.id === u)?.type === "loop"
          || nodes.find((n) => n.id === v)?.type === "loop";
        if (!inLoop) {
          errors.push({ code: "cycle_detected", message: "El workflow tiene un ciclo sin nodo Loop.", nodeId: u });
          return true;
        }
      } else if (c === WHITE) {
        if (dfs(v)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }
  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) dfs(n.id);
  }

  return errors;
}
