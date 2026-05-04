"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
// useTransition se mantiene únicamente para el reordenamiento de unidades.
import {
  addDays,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  parseISO,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowDownUp,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  GripVertical,
  Hotel,
  House,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BOOKING_STATUS_META,
  BOOKING_SOURCE_META,
  UNIT_STATUS_META,
} from "@/lib/constants";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { reorderUnitsGlobal } from "@/lib/actions/units";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type {
  BookingMode,
  BookingPaymentSchedule,
  BookingSource,
  BookingStatus,
  BookingWithRelations,
  CashAccount,
  Unit,
  UnitWithRelations,
} from "@/lib/types/database";
import { CuotaBadge } from "@/components/payment-schedule/cuota-badge";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import {
  MoveConfirmDialog,
  type MoveOperation,
  type PendingMove,
} from "@/components/bookings/move-confirm-dialog";
import {
  BOOKING_BAR_STYLE,
  BOOKING_MODE_OVERLAY,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_MOBILE,
  MOBILE_ZOOM,
  SOURCE_ACCENT,
  UNIT_OVERLAY_STYLE,
  ZOOM_CONFIG,
  isoAddDays,
  dayOffset,
  type ZoomLevel,
} from "./pms-constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { PmsBookingPopoverContent } from "./pms-booking-popover";
import { PmsUnitPopoverContent } from "./pms-unit-popover";

