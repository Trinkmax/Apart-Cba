"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { Building2, Plus, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { UnitCard } from "./unit-card";
import { UnitFormDialog } from "./unit-form-dialog";
import { UNIT_STATUS_META, UNIT_STATUSES } from "@/lib/constants";
import { changeUnitStatus, reorderUnits } from "@/lib/actions/units";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Unit, UnitStatus, UnitWithRelations, Owner } from "@/lib/types/database";

interface KanbanBoardProps {
  initialUnits: UnitWithRelations[];
  owners: Owner[];
  organizationId: string;
}

export function KanbanBoard({ initialUnits, owners, organizationId }: KanbanBoardProps) {
  const [units, setUnits] = useState(initialUnits);
  const [activeUnit, setActiveUnit] = useState<UnitWithRelations | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const draggingIdRef = useRef<string | null>(null);

  // Suscripción Realtime — refresca cuando otros usuarios cambian unidades
  useEffect(() => {
    const supabase = createBrowserSupabase();

    const channel = supabase
      .channel(`apartcba:units:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "apartcba",
          table: "units",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Unit;
            // No pisar si yo lo estoy moviendo
            if (draggingIdRef.current === updated.id) return;
            setUnits((prev) =>
              prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u))
            );
          }
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const groupedByStatus = useMemo(() => {
    const map = new Map<UnitStatus, UnitWithRelations[]>();
    UNIT_STATUSES.forEach((s) => map.set(s, []));
    units.forEach((u) => {
      map.get(u.status)?.push(u);
    });
    map.forEach((list) => list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
    return map;
  }, [units]);

  const findStatusOf = useCallback(
    (id: string): UnitStatus | undefined => {
      const u = units.find((x) => x.id === id);
      return u?.status;
    },
    [units]
  );

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    draggingIdRef.current = id;
    const u = units.find((x) => x.id === id);
    if (u) setActiveUnit(u);
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    // Si over es una columna, mover al final de esa columna
    const overIsColumn = UNIT_STATUSES.includes(overId as UnitStatus);
    const targetStatus = overIsColumn ? (overId as UnitStatus) : findStatusOf(overId);
    if (!targetStatus) return;

    const activeStatus = findStatusOf(activeId);
    if (!activeStatus || activeStatus === targetStatus) return;

    setUnits((prev) =>
      prev.map((u) => (u.id === activeId ? { ...u, status: targetStatus } : u))
    );
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveUnit(null);
    draggingIdRef.current = null;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const overIsColumn = UNIT_STATUSES.includes(overId as UnitStatus);
    const newStatus = overIsColumn ? (overId as UnitStatus) : findStatusOf(overId);
    if (!newStatus) return;

    const overUnit = !overIsColumn ? units.find((u) => u.id === overId) : null;

    // Reorder dentro de columna
    const itemsInTarget = units.filter((u) => u.status === newStatus);
    const oldIdx = itemsInTarget.findIndex((u) => u.id === activeId);
    let newIdx = overIsColumn || !overUnit ? itemsInTarget.length - 1 : itemsInTarget.findIndex((u) => u.id === overId);
    if (newIdx < 0) newIdx = itemsInTarget.length - 1;

    const reordered = oldIdx >= 0 ? arrayMove(itemsInTarget, oldIdx, newIdx) : itemsInTarget;

    setUnits((prev) => {
      const others = prev.filter((u) => u.status !== newStatus);
      return [...others, ...reordered.map((u, i) => ({ ...u, position: i }))];
    });

    const movedUnit = units.find((u) => u.id === activeId);
    const previousStatus = movedUnit?.status;

    try {
      // Si cambió de columna, hacer el changeStatus (incluye reorder al final)
      if (previousStatus !== newStatus) {
        await changeUnitStatus(activeId, newStatus, "Movido en Kanban");
        toast.success(`${movedUnit?.code} → ${UNIT_STATUS_META[newStatus].label}`, {
          description: "Estado actualizado",
        });
      }
      // Y persistir el orden
      await reorderUnits(
        newStatus,
        reordered.map((u) => u.id)
      );
    } catch (err) {
      toast.error("No se pudo mover", { description: (err as Error).message });
      // Revertir
      setUnits(initialUnits);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            Unidades
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {units.length} unidades · arrastrá para cambiar de estado
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "hidden md:flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full",
              realtimeConnected
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            )}
            title={realtimeConnected ? "Realtime conectado" : "Realtime desconectado"}
          >
            <Wifi size={10} className={cn(realtimeConnected && "animate-pulse")} />
            {realtimeConnected ? "En vivo" : "Sin conexión"}
          </div>
          <UnitFormDialog owners={owners}>
            <Button className="gap-2"><Plus size={16} /> Nueva unidad</Button>
          </UnitFormDialog>
        </div>
      </div>

      {/* Board */}
      <ScrollArea className="flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 p-4 lg:p-6 min-h-full">
            {UNIT_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                units={groupedByStatus.get(status) ?? []}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeUnit ? <UnitCard unit={activeUnit} isOverlay /> : null}
          </DragOverlay>
        </DndContext>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

interface KanbanColumnProps {
  status: UnitStatus;
  units: UnitWithRelations[];
}

function KanbanColumn({ status, units }: KanbanColumnProps) {
  const meta = UNIT_STATUS_META[status];

  // Permitir drop en column vacía vía useSortable con un id = status
  const { setNodeRef, isOver } = useSortable({
    id: status,
    data: { type: "column", status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 w-80 flex flex-col rounded-xl border border-border bg-muted/30",
        "transition-all duration-200",
        isOver && "ring-2 ring-primary/40 bg-muted/50"
      )}
    >
      {/* Column header */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <div
            className="size-2 rounded-full shadow-sm"
            style={{ backgroundColor: meta.color }}
          />
          <h3 className="text-sm font-semibold tracking-tight">{meta.label}</h3>
        </div>
        <Badge variant="secondary" className="font-mono text-[10px] h-5">
          {units.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 min-h-[200px] overflow-y-auto">
        <SortableContext items={units.map((u) => u.id)} strategy={verticalListSortingStrategy}>
          {units.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/50 italic border border-dashed border-border/40 rounded-lg">
              Vacío
            </div>
          ) : (
            units.map((unit) => <UnitCard key={unit.id} unit={unit} />)
          )}
        </SortableContext>
      </div>
    </div>
  );
}
