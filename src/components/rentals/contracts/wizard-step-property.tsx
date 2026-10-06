"use client";

import { useMemo, useRef, useState } from "react";
import { Building2, Check, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PropertyFormDialog } from "@/components/rentals/properties/property-form-dialog";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { CONTRACT_STATE_META, PROPERTY_TYPE_LABEL, formatContractNumber, propertyAddress } from "@/lib/rentals/labels";
import { Callout, StepIntro } from "./wizard-fields";
import type { StepProps } from "./wizard-step-props";

/** Paso 1: la propiedad (buscar o crear) y sus dueños con el porcentaje. */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function StepProperty({ state, set, errors, properties, addProperty, contractId }: StepProps) {
  const [q, setQ] = useState("");
  // La que se acaba de cargar va primera: si no, queda al final de la lista, fuera de la vista.
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = properties.find((p) => p.id === state.property_id) ?? null;
  const list = useMemo(() => {
    const needle = norm(q.trim());
    const all = needle
      ? properties.filter((p) => norm([p.address, p.code, p.city, ...p.owners.map((o) => o.name)].join(" ")).includes(needle))
      : properties;
    const first = justCreated ? all.find((p) => p.id === justCreated) : undefined;
    const shown = first ? [first, ...all.filter((p) => p.id !== first.id)].slice(0, 60) : all.slice(0, 60);
    // La elegida siempre se ve, aunque quede fuera de las 60 o de lo buscado.
    return selected && !shown.some((p) => p.id === selected.id) ? [selected, ...shown.slice(0, 59)] : shown;
  }, [q, properties, justCreated, selected]);

  return (
    <div className="space-y-5">
      <StepIntro title="¿Qué propiedad se alquila?">Buscala por dirección, código o dueño. Si no está, la cargás acá mismo.</StepIntro>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Dean Funes 450, CBA-012, García…"
            className="pl-9 h-10"
            aria-label="Buscar propiedad"
            aria-invalid={Boolean(errors.property_id) || undefined}
            data-wizard-field={properties.length > 0 ? "property_id" : undefined}
          />
        </div>
        <PropertyFormDialog
          onSaved={(p, owners) => {
            addProperty({
              id: p.id,
              code: p.code,
              address: propertyAddress(p),
              city: p.city,
              propertyType: p.property_type,
              // Los dueños con los que se guardó: sin esto el aviso decía "no tiene propietario cargado".
              owners: owners.map((o) => ({ ownerId: o.owner_id, name: o.full_name, pct: o.ownership_pct, isPrimary: o.is_primary })),
              busyWith: null,
              listingRent: p.listing_rent != null ? Number(p.listing_rent) : null,
              listingCurrency: p.listing_currency,
            });
            set({ property_id: p.id });
            setQ("");
            setJustCreated(p.id);
            requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }));
          }}
        >
          {/* Sin propiedades cargadas es el único camino: va como acción principal. */}
          <Button
            type="button"
            variant={properties.length === 0 ? "default" : "outline"}
            className="gap-2 h-10"
            data-wizard-field={properties.length === 0 ? "property_id" : undefined}
          >
            <Plus size={15} /> Nueva propiedad
          </Button>
        </PropertyFormDialog>
      </div>
      {errors.property_id && (
        <p className="text-[12px] text-rose-600 dark:text-rose-400" role="alert">
          {errors.property_id}
        </p>
      )}

      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center">
          <Building2 className="size-9 mx-auto text-muted-foreground/50" />
          <p className="text-sm font-medium mt-2">Todavía no hay propiedades cargadas</p>
          <p className="text-xs text-muted-foreground mt-1">Tocá «Nueva propiedad»: con la dirección y el dueño alcanza.</p>
        </div>
      ) : (
        <div ref={listRef} role="radiogroup" aria-label="Propiedades" className="grid gap-2 max-h-[26rem] overflow-y-auto pr-1 -mr-1">
          {list.map((p) => {
            const active = p.id === state.property_id;
            const busy = p.busyWith && p.busyWith.contractId !== contractId ? p.busyWith : null;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ property_id: p.id })}
                className={cn(
                  "w-full text-left rounded-xl border px-3.5 py-3 transition-colors flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active ? "shadow-sm" : "hover:bg-accent/30",
                )}
                style={active ? { borderColor: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}0f` } : undefined}
              >
                <span
                  className={cn("size-9 rounded-lg flex items-center justify-center shrink-0", !active && "bg-muted text-muted-foreground")}
                  style={active ? { backgroundColor: RENTALS_ACCENT, color: "white" } : undefined}
                >
                  {active ? <Check size={16} /> : <Building2 size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{p.address}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    <span className="font-mono">{p.code}</span> · {PROPERTY_TYPE_LABEL[p.propertyType]}
                    {p.city ? ` · ${p.city}` : ""}
                    {p.listingRent ? ` · pretendido ${formatMoney(p.listingRent, p.listingCurrency || "ARS")}` : ""}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                    <Users size={11} className="shrink-0" />
                    {p.owners.length ? p.owners.map((o) => `${o.name} (${o.pct.toLocaleString("es-AR")} %)`).join(", ") : "Sin propietario cargado"}
                  </span>
                  {busy && (
                    <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">
                      {CONTRACT_STATE_META[busy.status].label}: {formatContractNumber(busy.number)}
                      {busy.status === "vigente" ? ` hasta el ${formatDate(busy.endDate)}` : ""}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {list.length === 0 && <p className="text-sm text-muted-foreground px-1 py-4">Ninguna propiedad coincide con «{q}».</p>}
        </div>
      )}

      {selected && <SelectedOwners selected={selected} />}
    </div>
  );
}

function SelectedOwners({ selected }: { selected: StepProps["properties"][number] }) {
  const pct = selected.owners.reduce((s, o) => s + o.pct, 0);
  if (!selected.owners.length) {
    return (
      <Callout tone="warn">
        La propiedad no tiene propietario cargado. Podés guardar el borrador, pero para activar el contrato hace falta: agregalo desde la ficha de la propiedad.
      </Callout>
    );
  }
  if (Math.abs(pct - 100) > 0.01) {
    return <Callout tone="warn">Los porcentajes de los propietarios suman {pct.toLocaleString("es-AR")} %: tienen que sumar 100 % para poder activar.</Callout>;
  }
  return (
    <Callout tone="ok">
      Se le rinde a {selected.owners.length === 1 ? selected.owners[0].name : `${selected.owners.length} propietarios`} lo que se cobre, menos los honorarios de administración.
    </Callout>
  );
}
