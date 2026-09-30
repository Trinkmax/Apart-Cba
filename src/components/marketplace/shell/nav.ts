/**
 * Navegación principal de la web (header de escritorio y menú mobile).
 * Puro: el estado activo se calcula con el pathname y el `modo` de la URL.
 */
export interface NavItem {
  href: string;
  label: string;
  /** ¿Este ítem representa la página actual? */
  isActive: (pathname: string, modo: string | null) => boolean;
}

const isMonthlyMode = (modo: string | null) => modo === "mes" || modo === "mensual";

export const MAIN_NAV: readonly NavItem[] = [
  {
    href: "/buscar",
    label: "Alojamientos",
    isActive: (pathname, modo) =>
      (pathname === "/buscar" && !isMonthlyMode(modo)) || pathname.startsWith("/u/"),
  },
  {
    href: "/buscar?modo=mes",
    label: "Por mes",
    isActive: (pathname, modo) => pathname === "/buscar" && isMonthlyMode(modo),
  },
  {
    href: "/como-reservar",
    label: "Cómo reservar",
    isActive: (pathname) => pathname.startsWith("/como-reservar"),
  },
  {
    href: "/propietarios",
    label: "Propietarios",
    isActive: (pathname) => pathname.startsWith("/propietarios"),
  },
];

/** Accesos de la cuenta del huésped (menú del avatar y menú mobile). */
export const ACCOUNT_LINKS = [
  { href: "/mi-cuenta", label: "Mis reservas" },
  { href: "/favoritos", label: "Favoritos" },
  { href: "/mi-cuenta/perfil", label: "Mis datos" },
] as const;

/** Frase de marca del menú mobile y del footer. */
export const BRAND_INVITE = "¿Hacemos lugar? Dale, pasá.";
