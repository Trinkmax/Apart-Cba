/**
 * System tags precargados por organización (12). Sincronizado con
 * `tg_crm_seed_system_tags()` en migration 010 — si cambian acá, cambiar allá.
 */

export interface SystemTagDef {
  slug: string;
  name: string;
  color: string;
  order: number;
  description?: string;
}

export const SYSTEM_TAGS: readonly SystemTagDef[] = [
  { slug: "lead", name: "Lead", color: "#10b981", order: 1, description: "Posible cliente nuevo." },
  { slug: "consulta-disponibilidad", name: "Consulta disponibilidad", color: "#3b82f6", order: 2 },
  { slug: "reserva-pendiente", name: "Reserva pendiente", color: "#eab308", order: 3 },
  { slug: "reserva-confirmada", name: "Reserva confirmada", color: "#a855f7", order: 4 },
  { slug: "incidente", name: "Incidente", color: "#ef4444", order: 5 },
  { slug: "reclamo", name: "Reclamo", color: "#f97316", order: 6 },
  { slug: "huesped-vip", name: "Huésped VIP", color: "#fbbf24", order: 7 },
  { slug: "propietario", name: "Propietario", color: "#92400e", order: 8 },
  { slug: "checkout-positivo", name: "Checkout positivo", color: "#22c55e", order: 9 },
  { slug: "checkout-negativo", name: "Checkout negativo", color: "#dc2626", order: 10 },
  { slug: "spam", name: "Spam", color: "#71717a", order: 11 },
  { slug: "staff-interno", name: "Staff interno", color: "#facc15", order: 12 },
] as const;

export function tagColorClasses(color: string): string {
  // Hex to tailwind-friendly inline style. UI usa style={{ backgroundColor: ... }}.
  return color;
}
