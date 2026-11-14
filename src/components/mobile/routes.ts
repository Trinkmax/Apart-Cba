/**
 * El mapa de pantallas del celular (nov-2026): qué pestañas ve cada rol, qué
 * sub-pestañas tiene cada sección, a qué pestaña pertenece cada pantalla, qué
 * dice la barra de arriba, adónde vuelve «‹» y qué mosaicos tiene «Más».
 *
 * Puro y client-safe (sin React): lo usan la barra de abajo, la de arriba, la
 * hoja «Más», su buscador y Tex (`abrir_pantalla`). El test
 * (`__tests__/routes.test.ts`) hace cumplir la regla de sharp-app: ninguna
 * pestaña, sub-pestaña ni mosaico lleva a una pantalla que rebota a ese rol.
 *
 * La idea (pedido del dueño, 14/11/2026): pocas puertas grandes y, adentro,
 * sub-pestañas. 17 secciones del sidebar → 4 pestañas + «Más». El escritorio
 * no cambia: el sidebar sigue igual.
 */
import { can, isAdminLevel, type Resource } from "@/lib/permissions";
import { isPathAllowedForOwner } from "@/lib/auth/route-access";
import type { UserRole } from "@/lib/types/database";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type IconKey =
  | "hoy"
  | "reservas"
  | "caja"
  | "mas"
  | "inicio"
  | "resumen"
  | "parte"
  | "limpieza"
  | "mantenimiento"
  | "tareas"
  | "calendario"
  | "lista"
  | "solicitudes"
  | "huespedes"
  | "resultados"
  | "liquidaciones"
  | "propietarios"
  | "unidades"
  | "tradicionales"
  | "canales"
  | "avisos"
  | "configuracion"
  | "perfil"
  | "consejos"
  | "chats"
  | "tickets";

export type TabId =
  | "hoy"
  | "reservas"
  | "caja"
  | "mas"
  | "inicio"
  | "limpieza"
  | "tickets"
  | "parte"
  | "calendario"
  | "liquidaciones";

export type ScreenLink = {
  id: string;
  href: string;
  label: string;
  icon: IconKey;
  /** Sólo la ruta exacta (el Resumen es `/dashboard`, no todo lo que empieza así). */
  exact?: boolean;
  /** Otras rutas que son esta misma pantalla en otra vista (el calendario mensual). */
  aliases?: string[];
  /** Prefijos que también le pertenecen (sus sub-pantallas). */
  also?: string[];
  /** Permiso para verla (`can(role, resource, "view")`). "*" = cualquiera. */
  resource?: Resource | "*";
  /** Módulo que se enciende por organización. */
  module?: "rentals";
  /** Sólo admin/recepción (Configuración). */
  adminOnly?: boolean;
  /** Palabras extra para el buscador de «Más». */
  keywords?: string;
};

export type MobileTab = ScreenLink & { id: TabId; subtabs: ScreenLink[] };

export type MoreGroup = { id: string; title: string; rows: ScreenLink[] };

export type ShellContext = {
  role: UserRole;
  rentalsEnabled: boolean;
};

export type RouteMeta = {
  /** La pestaña a la que pertenece la pantalla ("mas" si vive en «Más»). */
  tab: TabId | null;
  /** El link (pestaña, sub-pestaña o mosaico) al que pertenece la pantalla. */
  link: string | null;
  /** La sub-pestaña elegida, si la sección tiene. */
  subtab: string | null;
  /** Las sub-pestañas de la sección (ya filtradas por rol). Vacío en sub-pantallas. */
  subtabs: ScreenLink[];
  /** root: raíz de pestaña o sub-pestaña. sub: una pantalla más adentro (ficha, detalle). */
  kind: "root" | "sub";
  /** Título corto para la barra de arriba. */
  title: string;
  /** El padre estructural (para «‹ volver» cuando no hay historial). */
  parent: { href: string; label: string } | null;
  /** La pantalla maneja su propio scroll de alto completo (el calendario). */
  fullHeight: boolean;
};

