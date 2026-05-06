import type { z } from "zod";

// SupabaseClient con schema 'apartcba' — usamos `any` para evitar conflictos con
// el genérico de schema string literal del cliente generado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type NodeCategory = "trigger" | "messages" | "logic" | "ai" | "actions" | "pms";

export interface NodeOutput {
  id: string; // 'next' | 'yes' | 'no' | 'replied' | 'timeout' | 'success' | 'error' | ...
  label?: string;
}

export interface NodeDefinition<TConfig = Record<string, unknown>> {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string; // lucide icon name
  accentColor: "green" | "amber" | "violet" | "red" | "blue" | "zinc";
  configSchema: z.ZodSchema<TConfig>;
  defaultConfig: TConfig;
  outputs: NodeOutput[];
  isTerminal?: boolean;
  /** Para triggers: solo aparece como nodo inicial. */
  isTrigger?: boolean;
  execute: (ctx: NodeContext, config: TConfig) => Promise<NodeResult>;
}

export interface NodeContext {
  organizationId: string;
  conversationId?: string;
  contactId?: string;
  channelId?: string;
  triggerMessageId?: string;
  variables: Record<string, unknown>;
  workflowId: string;
  runId: string;
  emitEvent: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
  log: (level: "info" | "warn" | "error", msg: string, meta?: unknown) => void;
  admin: AdminClient;
}

export type NodeResult =
  | { kind: "next"; outputId?: string; output?: Record<string, unknown> }
  | { kind: "branch"; outputId: string; output?: Record<string, unknown> }
  | { kind: "wait_time"; resumeAt: Date }
  | { kind: "wait_reply"; conversationId: string; timeoutAt?: Date }
  | { kind: "error"; error: string; isRetryable?: boolean }
  | { kind: "stop" };

// Extract z.output type from schema for execute signature (handles defaults).
type SchemaOutput<T> = T extends z.ZodType<infer Out, z.ZodTypeDef, unknown> ? Out : never;

export function defineNode<TSchema extends z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>>(
  def: Omit<NodeDefinition<SchemaOutput<TSchema>>, "configSchema"> & { configSchema: TSchema },
): NodeDefinition<SchemaOutput<TSchema>> {
  return def as unknown as NodeDefinition<SchemaOutput<TSchema>>;
}
