/**
 * Tipos de Tex, el agente de Apart (nov-2026). Client-safe: los usan el
 * servidor (route + herramientas) y la hoja de Tex en el navegador.
 */
import type { UserRole } from "@/lib/types/database";

// ── Tarjetas: lo que la app dibuja con los datos de una herramienta ──────────

export type CardTone = "neutral" | "good" | "warn" | "bad" | "info";

export type CardIcon =
  | "calendar"
  | "bed"
  | "wallet"
  | "chart"
  | "broom"
  | "wrench"
  | "list"
  | "inbox"
  | "bell"
  | "file"
  | "user"
  | "home"
  | "search"
  | "key";

export type CardRow = {
  title: string;
  subtitle?: string;
  /** Texto chico a la derecha arriba (fecha, hora). */
  meta?: string;
  badge?: { label: string; tone: CardTone };
  /** Importe a la derecha (ya formateado, con moneda). */
  amount?: { value: string; tone?: CardTone };
  /** Pantalla de la app a la que lleva la fila. */
  href?: string;
};

export type StatTile = {
  label: string;
  value: string;
  hint?: string;
  tone?: CardTone;
};

export type TexCard =
  | {
      kind: "list";
      title: string;
      icon?: CardIcon;
      rows: CardRow[];
      /** Cuántas más hay que no entraron en la tarjeta. */
      more?: number;
      empty?: string;
      footer?: { label: string; href: string };
    }
  | {
      kind: "stats";
      title: string;
      icon?: CardIcon;
      tiles: StatTile[];
      note?: string;
      footer?: { label: string; href: string };
    }
  | {
      kind: "link";
      title: string;
      description?: string;
      href: string;
      cta: string;
    };

// ── Propuestas: una acción que la persona tiene que confirmar ────────────────

export type ProposalSummary = {
  /** "Registrar un gasto". */
  title: string;
  lines: Array<{ label: string; value: string }>;
  /** Aviso importante ("Le llega un mail al huésped"). */
  note?: string;
  /** Texto del botón ("Registrar gasto"). */
  confirmLabel: string;
  /** Pinta el botón en rojo (algo que no se deshace fácil). */
  danger?: boolean;
};

export type ProposalStatus = "pending" | "executing" | "executed" | "failed" | "cancelled" | "expired";

export type ProposalView = {
  id: string;
  tool: string;
  summary: ProposalSummary;
  status: ProposalStatus;
  /** Cuando se ejecutó: qué pasó y a dónde ir a verlo. */
  result?: { message: string; href?: string } | null;
  error?: string | null;
  expiresAt: string;
};

// ── Eventos del stream (NDJSON, una línea por evento) ────────────────────────

export type TexUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type TexEvent =
  | { t: "start"; conversationId: string }
  | { t: "text"; d: string }
  | { t: "tool"; id: string; name: string; label: string; state: "start" | "done" | "error"; note?: string }
  | { t: "card"; id: string; card: TexCard }
  | { t: "proposal"; action: ProposalView }
  | { t: "navigate"; href: string; label: string }
  /** Respuestas que la persona puede tocar en vez de escribir ("Sí, $ 180.000", "Sin seña"). */
  | { t: "replies"; items: string[] }
  /** Retirar los últimos `chars` caracteres mostrados (un intento que se repite). */
  | { t: "rewind"; chars: number }
  | { t: "done"; usage?: TexUsage; stop?: string }
  | { t: "error"; message: string; code?: TexErrorCode };

export type TexErrorCode =
  | "unauthorized"
  | "forbidden"
  | "disabled"
  | "not_configured"
  | "rate_limited"
  | "budget"
  | "refusal"
  | "timeout"
  | "upstream"
  | "bad_request";

// ── Lo que se guarda para volver a dibujar una conversación ──────────────────

export type TexPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; label: string; state: "done" | "error"; note?: string }
  | { type: "card"; id: string; card: TexCard }
  | { type: "proposal"; actionId: string }
  | { type: "navigate"; href: string; label: string }
  | { type: "replies"; items: string[] };

export type TexHistoryMessage =
  | { id: string; role: "user"; text: string; createdAt: string }
  | { id: string; role: "assistant"; parts: TexPart[]; createdAt: string };

export type TexConversationView = {
  conversationId: string | null;
  messages: TexHistoryMessage[];
  /** Estado actual de las propuestas que aparecen en la conversación. */
  actions: Record<string, ProposalView>;
};

/** Desde qué pantalla se abrió Tex (para las sugerencias y el contexto). */
export type TexOpenContext = {
  pathname: string;
  /** Pregunta para mandar apenas se abre (la tarjeta "Tex te cuenta"). */
  prompt?: string;
};

export type TexRole = UserRole;
