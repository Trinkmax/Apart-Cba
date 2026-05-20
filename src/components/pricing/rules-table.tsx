"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deletePricingRule } from "@/lib/actions/listings";
import { formatCurrency } from "@/lib/marketplace/pricing";
import type { UnitPricingRule } from "@/lib/types/database";

const DAY_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];

interface Props {
  rules: UnitPricingRule[];
  basePrice: number;
  currency: string;
  onChanged: () => void;
}

export function RulesTable({ rules, basePrice, currency, onChanged }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(ruleId: string) {
    if (!confirm("¿Eliminar esta regla de tarifa?")) return;
    startTransition(async () => {
      try {
        const r = await deletePricingRule(ruleId);
        if (!r.ok) {
          toast.error("Error", { description: r.error });
          return;
        }
        toast.success("Regla eliminada");
        onChanged();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  if (rules.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground border-dashed">
        Sin reglas de tarifa activas. Seleccioná un rango en el calendario para crear una.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Reglas activas</h3>
      </div>
      <div className="divide-y">
        {rules.map((r) => {
          const effectivePrice = r.price_override
            ? Number(r.price_override)
            : basePrice * Number(r.price_multiplier ?? 1);
          const delta = effectivePrice - basePrice;
          const pctChange = basePrice > 0 ? ((delta / basePrice) * 100).toFixed(0) : "0";

          return (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    P{r.priority}
                  </Badge>
                  {r.rule_type === "date_range" ? (
                    <span className="text-xs text-muted-foreground">
                      {r.start_date} → {r.end_date}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {(r.days_of_week ?? []).map((d) => DAY_LABELS[d]).join(", ")}
                    </span>
                  )}
                  {r.min_nights_override && (
                    <span className="text-xs text-muted-foreground">
                      Min {r.min_nights_override} noches
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-medium">{formatCurrency(effectivePrice, currency)}</div>
                  <div className={`text-[10px] ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                    {delta > 0 ? "+" : ""}{pctChange}%
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(r.id)}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="animate-spin size-3" /> : <Trash2 size={14} />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
