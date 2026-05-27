import type {
  UnitStatus,
  BookingStatus,
  TicketStatus,
  TicketPriority,
  CleaningStatus,
  UserRole,
  BookingSource,
  BookingMode,
  UnitDefaultMode,
  UnitTipCategory,
  UnitTipReactionType,
} from "./types/database";

// ─── Join de unidad para tickets / limpieza ─────────────────────────────────
/**
 * Columnas que trae el join `unit:units(...)` en las acciones de tickets de
 * mantenimiento y tareas de limpieza. Hidrata un `UnitRef` (ver `database.ts`):
 * lo necesario para que el personal de campo llegue e ingrese a la unidad.
 * Mantener sincronizado con el `Pick` de `UnitRef`.
 */
export const UNIT_REF_SELECT =
  "id, code, name, address, neighborhood, tower, floor, apartment, internal_extra";

// ─── Estados de unidad (Kanban) ─────────────────────────────────────────────
export const UNIT_STATUSES: UnitStatus[] = [
  "disponible",
  "reservado",
  "ocupado",
  "limpieza",
  "mantenimiento",
  "bloqueado",
];

export const UNIT_STATUS_META: Record<
  UnitStatus,
  { label: string; color: string; bgClass: string; ringClass: string; dotClass: string; iconBg: string }