interface PmsBoardProps {
  initialUnits: UnitWithRelations[];
  initialBookings: BookingWithRelations[];
  /** Cuentas de caja activas para el form de booking (cobro al crear/editar) */
  accounts?: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  /** Cuotas mensuales — para badges 1/N flotantes sobre las barras */
  initialSchedule?: BookingPaymentSchedule[];
  organizationId: string;
  startISO: string; // ISO yyyy-MM-dd — primer día visible
  days: number; // total de días a mostrar
  orgCurrency?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// Convierte "HH:MM[:SS]" a fracción de día (0..1). 11:00 → 0.4583
function timeToDayFraction(time: string | null | undefined, fallback = 0): number {
  if (!time) return fallback;
  const [hh, mm] = time.split(":").map((s) => parseInt(s, 10));
  if (isNaN(hh)) return fallback;
  const h = Math.min(23, Math.max(0, hh));
  const m = Math.min(59, Math.max(0, isNaN(mm) ? 0 : mm));
  return (h + m / 60) / 24;
}

// ─── Tipos de drag ──────────────────────────────────────────────────────────
type DragMode = "move" | "resize-left" | "resize-right";

interface DragState {
  bookingId: string;
  mode: DragMode;
  pointerStartX: number;
  pointerStartY: number;
  originalUnitId: string;
  originalCheckIn: string; // ISO
  originalCheckOut: string; // ISO
  // deltas (en unidades de grid)
  dayDelta: number;
  rowDelta: number;
  moved: boolean;
}

// ─── Componente principal ───────────────────────────────────────────────────
export function PmsBoard({
  initialUnits,
  initialBookings,
  accounts = [],
  initialSchedule = [],
  organizationId,
  startISO,
  days,
  orgCurrency = "ARS",
}: PmsBoardProps) {
  const router = useRouter();
  // ── estado base
  // Sincronizamos units/bookings cuando llegan nuevos props (router.refresh tras
  // crear/editar). Patrón "ajuste de state durante render" — reemplaza al
  // useEffect+setState que la regla react-hooks/set-state-in-effect prohíbe.
  // Para bookings preservamos las que están con mutaciones optimistas en curso
  // (drag-and-drop). Para units pisamos directamente.
  const [prevInitialUnits, setPrevInitialUnits] = useState(initialUnits);
  const [units, setUnits] = useState(initialUnits);
  if (prevInitialUnits !== initialUnits) {
    setPrevInitialUnits(initialUnits);
    setUnits(initialUnits);
  }
  const [prevInitialBookings, setPrevInitialBookings] = useState(initialBookings);
  const [bookings, setBookings] = useState(initialBookings);
  const [windowStart, setWindowStart] = useState(startISO);
  const [windowDays, setWindowDays] = useState(days);
  const [zoom, setZoom] = useState<ZoomLevel>("confort");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<BookingStatus>>(
    () => new Set(["pendiente", "confirmada", "check_in", "check_out"])
  );
  const [sourceFilter, setSourceFilter] = useState<Set<BookingSource>>(
    () => new Set(Object.keys(BOOKING_SOURCE_META) as BookingSource[])
  );
  // Filtro de modo: null = todos | "temporario" | "mensual"
  const [modeFilter, setModeFilter] = useState<BookingMode | null>(null);
  // Filtro: mostrar sólo bookings con cuotas vencidas
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Schedule (cuotas) — sincronizado con prop
  const [prevInitialSchedule, setPrevInitialSchedule] = useState(initialSchedule);
  const [schedule, setSchedule] = useState(initialSchedule);
  if (prevInitialSchedule !== initialSchedule) {
    setPrevInitialSchedule(initialSchedule);
    setSchedule(initialSchedule);
  }
  // Estado del dialog de confirmación obligatoria
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  // ── Filtros de búsqueda de unidades ────────────────────────────────────────
  // Pensado para ayudar a encontrar deptos: disponibilidad por fechas, cap.,
  // precio por noche, dormitorios, etc. Un valor vacío/null significa "no filtrar".
  interface UnitSearchFilters {
    availableFrom: string;
    availableTo: string;
    minGuests: string; // string para inputs (vacío = sin filtro)
    minPrice: string;
    maxPrice: string;
    minBedrooms: string;
    minBathrooms: string;
    neighborhood: string;
    defaultMode: "temporario" | "mensual" | "mixto" | null;
  }
  const EMPTY_UNIT_FILTERS: UnitSearchFilters = {
    availableFrom: "",
    availableTo: "",
    minGuests: "",
    minPrice: "",
    maxPrice: "",
    minBedrooms: "",
    minBathrooms: "",
    neighborhood: "",
    defaultMode: null,
  };
  const [unitFilters, setUnitFilters] = useState<UnitSearchFilters>(EMPTY_UNIT_FILTERS);

  const activeUnitFilterCount = useMemo(() => {
    let n = 0;
    if (unitFilters.availableFrom && unitFilters.availableTo) n += 1;
    if (unitFilters.minGuests) n += 1;
    if (unitFilters.minPrice) n += 1;
    if (unitFilters.maxPrice) n += 1;
    if (unitFilters.minBedrooms) n += 1;
    if (unitFilters.minBathrooms) n += 1;
    if (unitFilters.neighborhood.trim()) n += 1;
    if (unitFilters.defaultMode) n += 1;
    return n;
  }, [unitFilters]);

  function clearUnitFilters() {
    setUnitFilters(EMPTY_UNIT_FILTERS);
  }

  // ── modo edición de orden
  const [editMode, setEditMode] = useState(false);
  const [draftOrder, setDraftOrder] = useState<UnitWithRelations[]>(initialUnits);
  const [confirmReorderOpen, setConfirmReorderOpen] = useState(false);
  const [isSavingOrder, startSaveOrderTransition] = useTransition();
  const reorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const orderChanged = useMemo(() => {
    if (!editMode) return false;
    if (draftOrder.length !== units.length) return false;
    for (let i = 0; i < draftOrder.length; i++) {
      if (draftOrder[i].id !== units[i].id) return true;
    }
    return false;
  }, [editMode, draftOrder, units]);

  function enterEditMode() {
    setDraftOrder(units);
    setEditMode(true);
  }
  function cancelEditMode() {
    setEditMode(false);
    setConfirmReorderOpen(false);
    setDraftOrder(units);
  }
  function handleReorderDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = draftOrder.findIndex((u) => u.id === active.id);
    const newIndex = draftOrder.findIndex((u) => u.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setDraftOrder((prev) => arrayMove(prev, oldIndex, newIndex));
  }
  function applyReorder() {
    const ids = draftOrder.map((u) => u.id);
    startSaveOrderTransition(async () => {
      try {
        await reorderUnitsGlobal(ids);
        setUnits(draftOrder);
        setEditMode(false);
        setConfirmReorderOpen(false);
        toast.success("Orden actualizado", {
          description: `${draftOrder.length} unidades reordenadas`,
        });
        router.refresh();
      } catch (e) {
        toast.error("No se pudo guardar el orden", {
          description: (e as Error).message,
        });
      }
    });
  }

  // ── popovers
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [editBooking, setEditBooking] = useState<BookingWithRelations | null>(null);

  // ── quick-add dialog state
  const [quickAdd, setQuickAdd] = useState<{
    unitId: string;
    checkIn: string;
    checkOut: string;
  } | null>(null);

  // ── refs + drag state
  // `drag` state se lee en render. `dragRef` se lee desde los handlers de
  // pointer (síncrono, sin stale-closures). Ambos se mantienen en sync.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const pendingMutateIds = useRef<Set<string>>(new Set());

  // Long-press en mobile: el drag arranca recién después de mantener apretado
  // 600ms sin moverse. Mientras tanto, el scroll horizontal/vertical funciona
  // libremente porque NO hicimos preventDefault. Si el usuario mueve antes de
  // que dispare el timer, cancelamos y el browser hace pan natural.
  const LONG_PRESS_MS = 600;
  const LONG_PRESS_TOLERANCE_PX = 8;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressArmRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    /** Última posición del puntero antes de disparar (≤ tolerancia) */
    lastX: number;
    lastY: number;
    target: HTMLElement;
    booking: BookingWithRelations;
    mode: DragMode;
  } | null>(null);
  // Cuando el long-press dispara y entramos en modo drag, congelamos el scroll
  // *user-driven* del contenedor (touch-action: none) pero dejamos `overflow`
  // intacto para poder hacer auto-scroll programático cuando el dedo se acerca
  // a los bordes. Guardamos los estilos originales para restaurar.
  const scrollLockRef = useRef<{
    touchAction: string;
    overscrollBehavior: string;
  } | null>(null);
  // Posición de scroll y de puntero al iniciar el drag — para que el dayDelta
  // tenga en cuenta tanto el movimiento del dedo como el auto-scroll del grid.
  const dragInitialScrollRef = useRef<{ left: number; top: number } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lockGridScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || scrollLockRef.current) return;
    scrollLockRef.current = {
      touchAction: el.style.touchAction,
      overscrollBehavior: el.style.overscrollBehavior,
    };
    // touch-action:none corta cualquier pan/zoom táctil pero no `overflow`,
    // así podemos seguir scrolleando programáticamente con scrollBy/scrollLeft.
    el.style.touchAction = "none";
    el.style.overscrollBehavior = "none";
  }, []);
  const unlockGridScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    dragInitialScrollRef.current = null;
    lastPointerRef.current = null;
    const el = scrollRef.current;
    if (!el || !scrollLockRef.current) return;
    el.style.touchAction = scrollLockRef.current.touchAction;
    el.style.overscrollBehavior = scrollLockRef.current.overscrollBehavior;
    scrollLockRef.current = null;
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressArmRef.current = null;
  }, []);

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next ? { ...next } : null);
  }, []);

  // Reconciliación de bookings: si llegó un prop nuevo, fusionamos preservando
  // las que están en mid-mutation optimistic (drag-drop) — realtime se encarga
  // de propagar esos cambios cuando el server confirme.
  if (prevInitialBookings !== initialBookings) {
    setPrevInitialBookings(initialBookings);
    setBookings((prev) => {
      const pending = pendingMutateIds.current;
      if (pending.size === 0) return initialBookings;
      const prevById = new Map(prev.map((b) => [b.id, b]));
      return initialBookings.map((b) =>
        pending.has(b.id) && prevById.has(b.id) ? prevById.get(b.id)! : b
      );
    });
  }

  // ── zen mode (pantalla completa animada, oculta sidebar + topbar)
  // Estados:
  //   "idle"          → in-flow normal
  //   "expanding"     → fixed en rect capturado, animando hacia inset:0
  //   "expanded"      → fixed inset:0
  //   "collapsing"    → fixed en inset:0, animando hacia rect capturado
  type ZenPhase = "idle" | "expanding" | "expanded" | "collapsing";
  type ZenRect = { top: number; left: number; width: number; height: number } | null;
  const [zenPhase, setZenPhase] = useState<ZenPhase>("idle");
  // zenRect en state (no ref) — la regla react-hooks/refs prohíbe leer
  // ref.current durante render, y este valor se usa en el style del JSX.
  const [zenRect, setZenRect] = useState<ZenRect>(null);
  const zenWrapperRef = useRef<HTMLDivElement | null>(null);
  const ZEN_ANIM_MS = 380;

  const enterZen = useCallback(() => {
    const el = zenWrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setZenRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    setZenPhase("expanding");
    // siguiente frame → cambiar a 'expanded' para que la transición arranque
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setZenPhase("expanded"));
    });
  }, []);

  const exitZen = useCallback(() => {
    // recapturar el rect destino por si el viewport o el sidebar cambiaron
    setZenPhase("collapsing");
    window.setTimeout(() => {
      setZenPhase("idle");
      setZenRect(null);
    }, ZEN_ANIM_MS);
  }, []);

  const toggleZen = useCallback(() => {
    if (zenPhase === "idle") enterZen();
    else if (zenPhase === "expanded") exitZen();
  }, [zenPhase, enterZen, exitZen]);

  const zenActive = zenPhase !== "idle";
  const zenAtFullscreen = zenPhase === "expanding" || zenPhase === "expanded";

  // ESC para salir
  useEffect(() => {
    if (zenPhase !== "expanded") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitZen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenPhase, exitZen]);

  // Limpia el timer del long-press y restaura el scroll del grid al desmontar
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressArmRef.current = null;
      unlockGridScroll();
    };
  }, [unlockGridScroll]);

  // Bloquear scroll del body mientras zen está activo
  useEffect(() => {
    if (!zenActive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [zenActive]);

  // Estilos del wrapper según fase
  const zenStyle: React.CSSProperties | undefined = useMemo(() => {
    if (zenPhase === "idle") return undefined;
    if (zenAtFullscreen) {
      return { top: 0, left: 0, width: "100vw", height: "100vh" };
    }
    // expanding (initial frame) o collapsing
    if (zenRect) {
      return {
        top: zenRect.top,
        left: zenRect.left,
        width: zenRect.width,
        height: zenRect.height,
      };
    }
    return undefined;
  }, [zenPhase, zenAtFullscreen, zenRect]);

  // ── constantes de zoom (en mobile usamos un preset compacto y un sidebar
  // angosto para que entren ~6 días en pantallas de 360px)
  const isMobile = useIsMobile();
  const { cellWidth: CELL, rowHeight: ROW } = isMobile
    ? { cellWidth: MOBILE_ZOOM.cellWidth, rowHeight: MOBILE_ZOOM.rowHeight }
    : ZOOM_CONFIG[zoom];
  const SIDEBAR = isMobile ? SIDEBAR_WIDTH_MOBILE : SIDEBAR_WIDTH;

  // ── dateRange memoizado
  const dateRange = useMemo(() => {
    const start = parseISO(windowStart);
    return Array.from({ length: windowDays }).map((_, i) => addDays(start, i));
  }, [windowStart, windowDays]);

  // ── schedule indexado por booking_id (para badges flotantes)
  const scheduleByBooking = useMemo(() => {
    const m = new Map<string, BookingPaymentSchedule[]>();
    schedule.forEach((s) => {
      const arr = m.get(s.booking_id) ?? [];
      arr.push(s);
      m.set(s.booking_id, arr);
    });
    return m;
  }, [schedule]);

  // Booking IDs con al menos una cuota vencida
  const bookingsWithOverdue = useMemo(() => {
    const set = new Set<string>();
    schedule.forEach((s) => {
      if (s.status === "overdue") set.add(s.booking_id);
    });
    return set;
  }, [schedule]);

  // ── filtrado
  const visibleBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (!statusFilter.has(b.status)) return false;
      if (!sourceFilter.has(b.source)) return false;
      if (modeFilter && (b.mode ?? "temporario") !== modeFilter) return false;
      if (overdueOnly && !bookingsWithOverdue.has(b.id)) return false;
      if (!q) return true;
      return (
        b.guest?.full_name?.toLowerCase().includes(q) ||
        b.unit?.code?.toLowerCase().includes(q) ||
        b.unit?.name?.toLowerCase().includes(q) ||
        b.external_id?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [bookings, statusFilter, sourceFilter, modeFilter, query, overdueOnly, bookingsWithOverdue]);

  const bookingsByUnit = useMemo(() => {
    const m = new Map<string, BookingWithRelations[]>();
    visibleBookings.forEach((b) => {
      const arr = m.get(b.unit_id) ?? [];
      arr.push(b);
      m.set(b.unit_id, arr);
    });
    return m;
  }, [visibleBookings]);

  // Lease groups: para cada booking que pertenece a un grupo, calculamos
  // index (1..N) y total (N) ordenando por check_in_date. Lo computamos sobre
  // TODO el array `bookings` (no sólo visibles) para no perder índices cuando
  // el usuario filtra por status/canal/modo.
  const leaseGroupIndex = useMemo(() => {
    const groups = new Map<string, BookingWithRelations[]>();
    bookings.forEach((b) => {
      if (!b.lease_group_id) return;
      const arr = groups.get(b.lease_group_id) ?? [];
      arr.push(b);
      groups.set(b.lease_group_id, arr);
    });
    const out = new Map<string, { index: number; total: number }>();
    groups.forEach((arr) => {
      const sorted = arr.slice().sort((a, b) =>
        a.check_in_date < b.check_in_date ? -1 : 1
      );
      sorted.forEach((b, i) => {
        out.set(b.id, { index: i + 1, total: sorted.length });
      });
    });
    return out;
  }, [bookings]);

  // ── Filtrado de unidades (filtros de búsqueda) ─────────────────────────────
  // Aplicado DESPUÉS del cálculo de bookingsByUnit para usar las reservas
  // existentes en el chequeo de disponibilidad por rango.
  const filteredUnits = useMemo(() => {
    const f = unitFilters;
    const minGuests = f.minGuests ? Number(f.minGuests) : null;
    const minPrice = f.minPrice ? Number(f.minPrice) : null;
    const maxPrice = f.maxPrice ? Number(f.maxPrice) : null;
    const minBedrooms = f.minBedrooms ? Number(f.minBedrooms) : null;
    const minBathrooms = f.minBathrooms ? Number(f.minBathrooms) : null;
    const neighborhood = f.neighborhood.trim().toLowerCase();
    const checkAvailability =
      f.availableFrom && f.availableTo && f.availableTo > f.availableFrom;

    return units.filter((u) => {
      if (minGuests !== null && (u.max_guests ?? 0) < minGuests) return false;
      if (minPrice !== null && (Number(u.base_price) || 0) < minPrice) return false;
      if (maxPrice !== null && (Number(u.base_price) || 0) > maxPrice) return false;
      if (minBedrooms !== null && (u.bedrooms ?? 0) < minBedrooms) return false;
      if (minBathrooms !== null && (u.bathrooms ?? 0) < minBathrooms) return false;
      if (neighborhood) {
        const n = (u.neighborhood ?? "").toLowerCase();
        const a = (u.address ?? "").toLowerCase();
        if (!n.includes(neighborhood) && !a.includes(neighborhood)) return false;
      }
      if (f.defaultMode) {
        // Una unidad "mixto" acepta ambos modos, así que match contra
        // temporario/mensual también la incluye. Match exacto solo si pediste "mixto".
        if (f.defaultMode === "mixto") {
          if (u.default_mode !== "mixto") return false;
        } else {
          if (u.default_mode !== f.defaultMode && u.default_mode !== "mixto") return false;
        }
      }
      if (checkAvailability) {
        // Disponible si NINGUNA reserva activa overlapa con el rango pedido.
        const unitBookings = bookings.filter(
          (b) =>
            b.unit_id === u.id &&
            b.status !== "cancelada" &&
            b.status !== "no_show"
        );
        const overlap = unitBookings.some(
          (b) => b.check_in_date < f.availableTo && b.check_out_date > f.availableFrom
        );
        if (overlap) return false;
      }
      return true;
    });
  }, [units, unitFilters, bookings]);

  // ── stats por unidad dentro del rango visible (para el popover de unidad)
  const statsByUnit = useMemo(() => {
    const m = new Map<string, { nights: number; revenue: number }>();
    const endISO = isoAddDays(windowStart, windowDays);
    visibleBookings.forEach((b) => {
      if (b.status === "cancelada" || b.status === "no_show") return;
      const from = b.check_in_date > windowStart ? b.check_in_date : windowStart;
      const to = b.check_out_date < endISO ? b.check_out_date : endISO;
      if (to <= from) return;
      const nights = dayOffset(from, to);
      const prev = m.get(b.unit_id) ?? { nights: 0, revenue: 0 };
      prev.nights += nights;
      // Revenue prorrateado
      const totalNights = dayOffset(b.check_in_date, b.check_out_date);
      const rev = totalNights > 0 ? (Number(b.total_amount) * nights) / totalNights : 0;
      prev.revenue += rev;
      m.set(b.unit_id, prev);
    });
    return m;
  }, [visibleBookings, windowStart, windowDays]);

  // ── realtime
  useEffect(() => {
    const supabase = createBrowserSupabase();

    // Trae la reserva con sus relaciones (unit + guest) para que la fila del
    // grid muestre el huésped y la unidad correctamente, no solo "Sin huésped".
    async function fetchWithRelations(id: string): Promise<BookingWithRelations | null> {
      const { data } = await supabase
        .from("bookings")
        .select(
          "*, unit:units(id, code, name), guest:guests(id, full_name, phone, email)"
        )
        .eq("id", id)
        .maybeSingle();
      return (data as BookingWithRelations | null) ?? null;
    }

    const channel = supabase
      .channel(`apartcba:bookings:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "apartcba",
          table: "bookings",
          filter: `organization_id=eq.${organizationId}`,
        },
        async (payload) => {
          const id =
            (payload.new as { id?: string })?.id ??
            (payload.old as { id?: string })?.id;
          if (!id) return;
          if (pendingMutateIds.current.has(id)) return;

          if (payload.eventType === "DELETE") {
            setBookings((prev) => prev.filter((x) => x.id !== id));
            return;
          }

          // INSERT / UPDATE → re-fetch con relaciones para no perder unit/guest.
          const full = await fetchWithRelations(id);
          if (!full) return;

          setBookings((prev) => {
            const idx = prev.findIndex((x) => x.id === id);
            if (idx === -1) return [...prev, full];
            const next = prev.slice();
            next[idx] = full;
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  // ── scroll-to-today al montar
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const todayOff = dayOffset(windowStart, new Date().toISOString().slice(0, 10));
    if (todayOff < 0 || todayOff >= windowDays) return;
    // hoy cerca del borde izquierdo (2 días de pasado visibles)
    const target = (todayOff - 2) * CELL;
    el.scrollLeft = Math.max(0, target);
    // solo la primera vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── navegación
  const shiftDays = useCallback(
    (delta: number) => {
      setWindowStart((iso) => isoAddDays(iso, delta));
    },
    []
  );
  const jumpToday = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    setWindowStart(isoAddDays(today, -7));
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        const todayOff = 7;
        el.scrollLeft = Math.max(0, (todayOff - 2) * CELL);
      }
    });
  }, [CELL]);

  // ── drag handlers
  // Helper: arranca el drag activo (con captura de puntero)
  function startActiveDrag(
    target: HTMLElement,
    pointerId: number,
    clientX: number,
    clientY: number,
    booking: BookingWithRelations,
    mode: DragMode
  ) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // ignorable: el puntero ya fue liberado (e.g. scroll)
    }
    // Capturamos el scroll del grid en este instante: cuando el auto-scroll
    // mueva el contenedor, el delta de scroll se sumará al delta del puntero
    // para mantener la barra pegada al dedo y abrir paso a más días/unidades.
    if (scrollRef.current) {
      dragInitialScrollRef.current = {
        left: scrollRef.current.scrollLeft,
        top: scrollRef.current.scrollTop,
      };
    }
    lastPointerRef.current = { x: clientX, y: clientY };
    updateDrag({
      bookingId: booking.id,
      mode,
      pointerStartX: clientX,
      pointerStartY: clientY,
      originalUnitId: booking.unit_id,
      originalCheckIn: booking.check_in_date,
      originalCheckOut: booking.check_out_date,
      dayDelta: 0,
      rowDelta: 0,
      moved: false,
    });
    startAutoScroll();
  }

  // Recalcula los deltas a partir del último puntero conocido, sumando el
  // desplazamiento que el grid scrolleó automáticamente.
  function syncDragFromPointer() {
    const d = dragRef.current;
    const p = lastPointerRef.current;
    const init = dragInitialScrollRef.current;
    const el = scrollRef.current;
    if (!d || !p || !init || !el) return;
    const scrollDX = el.scrollLeft - init.left;
    const scrollDY = el.scrollTop - init.top;
    const rawDx = (p.x - d.pointerStartX) + scrollDX;
    const rawDy = (p.y - d.pointerStartY) + scrollDY;
    const moved = d.moved || Math.abs(rawDx) >= 5 || Math.abs(rawDy) >= 5;
    if (!moved) return;
    updateDrag({
      ...d,
      moved,
      dayDelta: Math.round(rawDx / CELL),
      rowDelta: d.mode === "move" ? Math.round(rawDy / ROW) : 0,
    });
  }

  // Auto-scroll: si el dedo se acerca a un borde del grid, scrolleamos en esa
  // dirección a una velocidad proporcional a la cercanía. Corre en rAF para
  // ser suave y sólo mientras hay drag activo.
  function startAutoScroll() {
    if (autoScrollRafRef.current !== null) return;
    const tick = () => {
      const el = scrollRef.current;
      const p = lastPointerRef.current;
      if (!el || !p || !dragRef.current) {
        autoScrollRafRef.current = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const EDGE = 64; // px desde el borde donde arranca el auto-scroll
      const MAX_SPEED = 18; // px por frame en el borde más extremo
      let vx = 0;
      let vy = 0;
      if (p.x < r.left + EDGE) {
        const t = Math.max(0, (r.left + EDGE - p.x) / EDGE);
        vx = -MAX_SPEED * t;
      } else if (p.x > r.right - EDGE) {
        const t = Math.max(0, (p.x - (r.right - EDGE)) / EDGE);
        vx = MAX_SPEED * t;
      }
      if (p.y < r.top + EDGE) {
        const t = Math.max(0, (r.top + EDGE - p.y) / EDGE);
        vy = -MAX_SPEED * t;
      } else if (p.y > r.bottom - EDGE) {
        const t = Math.max(0, (p.y - (r.bottom - EDGE)) / EDGE);
        vy = MAX_SPEED * t;
      }
      if (vx !== 0 || vy !== 0) {
        const before = { left: el.scrollLeft, top: el.scrollTop };
        el.scrollBy({ left: vx, top: vy, behavior: "auto" });
        // Sólo recalculamos si el scroll efectivamente cambió (útil cuando
        // estamos contra el final del contenido, así no metemos delta extra).
        if (el.scrollLeft !== before.left || el.scrollTop !== before.top) {
          syncDragFromPointer();
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }

  function onBarPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations,
    mode: DragMode
  ) {
    if (e.button !== 0) return;
    // no arrastrar canceladas/no-show
    if (booking.status === "cancelada" || booking.status === "no_show") return;

    const isTouch = e.pointerType === "touch" || e.pointerType === "pen";

    if (isTouch) {
      // En mobile: armamos el long-press. NO hacemos preventDefault para que
      // el scroll-x del contenedor funcione libre. Recién cuando el timer
      // dispara (sin movimiento previo) tomamos el control con pointer capture
      // y entramos a modo drag con feedback háptico.
      e.stopPropagation();
      cancelLongPress();
      const target = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      const clientX = e.clientX;
      const clientY = e.clientY;
      longPressArmRef.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastY: clientY,
        target,
        booking,
        mode,
      };
      longPressTimerRef.current = setTimeout(() => {
        const arm = longPressArmRef.current;
        if (!arm) return;
        longPressArmRef.current = null;
        longPressTimerRef.current = null;
        // Vibración háptica si el dispositivo la soporta
        try {
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(20);
          }
        } catch {
          // best-effort, no rompe el drag
        }
        // CRÍTICO en mobile: congelamos el scroll-x/y del grid antes de tomar
        // el control. Si no, iOS sigue scrolleando con el dedo y la barra
        // "viaja" con el contenedor en vez de seguir al puntero.
        lockGridScroll();
        // Usamos la última posición del dedo (lastX/lastY) como origen del drag,
        // no la posición original del touchstart, para que el dayDelta inicial
        // sea cero y la barra no salte cuando arranca el drag.
        startActiveDrag(arm.target, arm.pointerId, arm.lastX, arm.lastY, arm.booking, arm.mode);
      }, LONG_PRESS_MS);
      return;
    }

    // Desktop / mouse / stylus con botón: drag inmediato
    e.stopPropagation();
    e.preventDefault();
    startActiveDrag(e.currentTarget as HTMLElement, e.pointerId, e.clientX, e.clientY, booking, mode);
  }

  function onBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Si todavía estamos esperando el long-press, cualquier movimiento mayor
    // a la tolerancia cancela: el usuario está scrolleando. Si está dentro de
    // tolerancia, actualizamos lastX/lastY para arrancar el drag exactamente
    // donde está el dedo en el momento del fire (evita "saltos" iniciales).
    const arm = longPressArmRef.current;
    if (arm) {
      const dx = e.clientX - arm.startX;
      const dy = e.clientY - arm.startY;
      if (Math.abs(dx) > LONG_PRESS_TOLERANCE_PX || Math.abs(dy) > LONG_PRESS_TOLERANCE_PX) {
        cancelLongPress();
      } else {
        arm.lastX = e.clientX;
        arm.lastY = e.clientY;
      }
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    // En mobile preventDefault dentro del move asegura que iOS no inicie un
    // gesto de scroll/zoom paralelo aún con el contenedor lockeado. (e.button
    // no aplica a touch; usamos pointerType.)
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      e.preventDefault();
    }
    // Guardamos el último puntero para que el rAF de auto-scroll lo lea, y
    // recalculamos los deltas considerando el scroll actual del grid.
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    syncDragFromPointer();
  }

  // El pointerUp NO commitea: prepara el "ghost preview" (cambio en cliente,
  // marcado como pending) y abre el modal de confirmación. El commit ocurre
  // sólo si el usuario confirma. Si cancela, revertimos al snapshot original.
  function onBarPointerUp(
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations
  ) {
    // Si soltamos antes de que el long-press dispare → es un tap: abrir popover
    if (longPressArmRef.current) {
      cancelLongPress();
      setOpenBookingId(booking.id);
      setOpenUnitId(null);
      return;
    }

    const d = dragRef.current;
    if (!d) {
      unlockGridScroll();
      return;
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignorable
    }

    // Click (no-drag) → abrir popover de reserva
    if (!d.moved) {
      updateDrag(null);
      unlockGridScroll();
      setOpenBookingId(booking.id);
      setOpenUnitId(null);
      return;
    }

    // Calcular target
    let newCheckIn = booking.check_in_date;
    let newCheckOut = booking.check_out_date;
    let newUnitId = booking.unit_id;
    const operation: MoveOperation = d.mode;

    if (d.mode === "move") {
      newCheckIn = isoAddDays(d.originalCheckIn, d.dayDelta);
      newCheckOut = isoAddDays(d.originalCheckOut, d.dayDelta);
      const curRow = units.findIndex((u) => u.id === d.originalUnitId);
      const newRow = Math.max(0, Math.min(units.length - 1, curRow + d.rowDelta));
      newUnitId = units[newRow]?.id ?? newUnitId;
    } else if (d.mode === "resize-left") {
      newCheckIn = isoAddDays(d.originalCheckIn, d.dayDelta);
      if (newCheckIn >= newCheckOut) newCheckIn = isoAddDays(newCheckOut, -1);
    } else if (d.mode === "resize-right") {
      newCheckOut = isoAddDays(d.originalCheckOut, d.dayDelta);
      if (newCheckOut <= newCheckIn) newCheckOut = isoAddDays(newCheckIn, 1);
    }

    // Sin cambio real
    if (
      newCheckIn === booking.check_in_date &&
      newCheckOut === booking.check_out_date &&
      newUnitId === booking.unit_id
    ) {
      updateDrag(null);
      unlockGridScroll();
      return;
    }

    // Ghost preview: actualizamos el booking en cliente + lo marcamos como
    // pending (para que el realtime no nos pise). El servidor sólo se toca
    // cuando el usuario confirma el modal.
    const targetUnit = units.find((u) => u.id === newUnitId) ?? null;
    setBookings((bs) =>
      bs.map((b) =>
        b.id === booking.id
          ? {
              ...b,
              unit_id: newUnitId,
              check_in_date: newCheckIn,
              check_out_date: newCheckOut,
              unit: targetUnit
                ? {
                    id: targetUnit.id,
                    code: targetUnit.code,
                    name: targetUnit.name,
                  }
                : b.unit,
            }
          : b
      )
    );
    pendingMutateIds.current.add(booking.id);
    updateDrag(null);
    unlockGridScroll();

    setPendingMove({
      booking,
      operation,
      targetUnitId: newUnitId,
      targetUnitCode: targetUnit?.code ?? null,
      targetUnitName: targetUnit?.name ?? null,
      newCheckInDate: newCheckIn,
      newCheckOutDate: newCheckOut,
    });
  }

  // Cancela cualquier long-press pendiente y resetea el drag si el browser
  // interrumpe (e.g. el scroll container toma el control en mobile).
  function onBarPointerCancel() {
    cancelLongPress();
    unlockGridScroll();
  }

  function handleConfirmMove() {
    // El server ya respondió OK dentro del dialog; el ghost se vuelve permanente.
    if (!pendingMove) return;
    const id = pendingMove.booking.id;
    setPendingMove(null);
    // Liberamos el lock un poco después para no pisar con realtime
    setTimeout(() => pendingMutateIds.current.delete(id), 800);
    // router.refresh para recoger cualquier dato derivado (totals, status)
    router.refresh();
  }

  function handleCancelMove() {
    if (!pendingMove) return;
    const original = pendingMove.booking;
    // Rollback del ghost al snapshot original
    setBookings((bs) =>
      bs.map((b) =>
        b.id === original.id
          ? {
              ...b,
              unit_id: original.unit_id,
              check_in_date: original.check_in_date,
              check_out_date: original.check_out_date,
              unit: original.unit,
            }
          : b
      )
    );
    pendingMutateIds.current.delete(original.id);
    setPendingMove(null);
  }

  // Cambio de fecha pedido desde el popover (cards de check-in / check-out).
  // Construye un PendingMove y abre el MoveConfirmDialog para que pase por el
  // mismo flujo de confirmación que los drags (preview, conflictos, precio).
  function requestDateChangeFromPopover(
    booking: BookingWithRelations,
    field: "check_in_date" | "check_out_date",
    newDateISO: string
  ) {
    const newCheckIn = field === "check_in_date" ? newDateISO : booking.check_in_date;
    const newCheckOut = field === "check_out_date" ? newDateISO : booking.check_out_date;
    if (newCheckOut <= newCheckIn) {
      toast.error("Fecha inválida", {
        description: "El check-out debe ser posterior al check-in",
      });
      return;
    }
    if (
      newCheckIn === booking.check_in_date &&
      newCheckOut === booking.check_out_date
    ) {
      return;
    }

    // Optimistic ghost en el grid
    setBookings((bs) =>
      bs.map((b) =>
        b.id === booking.id
          ? { ...b, check_in_date: newCheckIn, check_out_date: newCheckOut }
          : b
      )
    );
    pendingMutateIds.current.add(booking.id);

    setPendingMove({
      booking,
      operation: field === "check_in_date" ? "resize-left" : "resize-right",
      targetUnitId: booking.unit_id,
      targetUnitCode: booking.unit?.code ?? null,
      targetUnitName: booking.unit?.name ?? null,
      newCheckInDate: newCheckIn,
      newCheckOutDate: newCheckOut,
    });
  }

  // ── click en celda vacía → abrir quick-add
  const onCellClick = useCallback(
    (unit: UnitWithRelations, date: Date) => {
      if (dragRef.current?.moved) return;
      const ci = format(date, "yyyy-MM-dd");
      const co = isoAddDays(ci, 1);
      setQuickAdd({ unitId: unit.id, checkIn: ci, checkOut: co });
    },
    []
  );

  // ── render helpers
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayOff = dayOffset(windowStart, todayISO);
  const gridWidth = windowDays * CELL;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={zenWrapperRef}
        className={cn(
          "flex flex-col bg-background",
          zenActive
            ? "fixed z-[60] shadow-2xl ring-1 ring-border/40 transition-[top,left,width,height] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[top,left,width,height]"
            : "h-[calc(100svh-3.5rem)] md:h-[calc(100svh-4rem)]"
        )}
        style={
          zenActive
            ? { ...zenStyle, transitionDuration: `${ZEN_ANIM_MS}ms` }
            : undefined
        }
      >
        {/* ═══════ Toolbar superior ═══════ */}
        <div className="shrink-0 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/30">
          {/* MOBILE TOOLBAR: nav + rango de fechas + búsqueda en una sola fila */}
          <div className="md:hidden flex items-center gap-1 px-2 py-2 safe-x">
            <Button size="icon" variant="ghost" className="size-9 shrink-0 tap" onClick={() => shiftDays(-7)} aria-label="Semana anterior">
              <ChevronLeft size={17} />
            </Button>
            <Button size="sm" variant="secondary" className="h-9 gap-1 text-[11px] px-2 tap shrink-0" onClick={jumpToday}>
              <CalendarDays size={13} />
              Hoy
            </Button>
            <Button size="icon" variant="ghost" className="size-9 shrink-0 tap" onClick={() => shiftDays(7)} aria-label="Semana siguiente">
              <ChevronRight size={17} />
            </Button>
            <div className="text-[10px] font-medium text-foreground/80 tabular-nums truncate min-w-0 flex-1 text-center px-1">
              {format(parseISO(windowStart), "d MMM", { locale: es })}
              {" — "}
              {format(addDays(parseISO(windowStart), windowDays - 1), "d MMM", { locale: es })}
            </div>
            <div className="relative shrink-0">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 h-9 w-28 text-[12px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* DESKTOP TOOLBAR */}
          <div className="hidden md:flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 flex-wrap">
            <div className="flex items-center gap-2 mr-1">
              <div className="size-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                <Hotel size={15} className="text-primary" />
              </div>
              <div className="hidden md:block">
                <h1 className="text-sm font-semibold leading-none tracking-tight">
                  Vista PMS
                </h1>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {activeUnitFilterCount > 0
                    ? `${filteredUnits.length} de ${units.length} unidades · `
                    : `${units.length} unidades · `}
                  {visibleBookings.length} reservas
                </p>
              </div>
            </div>

            <div className="h-6 w-px bg-border mx-1" />

            {/* Navigation */}
            <div className="flex items-center gap-0.5">
              <Button size="icon" variant="ghost" className="size-8" onClick={() => shiftDays(-7)}>
                <ChevronLeft size={15} />
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={jumpToday}>
                <CalendarDays size={13} />
                Hoy
              </Button>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => shiftDays(7)}>
                <ChevronRight size={15} />
              </Button>
            </div>

            <div className="h-6 w-px bg-border mx-1" />

            <div className="text-xs font-medium text-foreground/80 tabular-nums min-w-[180px]">
              {format(parseISO(windowStart), "d MMM", { locale: es })}
              {" — "}
              {format(addDays(parseISO(windowStart), windowDays - 1), "d MMM yyyy", { locale: es })}
            </div>

            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar huésped, unidad…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-7 h-8 w-56 text-xs"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Mode filter — segmented control de 3 estados (Todos | Temp | Mens).
                  "Mens" cambia a la vista mensual, no es un filtro. */}
              <ModeFilterToggle
                value={modeFilter}
                onChange={(next) => {
                  if (next === "mensual") {
                    router.push("/dashboard/unidades/calendario/mensual");
                    return;
                  }
                  setModeFilter(next);
                }}
              />

              {/* Cuotas vencidas: chip toggle. Muestra el contador si hay vencidas */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant={overdueOnly ? "default" : "outline"}
                    onClick={() => setOverdueOnly((v) => !v)}
                    className={cn(
                      "h-8 gap-1 text-xs",
                      bookingsWithOverdue.size > 0 && !overdueOnly &&
                        "border-rose-300/70 dark:border-rose-700/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    )}
                    aria-pressed={overdueOnly}
                  >
                    <span className={cn(
                      "size-1.5 rounded-full",
                      bookingsWithOverdue.size > 0
                        ? "bg-rose-500 animate-pulse"
                        : "bg-muted-foreground/40"
                    )} />
                    Cuotas vencidas
                    {bookingsWithOverdue.size > 0 && (
                      <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold tabular-nums">
                        {bookingsWithOverdue.size}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {bookingsWithOverdue.size === 0
                    ? "No hay cuotas vencidas"
                    : `${bookingsWithOverdue.size} reserva${bookingsWithOverdue.size === 1 ? "" : "s"} con cuota vencida`}
                </TooltipContent>
              </Tooltip>

              {/* Buscar deptos: filtros por disponibilidad/cap/precio */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={activeUnitFilterCount > 0 ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                  >
                    <SlidersHorizontal size={12} />
                    Buscar dept
                    {activeUnitFilterCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="h-4 text-[9px] bg-primary/20 text-primary-foreground/90"
                      >
                        {activeUnitFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[360px] p-0"
                  sideOffset={6}
                >
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Buscar departamento</div>
                      <div className="text-[11px] text-muted-foreground">
                        Filtrá por disponibilidad, capacidad y precio.
                      </div>
                    </div>
                    {activeUnitFilterCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={clearUnitFilters}
                      >
                        Limpiar
                      </Button>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
                    {/* Disponibilidad por rango */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Disponible entre
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="date"
                          value={unitFilters.availableFrom}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, availableFrom: e.target.value }))
                          }
                          className="h-8 text-xs"
                          placeholder="Desde"
                        />
                        <Input
                          type="date"
                          value={unitFilters.availableTo}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, availableTo: e.target.value }))
                          }
                          className="h-8 text-xs"
                          placeholder="Hasta"
                          min={unitFilters.availableFrom || undefined}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Oculta unidades con reservas activas que solapan con ese rango.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                          Huéspedes mín.
                        </div>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          value={unitFilters.minGuests}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, minGuests: e.target.value }))
                          }
                          placeholder="2"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                          Modo de operación
                        </div>
                        <Select
                          value={unitFilters.defaultMode ?? "any"}
                          onValueChange={(v) =>
                            setUnitFilters((f) => ({
                              ...f,
                              defaultMode: v === "any" ? null : (v as "temporario" | "mensual" | "mixto"),
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Todos</SelectItem>
                            <SelectItem value="temporario">Temporario (incluye mixto)</SelectItem>
                            <SelectItem value="mensual">Mensual (incluye mixto)</SelectItem>
                            <SelectItem value="mixto">Solo mixto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Precio por noche ({orgCurrency})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={unitFilters.minPrice}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, minPrice: e.target.value.replace(",", ".") }))
                          }
                          placeholder="Mín"
                          className="h-8 text-xs"
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={unitFilters.maxPrice}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, maxPrice: e.target.value.replace(",", ".") }))
                          }
                          placeholder="Máx"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                          Dormitorios mín.
                        </div>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={unitFilters.minBedrooms}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, minBedrooms: e.target.value }))
                          }
                          placeholder="1"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                          Baños mín.
                        </div>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={unitFilters.minBathrooms}
                          onChange={(e) =>
                            setUnitFilters((f) => ({ ...f, minBathrooms: e.target.value }))
                          }
                          placeholder="1"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Barrio / dirección
                      </div>
                      <Input
                        type="text"
                        value={unitFilters.neighborhood}
                        onChange={(e) =>
                          setUnitFilters((f) => ({ ...f, neighborhood: e.target.value }))
                        }
                        placeholder="Nueva Córdoba, Centro…"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="border-t px-4 py-2 flex items-center justify-between bg-muted/30">
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-semibold tabular-nums text-foreground">
                        {filteredUnits.length}
                      </span>{" "}
                      / {units.length} unidades
                    </span>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Status/source filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    Filtros
                    {(statusFilter.size < 6 || sourceFilter.size < 8) && (
                      <Badge variant="secondary" className="h-4 text-[9px]">
                        {statusFilter.size + sourceFilter.size}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                    Estado
                  </DropdownMenuLabel>
                  {(Object.keys(BOOKING_STATUS_META) as BookingStatus[]).map((s) => (
                    <DropdownMenuCheckboxItem
                      key={s}
                      checked={statusFilter.has(s)}
                      onCheckedChange={(c) => {
                        setStatusFilter((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(s);
                          else next.delete(s);
                          return next;
                        });
                      }}
                    >
                      <span
                        className="size-2 rounded-full mr-2"
                        style={{ backgroundColor: BOOKING_STATUS_META[s].color }}
                      />
                      {BOOKING_STATUS_META[s].label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                    Canal
                  </DropdownMenuLabel>
                  {(Object.keys(BOOKING_SOURCE_META) as BookingSource[]).map((s) => (
                    <DropdownMenuCheckboxItem
                      key={s}
                      checked={sourceFilter.has(s)}
                      onCheckedChange={(c) => {
                        setSourceFilter((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(s);
                          else next.delete(s);
                          return next;
                        });
                      }}
                    >
                      <span
                        className="size-2 rounded-full mr-2"
                        style={{ backgroundColor: BOOKING_SOURCE_META[s].color }}
                      />
                      {BOOKING_SOURCE_META[s].label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Zoom */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <ZoomIn size={12} />
                    {ZOOM_CONFIG[zoom].label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(ZOOM_CONFIG) as ZoomLevel[]).map((z) => (
                    <DropdownMenuCheckboxItem
                      key={z}
                      checked={zoom === z}
                      onCheckedChange={() => setZoom(z)}
                    >
                      {ZOOM_CONFIG[z].label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                    Rango
                  </DropdownMenuLabel>
                  {[30, 60, 90, 120].map((d) => (
                    <DropdownMenuCheckboxItem
                      key={d}
                      checked={windowDays === d}
                      onCheckedChange={() => setWindowDays(d)}
                    >
                      {d} días
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Zen mode (pantalla completa) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={zenActive ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={toggleZen}
                    aria-pressed={zenActive}
                    disabled={zenPhase === "expanding" || zenPhase === "collapsing"}
                  >
                    {zenActive ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    <span className="hidden md:inline">
                      {zenActive ? "Salir Zen" : "Zen"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {zenActive
                    ? "Salir del modo pantalla completa (Esc)"
                    : "Modo Zen — calendario a pantalla completa"}
                </TooltipContent>
              </Tooltip>

              {/* Toggle modo reordenar */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={editMode ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={editMode ? cancelEditMode : enterEditMode}
                  >
                    <ArrowDownUp size={12} />
                    {editMode ? "Salir de orden" : "Reordenar"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {editMode
                    ? "Cancelar cambios y salir del modo de orden"
                    : "Activar modo edición para reordenar las unidades"}
                </TooltipContent>
              </Tooltip>

              {/* Nueva reserva */}
              <BookingFormDialog units={units} accounts={accounts} existingBookings={bookings}>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={editMode}
                >
                  <Plus size={13} /> Nueva
                </Button>
              </BookingFormDialog>
            </div>
          </div>

          {/* Legend strip */}
          <div className="hidden lg:flex items-center gap-3 px-4 pb-2 text-[10px] text-muted-foreground flex-wrap">
            <span className="uppercase tracking-wider text-[9px] font-semibold text-foreground/60 mr-1">Leyenda</span>
            {(Object.keys(BOOKING_BAR_STYLE) as BookingStatus[]).map((s) => {
              const st = BOOKING_BAR_STYLE[s];
              return (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-5 rounded-sm bg-gradient-to-r"
                    style={{
                      backgroundImage: `linear-gradient(to right, ${st.hex}, ${st.hex}CC)`,
                    }}
                  />
                  {BOOKING_STATUS_META[s].label}
                </span>
              );
            })}
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-5 rounded-sm"
                style={{
                  background:
                    "repeating-linear-gradient(135deg, rgba(100,116,139,0.4) 0 4px, rgba(100,116,139,0.15) 4px 8px)",
                }}
              />
              Bloqueo operacional
            </span>
          </div>
        </div>

        {/* ═══════ Banner de modo edición ═══════ */}
        {editMode && (
          <div className="shrink-0 border-b bg-amber-50 dark:bg-amber-500/10 border-amber-300/60 dark:border-amber-500/30">
            <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-md bg-amber-500/20 flex items-center justify-center ring-1 ring-amber-500/30">
                  <ArrowDownUp size={13} className="text-amber-700 dark:text-amber-300" />
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Modo edición de orden
                  </div>
                  <div className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
                    Arrastrá las filas para definir el orden de las unidades.
                  </div>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {orderChanged && (
                  <Badge variant="secondary" className="text-[10px] gap-1 bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/30">
                    Cambios sin guardar
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={cancelEditMode}
                  disabled={isSavingOrder}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setConfirmReorderOpen(true)}
                  disabled={!orderChanged || isSavingOrder}
                >
                  <Check size={12} />
                  Guardar orden
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ Panel reorden (modo edición) ═══════ */}
        {editMode ? (
          <div className="flex-1 overflow-auto bg-muted/20">
            <div className="max-w-2xl mx-auto p-4 sm:p-6">
              <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
                    Unidad
                  </span>
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
                    {draftOrder.length} unidades
                  </span>
                </div>
                <DndContext
                  sensors={reorderSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorderDragEnd}
                >
                  <SortableContext
                    items={draftOrder.map((u) => u.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="divide-y divide-border/60">
                      {draftOrder.map((unit, idx) => (
                        <SortableUnitOrderRow
                          key={unit.id}
                          unit={unit}
                          index={idx}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 px-1">
                El orden se aplica a la grilla de Unidades y a las filas del Calendario PMS.
              </p>
            </div>
          </div>
        ) : (
        /* ═══════ Grid ═══════ */
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto relative overscroll-contain touch-pan-x touch-pan-y"
          style={{ scrollbarGutter: "stable" }}
        >
          <div
            ref={gridRef}
            className="relative"
            style={{
              width: SIDEBAR + gridWidth,
              minHeight: "100%",
            }}
          >
            {/* ─── Header fila fecha (sticky top) ─── */}
            <div
              className="sticky top-0 z-30 flex bg-background/95 backdrop-blur border-b"
              style={{ height: isMobile ? 44 : 52 }}
            >
              <div
                className="sticky left-0 z-40 bg-background border-r flex items-end px-2 sm:px-3 pb-1.5 shrink-0"
                style={{ width: SIDEBAR }}
              >
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Unidad
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-muted-foreground/80">
                    {units.length}{isMobile ? "" : " activas"}
                  </div>
                </div>
              </div>

              <div className="relative" style={{ width: gridWidth }}>
                {/* Month band */}
                <MonthBand startISO={windowStart} days={windowDays} cellWidth={CELL} />
                {/* Day chips */}
                <div className="flex absolute bottom-0 left-0 right-0 h-[34px]">
                  {dateRange.map((d, i) => {
                    const prev = i > 0 ? dateRange[i - 1] : null;
                    const monthBoundary = prev && !isSameMonth(prev, d);
                    return (
                      <DayChip
                        key={d.toISOString()}
                        date={d}
                        cellWidth={CELL}
                        monthBoundary={!!monthBoundary}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ─── Rows ─── */}
            {filteredUnits.length === 0 && units.length > 0 && (
              <div className="px-6 py-12 text-center">
                <Hotel className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                <h3 className="font-semibold">Ninguna unidad coincide con los filtros</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Probá relajar los criterios o limpiá los filtros para volver a ver todas las unidades.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-8 text-xs"
                  onClick={clearUnitFilters}
                >
                  Limpiar filtros
                </Button>
              </div>
            )}
            {filteredUnits.map((unit, rowIdx) => {
              const unitBookings = bookingsByUnit.get(unit.id) ?? [];
              const overlay = UNIT_OVERLAY_STYLE[unit.status];
              const stats = statsByUnit.get(unit.id);
              const totalNights = windowDays;
              const occupiedNights = stats?.nights ?? 0;
              const occupancyPct = totalNights > 0 ? (occupiedNights / totalNights) * 100 : 0;

              return (
                <div
                  key={unit.id}
                  className={cn(
                    "flex border-b border-border/60 relative",
                    rowIdx % 2 === 1 && "bg-muted/15"
                  )}
                  style={{ height: ROW }}
                >
                  {/* Sidebar cell: unit info */}
                  <UnitCellHeader
                    unit={unit}
                    occupancyPct={occupancyPct}
                    nights={occupiedNights}
                    totalNights={totalNights}
                    revenue={stats?.revenue ?? 0}
                    currency={orgCurrency}
                    isOpen={openUnitId === unit.id}
                    onOpenChange={(o) => setOpenUnitId(o ? unit.id : null)}
                    sidebarWidth={SIDEBAR}
                    compact={isMobile}
                  />

                  {/* Cells */}
                  <div
                    className="relative shrink-0"
                    style={{ width: gridWidth }}
                  >
                    {/* Unit-status overlay (limpieza / mantenimiento / bloqueado) */}
                    {overlay && (
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{ background: overlay.pattern }}
                        title={overlay.label}
                      />
                    )}

                    {/* Day cells grid background */}
                    {dateRange.map((d, i) => {
                      const wk = isWeekend(d);
                      const hoy = isToday(d);
                      const prev = i > 0 ? dateRange[i - 1] : null;
                      const monthBoundary = prev && !isSameMonth(prev, d);
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => onCellClick(unit, d)}
                          className={cn(
                            "absolute top-0 bottom-0 hover:bg-primary/5 active:bg-primary/10 transition-colors group/cell",
                            wk && "bg-amber-50/60 dark:bg-amber-500/[0.03]",
                            hoy && "bg-primary/5 dark:bg-primary/10",
                            monthBoundary && "border-l-2 border-border"
                          )}
                          style={{
                            left: i * CELL,
                            width: CELL,
                            borderRight: "1px solid var(--border)",
                          }}
                          aria-label={`Crear reserva en ${unit.code} · ${format(d, "d MMM", { locale: es })}`}
                        >
                          <span className="sr-only">Crear reserva</span>
                          <Plus
                            size={14}
                            className="text-primary/60 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 transition-opacity"
                          />
                        </button>
                      );
                    })}

                    {/* Booking bars */}
                    {unitBookings.map((b) => (
                      <BookingBar
                        key={b.id}
                        booking={b}
                        leaseInfo={leaseGroupIndex.get(b.id) ?? null}
                        scheduleForBooking={scheduleByBooking.get(b.id) ?? []}
                        accounts={accounts}
                        windowStart={windowStart}
                        windowDays={windowDays}
                        cellWidth={CELL}
                        rowHeight={ROW}
                        dragState={drag?.bookingId === b.id ? drag : null}
                        isOpen={openBookingId === b.id}
                        onOpenChange={(o) => setOpenBookingId(o ? b.id : null)}
                        onEdit={() => {
                          setOpenBookingId(null);
                          setEditBooking(b);
                        }}
                        onPointerDown={onBarPointerDown}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={onBarPointerUp}
                        onPointerCancel={onBarPointerCancel}
                        onRequestDateChange={requestDateChangeFromPopover}
                        unitCode={unit.code}
                        unitName={unit.name}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Today vertical line (over all rows) */}
            {todayOff >= 0 && todayOff < windowDays && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-[5]"
                style={{
                  left: SIDEBAR + todayOff * CELL,
                  width: CELL,
                }}
              >
                <div className="absolute inset-y-0 left-0 w-0.5 bg-primary/60 shadow-[0_0_8px_rgba(var(--primary-rgb,59,130,246),0.35)]" />
                <div className="absolute top-0 left-0 -translate-x-1/2 bg-primary text-primary-foreground text-[9px] px-1.5 py-0.5 rounded-b-md font-semibold tracking-widest uppercase shadow-sm">
                  Hoy
                </div>
              </div>
            )}

            {/* Empty state when no units */}
            {units.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-24">
                <div className="text-center max-w-sm">
                  <Hotel className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                  <h3 className="font-semibold">No hay unidades cargadas todavía</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cargá tu primera unidad en <span className="font-medium">Unidades → Nueva unidad</span> para empezar a ver el calendario PMS.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Confirmación de guardar orden */}
        <Dialog
          open={confirmReorderOpen}
          onOpenChange={(o) => { if (!isSavingOrder) setConfirmReorderOpen(o); }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Guardar nuevo orden</DialogTitle>
              <DialogDescription>
                Vas a actualizar el orden de {draftOrder.length} unidades. Esto se reflejará en la grilla de Unidades y en el Calendario PMS.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmReorderOpen(false)}
                disabled={isSavingOrder}
              >
                Revisar de nuevo
              </Button>
              <Button onClick={applyReorder} disabled={isSavingOrder}>
                {isSavingOrder ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                Confirmar y guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit dialog (portal controlado) */}
        {editBooking && (
          <BookingFormDialog
            key={editBooking.id}
            booking={editBooking}
            units={units}
            accounts={accounts}
            existingBookings={bookings}
            open
            onOpenChange={(o) => { if (!o) setEditBooking(null); }}
          />
        )}

        {/* Quick-add dialog */}
        {quickAdd && (
          <QuickAddBridge
            units={units}
            accounts={accounts}
            existingBookings={bookings}
            unitId={quickAdd.unitId}
            checkIn={quickAdd.checkIn}
            checkOut={quickAdd.checkOut}
            onClose={() => setQuickAdd(null)}
          />
        )}

        {/* Modal de confirmación obligatoria para mover/extender */}
        <MoveConfirmDialog
          pending={pendingMove}
          onConfirmed={handleConfirmMove}
          onCancel={handleCancelMove}
        />
      </div>
    </TooltipProvider>
  );
}

// ─── Subcomponentes top-level ───────────────────────────────────────────────

interface ModeFilterToggleProps {
  value: BookingMode | null;
  onChange: (next: BookingMode | null) => void;
}

function ModeFilterToggle({ value, onChange }: ModeFilterToggleProps) {
  const opts: { id: BookingMode | null; label: string; icon: typeof CalendarRange | null; tone: string }[] = [
    { id: null, label: "Todos", icon: null, tone: "" },
    {
      id: "temporario",
      label: "Temp",
      icon: CalendarRange,
      tone: "data-[active=true]:bg-sky-500/15 data-[active=true]:text-sky-700 dark:data-[active=true]:text-sky-300 data-[active=true]:ring-sky-500/30",
    },
    {
      id: "mensual",
      label: "Mens",
      icon: House,
      tone: "data-[active=true]:bg-violet-500/15 data-[active=true]:text-violet-700 dark:data-[active=true]:text-violet-300 data-[active=true]:ring-violet-500/30",
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Filtro de modo"
      className="flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
    >
      {opts.map((o) => {
        const active = value === o.id;
        const Icon = o.icon;
        return (
          <button
            key={o.id ?? "todos"}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "h-7 px-2 rounded text-[11px] font-medium flex items-center gap-1 transition-colors",
              "data-[active=false]:text-muted-foreground data-[active=false]:hover:text-foreground",
              "data-[active=true]:bg-background data-[active=true]:shadow-sm data-[active=true]:ring-1",
              o.tone
            )}
          >
            {Icon && <Icon size={11} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Subcomponentes
// ═════════════════════════════════════════════════════════════════════════

function MonthBand({
  startISO,
  days,
  cellWidth,
}: {
  startISO: string;
  days: number;
  cellWidth: number;
}) {
  // calcular segmentos de mes
  const start = parseISO(startISO);
  const segments: { label: string; startIdx: number; length: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const lastSeg = segments[segments.length - 1];
    const label = format(d, "MMMM yyyy", { locale: es });
    if (!lastSeg || lastSeg.label !== label) {
      segments.push({ label, startIdx: i, length: 1 });
    } else {
      lastSeg.length++;
    }
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-[18px] flex">
      {segments.map((seg, i) => (
        <div
          key={i}
          className="relative border-l border-border/50 first:border-l-0 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 px-2 py-0.5 truncate"
          style={{
            left: 0,
            width: seg.length * cellWidth,
          }}
        >
          {seg.label}
        </div>
      ))}
    </div>
  );
}

function DayChip({
  date,
  cellWidth,
  monthBoundary,
}: {
  date: Date;
  cellWidth: number;
  monthBoundary: boolean;
}) {
  const wk = isWeekend(date);
  const hoy = isToday(date);
  return (
    <div
      className={cn(
        "shrink-0 flex flex-col items-center justify-center border-r border-border/50 text-[10px]",
        wk && "bg-amber-50/60 dark:bg-amber-500/[0.03]",
        hoy && "bg-primary/10",
        monthBoundary && "border-l-2 border-border"
      )}
      style={{ width: cellWidth }}
    >
      <span
        className={cn(
          "uppercase text-[8px] leading-tight font-medium tracking-widest",
          hoy ? "text-primary" : "text-muted-foreground"
        )}
      >
        {format(date, "EEE", { locale: es }).slice(0, 3)}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums leading-tight",
          hoy ? "text-primary text-sm" : wk ? "text-amber-700 dark:text-amber-400" : "text-foreground/90"
        )}
      >
        {format(date, "d")}
      </span>
    </div>
  );
}

function UnitCellHeader({
  unit,
  occupancyPct,
  nights,
  totalNights,
  revenue,
  currency,
  isOpen,
  onOpenChange,
  sidebarWidth = SIDEBAR_WIDTH,
  compact = false,
}: {
  unit: UnitWithRelations;
  occupancyPct: number;
  nights: number;
  totalNights: number;
  revenue: number;
  currency: string;
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  sidebarWidth?: number;
  compact?: boolean;
}) {
  const meta = UNIT_STATUS_META[unit.status];
  const overlay = UNIT_OVERLAY_STYLE[unit.status];
  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => onOpenChange(!isOpen)}
          className={cn(
            "sticky left-0 z-20 shrink-0 flex items-center border-r bg-background hover:bg-accent/40 transition-colors text-left group",
            compact ? "gap-1.5 px-1.5" : "gap-2.5 px-3"
          )}
          style={{ width: sidebarWidth }}
        >
          {/* Status stripe vertical izquierda */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] transition-all"
            style={{ backgroundColor: meta.color }}
          />

          {!compact && (
            <div
              className={cn(
                "size-8 rounded-lg shrink-0 flex items-center justify-center ring-1 transition-all",
                overlay ? "ring-transparent" : "ring-border/60"
              )}
              style={{
                backgroundColor: meta.color + "20",
                color: meta.color,
                background: overlay ? overlay.pattern : `linear-gradient(135deg, ${meta.color}22, ${meta.color}10)`,
              }}
            >
              <span className="text-[10px] font-bold tracking-tight">
                {unit.code.slice(0, 3).toUpperCase()}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1 pl-1">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "font-mono font-semibold truncate",
                  compact ? "text-[11px]" : "text-xs"
                )}
              >
                {unit.code}
              </span>
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: meta.color }}
              />
            </div>
            {!compact && (
              <div className="text-[10px] text-muted-foreground truncate">
                {unit.name}
              </div>
            )}
            {compact && (
              <div className="text-[9px] tabular-nums text-foreground/70 mt-0.5">
                {occupancyPct.toFixed(0)}%
              </div>
            )}
          </div>

          {/* Mini occupancy bar — solo en desktop */}
          {!compact && (
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <span className="text-[9px] font-semibold tabular-nums text-foreground/80">
                {occupancyPct.toFixed(0)}%
              </span>
              <div className="w-10 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    occupancyPct >= 70
                      ? "bg-emerald-500"
                      : occupancyPct >= 40
                        ? "bg-amber-500"
                        : "bg-rose-500/60"
                  )}
                  style={{ width: `${Math.min(100, occupancyPct)}%` }}
                />
              </div>
            </div>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent align="start" side="right" className="p-0 w-auto">
        <PmsUnitPopoverContent
          unit={unit}
          occupancyPct={occupancyPct}
          nightsOccupied={nights}
          nightsTotal={totalNights}
          revenue={revenue}
          currency={currency}
        />
      </PopoverContent>
    </Popover>
  );
}

interface BookingBarProps {
  booking: BookingWithRelations;
  /** Posición del booking dentro de su lease group (null si no es lease) */
  leaseInfo: { index: number; total: number } | null;
  /** Cuotas mensuales de esta booking (para badges 1/N flotantes) */
  scheduleForBooking?: BookingPaymentSchedule[];
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  windowStart: string;
  windowDays: number;
  cellWidth: number;
  rowHeight: number;
  dragState: DragState | null;
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
  onEdit: () => void;
  onPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations,
    mode: DragMode
  ) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations
  ) => void;
  /** Cancela el long-press si el browser interrumpe (scroll, touch-cancel) */
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  onRequestDateChange: (
    booking: BookingWithRelations,
    field: "check_in_date" | "check_out_date",
    newDateISO: string
  ) => void;
  unitCode: string;
  unitName: string;
}

function BookingBar({
  booking,
  leaseInfo,
  scheduleForBooking = [],
  accounts,
  windowStart,
  windowDays,
  cellWidth,
  rowHeight,
  dragState,
  isOpen,
  onOpenChange,
  onEdit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onRequestDateChange,
  unitCode,
  unitName,
}: BookingBarProps) {
  // cálculo de offsets — incluye fracción del día según hora real de check-in / check-out
  // (14:00 → +0.583 del día; 10:00 → +0.416 del día). Esto hace que la barra "pise"
  // visualmente el día de salida hasta la hora real de check-out, y deja espacio
  // para una nueva reserva el mismo día por la tarde.
  const ciFrac = timeToDayFraction(booking.check_in_time, 14 / 24);
  const coFrac = timeToDayFraction(booking.check_out_time, 10 / 24);
  let ciOffset = dayOffset(windowStart, booking.check_in_date) + ciFrac;
  let coOffset = dayOffset(windowStart, booking.check_out_date) + coFrac;
  let rowOffsetPx = 0;

  if (dragState) {
    if (dragState.mode === "move") {
      ciOffset += dragState.dayDelta;
      coOffset += dragState.dayDelta;
      rowOffsetPx = dragState.rowDelta * rowHeight;
    } else if (dragState.mode === "resize-left") {
      ciOffset += dragState.dayDelta;
      if (ciOffset >= coOffset - 0.25) ciOffset = coOffset - 0.5;
    } else if (dragState.mode === "resize-right") {
      coOffset += dragState.dayDelta;
      if (coOffset <= ciOffset + 0.25) coOffset = ciOffset + 0.5;
    }
  }

  // recorte a ventana visible
  if (coOffset <= 0 || ciOffset >= windowDays) return null;
  const clippedStart = Math.max(ciOffset, 0);
  const clippedEnd = Math.min(coOffset, windowDays);
  const width = (clippedEnd - clippedStart) * cellWidth;
  if (width <= 0) return null;
  const leftOverflow = ciOffset < 0;
  const rightOverflow = coOffset > windowDays;

  const style = BOOKING_BAR_STYLE[booking.status];
  const sourceColor = SOURCE_ACCENT[booking.source];
  const bookingMode: BookingMode = booking.mode ?? "temporario";
  const modeOverlay = BOOKING_MODE_OVERLAY[bookingMode];

  // Check-in dot is at exact grid line (start of bar).
  // We'll render an angled corner (triangle notch) for visual elegance at checkout.
  const isDragging = !!dragState;

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            // En mobile dejamos pasar el scroll del contenedor (touch-pan-x/y)
            // hasta que el long-press dispara y entramos en modo drag. En desktop
            // touch-none bloquea el pan para que el drag con puntero sea perfecto.
            // Cuando isDragging=true forzamos touch-none también en mobile.
            "absolute rounded-md border flex items-stretch overflow-hidden select-none",
            isDragging ? "touch-none" : "touch-pan-x touch-pan-y md:touch-none",
            "bg-gradient-to-r shadow-sm",
            style.gradient,
            style.border,
            style.ring,
            "hover:ring-2 hover:shadow-md hover:z-10",
            "transition-[transform,box-shadow] duration-150",
            isDragging && "ring-2 ring-primary z-20 shadow-xl scale-[1.02] cursor-grabbing",
            !isDragging && "cursor-grab",
            booking.status === "cancelada" && "opacity-55"
          )}
          style={{
            top: rowHeight * 0.14 + rowOffsetPx,
            height: rowHeight * 0.72,
            left: clippedStart * cellWidth + 2,
            width: width - 4,
            borderTopLeftRadius: leftOverflow ? 0 : undefined,
            borderBottomLeftRadius: leftOverflow ? 0 : undefined,
            borderTopRightRadius: rightOverflow ? 0 : undefined,
            borderBottomRightRadius: rightOverflow ? 0 : undefined,
          }}
          role="button"
          aria-label={`Reserva de ${booking.guest?.full_name ?? "huésped"} — ${booking.check_in_date} a ${booking.check_out_date}`}
          onPointerDown={(e) => {
            // si el click es en un handle, lo maneja el handle
            const t = e.target as HTMLElement;
            if (t.closest("[data-resize]")) return;
            onPointerDown(e, booking, "move");
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerUp(e, booking)}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
        >
          {/* Resize handle izquierdo */}
          {!leftOverflow && booking.status !== "cancelada" && (
            <div
              data-resize="left"
              className="w-1.5 cursor-ew-resize hover:bg-white/30 active:bg-white/40 transition-colors shrink-0 group/handle"
              onPointerDown={(e) => onPointerDown(e, booking, "resize-left")}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerUp(e, booking)}
              onPointerCancel={onPointerCancel}
              onLostPointerCapture={onPointerCancel}
            >
              <div className="h-full w-px bg-white/40 mx-auto opacity-0 group-hover/handle:opacity-100" />
            </div>
          )}

          {/* Source accent stripe */}
          <div
            className="w-[3px] shrink-0"
            style={{ backgroundColor: sourceColor, boxShadow: `0 0 6px ${sourceColor}` }}
          />

          {/* Mode overlay (patrón sutil de líneas verticales para mensual) */}
          {modeOverlay.stripePattern && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{ background: modeOverlay.stripePattern }}
            />
          )}

          {/* Content */}
          <div className={cn("relative flex-1 min-w-0 px-2 flex items-center gap-1.5", style.text)}>
            <GripVertical size={10} className="opacity-50 shrink-0 hidden sm:block" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1 truncate text-[11px] font-semibold">
                {/* Badge mensual — sólo visible cuando el modo es mensual */}
                {bookingMode === "mensual" && (
                  <span
                    aria-label="Reserva mensual"
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center size-3.5 rounded-sm ring-1 text-[8px] font-bold tracking-tighter",
                      modeOverlay.badgeBg,
                      modeOverlay.badgeText,
                      modeOverlay.badgeRing
                    )}
                  >
                    M
                  </span>
                )}
                {/* Badge lease group: 1/N — agrupa mensuales del mismo contrato */}
                {leaseInfo && leaseInfo.total > 1 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        aria-label={`Período ${leaseInfo.index} de ${leaseInfo.total} del contrato`}
                        className="shrink-0 inline-flex items-center justify-center px-1 h-3.5 rounded-sm bg-violet-700/90 text-white text-[8px] font-bold tabular-nums tracking-tight"
                      >
                        {leaseInfo.index}/{leaseInfo.total}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Período {leaseInfo.index} de {leaseInfo.total} del contrato mensual
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="truncate">{booking.guest?.full_name ?? "Sin huésped"}</span>
                {booking.internal_notes && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="shrink-0 inline-flex items-center justify-center size-3.5 rounded-full bg-amber-400/90 text-amber-950 ring-1 ring-amber-50/40 shadow-sm"
                        aria-label="Tiene comentario interno"
                      >
                        <MessageSquareText size={9} strokeWidth={2.5} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">
                      <span className="text-[10px] uppercase tracking-wider opacity-70 block mb-0.5">
                        Comentario interno
                      </span>
                      {booking.internal_notes}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] opacity-90 truncate">
                <span className="flex items-center gap-0.5">
                  <Moon size={8} /> {dayOffset(booking.check_in_date, booking.check_out_date)}n
                </span>
                <span>·</span>
                <span>{booking.guests_count}p</span>
                {Number(booking.paid_amount) < Number(booking.total_amount) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        aria-label="Saldo pendiente — no se podrá hacer check-out hasta cobrarlo"
                        className="ml-auto inline-flex items-center gap-0.5 rounded-sm bg-amber-400 text-amber-950 px-1 py-px font-bold tabular-nums shadow-sm ring-1 ring-amber-200/40"
                      >
                        <Wallet size={9} strokeWidth={2.5} />
                        {formatMoney(
                          Number(booking.total_amount) - Number(booking.paid_amount),
                          booking.currency
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <span className="text-[10px] uppercase tracking-wider opacity-70 block mb-0.5">
                        Saldo pendiente
                      </span>
                      <span>
                        Cobrá antes del check-out — el sistema bloquea la salida con saldo.
                      </span>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          {/* Resize handle derecho */}
          {!rightOverflow && booking.status !== "cancelada" && (
            <div
              data-resize="right"
              className="w-1.5 cursor-ew-resize hover:bg-white/30 active:bg-white/40 transition-colors shrink-0 group/handle"
              onPointerDown={(e) => onPointerDown(e, booking, "resize-right")}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerUp(e, booking)}
              onPointerCancel={onPointerCancel}
              onLostPointerCapture={onPointerCancel}
            >
              <div className="h-full w-px bg-white/40 mx-auto opacity-0 group-hover/handle:opacity-100" />
            </div>
          )}

          {/* Cuota badges flotantes — posicionadas en el due_date exacto */}
          {bookingMode === "mensual" && scheduleForBooking.length > 0 && (
            <div
              aria-hidden={false}
              className="absolute inset-x-0 -top-2 pointer-events-none"
            >
              {scheduleForBooking.map((s) => {
                // Posición relativa al inicio de la barra (clippedStart en grid coords)
                const dueOff = dayOffset(windowStart, s.due_date) + 0.5;
                if (dueOff < clippedStart || dueOff > clippedEnd) return null;
                const leftPx = (dueOff - clippedStart) * cellWidth;
                return (
                  <div
                    key={s.id}
                    className="absolute pointer-events-auto"
                    style={{
                      left: leftPx,
                      transform: "translate(-50%, 0)",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <CuotaBadge
                      schedule={s}
                      bookingId={booking.id}
                      accounts={accounts}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="start" className="p-0 w-auto" sideOffset={6}>
        <PmsBookingPopoverContent
          booking={booking}
          unitCode={unitCode}
          unitName={unitName}
          accounts={accounts}
          onEdit={onEdit}
          onStatusChanged={() => onOpenChange(false)}
          onRequestDateChange={(field, iso) => {
            onOpenChange(false);
            onRequestDateChange(booking, field, iso);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}


function SortableUnitOrderRow({
  unit,
  index,
}: {
  unit: UnitWithRelations;
  index: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: unit.id });
  const meta = UNIT_STATUS_META[unit.status];
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex items-center gap-3 px-4 py-3 bg-card transition-colors",
        isDragging && "z-10 shadow-2xl ring-2 ring-primary/40 rounded-md bg-card",
        !isDragging && "hover:bg-muted/40"
      )}
    >
      {/* Posición */}
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-6 text-right shrink-0">
        {(index + 1).toString().padStart(2, "0")}
      </span>

      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground transition-colors p-1 -m-1 rounded touch-none"
        aria-label={`Arrastrar ${unit.code}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>

      {/* Avatar code */}
      <div
        className="size-9 rounded-lg shrink-0 flex items-center justify-center ring-1 ring-border/60"
        style={{
          background: `linear-gradient(135deg, ${meta.color}22, ${meta.color}10)`,
          color: meta.color,
        }}
      >
        <span className="text-[10px] font-bold tracking-tight">
          {unit.code.slice(0, 3).toUpperCase()}
        </span>
      </div>

      {/* Code + name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sm truncate">{unit.code}</span>
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: meta.color }}
          />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{unit.name}</div>
      </div>

      {/* Status badge */}
      <Badge
        variant="secondary"
        className="text-[10px] gap-1 font-normal shrink-0 hidden sm:inline-flex"
        style={{ color: meta.color, borderColor: meta.color + "40" }}
      >
        <span className="status-dot" style={{ backgroundColor: meta.color }} />
        {meta.label}
      </Badge>
    </li>
  );
}

function QuickAddBridge({
  units,
  accounts,
  existingBookings,
  unitId,
  checkIn,
  checkOut,
  onClose,
}: {
  units: Unit[];
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  existingBookings: BookingWithRelations[];
  unitId: string;
  checkIn: string;
  checkOut: string;
  onClose: () => void;
}) {
  return (
    <BookingFormDialog
      units={units}
      accounts={accounts}
      existingBookings={existingBookings}
      defaultUnitId={unitId}
      defaultCheckIn={checkIn}
      defaultCheckOut={checkOut}
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
    />
  );
}
