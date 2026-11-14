/**
 * Cómo se define una herramienta de Tex (nov-2026).
 *
 * Dos clases:
 * - `read`: consulta y devuelve datos (para el modelo) + una tarjeta (para la app).
 * - `write`: NUNCA escribe al llamarla. `propose` resuelve y valida, y devuelve
 *   el payload normalizado + un resumen armado por código; la app muestra la
 *   tarjeta de confirmación y recién cuando la persona toca «Confirmar»,
 *   `confirmTexAction` (src/lib/actions/tex.ts) re-valida el payload con
 *   `payload` y corre `execute`.
 *
 * Las herramientas envuelven las server actions existentes (src/lib/actions/*):
 * corren adentro del route handler con la cookie de la persona, así que
 * `requireSession()`/`getCurrentOrg()` y el filtro de `organization_id` siguen
 * en un solo lugar. Ojo: esas actions redirigen (`NEXT_REDIRECT`) en vez de
 * devolver error; `attempt()` lo convierte en un error legible.
 */
import type { z } from "zod/v4";
import type { Action, Resource } from "@/lib/permissions";
import type { UserRole } from "@/lib/types/database";
import type { ProposalSummary, TexCard } from "./types";

export type ToolContext = {
  org: { id: string; name: string; timezone: string; currency: string; rentalsEnabled: boolean };
  user: { id: string; name: string; firstName: string };
  role: UserRole;
  /** Hoy y mañana en la zona horaria de la organización (`YYYY-MM-DD`). */
  today: string;
  tomorrow: string;
  conversationId: string;
};

export type ReadResult =
  | {
      ok: true;
      /** Lo que lee el modelo: compacto, sin ids internos innecesarios, ≤ 40 filas. */
      data: unknown;
      /** Lo que dibuja la app (una o varias tarjetas). */
      card?: TexCard;
      cards?: TexCard[];
      /** `abrir_pantalla`: la app muestra el botón para ir. */
      navigate?: { href: string; label: string };
    }
  | { ok: false; error: string };

export type ChoiceOption = { id: string; label: string; detail?: string };

export type ProposeResult<P> =
  | { ok: true; payload: P; summary: ProposalSummary }
  /** Algo no cierra: el modelo tiene que corregir o preguntarle a la persona. */
  | { ok: false; error: string }
  /** Hay más de un candidato: NUNCA se elige solo ("Zulma Pereyra" ≠ "Camila Ferreyra"). */
  | { ok: "choose"; question: string; options: ChoiceOption[] };

export type ExecuteResult =
  | { ok: true; message: string; href?: string; data?: unknown }
  | { ok: false; error: string };

type BaseTool<I> = {
  /** snake_case, en castellano: lo lee el modelo. */
  name: string;
  /** Lo que se ve mientras corre: "Buscando reservas…". */
  label: string;
  /** Para el modelo: qué hace, cuándo usarla y cuándo no. */
  description: string;
  input: z.ZodType<I>;
  /** `can(role, resource, action)` decide si el rol la ve. "*" = todos. */
  resource: Resource | "*";
  action: Action;
  /** Sólo admin/recepción (hay actions que chequean `isAdminLevel`). */
  adminLevel?: boolean;
  /** Si está, sólo estos roles la ven (además de `can`). */
  roles?: readonly UserRole[];
};

export type ReadTool<I = unknown> = BaseTool<I> & {
  kind: "read";
  run: (input: I, ctx: ToolContext) => Promise<ReadResult>;
};

export type WriteTool<I = unknown, P = unknown> = BaseTool<I> & {
  kind: "write";
  /** Esquema del payload guardado: se vuelve a validar antes de ejecutar. */
  payload: z.ZodType<P>;
  propose: (input: I, ctx: ToolContext) => Promise<ProposeResult<P>>;
  execute: (payload: P, ctx: ToolContext) => Promise<ExecuteResult>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TexTool = ReadTool<any> | WriteTool<any, any>;

// `NoInfer`: los tipos salen SÓLO de los esquemas Zod (`input`, `payload`), no
// de lo que devuelve `propose` (ahí un literal como "owner" se ensancharía a string).
export function defineRead<I>(
  t: BaseTool<I> & { run: (input: NoInfer<I>, ctx: ToolContext) => Promise<ReadResult> },
): ReadTool<I> {
  return { ...t, kind: "read" };
}

export function defineWrite<I, P>(
  t: BaseTool<I> & {
    payload: z.ZodType<P>;
    propose: (input: NoInfer<I>, ctx: ToolContext) => Promise<ProposeResult<NoInfer<P>>>;
    execute: (payload: NoInfer<P>, ctx: ToolContext) => Promise<ExecuteResult>;
  },
): WriteTool<I, P> {
  return { ...t, kind: "write" };
}

/** Los errores de navegación de Next (`redirect()`, `notFound()`) traen un digest propio. */
function isNextNavigationError(e: unknown): boolean {
  if (!e || typeof e !== "object" || !("digest" in e)) return false;
  const d = String((e as { digest?: unknown }).digest ?? "");
  return d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND") || d.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

/**
 * Corre una server action y nunca tira: devuelve el valor o un error legible.
 * Llamadas en el servidor, los mensajes en castellano de las actions conservan
 * su texto (Next sólo los enmascara cuando cruzan al navegador).
 */
export async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isNextNavigationError(e)) return { ok: false, error: "No tenés acceso a esto con tu usuario." };
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Algo falló.";
    return { ok: false, error: translateDbError(msg).slice(0, 500) };
  }
}

/** Los nombres de constraints que la gente no tiene por qué leer. */
export function translateDbError(msg: string): string {
  if (/bookings_no_overlap/i.test(msg)) return "Ya hay una reserva en esa unidad para esas fechas.";
  if (/bookings_dates_valid/i.test(msg)) return "La salida tiene que ser después de la llegada.";
  if (/duplicate key value/i.test(msg)) return "Eso ya existe.";
  if (/violates foreign key/i.test(msg)) return "Falta algo que esto necesita (una unidad, una cuenta o una persona que ya no está).";
  return msg;
}

/** Pantallas de la app para linkear desde las tarjetas. */
export const hrefs = {
  booking: (id: string) => `/dashboard/reservas/${id}`,
  bookings: () => "/dashboard/reservas",
  calendar: () => "/dashboard/unidades/kanban",
  unit: (id: string) => `/dashboard/unidades/${id}`,
  guests: () => "/dashboard/huespedes",
  owner: (id: string) => `/dashboard/propietarios/${id}`,
  cash: () => "/dashboard/caja",
  cashAccount: (id: string) => `/dashboard/caja/${id}`,
  results: () => "/dashboard/resultados",
  settlements: () => "/dashboard/liquidaciones",
  settlement: (id: string) => `/dashboard/liquidaciones/${id}`,
  requests: () => "/dashboard/reservas-pendientes",
  request: (id: string) => `/dashboard/reservas-pendientes/${id}`,
  cleaning: () => "/dashboard/limpieza",
  maintenance: () => "/dashboard/mantenimiento",
  tasks: () => "/dashboard/tareas",
  parte: () => "/dashboard/parte-diario",
  alerts: () => "/dashboard/alertas",
  ticketField: (id: string) => `/m/mantenimiento/${id}`,
} as const;
