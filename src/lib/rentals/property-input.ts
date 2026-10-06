import { z } from "zod";
import { isYmd } from "./ymd";

/**
 * Validación del alta / edición de una propiedad y del propietario nuevo que
 * se tipea adentro de ese formulario. UN solo esquema para el formulario y
 * para las server actions: el formulario lo corre ANTES de crear al primer
 * propietario nuevo. Si el servidor descubría un error recién después (un
 * "Planta baja" de 11 letras en Piso, un mail del consorcio mal escrito), el
 * propietario ya había quedado creado y la propiedad no: lo mismo que pasó
 * el 05/10, dos propietarios cargados y ninguna propiedad.
 *
 * Módulo común (ni "use server" ni "use client"): un archivo "use server"
 * sólo puede exportar funciones async.
 */

/** Largos máximos: los usa el esquema y los `maxLength` de los campos. */
export const PROPERTY_TEXT_MAX = {
  street: 120,
  street_number: 20,
  // "Planta baja", "Entrepiso", "Local 3 - Galería": con 10 se cortaba lo tipeado sin avisar.
  floor: 30,
  apartment: 30,
  tower: 20,
  neighborhood: 80,
  city: 80,
  province: 80,
  postal_code: 12,
  consortium_name: 120,
  consortium_phone: 40,
  functional_unit: 20,
  cadastral_id: 60,
  notes: 2000,
  service_provider: 80,
  service_account_number: 60,
  service_holder: 120,
  service_notes: 200,
} as const;

export const OWNER_TEXT_MAX = { full_name: 160, phone: 40 } as const;

/**
 * La salida para dos personas con el mismo nombre: el sistema no deja cargar
 * dos propietarios con el mismo nombre, así que se los distingue en el nombre.
 */
export const OTHER_PERSON_HINT = "¿Es otra persona? Sumale algo al nombre, por ejemplo el segundo apellido.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Id que el formulario le pone a lo que va a crear (la propiedad, cada
 * propietario nuevo) y guarda en el borrador. Si la respuesta del guardado se
 * pierde (señal débil, recarga en medio), reintentar con el mismo id devuelve
 * lo ya creado en vez de duplicarlo. `randomUUID` sólo existe en https o
 * localhost; `getRandomValues` también en http (p. ej. probando por la IP de la red).
 */
export function newClientId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Un id que no sirve no bloquea el guardado: se guarda igual, sólo que sin la protección contra duplicados.
const clientId = z.string().regex(UUID_RE).nullable().optional().catch(null);

const optText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}: hasta ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const optInt = (label: string) =>
  z
    .number({ invalid_type_error: `${label}: tiene que ser un número.` })
    .int(`${label}: tiene que ser un número entero.`)
    .min(0, `${label}: no puede ser negativo.`)
    .max(99, `${label}: revisá el número.`)
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const optM2 = (label: string) =>
  z
    .number({ invalid_type_error: `${label}: tiene que ser un número.` })
    .positive(`${label}: tiene que ser mayor a 0.`)
    .max(999_999, `${label}: revisá el número.`)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const M = PROPERTY_TEXT_MAX;

const serviceSchema = z.object({
  kind: z.enum(["expensas", "luz", "gas", "agua", "municipal", "inmobiliario", "internet", "seguro", "otro"]),
  provider: optText(M.service_provider, "Empresa del servicio"),
  account_number: optText(M.service_account_number, "Número de cuenta"),
  holder: optText(M.service_holder, "Titular del servicio"),
  notes: optText(M.service_notes, "Nota del servicio"),
});

export const ownerRowSchema = z.object({
  owner_id: z.string().uuid("Elegí el propietario en cada fila."),
  ownership_pct: z.number({ invalid_type_error: "Revisá los porcentajes." }),
  is_primary: z.boolean(),
});

