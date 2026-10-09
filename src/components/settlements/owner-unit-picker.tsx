"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Home, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { foldSearch } from "@/lib/cash/search";
import { cn } from "@/lib/utils";

type PickerUnit = { id: string; code: string; name: string };

export type PickerOwner = {
  id: string;
  full_name: string;
  active?: boolean | null;
  unit_owners?: { unit?: PickerUnit | null }[] | null;
};

export type OwnerUnitSelection = { ownerId: string; unitId: string | null };

/** Todos los tokens tienen que aparecer, sin importar tildes ni mayúsculas. */
function matches(haystack: string, search: string): number {
  const tokens = foldSearch(search).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const hay = foldSearch(haystack);
  return tokens.every((t) => hay.includes(t)) ? 1 : 0;
}

function unitsOf(owner: PickerOwner): PickerUnit[] {
  return (owner.unit_owners ?? []).flatMap((uo) => (uo.unit ? [uo.unit] : []));
}

/**
 * "¿De quién es la liquidación?": se busca por propietario o por unidad
 * ("alcorta" encuentra ALCORTA2 y te dice de quién es). Elegir una unidad
 * elige a su propietario — la liquidación siempre es del propietario.
 */
export function OwnerUnitPicker({
  owners,
  value,
  onChange,
}: {
  owners: PickerOwner[];
  value: OwnerUnitSelection | null;
  onChange: (next: OwnerUnitSelection) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedOwner = value ? owners.find((o) => o.id === value.ownerId) ?? null : null;
  const selectedUnit =
    selectedOwner && value?.unitId
      ? unitsOf(selectedOwner).find((u) => u.id === value.unitId) ?? null
      : null;

  // Una fila por (unidad, propietario): una unidad compartida aparece una vez
  // por cada dueño, cada una con su nombre.
  const unitRows = owners
    .flatMap((o) => unitsOf(o).map((u) => ({ unit: u, owner: o })))
    .sort((a, b) => a.unit.code.localeCompare(b.unit.code, "es"));

  function pick(next: OwnerUnitSelection) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Propietario o unidad"
          className={cn(
            "h-auto min-h-10 w-full justify-between px-3 py-2 font-normal",
            !selectedOwner && "text-muted-foreground",
          )}
        >
          {selectedOwner ? (
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="truncate font-medium text-foreground">
                {selectedOwner.full_name.trim()}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {selectedUnit
                  ? `${selectedUnit.code} · ${selectedUnit.name.trim()}`
                  : unitsOf(selectedOwner)
                      .map((u) => u.code)
                      .join(", ") || "Sin unidades asignadas"}
              </span>
            </span>
          ) : (
            <span className="truncate">Buscar propietario o unidad…</span>
          )}
          <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) min-w-[300px] p-0"
      >
        {/* Se busca SÓLO en las keywords: el value lleva ids (únicos para cmdk)
            y sus letras hex matchearían cualquier búsqueda corta. */}
        <Command filter={(_value, search, keywords) => matches((keywords ?? []).join(" "), search)}>
          <CommandInput placeholder="Nombre, código o unidad…" aria-label="Buscar propietario o unidad" />
          <CommandList className="max-h-80">
            <CommandEmpty>Nada con ese nombre.</CommandEmpty>
            <CommandGroup heading="Unidades">
              {unitRows.map(({ unit, owner }) => {
                const isSelected = value?.ownerId === owner.id && value?.unitId === unit.id;
                return (
                  <CommandItem
                    key={`${unit.id}:${owner.id}`}
                    value={`unidad ${unit.id} ${owner.id}`}
                    keywords={[unit.code, unit.name]}
                    onSelect={() => pick({ ownerId: owner.id, unitId: unit.id })}
                    className="gap-2"
                  >
                    <Home size={14} className="shrink-0 opacity-60" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono text-xs">{unit.code}</span>
                        <span className="truncate text-xs text-muted-foreground">{unit.name.trim()}</span>
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        de {owner.full_name.trim()}
                      </span>
                    </span>
                    <Check size={14} className={cn("shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandGroup heading="Propietarios">
              {owners.map((o) => {
                const units = unitsOf(o);
                const isSelected = value?.ownerId === o.id && !value?.unitId;
                return (
                  <CommandItem
                    key={o.id}
                    value={`propietario ${o.id}`}
                    keywords={[o.full_name]}
                    onSelect={() => pick({ ownerId: o.id, unitId: null })}
                    className="gap-2"
                  >
                    <UserRound size={14} className="shrink-0 opacity-60" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{o.full_name.trim()}</span>
                      <span
                        className={cn(
                          "truncate text-[11px]",
                          units.length === 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                        )}
                      >
                        {units.length === 0
                          ? "Sin unidades asignadas"
                          : units.map((u) => u.code).join(", ")}
                        {o.active === false && " · inactivo"}
                      </span>
                    </span>
                    <Check size={14} className={cn("shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
