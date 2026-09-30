/**
 * Opciones y tipos del formulario de propietarios, compartidos entre el
 * formulario (cliente) y `submitOwnerLead` (server action). Viven acá porque
 * un archivo "use server" sólo puede exportar funciones async.
 */
export const OWNER_LEAD_ROOMS = ["Monoambiente", "1 dormitorio", "2 dormitorios", "3 dormitorios o más"] as const;

export type OwnerLeadRooms = (typeof OWNER_LEAD_ROOMS)[number];

export type OwnerLeadField = "name" | "phone" | "email" | "address" | "rooms" | "message";

export interface OwnerLeadInput {
  name: string;
  phone: string;
  email: string;
  /** Barrio o dirección del departamento. */
  address: string;
  rooms?: string | null;
  message?: string | null;
  /** Honeypot: un humano no lo ve ni lo completa. */
  website?: string | null;
}

export type OwnerLeadResult = { ok: true } | { ok: false; error: string; field?: OwnerLeadField };

export const OWNER_LEAD_LIMITS = {
  name: 120,
  email: 200,
  address: 200,
  message: 2000,
} as const;
