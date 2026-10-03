/**
 * Navegación interna del módulo "Tradicionales" (alquileres tradicionales).
 *
 * El menú lateral tiene UNA sola entrada para todo el módulo; adentro, las
 * secciones van en una barra de pestañas. Lo que vive acá es puro (sin React)
 * para poder probar qué pestaña queda activa en cada ruta.
 */

export const RENTALS_BASE = "/dashboard/alquileres";

export type RentalsSectionKey =
  | "resumen"
  | "contratos"
  | "cobranzas"
  | "comprobantes"
  | "ajustes"
  | "rendiciones"
  | "propiedades"
  | "personas";

export interface RentalsSection {
  key: RentalsSectionKey;
  label: string;
  href: string;
}

export const RENTALS_SECTIONS: readonly RentalsSection[] = [
  { key: "resumen", label: "Resumen", href: RENTALS_BASE },
  { key: "contratos", label: "Contratos", href: `${RENTALS_BASE}/contratos` },
  { key: "cobranzas", label: "Cobranzas", href: `${RENTALS_BASE}/cobranzas` },
  { key: "comprobantes", label: "Comprobantes", href: `${RENTALS_BASE}/comprobantes` },
  { key: "ajustes", label: "Ajustes", href: `${RENTALS_BASE}/ajustes` },
  { key: "rendiciones", label: "Rendiciones", href: `${RENTALS_BASE}/rendiciones` },
  { key: "propiedades", label: "Propiedades", href: `${RENTALS_BASE}/propiedades` },
  { key: "personas", label: "Inquilinos", href: `${RENTALS_BASE}/personas` },
];

/**
 * Pestaña activa para una ruta. Las fichas y los formularios marcan su sección
 * (un contrato → "Contratos", una rendición → "Rendiciones"); el Resumen sólo
 * se marca en la portada del módulo. Fuera del módulo, null.
 */
export function activeRentalsSection(pathname: string): RentalsSectionKey | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === RENTALS_BASE) return "resumen";
  if (!path.startsWith(`${RENTALS_BASE}/`)) return null;
  let best: RentalsSection | null = null;
  for (const s of RENTALS_SECTIONS) {
    if (s.key === "resumen") continue;
    if ((path === s.href || path.startsWith(`${s.href}/`)) && (!best || s.href.length > best.href.length)) best = s;
  }
  return best?.key ?? null;
}

/** Lo que pide atención en cada sección (se muestra como contador en la pestaña). */
export interface RentalsNavCounts {
  /** Inquilinos con algún cargo vencido sin pagar. */
  cobranzas: number;
  /** Comprobantes y avisos de pago esperando que alguien los revise. */
  comprobantes: number;
  /** Ajustes por regir para confirmar (o sin monto cargado) y aplicados sin avisarle al inquilino. */
  ajustes: number;
}

export const EMPTY_RENTALS_NAV_COUNTS: RentalsNavCounts = { cobranzas: 0, comprobantes: 0, ajustes: 0 };
