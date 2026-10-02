"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SERVICE_KIND_META } from "@/lib/rentals/labels";
import type { RentalServiceKind } from "@/lib/types/database";
import { SERVICE_PROVIDER_HINT } from "./property-helpers";
import { newKey } from "./owner-rows";
import type { ServiceRowState } from "./property-form";
import { ServiceIcon, SERVICE_TINT } from "./service-icon";

const KIND_ORDER: RentalServiceKind[] = ["luz", "gas", "agua", "municipal", "inmobiliario", "expensas", "internet", "seguro", "otro"];

/**
 * Cuentas de servicios e impuestos de la propiedad (EPEC, Ecogas, Aguas
 * Cordobesas, Municipalidad, Rentas…). Un toque agrega el servicio con la
 * empresa habitual de Córdoba ya cargada; queda el número de cuenta.
 */
export function ServicesEditor({ rows, onChange }: { rows: ServiceRowState[]; onChange: (rows: ServiceRowState[]) => void }) {
  const used = new Set(rows.map((r) => r.kind));
  const update = (key: string, patch: Partial<ServiceRowState>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function add(kind: RentalServiceKind) {
    onChange([...rows, { key: newKey(), kind, provider: SERVICE_PROVIDER_HINT[kind], account_number: null, holder: null, notes: null }]);
    // El foco va al número de cuenta, que es lo único que falta.
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-service-account]");
      inputs[inputs.length - 1]?.focus();
    });
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground leading-snug">
          Guardá los números de cuenta para tenerlos a mano al pedir un comprobante o reclamar una factura.
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border bg-card p-2.5 sm:p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("size-7 rounded-md flex items-center justify-center shrink-0", SERVICE_TINT[r.kind])}>
                <ServiceIcon kind={r.kind} size={14} />
              </span>
              <span className="text-sm font-medium flex-1 min-w-0 truncate">{SERVICE_KIND_META[r.kind].label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-rose-600"
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                aria-label={`Quitar ${SERVICE_KIND_META[r.kind].label}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                value={r.provider ?? ""}
                onChange={(e) => update(r.key, { provider: e.target.value })}
                placeholder={r.kind === "expensas" ? "Administración" : "Empresa"}
                aria-label="Empresa"
                className="h-9"
              />
              <Input
                data-service-account
                value={r.account_number ?? ""}
                onChange={(e) => update(r.key, { account_number: e.target.value })}
                placeholder={r.kind === "inmobiliario" || r.kind === "municipal" ? "N° de cuenta / cuenta de Rentas" : "N° de cuenta o cliente"}
                aria-label="Número de cuenta"
                className="h-9 font-mono"
              />
              <Input
                value={r.holder ?? ""}
                onChange={(e) => update(r.key, { holder: e.target.value })}
                placeholder="Titular de la factura"
                aria-label="Titular"
                className="h-9"
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        {KIND_ORDER.filter((k) => k === "otro" || !used.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="inline-flex items-center gap-1.5 h-9 rounded-full border border-dashed px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-solid hover:bg-accent/40 transition-colors"
          >
            <Plus size={12} />
            {SERVICE_KIND_META[k].label}
            {SERVICE_PROVIDER_HINT[k] && <span className="text-muted-foreground/70">· {SERVICE_PROVIDER_HINT[k]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