// ── Pantallas ────────────────────────────────────────────────────────────────

const S = {
  resumen: { id: "resumen", href: "/dashboard", label: "Resumen", icon: "resumen", exact: true, resource: "*" },
  parte: {
    id: "parte",
    href: "/dashboard/parte-diario",
    label: "Parte diario",
    icon: "parte",
    resource: "parte_diario",
    also: ["/m/parte-diario"],
    keywords: "llegadas salidas check-in check-out sucios",
  },
  limpieza: {
    id: "limpieza",
    href: "/dashboard/limpieza",
    label: "Limpieza",
    icon: "limpieza",
    resource: "cleaning",
    also: ["/m/limpieza"],
    keywords: "sucio limpio mucama",
  },
  mantenimiento: {
    id: "mantenimiento",
    href: "/dashboard/mantenimiento",
    label: "Mantenimiento",
    icon: "mantenimiento",
    resource: "tickets",
    also: ["/m/mantenimiento"],
    keywords: "tickets arreglos roturas",
  },
  tareas: {
    id: "tareas",
    href: "/dashboard/tareas",
    label: "Tareas",
    icon: "tareas",
    resource: "concierge",
    also: ["/dashboard/conserjeria", "/m/tareas", "/m/conserjeria"],
    keywords: "conserjería pendientes",
  },
  calendario: {
    id: "calendario",
    href: "/dashboard/unidades/kanban",
    label: "Calendario",
    icon: "calendario",
    resource: "bookings",
    aliases: ["/dashboard/unidades/calendario/mensual"],
    also: ["/dashboard/unidades/calendario"],
    keywords: "ocupación grilla disponibilidad",
  },
  lista: {
    id: "lista",
    href: "/dashboard/reservas",
    label: "Lista",
    icon: "lista",
    resource: "bookings",
    keywords: "reservas buscar",
  },
  solicitudes: {
    id: "solicitudes",
    href: "/dashboard/reservas-pendientes",
    label: "Solicitudes",
    icon: "solicitudes",
    resource: "bookings",
    keywords: "pedidos web marketplace pendientes",
  },
  huespedes: {
    id: "huespedes",
    href: "/dashboard/huespedes",
    label: "Huéspedes",
    icon: "huespedes",
    resource: "guests",
    keywords: "clientes personas",
  },
  caja: {
    id: "caja",
    href: "/dashboard/caja",
    label: "Caja",
    icon: "caja",
    resource: "cash",
    keywords: "cuentas movimientos gastos cobros saldo",
  },
  resultados: {
    id: "resultados",
    href: "/dashboard/resultados",
    label: "Resultados",
    icon: "resultados",
    resource: "payments",
    keywords: "ventas comisiones ganancia mes",
  },
  liquidaciones: {
    id: "liquidaciones",
    href: "/dashboard/liquidaciones",
    label: "Liquidaciones",
    icon: "liquidaciones",
    resource: "settlements",
    keywords: "propietarios pagos rendiciones",
  },
  propietarios: {
    id: "propietarios",
    href: "/dashboard/propietarios",
    label: "Propietarios",
    icon: "propietarios",
    resource: "owners",
    keywords: "dueños",
  },
  unidades: {
    id: "unidades",
    href: "/dashboard/unidades",
    label: "Unidades",
    icon: "unidades",
    resource: "units",
    keywords: "departamentos deptos precios",
  },
  tradicionales: {
    id: "tradicionales",
    href: "/dashboard/alquileres",
    label: "Tradicionales",
    icon: "tradicionales",
    resource: "rentals",
    module: "rentals",
    keywords: "alquileres contratos inquilinos cobranzas",
  },
  canales: {
    id: "canales",
    href: "/dashboard/canales",
    label: "Canales de venta",
    icon: "canales",
    resource: "channels",
    also: ["/dashboard/channel-manager"],
    keywords: "airbnb booking ical",
  },
  avisos: {
    id: "avisos",
    href: "/dashboard/alertas",
    label: "Avisos",
    icon: "avisos",
    resource: "*",
    keywords: "alertas notificaciones",
  },
  configuracion: {
    id: "configuracion",
    href: "/dashboard/configuracion",
    label: "Configuración",
    icon: "configuracion",
    adminOnly: true,
    keywords: "equipo organización colores comisiones web",
  },
  consejos: {
    id: "consejos",
    href: "/m/consejos",
    label: "Consejos",
    icon: "consejos",
    resource: "unit_tips",
    keywords: "tips unidades equipo",
  },
  chats: {
    id: "chats",
    href: "/dashboard/crm",
    label: "Mensajes",
    icon: "chats",
    resource: "crm_inbox",
    also: ["/m/crm"],
    keywords: "whatsapp crm",
  },
  perfilDashboard: { id: "perfil", href: "/dashboard/perfil", label: "Mi perfil", icon: "perfil", resource: "*" },
  perfilM: { id: "perfil", href: "/m/perfil", label: "Mi perfil", icon: "perfil", resource: "*" },
  // Versión de campo (/m): limpieza y mantenimiento.
  inicioM: { id: "inicio", href: "/m", label: "Inicio", icon: "inicio", exact: true, resource: "*" },
  limpiezaM: { id: "limpieza", href: "/m/limpieza", label: "Limpieza", icon: "limpieza", resource: "cleaning" },
  ticketsM: {
    id: "tickets",
    href: "/m/mantenimiento",
    label: "Tickets",
    icon: "tickets",
    resource: "tickets",
    keywords: "mantenimiento arreglos",
  },
  parteM: { id: "parte", href: "/m/parte-diario", label: "Parte", icon: "parte", resource: "parte_diario" },
  // Propietario.
  inicioOwner: { id: "inicio", href: "/dashboard", label: "Inicio", icon: "inicio", exact: true, resource: "*" },
  reservasOwner: { id: "reservas", href: "/dashboard/reservas", label: "Reservas", icon: "lista", resource: "bookings" },
} satisfies Record<string, ScreenLink>;

