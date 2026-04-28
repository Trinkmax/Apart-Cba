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
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  GripVertical,
  Hotel,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Moon,
  Plus,
  Search,
  Wifi,
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
} from "@/components/ui/popover";
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
import { BOOKING_STATUS_META, BOOKING_SOURCE_META, UNIT_STATUS_META } from "@/lib/constants";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { moveBooking } from "@/lib/actions/bookings";
import { reorderUnitsGlobal } from "@/lib/actions/units";
import { cn } from "@/lib/utils";
import type {
  Booking,
  BookingSource,
  BookingStatus,
  BookingWithRelations,
  Unit,
  UnitWithRelations,
} from "@/lib/types/database";
import { BookingFormDialog } from "@/components/bookings/booking-form-dialog";
import {
  BOOKING_BAR_STYLE,
  SIDEBAR_WIDTH,
  SOURCE_ACCENT,
  UNIT_OVERLAY_STYLE,
  ZOOM_CONFIG,
  isoAddDays,
  dayOffset,
  type ZoomLevel,
} from "./pms-constants";
import { PmsBookingPopoverContent } from "./pms-booking-popover";
import { PmsUnitPopoverContent } from "./pms-unit-popover";

interface PmsBoardProps {
  initialUnits: UnitWithRelations[];
  initialBookings: BookingWithRelations[];
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
  organizationId,
  startISO,
  days,
  orgCurrency = "ARS",
}: PmsBoardProps) {
  const router = useRouter();
  // ── estado base
  const [units, setUnits] = useState(initialUnits);
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
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [, startTransition] = useTransition();

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

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next ? { ...next } : null);
  }, []);

  // ── zen mode (pantalla completa animada, oculta sidebar + topbar)
  // Estados:
  //   "idle"          → in-flow normal
  //   "expanding"     → fixed en rect capturado, animando hacia inset:0
  //   "expanded"      → fixed inset:0
  //   "collapsing"    → fixed en inset:0, animando hacia rect capturado
  type ZenPhase = "idle" | "expanding" | "expanded" | "collapsing";
  const [zenPhase, setZenPhase] = useState<ZenPhase>("idle");
  const zenRectRef = useRef<{ top: number; left: number; width: number; height: number } | null>(null);
  const zenWrapperRef = useRef<HTMLDivElement | null>(null);
  const ZEN_ANIM_MS = 380;

  const enterZen = useCallback(() => {
    const el = zenWrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zenRectRef.current = { top: r.top, left: r.left, width: r.width, height: r.height };
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
      zenRectRef.current = null;
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
    const r = zenRectRef.current;
    if (zenAtFullscreen) {
      return { top: 0, left: 0, width: "100vw", height: "100vh" };
    }
    // expanding (initial frame) o collapsing
    if (r) {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
    return undefined;
  }, [zenPhase, zenAtFullscreen]);

  // ── constantes de zoom
  const { cellWidth: CELL, rowHeight: ROW } = ZOOM_CONFIG[zoom];

  // ── dateRange memoizado
  const dateRange = useMemo(() => {
    const start = parseISO(windowStart);
    return Array.from({ length: windowDays }).map((_, i) => addDays(start, i));
  }, [windowStart, windowDays]);

  // ── filtrado
  const visibleBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (!statusFilter.has(b.status)) return false;
      if (!sourceFilter.has(b.source)) return false;
      if (!q) return true;
      return (
        b.guest?.full_name?.toLowerCase().includes(q) ||
        b.unit?.code?.toLowerCase().includes(q) ||
        b.unit?.name?.toLowerCase().includes(q) ||
        b.external_id?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [bookings, statusFilter, sourceFilter, query]);

  const bookingsByUnit = useMemo(() => {
    const m = new Map<string, BookingWithRelations[]>();
    visibleBookings.forEach((b) => {
      const arr = m.get(b.unit_id) ?? [];
      arr.push(b);
      m.set(b.unit_id, arr);
    });
    return m;
  }, [visibleBookings]);

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
        (payload) => {
          const id =
            (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
          if (id && pendingMutateIds.current.has(id)) return;
          if (payload.eventType === "INSERT") {
            const b = payload.new as Booking;
            setBookings((prev) => (prev.find((x) => x.id === b.id) ? prev : [...prev, b as BookingWithRelations]));
          } else if (payload.eventType === "UPDATE") {
            const b = payload.new as Booking;
            setBookings((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...b } : x)));
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old?.id) setBookings((prev) => prev.filter((x) => x.id !== old.id));
          }
        }
      )
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
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
    // centrar hoy
    const target = todayOff * CELL - el.clientWidth / 2 + CELL / 2;
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
        el.scrollLeft = Math.max(0, todayOff * CELL - el.clientWidth / 2 + CELL / 2);
      }
    });
  }, [CELL]);

  // ── drag handlers
  function onBarPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations,
    mode: DragMode
  ) {
    if (e.button !== 0) return;
    // no arrastrar canceladas/no-show
    if (booking.status === "cancelada" || booking.status === "no_show") return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateDrag({
      bookingId: booking.id,
      mode,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      originalUnitId: booking.unit_id,
      originalCheckIn: booking.check_in_date,
      originalCheckOut: booking.check_out_date,
      dayDelta: 0,
      rowDelta: 0,
      moved: false,
    });
  }

  function onBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.pointerStartX;
    const dy = e.clientY - d.pointerStartY;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    updateDrag({
      ...d,
      moved: true,
      dayDelta: Math.round(dx / CELL),
      rowDelta: d.mode === "move" ? Math.round(dy / ROW) : 0,
    });
  }

  async function onBarPointerUp(
    e: React.PointerEvent<HTMLDivElement>,
    booking: BookingWithRelations
  ) {
    const d = dragRef.current;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Click (no-drag) → abrir popover de reserva
    if (!d.moved) {
      updateDrag(null);
      setOpenBookingId(booking.id);
      setOpenUnitId(null);
      return;
    }

    // Calcular target
    let newCheckIn = booking.check_in_date;
    let newCheckOut = booking.check_out_date;
    let newUnitId = booking.unit_id;

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
      return;
    }

    // Optimistic update
    const prevBookings = bookings;
    setBookings((bs) =>
      bs.map((b) =>
        b.id === booking.id
          ? {
              ...b,
              unit_id: newUnitId,
              check_in_date: newCheckIn,
              check_out_date: newCheckOut,
              unit: units.find((u) => u.id === newUnitId)
                ? { id: newUnitId, code: units.find((u) => u.id === newUnitId)!.code, name: units.find((u) => u.id === newUnitId)!.name }
                : b.unit,
            }
          : b
      )
    );

    pendingMutateIds.current.add(booking.id);
    updateDrag(null);

    startTransition(async () => {
      try {
        await moveBooking({
          id: booking.id,
          unit_id: newUnitId,
          check_in_date: newCheckIn,
          check_out_date: newCheckOut,
        });
        const movedUnit = units.find((u) => u.id === newUnitId);
        toast.success(
          `Reserva actualizada${movedUnit ? ` · ${movedUnit.code}` : ""}`,
          {
            description: `${newCheckIn} → ${newCheckOut}`,
          }
        );
      } catch (err) {
        toast.error("No se pudo mover", { description: (err as Error).message });
        setBookings(prevBookings); // rollback
      } finally {
        setTimeout(() => pendingMutateIds.current.delete(booking.id), 800);
      }
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
            : "h-[calc(100vh-4rem)]"
        )}
        style={
          zenActive
            ? { ...zenStyle, transitionDuration: `${ZEN_ANIM_MS}ms` }
            : undefined
        }
      >
        {/* ═══════ Toolbar superior ═══════ */}
        <div className="shrink-0 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/30">
          <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
            <div className="flex items-center gap-2 mr-1">
              <div className="size-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/20">
                <Hotel size={15} className="text-primary" />
              </div>
              <div className="hidden md:block">
                <h1 className="text-sm font-semibold leading-none tracking-tight">
                  Vista PMS
                </h1>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {units.length} unidades · {visibleBookings.length} reservas
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

              {/* Realtime pill */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-medium px-2 h-8 rounded-md",
                      realtimeConnected
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Wifi size={11} className={cn(realtimeConnected && "animate-pulse")} />
                    <span className="hidden md:inline">
                      {realtimeConnected ? "En vivo" : "Sin conexión"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {realtimeConnected
                    ? "Actualizaciones en tiempo real activas"
                    : "Realtime desconectado"}
                </TooltipContent>
              </Tooltip>

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
              <BookingFormDialog units={units}>
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
          className="flex-1 overflow-auto relative"
          style={{ scrollbarGutter: "stable" }}
        >
          <div
            ref={gridRef}
            className="relative"
            style={{
              width: SIDEBAR_WIDTH + gridWidth,
              minHeight: "100%",
            }}
          >
            {/* ─── Header fila fecha (sticky top) ─── */}
            <div
              className="sticky top-0 z-30 flex bg-background/95 backdrop-blur border-b"
              style={{ height: 52 }}
            >
              <div
                className="sticky left-0 z-40 bg-background border-r flex items-end px-3 pb-1.5 shrink-0"
                style={{ width: SIDEBAR_WIDTH }}
              >
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Unidad
                  </div>
                  <div className="text-[11px] text-muted-foreground/80">
                    {units.length} activas
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
            {units.map((unit, rowIdx) => {
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
                  left: SIDEBAR_WIDTH + todayOff * CELL,
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
            open
            onOpenChange={(o) => { if (!o) setEditBooking(null); }}
          />
        )}

        {/* Quick-add dialog */}
        {quickAdd && (
          <QuickAddBridge
            units={units}
            unitId={quickAdd.unitId}
            checkIn={quickAdd.checkIn}
            checkOut={quickAdd.checkOut}
            onClose={() => setQuickAdd(null)}
          />
        )}
      </div>
    </TooltipProvider>
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
}: {
  unit: UnitWithRelations;
  occupancyPct: number;
  nights: number;
  totalNights: number;
  revenue: number;
  currency: string;
  isOpen: boolean;
  onOpenChange: (o: boolean) => void;
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
            "sticky left-0 z-20 shrink-0 flex items-center gap-2.5 px-3 border-r bg-background hover:bg-accent/40 transition-colors text-left group"
          )}
          style={{ width: SIDEBAR_WIDTH }}
        >
          {/* Status stripe vertical izquierda */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] transition-all"
            style={{ backgroundColor: meta.color }}
          />

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

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-xs truncate">
                {unit.code}
              </span>
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: meta.color }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {unit.name}
            </div>
          </div>

          {/* Mini occupancy bar */}
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
  unitCode: string;
  unitName: string;
}

