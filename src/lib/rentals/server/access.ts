import "server-only";
import { redirect } from "next/navigation";
import { requireSession, type SessionContext } from "@/lib/actions/auth";
import { getCurrentOrg } from "@/lib/actions/org";
import { can, type Action } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_TIMEZONE, todayYmdInTz } from "@/lib/dates";
import type { Organization, UserRole } from "@/lib/types/database";

/**
 * Borde de seguridad del módulo Alquileres.
 *
 * Las server actions escriben con service role (la base no frena nada), así
 * que TODA lectura o escritura del módulo pasa por acá: sesión + org activa +
 * módulo encendido para la org + `can(role, "rentals", acción)`. Las actions
 * devuelven el error como valor (en producción Next.js pisa el mensaje de
 * cualquier throw); las pages usan `requireRentalsPage`, que redirige.
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface RentalsCtx {
  session: SessionContext;
  organization: Organization;
  role: UserRole;
  admin: AdminClient;
  /** Zona horaria de la org y "hoy" en esa zona (YYYY-MM-DD). */
  tz: string;
  today: string;
  /** Nombre para el historial ("Lucía Pérez"). */
  actorName: string;
}

export type ActionError = { ok: false; error: string; field?: string };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionError;

const DENIED: Record<Action, string> = {
  view: "No tenés permiso para ver los alquileres.",
  create: "No tenés permiso para cargar datos en alquileres.",
  update: "No tenés permiso para modificar alquileres.",
  delete: "No tenés permiso para borrar datos de alquileres.",
};

async function buildCtx(): Promise<RentalsCtx> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  const tz = organization.timezone || DEFAULT_ORG_TIMEZONE;
  return {
    session,
    organization,
    role,
    admin: createAdminClient(),
    tz,
    today: todayYmdInTz(tz),
    actorName: session.profile?.full_name || "Alguien del equipo",
  };
}

/** Para server actions: nunca lanza por permisos; devuelve el error en castellano. */
export async function rentalsContext(
  action: Action = "view",
): Promise<{ ok: true; ctx: RentalsCtx } | ActionError> {
  const ctx = await buildCtx();
  if (!ctx.organization.rentals_enabled) {
    return { ok: false, error: "El módulo de alquileres no está activado para esta organización." };
  }
  if (!can(ctx.role, "rentals", action)) return { ok: false, error: DENIED[action] };
  return { ok: true, ctx };
}

/** Para pages (server components): sin acceso → vuelve al dashboard. */
export async function requireRentalsPage(action: Action = "view"): Promise<RentalsCtx> {
  const ctx = await buildCtx();
  if (!ctx.organization.rentals_enabled || !can(ctx.role, "rentals", action)) redirect("/dashboard");
  return ctx;
}

export function logRentalsError(context: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  console.error(`[alquileres] ${context}: ${msg}`);
}

/** Prefijos estables que lanzan las funciones de la 068b; el texto que sigue ya está en castellano. */
const RPC_PREFIXES = [
  "CONTRATO_NO_ENCONTRADO",
  "IMPORTE_INVALIDO",
  "MONEDA_DISTINTA",
  "CUENTA_INVALIDA",
  "CARGO_INVALIDO",
  "IMPUTACION_INVALIDA",
  "IMPUTACION_EXCEDIDA",
  "SALDO_INSUFICIENTE",
  "COBRO_NO_ENCONTRADO",
  "COBRO_ANULADO",
  "YA_RENDIDO",
  "PROPIETARIO_NO_ENCONTRADO",
  "SIN_RENGLONES",
  "RENDICION_NO_ENCONTRADA",
  "RENDICION_CERRADA",
  "RENDICION_PAGADA",
  "SALDO_TRASLADADO",
  "SIN_SALDO",
  "SUMA_DISTINTA",
  // 068k: al generar una rendición, algo que toma (saldo, cobro, gasto) se anuló o cambió mientras tanto.
  "RENDICION_DESACTUALIZADA",
  // 068h: depósito en garantía (marcar cobrado, cerrar, deshacer; y el trigger que frena "despagarlo").
  "DEPOSITO",
  // 070: cobro con reparto (cobra el propietario) y la red que impide rendir lo que el propietario ya cobró.
  "REPARTO_INVALIDO",
  "COBRO_DIRECTO",
];

const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Respaldo: cada camino arma su mensaje con el contrato que choca. Desde la 068i la
  // ocupación llega hasta la salida registrada (o no tiene fin mientras se cobra la continuación).
  rental_contracts_no_overlap: "Ya hay un contrato vigente que ocupa esa propiedad en esas fechas: registrá antes su salida o cambiá las fechas.",
  rental_properties_org_code_key: "Ya hay una propiedad con ese código. Usá uno distinto.",
  rental_property_owners_unique: "Ese propietario ya figura en la propiedad.",
  rental_contract_parties_unique: "Esa persona ya figura en el contrato con ese rol.",
  rental_proofs_unique: "Ya hay un comprobante de ese tipo para ese mes.",
  rental_charges_monthly_key: "Ese período ya tiene su cargo.",
  rental_payments_receipt_key: "Ese número de recibo ya existe.",
  rental_owner_statement_lines_once_key: "Algo de esto ya figura en otra rendición del propietario.",
};

/**
 * Traduce un error de Postgres/PostgREST del módulo a un mensaje para una
 * persona. null = no lo reconoce (el caller loguea y muestra uno genérico).
 */
export function translateRentalsDbError(message: string | null | undefined): string | null {
  if (!message) return null;
  for (const prefix of RPC_PREFIXES) {
    const i = message.indexOf(`${prefix}:`);
    if (i >= 0) {
      const text = message.slice(i + prefix.length + 1).trim();
      return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
    }
  }
  for (const [constraint, text] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (message.includes(constraint)) return text;
  }
  if (message.includes("violates foreign key constraint")) {
    return "No se puede: hay otros datos que dependen de esto.";
  }
  return null;
}

/** Error genérico de escritura, logueando el detalle. */
export function dbFailure(context: string, error: { message?: string } | null | undefined, fallback: string): ActionError {
  const translated = translateRentalsDbError(error?.message);
  if (translated) return { ok: false, error: translated };
  logRentalsError(context, error);
  return { ok: false, error: fallback };
}