> = {
  disponible: {
    label: "Disponible",
    color: "#10b981",
    bgClass: "bg-emerald-500/10",
    ringClass: "ring-emerald-500/30",
    dotClass: "bg-emerald-500",
    iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  reservado: {
    label: "Reservado",
    color: "#f59e0b",
    bgClass: "bg-amber-500/10",
    ringClass: "ring-amber-500/30",
    dotClass: "bg-amber-500",
    iconBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  ocupado: {
    label: "Ocupado",
    color: "#3b82f6",
    bgClass: "bg-blue-500/10",
    ringClass: "ring-blue-500/30",
    dotClass: "bg-blue-500",
    iconBg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  limpieza: {
    label: "Limpieza",
    color: "#06b6d4",
    bgClass: "bg-cyan-500/10",
    ringClass: "ring-cyan-500/30",
    dotClass: "bg-cyan-500",
    iconBg: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  },
  mantenimiento: {
    label: "Mantenimiento",
    color: "#f97316",
    bgClass: "bg-orange-500/10",
    ringClass: "ring-orange-500/30",
    dotClass: "bg-orange-500",
    iconBg: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  bloqueado: {
    label: "Bloqueado",
    color: "#64748b",
    bgClass: "bg-slate-500/10",
    ringClass: "ring-slate-500/30",
    dotClass: "bg-slate-500",
    iconBg: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
};

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "#94a3b8" },
  confirmada: { label: "Confirmada", color: "#10b981" },
  check_in: { label: "Check-in", color: "#3b82f6" },
  check_out: { label: "Check-out", color: "#06b6d4" },
  cancelada: { label: "Cancelada", color: "#ef4444" },
  no_show: { label: "No-show", color: "#7c3aed" },
};

// Modo de estadía (temporario vs mensual). El acento violeta en mensual está
// pensado para coexistir con la paleta de status sin generar choque cromático.
export const BOOKING_MODE_META: Record<
  BookingMode,
  { label: string; shortLabel: string; description: string; color: string; bgClass: string; textClass: string; ringClass: string; badgeBgClass: string; iconLetter: string }
> = {
  temporario: {
    label: "Temporario",
    shortLabel: "Temp",
    description: "Estadía corta tipo Airbnb (tarifa por noche).",
    color: "#0ea5e9",
    bgClass: "bg-sky-500/10",
    textClass: "text-sky-700 dark:text-sky-300",
    ringClass: "ring-sky-500/40",
    badgeBgClass: "bg-sky-500/15",
    iconLetter: "T",
  },
  mensual: {
    label: "Mensual",
    shortLabel: "Mens",
    description: "Inquilino largo con renta mensual + expensas.",
    color: "#7c3aed",
    bgClass: "bg-violet-500/10",
    textClass: "text-violet-700 dark:text-violet-300",
    ringClass: "ring-violet-500/40",
    badgeBgClass: "bg-violet-500/15",
    iconLetter: "M",
  },
};

export const UNIT_DEFAULT_MODE_META: Record<
  UnitDefaultMode,
  { label: string; description: string; color: string }
> = {
  temporario: {
    label: "Temporario",
    description: "La unidad se opera como alquiler temporario (Airbnb-style).",
    color: "#0ea5e9",
  },
  mensual: {
    label: "Mensual",
    description: "La unidad se alquila mensualmente a inquilinos largos.",
    color: "#7c3aed",
  },
  mixto: {
    label: "Mixto",
    description: "La unidad acepta ambos modos según la temporada.",
    color: "#94a3b8",
  },
};

export const BOOKING_SOURCE_META: Record<BookingSource, { label: string; icon?: string; color: string }> = {
  directo: { label: "Directo", color: "#0f766e" },
  airbnb: { label: "Airbnb", color: "#FF5A5F" },
  booking: { label: "Booking", color: "#003580" },
  expedia: { label: "Expedia", color: "#FBC04B" },
  vrbo: { label: "VRBO", color: "#1B6BFF" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  instagram: { label: "Instagram", color: "#E4405F" },
  otro: { label: "Otro", color: "#64748b" },
};

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; color: string }> = {
  abierto: { label: "Abierto", color: "#ef4444" },
  en_progreso: { label: "En progreso", color: "#3b82f6" },
  esperando_repuesto: { label: "Esperando repuesto", color: "#f59e0b" },
  resuelto: { label: "Resuelto", color: "#10b981" },
  cerrado: { label: "Cerrado", color: "#64748b" },
};

export const TICKET_PRIORITY_META: Record<TicketPriority, { label: string; color: string; weight: number }> = {
  baja: { label: "Baja", color: "#64748b", weight: 1 },
  media: { label: "Media", color: "#3b82f6", weight: 2 },
  alta: { label: "Alta", color: "#f59e0b", weight: 3 },
  urgente: { label: "Urgente", color: "#ef4444", weight: 4 },
};

export const CLEANING_STATUS_META: Record<CleaningStatus, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "#94a3b8" },
  en_progreso: { label: "En progreso", color: "#3b82f6" },
  completada: { label: "Completada", color: "#06b6d4" },
  verificada: { label: "Verificada", color: "#10b981" },
  cancelada: { label: "Cancelada", color: "#ef4444" },
};

// Categorías para "Consejos del depto". Cada categoría se asocia a un emoji
// (mostrado en chips/cards) y a un color base para el tinte de fondo/borde.
// El icono lucide se referencia por nombre para evitar acoplar este archivo
// a la dependencia de iconos (el consumidor mappea name → componente).
export const UNIT_TIP_CATEGORY_META: Record<
  UnitTipCategory,
  { label: string; emoji: string; iconName: string; color: string; bgClass: string; ringClass: string; textClass: string }
> = {
  general: {
    label: "General",
    emoji: "💡",
    iconName: "Lightbulb",
    color: "#eab308",
    bgClass: "bg-yellow-500/10",
    ringClass: "ring-yellow-500/30",
    textClass: "text-yellow-700 dark:text-yellow-400",
  },
  cocina: {
    label: "Cocina",
    emoji: "🍳",
    iconName: "ChefHat",
    color: "#f97316",
    bgClass: "bg-orange-500/10",
    ringClass: "ring-orange-500/30",
    textClass: "text-orange-700 dark:text-orange-400",
  },
  bano: {
    label: "Baño",
    emoji: "🚿",
    iconName: "ShowerHead",
    color: "#06b6d4",
    bgClass: "bg-cyan-500/10",
    ringClass: "ring-cyan-500/30",
    textClass: "text-cyan-700 dark:text-cyan-400",
  },
  dormitorio: {
    label: "Dormitorio",
    emoji: "🛏️",
    iconName: "Bed",
    color: "#a855f7",
    bgClass: "bg-purple-500/10",
    ringClass: "ring-purple-500/30",
    textClass: "text-purple-700 dark:text-purple-400",
  },
  acceso: {
    label: "Acceso",
    emoji: "🔑",
    iconName: "KeyRound",
    color: "#64748b",
    bgClass: "bg-slate-500/10",
    ringClass: "ring-slate-500/30",
    textClass: "text-slate-700 dark:text-slate-300",
  },
  electrodomesticos: {
    label: "Electro",
    emoji: "⚡",
    iconName: "Zap",
    color: "#3b82f6",
    bgClass: "bg-blue-500/10",
    ringClass: "ring-blue-500/30",
    textClass: "text-blue-700 dark:text-blue-400",
  },
  importante: {
    label: "Importante",
    emoji: "⚠️",
    iconName: "AlertTriangle",
    color: "#ef4444",
    bgClass: "bg-rose-500/10",
    ringClass: "ring-rose-500/30",
    textClass: "text-rose-700 dark:text-rose-400",
  },
};

export const UNIT_TIP_CATEGORIES: UnitTipCategory[] = [
  "general",
  "cocina",
  "bano",
  "dormitorio",
  "acceso",
  "electrodomesticos",
  "importante",
];

export const UNIT_TIP_REACTION_META: Record<
  UnitTipReactionType,
  { label: string; emoji: string; color: string }
> = {
  helpful: { label: "Me sirvió", emoji: "👍", color: "#10b981" },
  important: { label: "Importante", emoji: "⚠️", color: "#f59e0b" },
  love: { label: "Buenísimo", emoji: "❤️", color: "#ef4444" },
};

export const UNIT_TIP_REACTION_TYPES: UnitTipReactionType[] = ["helpful", "important", "love"];

// Estados del parte diario. El cromático va de slate (work in progress) a
// emerald (cerrado y enviado), pasando por amber (pendiente de revisar).
export const DAILY_REPORT_STATUS_META: Record<
  "borrador" | "revisado" | "enviado",
  { label: string; color: string; bgClass: string; ringClass: string; dotClass: string; textClass: string }
> = {
  borrador: {
    label: "Borrador",
    color: "#64748b",
    bgClass: "bg-slate-500/10",
    ringClass: "ring-slate-500/30",
    dotClass: "bg-slate-500",
    textClass: "text-slate-700 dark:text-slate-300",
  },
  revisado: {
    label: "Revisado",
    color: "#f59e0b",
    bgClass: "bg-amber-500/10",
    ringClass: "ring-amber-500/30",
    dotClass: "bg-amber-500",
    textClass: "text-amber-700 dark:text-amber-300",
  },
  enviado: {
    label: "Enviado",
    color: "#10b981",
    bgClass: "bg-emerald-500/10",
    ringClass: "ring-emerald-500/30",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-700 dark:text-emerald-300",
  },
};

// Paleta semántica para las secciones del parte. Misma escala cromática que
// UNIT_STATUS_META para que los staff lean el parte como una extensión del
// tablero de unidades. Cada sección define un color base hex (PDF / chart) y
// las clases Tailwind para chips/cards en el dashboard.
export const PARTE_DIARIO_SECTION_META = {
  check_outs: {
    label: "Check-outs",
    short: "CH OUT",
    color: "#ef4444",
    bgClass: "bg-rose-500/10",
    ringClass: "ring-rose-500/30",
    dotClass: "bg-rose-500",
    textClass: "text-rose-600 dark:text-rose-400",
  },
  check_ins: {
    label: "Check-ins",
    short: "CH IN",
    color: "#10b981",
    bgClass: "bg-emerald-500/10",
    ringClass: "ring-emerald-500/30",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  sucios: {
    label: "Sucios",
    short: "SUCIOS",
    color: "#06b6d4",
    bgClass: "bg-cyan-500/10",
    ringClass: "ring-cyan-500/30",
    dotClass: "bg-cyan-500",
    textClass: "text-cyan-600 dark:text-cyan-400",
  },
  tareas_pendientes: {
    label: "Tareas pendientes",
    short: "TAREAS",
    color: "#64748b",
    bgClass: "bg-slate-500/10",
    ringClass: "ring-slate-500/30",
    dotClass: "bg-slate-500",
    textClass: "text-slate-600 dark:text-slate-400",
  },
  arreglos: {
    label: "Arreglos",
    short: "ARREGLOS",
    color: "#f59e0b",
    bgClass: "bg-amber-500/10",
    ringClass: "ring-amber-500/30",
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-400",
  },
} as const;

export type ParteDiarioSectionKey = keyof typeof PARTE_DIARIO_SECTION_META;

export const ROLE_META: Record<UserRole, { label: string; description: string; color: string }> = {
  admin: { label: "Administrador", description: "Acceso completo", color: "#0f766e" },
  recepcion: { label: "Recepción", description: "Reservas, huéspedes, check-in/out", color: "#3b82f6" },
  mantenimiento: { label: "Mantenimiento", description: "Tickets de unidades", color: "#f97316" },
  limpieza: { label: "Limpieza", description: "Tareas de turnover", color: "#06b6d4" },
  owner_view: { label: "Propietario", description: "Solo lectura de sus unidades", color: "#a855f7" },
};

// Permisos default por rol
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Record<string, string[]>> = {
  admin: {
    "*": ["view", "create", "update", "delete"],
  },
  recepcion: {
    // TEMPORAL: recepción opera con permisos completos (equivalente a admin).
    // TODO: rebajar a un set acotado más adelante. El set original era:
    //   units ["view","update"], owners ["view"], bookings ["view"],
    //   guests ["view","create","update"], tickets ["view","create"],
    //   cleaning ["view"], concierge ["view","create","update"],
    //   messaging ["view","create","update"], crm_inbox ["view","create","update"],
    //   crm_rapidos ["view"], parte_diario ["view","update","create"],
    //   date_marks [CRUD], ical [CRUD]
    "*": ["view", "create", "update", "delete"],
  },
  mantenimiento: {
    units: ["view"],
    tickets: ["view", "create", "update"],
    cleaning: ["view"],
    parte_diario: ["view"],
    date_marks: ["view"],
    unit_tips: ["view", "create"],
  },
  limpieza: {
    units: ["view"],
    cleaning: ["view", "update"],
    parte_diario: ["view"],
    date_marks: ["view"],
    unit_tips: ["view", "create", "update", "delete"],
  },
  owner_view: {
    units: ["view"],
    bookings: ["view"],
    settlements: ["view"],
    date_marks: ["view"],
  },
};

export const APP_NAME = "rentOS";
export const APP_TAGLINE = "Operá y reservá alojamientos en un solo lugar";

// Coordenadas default para clima/contexto (Córdoba Capital).
// TODO: a futuro mover esto a `organizations` para multi-ciudad.
export const DEFAULT_COORDS = {
  latitude: -31.42,
  longitude: -64.19,
  timezone: "America/Argentina/Cordoba",
} as const;