// ── Pestañas por rol ─────────────────────────────────────────────────────────

const STAFF_TABS: readonly MobileTab[] = [
  {
    id: "hoy",
    href: "/dashboard",
    label: "Hoy",
    icon: "hoy",
    resource: "*",
    subtabs: [S.resumen, S.parte, S.limpieza, S.mantenimiento, S.tareas],
  },
  {
    id: "reservas",
    href: "/dashboard/unidades/kanban",
    label: "Reservas",
    icon: "reservas",
    resource: "bookings",
    subtabs: [S.calendario, S.lista, S.solicitudes, S.huespedes],
  },
  {
    id: "caja",
    href: "/dashboard/caja",
    label: "Caja",
    icon: "caja",
    resource: "cash",
    subtabs: [S.caja, S.resultados, S.liquidaciones, S.propietarios],
  },
];

// Mensajes (CRM) no va: salió del sidebar y en 30 días no tuvo un solo mensaje.
const STAFF_MORE: readonly MoreGroup[] = [
  { id: "negocio", title: "Tu negocio", rows: [S.unidades, S.tradicionales, S.canales, S.avisos] },
  { id: "equipo", title: "El equipo", rows: [S.consejos, S.configuracion] },
];

const CLEANING_TABS: readonly MobileTab[] = [
  { ...S.inicioM, id: "inicio", subtabs: [] },
  { ...S.limpiezaM, id: "limpieza", subtabs: [] },
  { ...S.parteM, id: "parte", subtabs: [] },
];

const MAINTENANCE_TABS: readonly MobileTab[] = [
  { ...S.inicioM, id: "inicio", subtabs: [] },
  { ...S.ticketsM, id: "tickets", subtabs: [] },
  { ...S.parteM, id: "parte", subtabs: [] },
];

