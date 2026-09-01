// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { Channel } from "./types";

/**
 * Política de SOLICITUDES por organización y canal.
 *
 * Vive en `channel_settings.config->'requests'` (migración 057) en vez de en una
 * variable de entorno porque el interruptor tiene que poder tocarse sin deploy:
 * si el gate se porta mal un domingo, un UPDATE lo apaga y el dispatcher vuelve
 * al comportamiento anterior en ≤2 minutos.
 *
 * El default de TODO es apagado. Las organizaciones que ni siquiera tienen fila
 * en `channel_settings` (hoy Habitana y Analia Piana) caen acá como `enabled:false`,
 * que es exactamente lo que corresponde: sin ingesta de email no hay promotor.
 */

export interface ChannelRequestPolicy {
  /** Si está apagado, el canal proyecta a `bookings` como siempre. */
  enabled: boolean;
  /**
   * Mientras la solicitud está pendiente, ¿bloquea la venta en la WEB PROPIA
   * (marketplace: date-picker y checkout)?
   *
   * Para Airbnb va en false por decisión del dueño: la solicitud todavía no es
   * una venta y el calendario no debe cerrarse hasta que se acepte.
   * Para Booking va en true: Booking.com no tiene solicitudes — sus reservas son
   * instantáneas — así que un VEVENT sin confirmar es o basura (marcadores de
   * ventana de disponibilidad) o una reserva YA VENDIDA cuya confirmación
   * todavía no cruzamos.
   *
   * NO gobierna el iCal saliente hacia las otras OTAs: eso se exporta siempre
   * (ver channelsExportedAsHolds). Son dos decisiones con radio de daño muy
   * distinto y meterlas en el mismo booleano abría una venta doble.
   */
  holdAvailability: boolean;
  /** Horas publicada en el feed tras las cuales se da por aceptada. */
  ttlHours: number;
  /** Umbral más corto cuando la llegada es inminente. */
  ttlHoursUrgent: number;
  /** Cuántos días antes del check-in se considera "inminente". */
  urgentDays: number;
  /** Si tiene elementos, sólo esas conexiones entran (canary). */
  onlyLinkIds: string[];
  excludeLinkIds: string[];
}

export type ChannelRequestPolicies = Record<Channel, ChannelRequestPolicy>;

export interface ChannelRequestPolicyRead {
  policies: ChannelRequestPolicies;
  /**
   * true = no se pudo leer la configuración (timeout, 5xx). NO es lo mismo que
   * "apagada": con el gate encendido, tratar un fallo de lectura como apagado
   * dispara el drenaje y convierte en reservas TODAS las solicitudes en vuelo,
   * incluidas las que la OTA ya rechazó. Cada consumidor decide qué hacer, pero
   * ninguno puede confundir las dos cosas.
   */
  failed: boolean;
}

const OFF: ChannelRequestPolicy = {
  enabled: false,
  holdAvailability: false,
  ttlHours: 26,
  ttlHoursUrgent: 3,
  urgentDays: 2,
  onlyLinkIds: [],
  excludeLinkIds: [],
};

const ALL_OFF: ChannelRequestPolicies = { airbnb: OFF, booking: OFF };

/**
 * Cache de módulo. En Fluid el módulo sobrevive entre invocaciones, así que el
 * dispatcher no paga una lectura de `channel_settings` por conexión (60 links ×
 * 1 query cada 2 min). 60 s es más corto que el intervalo de decisión de
 * cualquier operador y hace que apagar el flag surta efecto casi al instante.
 */
const CACHE = new Map<
  string,
  { value: ChannelRequestPolicies; failed: boolean; expiresAt: number }
>();
const CACHE_TTL_MS = 60_000;
const FAILURE_TTL_MS = 5_000;

export async function readChannelRequestPolicies(
  admin: AdminClient,
  organizationId: string,
): Promise<ChannelRequestPolicyRead> {
  const hit = CACHE.get(organizationId);
  if (hit && hit.expiresAt > Date.now()) return { policies: hit.value, failed: hit.failed };

  let value = ALL_OFF;
  // Un fallo de lectura NO se cachea un minuto entero: con el gate encendido,
  // durante ese minuto las filas nuevas nacerían `active` y se proyectarían
  // (vuelven los fantasmas), y el iCal saliente dejaría de retener justo
  // cuando la otra OTA hace su poll.
  let failed = false;
  try {
    // supabase-js NO lanza cuando vence el timeout de fetch: devuelve
    // `{ data: null, error }`. Sin leer el `error`, un timeout es
    // indistinguible de "esta organización no tiene política".
    const { data, error } = await admin
      .from("channel_settings")
      .select("config")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      console.error("[channels/request-policy] no se pudo leer la política", error.message);
      failed = true;
    }
    const raw = (data?.config as Record<string, unknown> | null)?.requests;
    if (raw && typeof raw === "object") {
      value = {
        airbnb: parsePolicy((raw as Record<string, unknown>).airbnb),
        booking: parsePolicy((raw as Record<string, unknown>).booking),
      };
    }
  } catch (err) {
    // Cualquier fallo cae al comportamiento actual: proyectar. Un gate que se
    // activa por error deja reservas reales invisibles; uno que se desactiva
    // por error sólo devuelve el bug conocido.
    console.error("[channels/request-policy] lectura de la política falló", err);
    value = ALL_OFF;
    failed = true;
  }

  CACHE.set(organizationId, {
    value,
    failed,
    expiresAt: Date.now() + (failed ? FAILURE_TTL_MS : CACHE_TTL_MS),
  });
  return { policies: value, failed };
}

