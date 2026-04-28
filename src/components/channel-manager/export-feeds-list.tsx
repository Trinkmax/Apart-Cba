"use client";

import { useState, useTransition } from "react";
import { Copy, Check, RefreshCw, Loader2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rotateExportToken, type UnitExportRow } from "@/lib/actions/ical";

export function ExportFeedsList({ units }: { units: UnitExportRow[] }) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function copy(unit: UnitExportRow) {
    navigator.clipboard.writeText(unit.export_url);
    setCopiedId(unit.id);
    toast.success("URL copiada", { description: "Pegala en Airbnb/Booking → Import calendar" });
    setTimeout(() => setCopiedId(null), 2000);
  }

  function rotate(unit: UnitExportRow) {
    if (!confirm(`¿Rotar el token de "${unit.code}"? Las URLs ya pegadas en Airbnb/Booking dejarán de funcionar.`)) return;
    setPendingId(unit.id);
    startTransition(async () => {
      try {
        await rotateExportToken(unit.id);
        toast.success("Token rotado", { description: "Volvé a copiar la URL y actualizala en cada plataforma" });
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      } finally {
        setPendingId(null);
      }
    });
  }

  if (units.length === 0) {
    return (
      <Card className="p-8 text-center border-dashed text-sm text-muted-foreground">
        Creá unidades primero para exponer sus calendarios.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {units.map((u) => (
          <div key={u.id} className="grid grid-cols-12 items-center gap-3 p-4">
            <div className="col-span-3 min-w-0">
              <div className="flex items-center gap-2">
                <LinkIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs">{u.code}</span>
              </div>
              <div className="text-sm font-medium truncate">{u.name}</div>
            </div>
            <div className="col-span-7">
              <Input
                readOnly
                value={u.export_url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-[11px] h-9"
              />
            </div>
            <div className="col-span-2 flex items-center gap-1 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => copy(u)}
                className="gap-1.5"
              >
                {copiedId === u.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                Copiar
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => rotate(u)}
                disabled={pendingId === u.id}
                title="Rotar token (invalida URLs viejas)"
                className="size-8 text-muted-foreground"
              >
                {pendingId === u.id ? <Loader2 className="animate-spin size-3" /> : <RefreshCw size={14} />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
