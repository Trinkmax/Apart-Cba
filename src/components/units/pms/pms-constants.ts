import type { BookingMode, BookingStatus, BookingSource, UnitStatus } from "@/lib/types/database";

export type ZoomLevel = "compacto" | "confort" | "amplio";

export const ZOOM_CONFIG: Record<
  ZoomLevel,
  { cellWidth: number; rowHeight: number; dayLabel: "narrow" | "full"; label: string }
> = {
  compacto: { cellWidth: 36, rowHeight: 52, dayLabel: "narrow", label: "Compacto" },
  confort: { cellWidth: 56, rowHeight: 64, dayLabel: "full", label: "Confort" },
  amplio: { cellWidth: 88, rowHeight: 76, dayLabel: "full", label: "Amplio" },
};

// Mobile preset — celdas ultra compactas y sidebar de unidad reducido para
// poder ver ~6 días de un vistazo en pantallas de 360px y 7-8 en 414px.
export const MOBILE_ZOOM: { cellWidth: number; rowHeight: number; dayLabel: "narrow" } = {
  cellWidth: 38,
  rowHeight: 48,
  dayLabel: "narrow",
};

export const SIDEBAR_WIDTH = 232; // ancho del panel fijo izquierdo (desktop)
export const SIDEBAR_WIDTH_MOBILE = 96; // panel izquierdo angosto en mobile
export const HEADER_HEIGHT = 56; // ancho del header de días + mes

// ─── Paleta de reservas ─────────────────────────────────────────────────────
// Gradientes + bordes pensados para que se lean en el grid a baja altura
export const BOOKING_BAR_STYLE: Record<
  BookingStatus,
  {
    label: string;
    gradient: string;     // tailwind gradient classes
    border: string;       // tailwind border classes
    ring: string;         // hover ring
    text: string;         // text color
    hex: string;          // fallback / legend dot
  }
> = {
  pendiente: {
    label: "Pendiente",
    gradient: "from-amber-200/70 via-amber-100/80 to-amber-200/70 dark:from-amber-500/25 dark:via-amber-500/15 dark:to-amber-500/25",
    border: "border-amber-500/60 border-dashed",
    ring: "hover:ring-amber-500/50",
    text: "text-amber-950 dark:text-amber-50",
    hex: "#f59e0b",
  },
  confirmada: {
    label: "Confirmada",
    gradient: "from-emerald-500 via-emerald-500 to-teal-500",
    border: "border-emerald-600/40",
    ring: "hover:ring-emerald-400/50",
    text: "text-white",
    hex: "#10b981",
  },
  check_in: {
    label: "In-house",
    gradient: "from-blue-600 via-blue-500 to-sky-500",
    border: "border-blue-700/40",
    ring: "hover:ring-blue-400/60",
    text: "text-white",
    hex: "#3b82f6",
  },
  check_out: {
    label: "Check-out",
    gradient: "from-cyan-500 via-teal-500 to-teal-600",
    border: "border-cyan-600/40",
    ring: "hover:ring-cyan-400/50",
    text: "text-white",
    hex: "#06b6d4",
  },
  cancelada: {
    label: "Cancelada",
    gradient: "from-rose-400/40 via-rose-300/40 to-rose-400/40",
    border: "border-rose-500/50 border-dashed",
    ring: "hover:ring-rose-400/40",
    text: "text-rose-950/80 line-through",
    hex: "#ef4444",
  },
  no_show: {
    label: "No-show",
    gradient: "from-violet-500/60 via-fuchsia-500/50 to-violet-500/60",
    border: "border-violet-500/60 border-dashed",
    ring: "hover:ring-violet-400/50",
    text: "text-white",
    hex: "#7c3aed",
  },
};

export const SOURCE_ACCENT: Record<BookingSource, string> = {
  directo: "#0f766e",
  airbnb: "#FF5A5F",
  booking: "#003580",
  expedia: "#FBC04B",
  vrbo: "#1B6BFF",
  whatsapp: "#25D366",
  instagram: "#E4405F",
  otro: "#64748b",
};

// Overlay sobre celdas cuando la unidad no tiene reserva pero tiene estado
// operacional especial (limpieza, mantenimiento, bloqueo).
export const UNIT_OVERLAY_STYLE: Partial<
  Record<UnitStatus, { pattern: string; label: string; hex: string }>
> = {
  limpieza: {
    pattern:
      "linear-gradient(rgba(6,182,212,0.10), rgba(6,182,212,0.10)), repeating-linear-gradient(135deg, rgba(6,182,212,0.40) 0 8px, rgba(6,182,212,0.14) 8px 16px)",
    label: "Limpieza",
    hex: "#06b6d4",
  },
  mantenimiento: {
    pattern:
      "linear-gradient(rgba(249,115,22,0.10), rgba(249,115,22,0.10)), repeating-linear-gradient(135deg, rgba(249,115,22,0.40) 0 8px, rgba(249,115,22,0.14) 8px 16px)",
    label: "Mantenimiento",
    hex: "#f97316",
  },
  bloqueado: {
    pattern:
      "linear-gradient(rgba(100,116,139,0.10), rgba(100,116,139,0.10)), repeating-linear-gradient(135deg, rgba(100,116,139,0.50) 0 8px, rgba(100,116,139,0.18) 8px 16px)",
    label: "Bloqueado",
    hex: "#64748b",
  },
};

// Overlay extra cuando el booking es mensual: patrón de líneas verticales sutil
// (representa visualmente los billing cycles) + leve oscurecido. El badge "M"
// se renderiza dentro de la barra en BookingBar.
export const BOOKING_MODE_OVERLAY: Record<
  BookingMode,
  { stripePattern: string | null; sideAccent: string | null; badgeBg: string; badgeText: string; badgeRing: string }
> = {
  temporario: {
    stripePattern: null,
    sideAccent: null,
    badgeBg: "bg-sky-100 dark:bg-sky-900/60",
    badgeText: "text-sky-700 dark:text-sky-200",
    badgeRing: "ring-sky-300/60 dark:ring-sky-700/60",
  },
  mensual: {
    // Pattern: líneas verticales legibles cada ~19px
    stripePattern:
      "repeating-linear-gradient(0deg, transparent 0 17px, rgba(255,255,255,0.42) 17px 19px)",
    sideAccent: "#7c3aed", // violeta — borde izquierdo finito
    badgeBg: "bg-violet-100 dark:bg-violet-900/60",
    badgeText: "text-violet-700 dark:text-violet-100",
    badgeRing: "ring-violet-300/60 dark:ring-violet-700/60",
  },
};

export const ROW_COLOR_ALT = "bg-muted/25";

// Precomputa Date -> offset (en días) desde startDate.
// Nota: usamos noon local para evitar DST off-by-one.
export function dayOffset(startISO: string, targetISO: string): number {
  const s = new Date(startISO + "T12:00:00");
  const t = new Date(targetISO + "T12:00:00");
  return Math.round((t.getTime() - s.getTime()) / 86_400_000);
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