/**
 * Versión que descarta el flag de fallo. Sólo para consumidores donde "no pude
 * leer" y "apagada" llevan al MISMO camino seguro: el comportamiento anterior
 * a la 057 (proyectar la reserva, exportar de más). No usar donde un fallo
 * pueda disparar una escritura.
 */
export async function getChannelRequestPolicies(
  admin: AdminClient,
  organizationId: string,
): Promise<ChannelRequestPolicies> {
  return (await readChannelRequestPolicies(admin, organizationId)).policies;
}

export async function getChannelRequestPolicy(
  admin: AdminClient,
  organizationId: string,
  channel: Channel,
): Promise<ChannelRequestPolicy> {
  return (await getChannelRequestPolicies(admin, organizationId))[channel] ?? OFF;
}

/** ¿La política alcanza a esta conexión? Sirve para el canary por link. */
export function appliesToLink(policy: ChannelRequestPolicy, linkId: string | null): boolean {
  if (!policy.enabled) return false;
  if (policy.excludeLinkIds.length > 0 && linkId && policy.excludeLinkIds.includes(linkId)) {
    return false;
  }
  if (policy.onlyLinkIds.length > 0) {
    return linkId !== null && policy.onlyLinkIds.includes(linkId);
  }
  return true;
}

/**
 * Canales cuya solicitud pendiente retiene disponibilidad en la WEB PROPIA.
 * Acá manda `hold_availability`, que es la decisión del dueño.
 */
export function channelsHoldingAvailability(policies: ChannelRequestPolicies): Channel[] {
  return (Object.keys(policies) as Channel[]).filter(
    (c) => policies[c].enabled && policies[c].holdAvailability,
  );
}

/**
 * Canales cuya solicitud pendiente se exporta en el iCal SALIENTE.
 *
 * Acá NO manda `hold_availability`: siempre que la política esté encendida se
 * exporta. Son dos cosas distintas con radio de daño distinto —
 * "no cerrar MI calendario" (decisión del dueño, reversible con un click) y
 * "dejar de bloquear a la OTRA OTA" (que nadie pidió y termina en venta doble:
 * hay 9 unidades con conexión activa de Airbnb y de Booking a la vez, y una
 * venta en Booking es instantánea e irreversible).
 *
 * Antes de este cambio, una solicitud de Airbnb — que hoy se proyecta y por eso
 * sale en el ICS — dejaba de exportarse durante hasta 26 h.
 */
export function channelsExportedAsHolds(policies: ChannelRequestPolicies): Channel[] {
  return (Object.keys(policies) as Channel[]).filter((c) => policies[c].enabled);
}

/** Horas de vida que tiene que tener una solicitud para darla por aceptada. */
export function ttlHoursFor(policy: ChannelRequestPolicy, daysToCheckIn: number | null): number {
  if (daysToCheckIn !== null && daysToCheckIn <= policy.urgentDays) return policy.ttlHoursUrgent;
  return policy.ttlHours;
}

function parsePolicy(raw: unknown): ChannelRequestPolicy {
  if (!raw || typeof raw !== "object") return OFF;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    holdAvailability: o.hold_availability === true,
    ttlHours: positive(o.ttl_hours, OFF.ttlHours),
    ttlHoursUrgent: positive(o.ttl_hours_urgent, OFF.ttlHoursUrgent),
    urgentDays: positive(o.urgent_days, OFF.urgentDays),
    onlyLinkIds: stringArray(o.only_link_ids),
    excludeLinkIds: stringArray(o.exclude_link_ids),
  };
}

function positive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** Sólo para tests / cambios de configuración desde la UI. */
export function invalidateChannelRequestPolicyCache(organizationId?: string): void {
  if (organizationId) CACHE.delete(organizationId);
  else CACHE.clear();
}
