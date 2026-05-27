"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Lightbulb, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listUnitTips, type EnrichedUnitTip } from "@/lib/actions/unit-tips";
import { TipCard } from "./tip-card";
import { TipComposerDrawer } from "./tip-composer-drawer";
import { cn } from "@/lib/utils";
import type { UnitRef, UserRole } from "@/lib/types/database";

interface Props {
  unit: UnitRef;
  currentUserId: string;
  currentUserRole: UserRole;
  /** Si true, arranca expandido (típicamente cuando la limpiadora ya tiene checklist avanzado). */
  defaultOpen?: boolean;
  /** Estilo: "inset" para embedding en task (más compacto), "card" standalone. */
  variant?: "inset" | "card";
}

export function UnitTipsInline({
  unit,
  currentUserId,
  currentUserRole,
  defaultOpen = false,
  variant = "inset",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [tips, setTips] = useState<EnrichedUnitTip[] | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [, startTransition] = useTransition();
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const data = await listUnitTips({ unitId: unit.id });
        setTips(data);
      } catch {
        setTips([]);
      }
    });
  }, [unit.id]);

  // Carga la primera vez que se abre (o si arranca abierto).
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [open, load]);

  const count = tips?.length ?? 0;
  const preview = tips ?? [];
  const top3 = preview.slice(0, 3);
  const hasMore = preview.length > 3;

  return (
    <>
      <div
        className={cn(
          variant === "card" && "border rounded-xl bg-card",
          variant === "inset" &&
            "border-t border-amber-500/20 bg-gradient-to-b from-amber-50/40 to-transparent dark:from-amber-950/10 rounded-lg",
          "overflow-hidden"
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-amber-500/5 transition-colors tap",
            variant === "card" && "px-4"
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="size-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Lightbulb size={14} />
            </span>
            <div className="text-left">
              <div className="text-xs font-semibold leading-tight">
                Consejos del depto
                {tips !== null && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400">({count})</span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {open ? "Pasale tu experiencia al equipo" : "Trucos y avisos que dejaron otras"}
              </div>
            </div>
          </div>
          {open ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
        </button>

        {open && (
          <div className="px-3 pb-3 pt-1 space-y-2 animate-fade-up">
            {tips === null ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 justify-center py-4">
                <Loader2 size={12} className="animate-spin" />
                Cargando…
              </div>
            ) : tips.length === 0 ? (
              <div className="text-center py-5 px-3">
                <p className="text-xs text-muted-foreground">
                  No hay consejos para este depto todavía.
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                  Sé la primera en compartir algo útil 💡
                </p>
              </div>
            ) : (
              <>
                {top3.map((t) => (
                  <TipCard
                    key={t.id}
                    tip={t}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                    showUnit={false}
                    onChanged={load}
                  />
                ))}
                {hasMore && (
                  <Link
                    href={`/m/consejos/${unit.id}`}
                    className="block text-center text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline py-2"
                  >
                    Ver todos los {count} consejos →
                  </Link>
                )}
              </>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setComposerOpen(true)}
              className="w-full gap-2 border-dashed border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 hover:text-amber-800 dark:hover:text-amber-300"
            >
              <Plus size={14} />
              Compartir un consejo
            </Button>
          </div>
        )}
      </div>

      <TipComposerDrawer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        lockedUnit={unit}
        onCreated={load}
      />
    </>
  );
}
