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
} from "./types/database";

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
    units: ["view", "update"],
    owners: ["view"],
    bookings: ["view", "create", "update"],
    guests: ["view", "create", "update"],
    payments: ["view", "create"],
    tickets: ["view", "create"],
    cleaning: ["view"],
    cash: ["view"],
    settlements: ["view"],
    concierge: ["view", "create", "update"],
  },
  mantenimiento: {
    units: ["view"],
    tickets: ["view", "create", "update"],
    cleaning: ["view"],
  },
  limpieza: {
    units: ["view"],
    cleaning: ["view", "update"],
  },
  owner_view: {
    units: ["view"],
    bookings: ["view"],
    settlements: ["view"],
  },
};

export const APP_NAME = "Apart Cba";
export const APP_TAGLINE = "Gestión de departamentos temporales";
