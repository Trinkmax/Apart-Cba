"use client";

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import {
  GripVertical,
  Bed,
  Bath,
  Users,
  CalendarRange,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { UNIT_STATUS_META, TICKET_PRIORITY_META } from "@/lib/constants";
import { formatDate, formatNights, getInitials } from "@/lib/format";
import type { UnitWithRelations } from "@/lib/types/database";

interface UnitCardProps {
  unit: UnitWithRelations;
  isOverlay?: boolean;
}

export function UnitCard({ unit, isOverlay }: UnitCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: unit.id, data: { type: "unit", unit } });

  const meta = UNIT_STATUS_META[unit.status];
  const ticket = unit.open_ticket;
  const ticketMeta = ticket ? TICKET_PRIORITY_META[ticket.priority] : null;
  const next = unit.next_booking;
  const nights = next ? formatNights(next.check_in_date, next.check_out_date) : 0;

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative bg-card rounded-xl border border-border shadow-sm overflow-hidden",
        "hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5",
        "transition-all duration-200 ease-out",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "shadow-2xl ring-2 ring-primary/40 rotate-2 scale-105"
      )}
    >
      {/* Top stripe color por estado */}
      <div className="h-1" style={{ backgroundColor: meta.color }} />

      <div className="p-3">
        {/* Header: drag handle + code + ticket warning */}
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors mt-0.5 -ml-1"
            {...attributes}
            {...listeners}
            aria-label="Arrastrar"
          >
            <GripVertical size={14} />
          </button>

          <Link
            href={`/dashboard/unidades/${unit.id}`}
            className="flex-1 min-w-0 group/link"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight group-hover/link:text-primary transition-colors">
                {unit.code}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{unit.name}</div>
          </Link>

          {ticket && ticketMeta && (
            <div
              className="size-5 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: ticketMeta.color + "20", color: ticketMeta.color }}
              title={`Ticket ${ticketMeta.label}: ${ticket.title}`}
            >
              <AlertTriangle size={11} />
            </div>
          )}
        </div>

        {/* Specs row */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/80">
          {unit.bedrooms !== null && unit.bedrooms !== undefined && (
            <span className="flex items-center gap-0.5"><Bed size={10} /> {unit.bedrooms}</span>
          )}
          {unit.bathrooms !== null && unit.bathrooms !== undefined && (
            <span className="flex items-center gap-0.5"><Bath size={10} /> {unit.bathrooms}</span>
          )}
          {unit.max_guests && (
            <span className="flex items-center gap-0.5"><Users size={10} /> {unit.max_guests}</span>
          )}
          {unit.neighborhood && (
            <span className="flex items-center gap-0.5 truncate">· {unit.neighborhood}</span>
          )}
        </div>

        {/* Owner principal */}
        {unit.primary_owner && (
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
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

        {/* Próxima reserva */}
        {next && (
          <div
            className="mt-2 p-2 rounded-md bg-amber-500/8 border border-amber-500/20 flex items-start gap-1.5"
          >
            <CalendarRange size={12} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-amber-900 dark:text-amber-200 leading-tight">
                Check-in {formatDate(next.check_in_date, "d 'de' MMM")}
              </div>
              <div className="text-[10px] text-amber-700/80 dark:text-amber-300/70 truncate">
                {next.guest?.full_name ?? "Sin huésped"} · {nights}n · {next.guests_count}p
              </div>
            </div>
          </div>
        )}

        {/* Ticket abierto */}
        {ticket && ticketMeta && (
          <div
            className="mt-2 p-2 rounded-md flex items-start gap-1.5"
            style={{ backgroundColor: ticketMeta.color + "10", border: `1px solid ${ticketMeta.color}30` }}
          >
            <AlertTriangle size={11} className="mt-0.5 shrink-0" style={{ color: ticketMeta.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-tight truncate" style={{ color: ticketMeta.color }}>
                {ticket.title}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {ticketMeta.label}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
