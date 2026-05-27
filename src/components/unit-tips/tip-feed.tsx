"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { Lightbulb, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRealtimeRows } from "@/hooks/use-realtime-rows";
import { listUnitTips, type EnrichedUnitTip } from "@/lib/actions/unit-tips";
import { TipCard } from "./tip-card";
import type {
  UnitTip,
  UnitTipCategory,
  UserRole,
} from "@/lib/types/database";

interface Props {
  initialTips: EnrichedUnitTip[];
  organizationId: string;
  currentUserId: string;
  currentUserRole: UserRole;
  unitId?: string;
  category?: UnitTipCategory;
  showUnit?: boolean;
  /** Mensaje custom para el empty state (p.ej. "Sé la primera…"). */
  emptyMessage?: string;
}

export function TipFeed({
  initialTips,
  organizationId,
  currentUserId,
  currentUserRole,
  unitId,
  category,
  showUnit = true,
  emptyMessage = "Todavía no hay consejos. ¡Sé el primero en compartir uno!",
}: Props) {
  const [tips, setTips] = useState<EnrichedUnitTip[]>(initialTips);
  const [isReloading, setIsReloading] = useState(false);
  const [, startTransition] = useTransition();
  // Guard contra refetch en paralelo cuando varios eventos realtime llegan juntos.
  // Es un ref porque su valor no afecta el render (solo coordina handlers).
  const reloadInFlight = useRef(false);

  const reload = useCallback(() => {
    if (reloadInFlight.current) return;
    reloadInFlight.current = true;
    setIsReloading(true);
    startTransition(async () => {
      try {
        const fresh = await listUnitTips({ unitId, category });
        setTips(fresh);
      } finally {
        reloadInFlight.current = false;
        setIsReloading(false);
      }
    });
  }, [unitId, category]);

  // Realtime sobre unit_tips: al detectar INSERT/UPDATE/DELETE en la org, hacemos
  // un refetch breve. La feed es chica (<= 100 items) así que un refetch es más
  // simple y robusto que mantener el cache local sincronizado con joins enriquecidos.
  useRealtimeRows<UnitTip>({
    table: "unit_tips",
    organizationId,
    onInsert: (row) => {
      if (unitId && row.unit_id !== unitId) return;
      if (category && row.category !== category) return;
      reload();
    },
    onUpdate: (row) => {
      if (unitId && row.unit_id !== unitId) return;
      reload();
    },
    onDelete: () => {
      // No tenemos el row pre-delete con confianza (incluso con REPLICA IDENTITY
      // FULL el filter solo conserva PK + columnas del filter). Refetch.
      reload();
    },
  });

  // También escuchamos reacciones: si alguien (otro device) reacciona, los counts cambian.
  useRealtimeRows<{ id: string; organization_id: string; tip_id: string }>({
    table: "unit_tip_reactions",
    organizationId,
    onInsert: () => reload(),
    onDelete: () => reload(),
  });

  if (tips.length === 0) {
    return (
      <Card className="p-10 text-center border-dashed bg-gradient-to-b from-yellow-50/50 to-transparent dark:from-yellow-950/10">
        <div className="mx-auto size-14 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 flex items-center justify-center mb-3">
          <Lightbulb size={24} />
        </div>
        <p className="text-sm font-medium text-foreground">{emptyMessage}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Tu experiencia ayuda al resto del equipo.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {tips.map((tip) => (
        <TipCard
          key={tip.id}
          tip={tip}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          showUnit={showUnit}
          onChanged={reload}
        />
      ))}
      {isReloading && (
        <div className="text-xs text-center text-muted-foreground py-2 flex items-center justify-center gap-1.5">
          <RefreshCw size={10} className="animate-spin" />
          Actualizando…
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={reload}
        className="w-full text-xs text-muted-foreground gap-1.5"
      >
        <RefreshCw size={11} />
        Actualizar
      </Button>
    </div>
  );
}
