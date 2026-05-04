"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface KanbanColumn<S extends string> {
  key: S;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  emptyText?: string;
}

export interface KanbanBoardProps<T extends { id: string }, S extends string> {
  columns: KanbanColumn<S>[];
  items: T[];
  getStatus: (item: T) => S;
  setItemStatus: (item: T, newStatus: S) => T;
  onMove: (id: string, newStatus: S) => Promise<void>;
  onCardClick?: (item: T) => void;
  renderCard: (item: T, opts: { dragging: boolean }) => React.ReactNode;
  sortFn?: (a: T, b: T) => number;
  className?: string;
  /** number of grid columns at xl breakpoint (default 4) */
  xlCols?: number;
}

export function KanbanBoard<T extends { id: string }, S extends string>({
  columns,
  items: initialItems,
  getStatus,
  setItemStatus,
  onMove,
  onCardClick,
  renderCard,
  sortFn,
  className,
  xlCols = 4,
}: KanbanBoardProps<T, S>) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // sync external changes (when parent re-fetches o cuando se cambia el status fuera del board)
  useStableSync(initialItems, getStatus, setItems);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const map = new Map<S, T[]>();
    columns.forEach((c) => map.set(c.key, []));
    items.forEach((it) => {
      const s = getStatus(it);
      const arr = map.get(s);
      if (arr) arr.push(it);
    });
    if (sortFn) map.forEach((list) => list.sort(sortFn));
    return map;
  }, [items, columns, getStatus, sortFn]);

  const activeItem = activeId ? items.find((it) => it.id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = String(e.active.id);
    const target = e.over?.id as S | undefined;
    if (!target) return;
    const item = items.find((it) => it.id === id);
    if (!item || getStatus(item) === target) return;

    const prev = items;
    setItems((cur) => cur.map((it) => (it.id === id ? setItemStatus(it, target) : it)));

    startTransition(async () => {
      try {
        await onMove(id, target);
        router.refresh();
      } catch (err) {
        setItems(prev);
        toast.error("No se pudo mover", { description: (err as Error).message });
      }
    });
  }

  // En desktop: grid responsive. En mobile: scroll horizontal con snap (tipo Trello).
  // Esto evita columnas extralargas que obligan al usuario a scrollear sin contexto.
  const gridClass = cn(
    "grid md:grid-cols-2 gap-3 md:gap-4",
    "grid-flow-col md:grid-flow-row auto-cols-[85vw] md:auto-cols-auto",
    "overflow-x-auto md:overflow-visible",
    "snap-x snap-mandatory md:snap-none",
    "pb-2 md:pb-0 -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0 no-scrollbar",
    xlCols === 3 && "lg:grid-cols-3",
    xlCols === 4 && "xl:grid-cols-4",
    xlCols === 5 && "xl:grid-cols-5",
    className
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={gridClass}>
        {columns.map((col) => {
          const list = grouped.get(col.key) ?? [];
          return (
            <div key={col.key} className="snap-start md:snap-align-none min-w-0">
              <Column column={col} count={list.length}>
                {list.length === 0 ? (
                  <EmptyColumn text={col.emptyText} />
                ) : (
                  list.map((it) => (
                    <DraggableCard
                      key={it.id}
                      id={it.id}
                      isDragging={activeId === it.id}
                      onClick={onCardClick ? () => onCardClick(it) : undefined}
                    >
                      {renderCard(it, { dragging: false })}
                    </DraggableCard>
                  ))
                )}
              </Column>
            </div>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? renderCard(activeItem, { dragging: true }) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column<S extends string>({
  column,
  count,
  children,
}: {
  column: KanbanColumn<S>;
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.key });
  const Icon = column.icon;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border bg-muted/20 transition-colors min-w-0",
        isOver && "bg-primary/5 ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="size-7 rounded-md flex items-center justify-center shrink-0"
            style={{ backgroundColor: column.color + "1a", color: column.color }}
          >
            <Icon size={14} />
          </span>
          <h3 className="font-semibold text-sm truncate">{column.label}</h3>
        </div>
        <Badge variant="secondary" className="font-mono shrink-0">
          {count}
        </Badge>
      </div>
      <div className="p-2 space-y-2 flex-1 min-h-[120px]">{children}</div>
    </div>
  );
}

function EmptyColumn({ text }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50 italic border border-dashed border-border/40 rounded-lg">
      {text ?? "Soltá items aquí"}
    </div>
  );
}

function DraggableCard({
  id,
  isDragging,
  onClick,
  children,
}: {
  id: string;
  isDragging: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (!onClick) return;
        // Skip if it was a drag (detail === 0 means programmatic)
        if (e.detail === 0) return;
        onClick();
      }}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-30")}
    >
      {children}
    </div>
  );
}

// ─── Hook helper ───────────────────────────────────────────────────────────
// La firma incluye id+status para que cambios de estado externos (p.ej. desde
// el detail dialog) se reflejen en la grilla aunque la lista tenga el mismo largo.
function useStableSync<T extends { id: string }, S extends string>(
  externalItems: T[],
  getStatus: (item: T) => S,
  setItems: React.Dispatch<React.SetStateAction<T[]>>
) {
  const stamp = useRef<string>("");
  useEffect(() => {
    const sig = externalItems.map((x) => `${x.id}:${getStatus(x)}`).join("|");
    if (sig !== stamp.current) {
      stamp.current = sig;
      setItems(externalItems);
    }
  }, [externalItems, getStatus, setItems]);
}
