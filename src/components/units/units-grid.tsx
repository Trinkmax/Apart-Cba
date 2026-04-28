"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  MapPin,
  Bed,
  Bath,
  Users,
  Building2,
  GripVertical,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
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
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UNIT_STATUSES, UNIT_STATUS_META } from "@/lib/constants";
import { formatMoney, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reorderUnitsGlobal } from "@/lib/actions/units";
import type { UnitWithRelations, UnitStatus } from "@/lib/types/database";

export function UnitsGrid({
  units,
  emptyCta,
}: {
  units: UnitWithRelations[];
  emptyCta?: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitStatus | "all">("all");
  const [orderedUnits, setOrderedUnits] = useState<UnitWithRelations[]>(units);
  const [pendingOrder, setPendingOrder] = useState<UnitWithRelations[] | null>(null);
  const [movedUnit, setMovedUnit] = useState<UnitWithRelations | null>(null);
  const [isPending, startTransition] = useTransition();

  // Mantener el state local sincronizado cuando cambian las units desde el server
  useEffect(() => {
    setOrderedUnits(units);
  }, [units]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const filtered = useMemo(() => {
    return orderedUnits.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          u.code.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          (u.neighborhood?.toLowerCase().includes(q) ?? false) ||
          (u.address?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [orderedUnits, query, statusFilter]);

  const dragEnabled = !query && statusFilter === "all";

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedUnits.findIndex((u) => u.id === active.id);
    const newIndex = orderedUnits.findIndex((u) => u.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(orderedUnits, oldIndex, newIndex);
    setPendingOrder(next);
    setMovedUnit(orderedUnits[oldIndex]);
  }

  function confirmReorder() {
    if (!pendingOrder) return;
    const ids = pendingOrder.map((u) => u.id);
    startTransition(async () => {
      try {
        await reorderUnitsGlobal(ids);
        setOrderedUnits(pendingOrder);
        setPendingOrder(null);
        setMovedUnit(null);
        toast.success("Orden actualizado");
        router.refresh();
      } catch (e) {
        toast.error("Error al guardar orden", { description: (e as Error).message });
      }
    });
  }

  function cancelReorder() {
    setPendingOrder(null);
    setMovedUnit(null);
  }

  return (
    <>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nombre, barrio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UnitStatus | "all")}>
          <SelectTrigger className="w-44 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {UNIT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="flex items-center gap-2">
                  <span className="status-dot" style={{ backgroundColor: UNIT_STATUS_META[s].color }} />
                  {UNIT_STATUS_META[s].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!dragEnabled && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Limpiá la búsqueda y los filtros para reordenar arrastrando.
        </p>
      )}

      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Building2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">
            {query || statusFilter !== "all" ? "Sin coincidencias" : "Aún no cargaste unidades"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            {query || statusFilter !== "all"
              ? "Probá ajustando los filtros"
              : "Cargá tu primera unidad para empezar a operar"}
          </p>
          {!query && statusFilter === "all" && emptyCta}
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnabled ? handleDragEnd : undefined}
        >
          <SortableContext items={filtered.map((u) => u.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
              {filtered.map((unit) => (
                <SortableUnitCard
                  key={unit.id}
                  unit={unit}
                  draggable={dragEnabled}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={!!pendingOrder} onOpenChange={(open) => { if (!open) cancelReorder(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar nuevo orden</DialogTitle>
            <DialogDescription>
              {movedUnit
                ? `Vas a mover ${movedUnit.code} a una nueva posición. ¿Guardar el orden?`
                : "¿Guardar el nuevo orden de las unidades?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelReorder} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmReorder} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={14} /> : null}
              Guardar orden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SortableUnitCard({
  unit,
  draggable,
}: {
  unit: UnitWithRelations;
  draggable: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: unit.id, disabled: !draggable });

  const meta = UNIT_STATUS_META[unit.status];
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "h-full rounded-xl",
        isDragging && "opacity-50 z-10"
      )}
    >
      <Card className="h-full flex flex-col overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/30 focus-within:ring-2 focus-within:ring-ring">
        <div className="h-1 shrink-0" style={{ backgroundColor: meta.color }} />
        <div className="relative flex-1 flex flex-col">
          {draggable && (
            <button
              type="button"
              className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              aria-label="Arrastrar para reordenar"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </button>
          )}
          <Link
            href={`/dashboard/unidades/${unit.id}`}
            className="p-4 flex-1 flex flex-col group focus:outline-none"
            onPointerDown={(e) => {
              // Permitir que el drag handle intercepte el pointer
              if ((e.target as HTMLElement).closest("[aria-label='Arrastrar para reordenar']")) {
                e.preventDefault();
              }
            }}
          >
            <div className={cn("flex items-start justify-between gap-2", draggable && "pl-6")}>
              <div className="min-w-0">
                <div className="font-semibold tracking-tight font-mono text-sm group-hover:text-primary transition-colors">
                  {unit.code}
                </div>
                <div className="text-sm text-muted-foreground truncate">{unit.name}</div>
              </div>
              <Badge
                variant="secondary"
                className="text-[10px] gap-1 font-normal shrink-0"
                style={{ color: meta.color, borderColor: meta.color + "40" }}
              >
                <span className="status-dot" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </Badge>
            </div>

            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              {unit.bedrooms !== null && unit.bedrooms !== undefined && (
                <span className="flex items-center gap-1"><Bed size={11} /> {unit.bedrooms}</span>
              )}
              {unit.bathrooms !== null && unit.bathrooms !== undefined && (
                <span className="flex items-center gap-1"><Bath size={11} /> {unit.bathrooms}</span>
              )}
              {unit.max_guests && (
                <span className="flex items-center gap-1"><Users size={11} /> {unit.max_guests}</span>
              )}
            </div>

            {unit.neighborhood && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <MapPin size={11} />
                <span className="truncate">{unit.neighborhood}</span>
              </div>
            )}

            {unit.base_price && (
              <div className="text-sm font-semibold mt-3">
                {formatMoney(Number(unit.base_price), unit.base_price_currency ?? "ARS")}
                <span className="text-xs text-muted-foreground font-normal ml-1">/ noche</span>
              </div>
            )}

            <div className="mt-auto pt-3">
              {unit.primary_owner && (
                <div className="flex items-center gap-1.5 pt-3 border-t border-border/50">
                  <Avatar className="size-5">
                    <AvatarFallback className="text-[8px] bg-muted">
                      {getInitials(unit.primary_owner.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {unit.primary_owner.full_name}
                  </span>
                </div>
              )}
            </div>
          </Link>
        </div>
      </Card>
    </div>
  );
}