function BookingBar({
  booking,
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
  unitCode,
  unitName,
}: BookingBarProps) {
  // cálculo de offsets — incluye fracción del día según hora real de check-in / check-out
  // (15:00 → +0.625 del día; 11:00 → +0.458 del día). Esto hace que la barra "pise"
  // visualmente el día de salida hasta la hora real de check-out, y deja espacio
  // para una nueva reserva el mismo día por la tarde.
  const ciFrac = timeToDayFraction(booking.check_in_time, 15 / 24);
  const coFrac = timeToDayFraction(booking.check_out_time, 11 / 24);
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

  // Check-in dot is at exact grid line (start of bar).
  // We'll render an angled corner (triangle notch) for visual elegance at checkout.
  const isDragging = !!dragState;

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "absolute rounded-md border flex items-stretch overflow-hidden select-none touch-none",
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
        >
          {/* Resize handle izquierdo */}
          {!leftOverflow && booking.status !== "cancelada" && (
            <div
              data-resize="left"
              className="w-1.5 cursor-ew-resize hover:bg-white/30 active:bg-white/40 transition-colors shrink-0 group/handle"
              onPointerDown={(e) => onPointerDown(e, booking, "resize-left")}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerUp(e, booking)}
            >
              <div className="h-full w-px bg-white/40 mx-auto opacity-0 group-hover/handle:opacity-100" />
            </div>
          )}

          {/* Source accent stripe */}
          <div
            className="w-[3px] shrink-0"
            style={{ backgroundColor: sourceColor, boxShadow: `0 0 6px ${sourceColor}` }}
          />

          {/* Content */}
          <div className={cn("flex-1 min-w-0 px-2 flex items-center gap-1.5", style.text)}>
            <GripVertical size={10} className="opacity-50 shrink-0 hidden sm:block" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1 truncate text-[11px] font-semibold">
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
                  <span className="ml-auto text-[9px] bg-white/20 rounded px-1">
                    Saldo
                  </span>
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
            >
              <div className="h-full w-px bg-white/40 mx-auto opacity-0 group-hover/handle:opacity-100" />
            </div>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="start" className="p-0 w-auto" sideOffset={6}>
        <PmsBookingPopoverContent
          booking={booking}
          unitCode={unitCode}
          unitName={unitName}
          onEdit={onEdit}
          onStatusChanged={() => onOpenChange(false)}
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
  unitId,
  checkIn,
  checkOut,
  onClose,
}: {
  units: Unit[];
  unitId: string;
  checkIn: string;
  checkOut: string;
  onClose: () => void;
}) {
  return (
    <BookingFormDialog
      units={units}
      defaultUnitId={unitId}
      defaultCheckIn={checkIn}
      defaultCheckOut={checkOut}
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
    />
  );
}
