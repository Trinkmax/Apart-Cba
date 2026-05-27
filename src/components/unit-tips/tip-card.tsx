"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { MoreVertical, Pin, PinOff, Pencil, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UNIT_TIP_CATEGORY_META,
  UNIT_TIP_REACTION_META,
  UNIT_TIP_REACTION_TYPES,
} from "@/lib/constants";
import {
  deleteUnitTip,
  reactToTip,
  togglePinTip,
  unreactToTip,
  type EnrichedUnitTip,
} from "@/lib/actions/unit-tips";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isAdminLevel } from "@/lib/permissions";
import type { UserRole, UnitTipReactionType } from "@/lib/types/database";
import { TipPhotoLightbox } from "./tip-photo-lightbox";

interface Props {
  tip: EnrichedUnitTip;
  currentUserId: string;
  currentUserRole: UserRole;
  /** Si false: oculta el chip de unidad (cuando ya estás en la vista de esa unidad). */
  showUnit?: boolean;
  onChanged?: () => void;
}

function getInitials(name: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TipCard({
  tip,
  currentUserId,
  currentUserRole,
  showUnit = true,
  onChanged,
}: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Optimistic state local para reacciones — al server se le pide en el background.
  const [reactions, setReactions] = useState(tip.reactions);
  const [myReactions, setMyReactions] = useState<UnitTipReactionType[]>(tip.my_reactions);
  const [isPinned, setIsPinned] = useState(!!tip.pinned_at);

  const categoryMeta = UNIT_TIP_CATEGORY_META[tip.category];
  const isOwner = tip.author_id === currentUserId;
  const isAdmin = isAdminLevel(currentUserRole);
  const canEdit = isOwner || isAdmin;

  function toggleReaction(type: UnitTipReactionType) {
    const had = myReactions.includes(type);
    // Optimistic
    if (had) {
      setMyReactions((cur) => cur.filter((r) => r !== type));
      setReactions((cur) => ({ ...cur, [type]: Math.max(0, cur[type] - 1) }));
    } else {
      setMyReactions((cur) => [...cur, type]);
      setReactions((cur) => ({ ...cur, [type]: cur[type] + 1 }));
    }
    startTransition(async () => {
      try {
        if (had) {
          await unreactToTip(tip.id, type);
        } else {
          await reactToTip(tip.id, type);
        }
      } catch (e) {
        // Rollback en error
        if (had) {
          setMyReactions((cur) => [...cur, type]);
          setReactions((cur) => ({ ...cur, [type]: cur[type] + 1 }));
        } else {
          setMyReactions((cur) => cur.filter((r) => r !== type));
          setReactions((cur) => ({ ...cur, [type]: Math.max(0, cur[type] - 1) }));
        }
        toast.error("No se pudo reaccionar", { description: (e as Error).message });
      }
    });
  }

  function handlePin() {
    const next = !isPinned;
    setIsPinned(next);
    startTransition(async () => {
      try {
        await togglePinTip(tip.id);
        onChanged?.();
      } catch (e) {
        setIsPinned(!next);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDelete() {
    if (!confirm("¿Eliminar este consejo? No se puede deshacer.")) return;
    startTransition(async () => {
      try {
        await deleteUnitTip(tip.id);
        toast.success("Consejo eliminado");
        onChanged?.();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  const authorName = tip.author?.full_name?.trim() || "Alguien del equipo";
  const isImportant = tip.category === "importante";

  return (
    <article
      className={cn(
        "group relative bg-card border rounded-2xl overflow-hidden transition-all",
        isPinned && "ring-1 ring-amber-500/40 shadow-sm",
        isImportant && !isPinned && "ring-1 ring-rose-500/20"
      )}
    >
      {/* Strip de color de la categoría */}
      <div className="h-1 w-full" style={{ backgroundColor: categoryMeta.color }} aria-hidden />

      {/* Pin badge arriba */}
      {isPinned && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-semibold ring-1 ring-amber-500/30">
          <Pin size={10} className="fill-current" />
          Destacado
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Header: avatar + nombre + chips */}
        <div className="flex items-start gap-3">
          <Avatar className="size-9 shrink-0 ring-1 ring-border">
            {tip.author?.avatar_url && (
              <AvatarImage src={tip.author.avatar_url} alt={authorName} />
            )}
            <AvatarFallback className="text-xs bg-muted">
              {getInitials(tip.author?.full_name ?? null)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm leading-tight truncate">{authorName}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                · {formatTimeAgo(tip.created_at)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge
                variant="outline"
                className="text-[10px] font-medium gap-1 px-1.5 py-0 h-5"
                style={{
                  borderColor: categoryMeta.color + "50",
                  color: categoryMeta.color,
                  backgroundColor: categoryMeta.color + "10",
                }}
              >
                <span>{categoryMeta.emoji}</span>
                {categoryMeta.label}
              </Badge>
              {showUnit && tip.unit && (
                <Link
                  href={`/m/consejos/${tip.unit.id}`}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Building2 size={10} />
                  <span className="font-mono">{tip.unit.code}</span>
                </Link>
              )}
            </div>
          </div>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 opacity-60 hover:opacity-100"
                  aria-label="Acciones"
                >
                  <MoreVertical size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isAdmin && (
                  <DropdownMenuItem onClick={handlePin}>
                    {isPinned ? (
                      <>
                        <PinOff size={14} className="mr-2" /> Quitar destacado
                      </>
                    ) : (
                      <>
                        <Pin size={14} className="mr-2" /> Destacar
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {isOwner && (
                  <DropdownMenuItem disabled>
                    <Pencil size={14} className="mr-2" /> Editar
                    <span className="ml-auto text-[9px] text-muted-foreground">próximamente</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 size={14} className="mr-2" /> Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Contenido */}
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
          {tip.content}
        </div>

        {/* Foto */}
        {tip.photo_url && (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full relative rounded-lg overflow-hidden border bg-muted/40 transition-transform active:scale-[0.99]"
            aria-label="Ver foto en grande"
          >
            <div className="relative w-full aspect-[4/3] max-h-72">
              <Image
                src={tip.photo_url}
                alt={`Foto del consejo de ${authorName}`}
                fill
                sizes="(max-width: 640px) 100vw, 600px"
                unoptimized
                loading="lazy"
                className="object-cover"
              />
            </div>
          </button>
        )}

        {/* Reacciones */}
        <div className="flex items-center gap-1.5 pt-1">
          {UNIT_TIP_REACTION_TYPES.map((rt) => {
            const meta = UNIT_TIP_REACTION_META[rt];
            const active = myReactions.includes(rt);
            const count = reactions[rt];
            return (
              <button
                key={rt}
                type="button"
                onClick={() => toggleReaction(rt)}
                aria-label={meta.label}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium transition-all",
                  "active:scale-95",
                  active
                    ? "border-transparent shadow-sm"
                    : "border-input bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                style={
                  active
                    ? {
                        backgroundColor: meta.color + "1a",
                        color: meta.color,
                        boxShadow: `inset 0 0 0 1px ${meta.color}40`,
                      }
                    : undefined
                }
              >
                <span className="text-sm leading-none">{meta.emoji}</span>
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {tip.photo_url && (
        <TipPhotoLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          url={tip.photo_url}
          alt={`Foto del consejo de ${authorName}`}
        />
      )}
    </article>
  );
}