const FIELD_MORE: readonly MoreGroup[] = [{ id: "equipo", title: "El equipo", rows: [S.consejos] }];

const OWNER_TABS: readonly MobileTab[] = [
  { ...S.inicioOwner, id: "inicio", subtabs: [] },
  { ...S.calendario, id: "calendario", label: "Calendario", subtabs: [] },
  { ...S.liquidaciones, id: "liquidaciones", subtabs: [] },
];

const OWNER_MORE: readonly MoreGroup[] = [{ id: "negocio", title: "Tus unidades", rows: [S.reservasOwner] }];

/** "Más" es una pestaña que abre la hoja; su href es el de la pantalla de respaldo sin JS. */
const MORE_TAB: MobileTab = { id: "mas", href: "#mas", label: "Más", icon: "mas", resource: "*", subtabs: [] };

// ── Permisos ─────────────────────────────────────────────────────────────────

export function isAllowed(link: ScreenLink, ctx: ShellContext): boolean {
  if (link.module === "rentals" && !ctx.rentalsEnabled) return false;
  if (link.adminOnly && !isAdminLevel(ctx.role)) return false;
  if (link.resource && link.resource !== "*" && !can(ctx.role, link.resource, "view")) return false;
  // El propietario sólo ve las pantallas de su lista blanca.
  if (ctx.role === "owner_view" && link.href.startsWith("/dashboard") && !isPathAllowedForOwner(link.href)) {
    return false;
  }
  // Limpieza y mantenimiento viven en /m (el PMS de escritorio no es para ellos).
  if ((ctx.role === "limpieza" || ctx.role === "mantenimiento") && !link.href.startsWith("/m")) return false;
  return true;
}

function tabsForRole(role: UserRole): readonly MobileTab[] {
  if (role === "limpieza") return CLEANING_TABS;
  if (role === "mantenimiento") return MAINTENANCE_TABS;
  if (role === "owner_view") return OWNER_TABS;
  return STAFF_TABS;
}

function moreForRole(role: UserRole): readonly MoreGroup[] {
  if (role === "limpieza" || role === "mantenimiento") return FIELD_MORE;
  if (role === "owner_view") return OWNER_MORE;
  return STAFF_MORE;
}

/** Las pestañas de la barra, en orden, con «Más» al final. */
export function mobileTabs(ctx: ShellContext): MobileTab[] {
  const tabs: MobileTab[] = [];
  for (const t of tabsForRole(ctx.role)) {
    const subtabs = t.subtabs.filter((s) => isAllowed(s, ctx));
    // Una sección con sub-pestañas vale si le queda alguna; su raíz es la primera que quedó.
    if (t.subtabs.length > 0) {
      if (subtabs.length === 0) continue;
      tabs.push({ ...t, href: subtabs[0].href, subtabs });
    } else if (isAllowed(t, ctx)) {
      tabs.push({ ...t, subtabs: [] });
    }
  }
  tabs.push(MORE_TAB);
  return tabs;
}

/** Los grupos de mosaicos de «Más» (ya filtrados; sin grupos vacíos). */
export function moreGroups(ctx: ShellContext): MoreGroup[] {
  return moreForRole(ctx.role)
    .map((g) => ({ ...g, rows: g.rows.filter((r) => isAllowed(r, ctx)) }))
    .filter((g) => g.rows.length > 0);
}

/**
 * La navegación de la compu (nov-2026): las mismas secciones que el celular
 * (el sidebar deja de tener 17 ítems) y los mismos mosaicos de «Más», sin las
 * pantallas de la versión de campo (/m) para quien opera desde el panel.
 */
