"use client";

import { ListChecks } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PickableCharge {
  id: string;
  label: string;
  dueDate: string;
  outstanding: number;
}

/**
 * "¿Qué paga?": por defecto lo más viejo primero; si el inquilino elige qué
 * paga (art. 900 CCyC), el cobro va primero a esos cargos y en ese orden.
 */
export function ChargePicker({
  charges,
  selected,
  onChange,
  choosing,
  onChoosingChange,
  paidAt,
  currency,
}: {
  charges: PickableCharge[];
  selected: string[];
  onChange: (ids: string[]) => void;
  choosing: boolean;
  onChoosingChange: (v: boolean) => void;
  paidAt: string;
  currency: string;
}) {
  if (charges.length < 2 && !choosing) {
    return null;
  }
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <ListChecks size={13} /> ¿Qué paga?
        </span>
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5" role="radiogroup" aria-label="Qué paga">
          {[
            { v: false, label: "Lo más viejo" },
            { v: true, label: "Elegir" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={choosing === o.v}
              onClick={() => {
                onChoosingChange(o.v);
                if (!o.v) onChange([]);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors min-h-7",
                choosing === o.v ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {choosing ? (
        <ul className="rounded-lg border divide-y bg-card">
          {charges.map((c) => {
            const order = selected.indexOf(c.id);
            const overdue = c.dueDate < paidAt;
            return (
              <li key={c.id}>
                <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors">
                  <Checkbox checked={order >= 0} onCheckedChange={() => toggle(c.id)} aria-label={`Paga ${c.label}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{c.label}</span>
                    <span className={cn("block text-[11px]", overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                      {overdue ? "Venció" : "Vence"} el {formatDate(c.dueDate)}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums whitespace-nowrap">{formatMoney(c.outstanding, currency)}</span>
                  <span
                    className={cn(
                      "size-5 shrink-0 rounded-full text-[10px] font-semibold flex items-center justify-center tabular-nums",
                      order >= 0 ? "bg-emerald-600 text-white" : "bg-transparent",
                    )}
                    aria-hidden
                  >
                    {order >= 0 ? order + 1 : ""}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Se cubre primero lo que venció antes y, dentro de cada mes, los intereses antes que el alquiler.
        </p>
      )}
      {choosing && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Marcá en orden lo que el inquilino dice que paga (art. 900 del Código Civil y Comercial). Si sobra, sigue por lo más viejo.
        </p>
      )}
    </div>
  );
}
