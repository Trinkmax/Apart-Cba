import type {
  RentalProperty,
  RentalPropertyAvailability,
  RentalServiceKind,
} from "@/lib/types/database";
import type { StatusMeta } from "@/lib/rentals/labels";
import type { PropertyInput } from "./property-types";
import { contractMonthsElapsed, diffDays } from "@/lib/rentals/ymd";

/**
 * Lógica pura de Propiedades (sin I/O): la usan el formulario (validación en
 * vivo) y las server actions (validación que manda) por igual.
 */

// ─── Código de la propiedad ──────────────────────────────────────────────────

/** Largo máximo del código (CHECK de la 068: 1..40). */
export const PROPERTY_CODE_MAX = 40;

/** Prefijos de tipo de calle que no aportan al código ("Av. Colón" → COLON). */
const STREET_PREFIXES = new Set([
  "AV", "AVDA", "AVENIDA", "BV", "BVD", "BVARD", "BOULEVARD", "BULEVAR", "CALLE",
  "PJE", "PSJE", "PASAJE", "DIAG", "DIAGONAL", "RUTA", "CAMINO",
]);
/** Conectores que se caen si queda más de una palabra ("27 de Abril" → 27ABRIL). */
const CONNECTORS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function alnumUpper(s: string | null | undefined): string {
  return stripAccents(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/**
 * Código corto sugerido a partir de la dirección: "Dean Funes 450, 3°B" →
 * "DEANFUNES450-3B". Vacío si todavía no hay calle.
 */
export function suggestPropertyCode(
  p: Partial<Pick<RentalProperty, "street" | "street_number" | "floor" | "apartment" | "tower">>,
): string {
  let words = stripAccents(p.street ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && STREET_PREFIXES.has(words[0])) words = words.slice(1);
  if (words.length > 1) {
    const kept = words.filter((w) => !CONNECTORS.has(w));
    if (kept.length) words = kept;
  }
  const street = words.join("").slice(0, 14);
  if (!street) return "";
  const base = `${street}${alnumUpper(p.street_number).slice(0, 6)}`;
  const tower = alnumUpper(p.tower).slice(0, 4);
  const unit = `${alnumUpper(p.floor).slice(0, 4)}${alnumUpper(p.apartment).slice(0, 4)}`;
  return [base, tower ? `T${tower}` : "", unit].filter(Boolean).join("-").slice(0, PROPERTY_CODE_MAX);
}

/** Normaliza lo que tipeó la persona: mayúsculas, sin acentos ni espacios raros. */
export function normalizePropertyCode(raw: string | null | undefined): string {
  return stripAccents(raw ?? "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9\-_./]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROPERTY_CODE_MAX);
}

/** Primer código libre: BASE, BASE-2, BASE-3… (comparación sin distinguir mayúsculas). */
export function firstFreeCode(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (c) => c.toUpperCase()));
  if (!used.has(base.toUpperCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, PROPERTY_CODE_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
  return base;
}

/**
 * Código tipeado que ya es de otra propiedad (la misma regla con la que el
 * servidor lo rechaza), con un código libre para proponer. `selfId`: la
 * propiedad que se edita, o el id con el que se va a crear el alta (si ya
 * se guardó y la respuesta se perdió, su código no choca consigo mismo).
 */
export function findCodeClash(
  codes: readonly { id: string; code: string; label: string }[],
  selfId: string | null,
  raw: string,
): { code: string; label: string; fix: string } | null {
  const typed = normalizePropertyCode(raw);
  if (!typed) return null;
  const taken = codes.filter((c) => c.id !== selfId);
  const hit = taken.find((c) => c.code.toUpperCase() === typed);
  return hit ? { code: typed, label: hit.label, fix: firstFreeCode(typed, taken.map((c) => c.code)) } : null;
}

/** Lo guardado, tal como lo devuelve el servidor (los numéricos pueden venir como texto). */
export interface SavedPropertySnapshot {
  property: RentalProperty;
  owners: readonly { owner_id: string; ownership_pct: number | string; is_primary: boolean }[];
}

/** Lo que manda el formulario (textos recortados, vacíos en null), o lo mismo ya validado por el esquema. */
export type PropertyDiffInput = Omit<PropertyInput, "id">;

/**
 * Qué difiere entre la propiedad que ya había quedado guardada (se perdió la
 * respuesta, o se recargó en medio del guardado) y lo que hay ahora en el
 * formulario, dicho como se ve en pantalla ("la dirección", "los
 * propietarios"…). Vacío = es lo mismo. Un código vacío no cuenta: al
 * guardar se conserva el que ya tiene.
 */
export function savedPropertyDiffs(saved: SavedPropertySnapshot, now: PropertyDiffInput): string[] {
  const p = saved.property;
  const txt = (v: string | null | undefined) => (v ?? "").trim() || null;
  const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
  const differs = (keys: readonly (keyof PropertyDiffInput & keyof RentalProperty)[], kind: "text" | "num" | "raw") =>
    keys.some((k) => {
      const a = (p as unknown as Record<string, unknown>)[k];
      const b = (now as unknown as Record<string, unknown>)[k];
      if (kind === "text") return txt(a as string | null) !== txt(b as string | null);
      if (kind === "num") return num(a as number | null) !== num(b as number | null);
      return typeof b === "boolean" ? Boolean(a) !== b : (a ?? null) !== (b ?? null);
    });
  const out: string[] = [];
  if (differs(["street", "street_number", "floor", "apartment", "tower", "neighborhood", "city", "province", "postal_code"], "text")) out.push("la dirección");
  const code = normalizePropertyCode(now.code);
  if (code && code !== p.code) out.push("el código");
  const ownerKey = (o: { owner_id: string; ownership_pct: number | string; is_primary: boolean }) => `${o.owner_id}|${round2(Number(o.ownership_pct))}|${o.is_primary}`;
  const savedOwners = saved.owners.map(ownerKey).sort().join(",");
  if (savedOwners !== now.owners.map(ownerKey).sort().join(",")) out.push("los propietarios");
  if (differs(["property_type", "furnished", "has_garage"], "raw") || differs(["rooms", "bedrooms", "bathrooms", "covered_m2", "total_m2"], "num")) out.push("cómo es");
  if (differs(["availability"], "raw")) out.push("la disponibilidad");
  const rent = num(now.listing_rent);
  const savedRent = num(p.listing_rent);
  if (rent !== savedRent || (rent != null && (now.listing_currency ?? "ARS") !== (p.listing_currency ?? "ARS"))) out.push("el precio");
  if (differs(["consortium_name", "consortium_phone", "consortium_email", "functional_unit", "cadastral_id"], "text")) out.push("el consorcio");
  const service = (s: PropertyDiffInput["services"][number]) => [s.kind, txt(s.provider), txt(s.account_number), txt(s.holder), txt(s.notes)].join("|");
  const savedServices = (Array.isArray(p.services) ? p.services : []).map(service).join("\n");
  if (savedServices !== now.services.map(service).join("\n")) out.push("los servicios");
  if (txt(p.mandate_signed_at) !== txt(now.mandate_signed_at)) out.push("el mandato");
  if (txt(p.notes) !== txt(now.notes)) out.push("las notas");
  return out;
}

// ─── Titulares ───────────────────────────────────────────────────────────────

export interface OwnershipRow {
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatPctEs(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/**
 * Reglas de los titulares: al menos uno, sin repetir, cada % entre 0 y 100,
 * suman exactamente 100 % (la rendición reparte lo cobrado por %) y hay un
 * solo titular principal.
 */
export function validateOwnership(rows: OwnershipRow[]): { ok: true } | { ok: false; error: string } {
  if (!rows.length) {
    return { ok: false, error: "Agregá al menos un propietario: a él se le rinde lo que se cobra." };
  }
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r.owner_id) return { ok: false, error: "Elegí el propietario en cada fila." };
    if (ids.has(r.owner_id)) return { ok: false, error: "Hay un propietario repetido." };
    ids.add(r.owner_id);
    if (!Number.isFinite(r.ownership_pct) || r.ownership_pct <= 0 || r.ownership_pct > 100) {
      return { ok: false, error: "Cada propietario tiene que tener un porcentaje mayor a 0 y de hasta 100 %." };
    }
  }
  const sum = round2(rows.reduce((s, r) => s + r.ownership_pct, 0));
  if (Math.abs(sum - 100) > 0.005) {
    const diff = round2(Math.abs(100 - sum));
    const hint = sum < 100 ? `falta ${formatPctEs(diff)} %` : `sobra ${formatPctEs(diff)} %`;
    return { ok: false, error: `Los porcentajes suman ${formatPctEs(sum)} % (${hint}). Tienen que sumar 100 %.` };
  }
  const primaries = rows.filter((r) => r.is_primary).length;
  if (primaries === 0) return { ok: false, error: "Marcá quién es el titular principal." };
  if (primaries > 1) return { ok: false, error: "Sólo puede haber un titular principal." };
  return { ok: true };
}

/** Partes iguales que suman exactamente 100: 3 → [33.34, 33.33, 33.33]. */
export function splitEvenly(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n) / 100;
  let cents = Math.round((100 - base * n) * 100);
  return Array.from({ length: n }, () => {
    const extra = cents > 0 ? 0.01 : 0;
    if (cents > 0) cents--;
    return round2(base + extra);
  });
}

// ─── Estado que se muestra ───────────────────────────────────────────────────

export type PropertyDisplayState = "alquilada" | "vacante" | "reservada" | "en_refaccion" | "retirada" | "archivada";

export const PROPERTY_STATE_META: Record<PropertyDisplayState, StatusMeta> = {
  alquilada: { label: "Alquilada", color: "#10b981", description: "Tiene un contrato vigente." },
  vacante: { label: "Vacante", color: "#f59e0b", description: "Sin contrato vigente: no genera alquiler." },
  reservada: { label: "Reservada", color: "#3b82f6", description: "Apalabrada con un inquilino, todavía sin contrato vigente." },
  en_refaccion: { label: "En refacción", color: "#f97316" },
  retirada: { label: "Fuera de alquiler", color: "#64748b", description: "El dueño no la quiere alquilar por ahora." },
  archivada: { label: "Archivada", color: "#94a3b8", description: "Ya no se administra. Se conserva el historial." },
};

export function propertyDisplayState(
  p: { active: boolean; availability: RentalPropertyAvailability },
  hasActiveContract: boolean,
): PropertyDisplayState {
  if (!p.active) return "archivada";
  if (hasActiveContract) return "alquilada";
  if (p.availability === "en_refaccion") return "en_refaccion";
  if (p.availability === "reservada") return "reservada";
  if (p.availability === "retirada") return "retirada";
  return "vacante";
}

/** "3 ambientes · 2 dormitorios · 65 m² · Amoblado · Cochera" (en partes). */
export function propertyFeatures(
  p: Pick<RentalProperty, "rooms" | "bedrooms" | "bathrooms" | "covered_m2" | "total_m2" | "furnished" | "has_garage">,
): string[] {
  const out: string[] = [];
  if (p.rooms) out.push(p.rooms === 1 ? "Monoambiente" : `${p.rooms} ambientes`);
  if (p.bedrooms) out.push(p.bedrooms === 1 ? "1 dormitorio" : `${p.bedrooms} dormitorios`);
  if (p.bathrooms) out.push(p.bathrooms === 1 ? "1 baño" : `${p.bathrooms} baños`);
  const m2 = p.covered_m2 ?? p.total_m2;
  if (m2) out.push(`${Number(m2).toLocaleString("es-AR", { maximumFractionDigits: 2 })} m²`);
  if (p.furnished) out.push("Amoblado");
  if (p.has_garage) out.push("Cochera");
  return out;
}

/** Empresa habitual de cada servicio en Córdoba (precarga el campo "Empresa"). */
export const SERVICE_PROVIDER_HINT: Record<RentalServiceKind, string | null> = {
  expensas: null,
  luz: "EPEC",
  gas: "Ecogas",
  agua: "Aguas Cordobesas",
  municipal: "Municipalidad de Córdoba",
  inmobiliario: "Rentas Córdoba",
  internet: null,
  seguro: null,
  otro: null,
};

/** "hace 12 días", "hace 3 meses", "hace 1 año y 2 meses" (desde `from` hasta `today`). */
export function sinceLabel(from: string, today: string): string {
  const days = diffDays(from, today);
  if (days <= 0) return "desde hoy";
  if (days === 1) return "desde ayer";
  const months = contractMonthsElapsed(from, today);
  if (months < 1) return `hace ${days} días`;
  if (months < 12) return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? "1 año" : `${years} años`;
  return rest ? `hace ${y} y ${rest === 1 ? "1 mes" : `${rest} meses`}` : `hace ${y}`;
}