export const propertyInputSchema = z.object({
  /** Id generado por el formulario en un alta (ver `newClientId`). */
  id: clientId,
  code: z.string().max(80, "El código: hasta 80 caracteres.").optional().default(""),
  property_type: z.enum(["departamento", "casa", "ph", "duplex", "local", "oficina", "cochera", "deposito", "terreno", "otro"]),
  street: z.string().trim().min(2, "Escribí la calle.").max(M.street, `La calle: hasta ${M.street} caracteres.`),
  street_number: optText(M.street_number, "Número"),
  floor: optText(M.floor, "Piso"),
  apartment: optText(M.apartment, "Departamento"),
  tower: optText(M.tower, "Torre"),
  neighborhood: optText(M.neighborhood, "Barrio"),
  city: z.string().trim().min(2, "Escribí la ciudad.").max(M.city, `La ciudad: hasta ${M.city} caracteres.`).default("Córdoba"),
  province: z.string().trim().min(2, "Escribí la provincia.").max(M.province, `La provincia: hasta ${M.province} caracteres.`).default("Córdoba"),
  postal_code: optText(M.postal_code, "Código postal"),
  rooms: optInt("Ambientes"),
  bedrooms: optInt("Dormitorios"),
  bathrooms: optInt("Baños"),
  covered_m2: optM2("Superficie cubierta"),
  total_m2: optM2("Superficie total"),
  furnished: z.boolean().default(false),
  has_garage: z.boolean().default(false),
  consortium_name: optText(M.consortium_name, "Consorcio / administración"),
  consortium_phone: optText(M.consortium_phone, "Teléfono del consorcio"),
  consortium_email: z
    .union([z.string().trim().email("El mail del consorcio no es válido."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  functional_unit: optText(M.functional_unit, "Unidad funcional"),
  cadastral_id: optText(M.cadastral_id, "Catastro / cuenta de Rentas"),
  services: z.array(serviceSchema).max(20, "Hasta 20 servicios por propiedad.").default([]),
  listing_rent: z
    .number({ invalid_type_error: "Revisá el precio pretendido." })
    .positive("El precio pretendido tiene que ser mayor a 0.")
    .max(999_999_999_999, "Revisá el precio pretendido.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  listing_currency: z.enum(["ARS", "USD", "EUR"]).nullable().optional().transform((v) => v ?? null),
  availability: z.enum(["disponible", "reservada", "en_refaccion", "retirada"]).default("disponible"),
  mandate_signed_at: z
    .union([z.string().refine(isYmd, "La fecha del mandato no es válida."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optText(M.notes, "Notas"),
  owners: z.array(ownerRowSchema).max(20, "Hasta 20 propietarios por propiedad."),
});

export type ParsedPropertyInput = z.infer<typeof propertyInputSchema>;

export const quickOwnerInputSchema = z.object({
  /** Id generado por el formulario para este propietario nuevo (ver `newClientId`). */
  id: clientId,
  full_name: z
    .string()
    .trim()
    .min(2, "Escribí el nombre del propietario.")
    .max(OWNER_TEXT_MAX.full_name, `El nombre: hasta ${OWNER_TEXT_MAX.full_name} caracteres.`),
  phone: optText(OWNER_TEXT_MAX.phone, "Teléfono"),
  email: z
    .union([z.string().trim().email("El mail no es válido."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  cbu: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? "").replace(/\D+/g, "") || null)
    .refine((v) => v == null || v.length === 22, "El CBU/CVU tiene 22 números."),
  alias_cbu: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ?? "").trim() || null)
    .refine((v) => v == null || /^[A-Za-z0-9.-]{6,20}$/.test(v), "El alias tiene entre 6 y 20 letras, números, puntos o guiones."),
});

export type ParsedQuickOwnerInput = z.infer<typeof quickOwnerInputSchema>;

/**
 * El primer problema, con el campo donde mostrarlo. `services.2.provider` se
 * marca en "services" (la sección), no en un id que no existe.
 */
export function firstIssue(error: z.ZodError): { error: string; field?: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? "Revisá los datos.", field: issue?.path?.[0] != null ? String(issue.path[0]) : undefined };
}

export type InputCheck<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

export function checkPropertyInput(input: unknown): InputCheck<ParsedPropertyInput> {
  const parsed = propertyInputSchema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, ...firstIssue(parsed.error) };
}

export function checkQuickOwnerInput(input: unknown): InputCheck<ParsedQuickOwnerInput> {
  const parsed = quickOwnerInputSchema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, ...firstIssue(parsed.error) };
}