export function desktopNav(ctx: ShellContext): { sections: MobileTab[]; groups: MoreGroup[] } {
  const field = ctx.role === "limpieza" || ctx.role === "mantenimiento";
  const sections = mobileTabs(ctx).filter((t) => t.id !== "mas");
  const groups = moreGroups(ctx)
    .map((g) => ({ ...g, rows: field ? g.rows : g.rows.filter((r) => !r.href.startsWith("/m")) }))
    .filter((g) => g.rows.length > 0);
  return { sections, groups };
}

/** Mi perfil: el de /m para limpieza y mantenimiento; el del panel para el resto. */
export function profileHref(role: UserRole): string {
  return role === "limpieza" || role === "mantenimiento" ? S.perfilM.href : S.perfilDashboard.href;
}

/** Todas las pantallas a las que este rol puede ir (para el buscador y para Tex). */
export function reachableScreens(ctx: ShellContext): ScreenLink[] {
  const out: ScreenLink[] = [];
  const seen = new Set<string>();
  const push = (l: ScreenLink) => {
    if (seen.has(l.href) || !isAllowed(l, ctx)) return;
    seen.add(l.href);
    out.push(l);
  };
  for (const t of mobileTabs(ctx)) {
    if (t.id === "mas") continue;
    if (t.subtabs.length) t.subtabs.forEach(push);
    else push(t);
  }
  for (const g of moreGroups(ctx)) g.rows.forEach(push);
  push(ctx.role === "limpieza" || ctx.role === "mantenimiento" ? S.perfilM : S.perfilDashboard);
  return out;
}

// ── A qué pertenece cada ruta ────────────────────────────────────────────────

/** Sin query, sin hash y sin barra final. */
export function cleanPath(pathname: string): string {
  const noQuery = pathname.split(/[?#]/)[0] ?? "";
  const noSlash = noQuery.length > 1 ? noQuery.replace(/\/+$/, "") : noQuery;
  return noSlash || "/";
}

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** Qué tan bien coincide `path` con el link: el largo del prefijo que pegó (0 = no). */
function matchLength(path: string, link: ScreenLink): { len: number; root: boolean } {
  if (link.exact) return path === link.href ? { len: link.href.length, root: true } : { len: 0, root: false };
  let best = { len: 0, root: false };
  for (const a of link.aliases ?? []) {
    if (path === a && a.length > best.len) best = { len: a.length, root: true };
  }
  if (under(path, link.href) && link.href.length > best.len) {
    best = { len: link.href.length, root: path === link.href };
  }
  for (const p of link.also ?? []) {
    if (under(path, p) && p.length > best.len) best = { len: p.length, root: false };
  }
  return best;
}

/** Pantallas con su propio scroll de alto completo: la ventana no scrollea. */
const FULL_HEIGHT = ["/dashboard/unidades/kanban", "/dashboard/unidades/calendario"];

/** Títulos de las pantallas de adentro (fichas y detalles). El orden importa: el primero que pega. */
const SUB_TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard\/reservas\/[^/]+$/, "Reserva"],
  [/^\/dashboard\/reservas-pendientes\/[^/]+$/, "Solicitud"],
  [/^\/dashboard\/caja\/[^/]+$/, "Cuenta"],
  [/^\/dashboard\/liquidaciones\/periodo$/, "Por período"],
  [/^\/dashboard\/liquidaciones\/[^/]+$/, "Liquidación"],
  [/^\/dashboard\/unidades\/[^/]+\/precios$/, "Precios"],
  [/^\/dashboard\/unidades\/[^/]+\/marketplace$/, "Publicación"],
  [/^\/dashboard\/unidades\/calendario\/mensual$/, "Calendario"],
  [/^\/dashboard\/unidades\/[^/]+$/, "Unidad"],
  [/^\/dashboard\/propietarios\/[^/]+$/, "Propietario"],
  [/^\/dashboard\/canales\/conectar$/, "Conectar canal"],
  [/^\/dashboard\/canales\/cancelaciones$/, "Cancelaciones"],
  [/^\/dashboard\/canales\/[^/]+$/, "Canal"],
  [/^\/dashboard\/parte-diario\/configuracion$/, "Configurar el parte"],
  [/^\/dashboard\/parte-diario\/destinatarios$/, "Destinatarios"],
  [/^\/dashboard\/configuracion\/equipo$/, "Equipo"],
  [/^\/dashboard\/configuracion\/organizacion$/, "Organización"],
  [/^\/dashboard\/configuracion\/inbound-email$/, "Mail de reservas"],
  [/^\/dashboard\/configuracion\/[^/]+$/, "Configuración"],
  [/^\/dashboard\/alquileres\/contratos\/nuevo$/, "Nuevo contrato"],
  [/^\/dashboard\/alquileres\/contratos(\/.*)?$/, "Contrato"],
  [/^\/dashboard\/alquileres\/personas(\/.*)?$/, "Personas"],
  [/^\/dashboard\/alquileres\/propiedades(\/.*)?$/, "Propiedades"],
  [/^\/dashboard\/alquileres\/rendiciones(\/.*)?$/, "Rendiciones"],
  [/^\/dashboard\/alquileres\/cobranzas$/, "Cobranzas"],
  [/^\/dashboard\/alquileres\/comprobantes$/, "Comprobantes"],
  [/^\/dashboard\/alquileres\/ajustes$/, "Ajustes"],
  [/^\/dashboard\/crm\/.+$/, "Mensajes"],
  [/^\/m\/mantenimiento\/[^/]+$/, "Ticket"],
  [/^\/m\/consejos\/[^/]+$/, "Consejos"],
  [/^\/m\/crm\/inbox\/[^/]+$/, "Chat"],
];

