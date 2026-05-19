"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { unlinkUnitFromOwner } from "@/lib/actions/owners";
import { UNIT_STATUS_META } from "@/lib/constants";
import type { Unit, UnitOwner, UnitStatus } from "@/lib/types/database";

type UnitOwnerRow = UnitOwner & {
  unit: Pick<Unit, "id" | "code" | "name" | "status">;
};

interface OwnerUnitsListProps {
  ownerId: string;
  unitOwners: UnitOwnerRow[];
}

export function OwnerUnitsList({ ownerId, unitOwners }: OwnerUnitsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRemove(unitOwnerId: string) {
    if (!confirm("¿Quitar esta unidad del propietario?")) return;
    startTransition(async () => {
      try {
        await unlinkUnitFromOwner(unitOwnerId, ownerId);
        toast.success("Unidad quitada");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  if (unitOwners.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Este propietario no tiene unidades asignadas
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unitOwners.map((uo) => {
        const meta = UNIT_STATUS_META[uo.unit.status as UnitStatus];
        return (
          <div
            key={uo.unit.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors"
          >
            <Link
              href={`/dashboard/unidades/${uo.unit.id}`}
              className="flex items-center gap-3 min-w-0 flex-1"
            >
              <span
                className="status-dot"
                style={{ backgroundColor: meta.color }}
              />
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {uo.unit.code} · {uo.unit.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {meta.label}
                </div>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {Number(uo.ownership_pct).toFixed(0)}%
              </Badge>
              {uo.is_primary && (
                <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
                  Principal
                </Badge>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(uo.id)}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