/** Título de cualquier pantalla (para «‹ volver a …»). Nunca vacío. */
export function screenTitle(pathname: string, ctx: ShellContext): string {
  return routeMeta(pathname, ctx).title;
}

export function routeMeta(pathname: string, ctx: ShellContext): RouteMeta {
  const path = cleanPath(pathname);
  const tabs = mobileTabs(ctx);
  const more = moreGroups(ctx);

  type Hit = { tab: TabId; link: ScreenLink; len: number; root: boolean; section: MobileTab | null };
  // El que mejor pega (el prefijo más largo): "Unidades" no le gana al "Calendario".
  const found: { best: Hit | null } = { best: null };
  const consider = (tab: TabId, link: ScreenLink, section: MobileTab | null) => {
    const m = matchLength(path, link);
    if (m.len > 0 && (!found.best || m.len > found.best.len)) {
      found.best = { tab, link, len: m.len, root: m.root, section };
    }
  };

  for (const t of tabs) {
    if (t.id === "mas") continue;
    if (t.subtabs.length) t.subtabs.forEach((s) => consider(t.id, s, t));
    else consider(t.id, t, null);
  }
  for (const g of more) g.rows.forEach((r) => consider("mas", r, null));
  consider("mas", ctx.role === "limpieza" || ctx.role === "mantenimiento" ? S.perfilM : S.perfilDashboard, null);

  const fullHeight = FULL_HEIGHT.some((p) => (p.endsWith("/") ? path.startsWith(p) : under(path, p)));
  const subTitle = SUB_TITLES.find(([re]) => re.test(path))?.[1];

  const hit = found.best;
  if (!hit) {
    return {
      tab: null,
      link: null,
      subtab: null,
      subtabs: [],
      kind: "sub",
      title: subTitle ?? "Apart",
      parent: null,
      fullHeight,
    };
  }
  const isRoot = hit.root;
  return {
    tab: hit.tab,
    link: hit.link.id,
    subtab: hit.section ? hit.link.id : null,
    subtabs: isRoot && hit.section ? hit.section.subtabs : [],
    kind: isRoot ? "root" : "sub",
    title: isRoot ? hit.link.label : (subTitle ?? hit.link.label),
    parent: isRoot ? null : { href: hit.link.href, label: hit.link.label },
    fullHeight,
  };
}
