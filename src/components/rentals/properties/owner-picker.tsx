"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { foldText } from "@/components/rentals/people/person-helpers";
import type { OwnerOption } from "./property-types";

/**
 * Buscador de propietarios (tabla `owners` de la org) con "Crear «…»" al pie:
 * si no está, se crea sin salir del formulario.
 */
export function OwnerPicker({
  id,
  value,
  options,
  excludeIds,
  onChange,
  onCreate,
  invalid,
}: {
  id?: string;
  value: string;
  options: OwnerOption[] | null;
  excludeIds: string[];
  onChange: (ownerId: string) => void;
  onCreate: (name: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options?.find((o) => o.id === value) ?? null;
  const visible = (options ?? []).filter((o) => o.id === value || !excludeIds.includes(o.id));

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Propietario"
          aria-invalid={invalid || undefined}
          disabled={options === null}
          className={cn("w-full justify-between font-normal h-10 px-3 min-w-0", !selected && "text-muted-foreground", invalid && "border-rose-500/60")}
        >
          <span className="truncate">{options === null ? "Cargando propietarios…" : selected ? selected.full_name : "Buscá o creá el propietario"}</span>
          <ChevronsUpDown size={14} className="opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--radix-popover-trigger-width) min-w-[280px] p-0">
        <Command filter={(itemValue, term) => (foldText(itemValue).includes(foldText(term).trim()) ? 1 : 0)}>
          <CommandInput placeholder="Nombre, DNI o teléfono…" value={search} onValueChange={setSearch} aria-label="Buscar propietario" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-3 text-center text-sm text-muted-foreground">
              {search.trim() ? "No hay propietarios con ese nombre." : "Todavía no hay propietarios cargados."}
            </CommandEmpty>
            {visible.length > 0 && (
              <CommandGroup heading="Propietarios">
                {visible.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.full_name} ${o.document_number ?? ""} ${o.phone ?? ""} ${o.email ?? ""} ${o.id}`}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className="min-h-10"
                  >
                    <Check size={14} className={cn("mr-1", value === o.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.full_name}</span>
                      {(o.phone || o.email) && <span className="block truncate text-[11px] text-muted-foreground">{o.phone || o.email}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup forceMount>
              <CommandItem
                forceMount
                value="__crear_propietario__"
                onSelect={() => {
                  onCreate(search.trim());
                  setOpen(false);
                }}
                className="min-h-10 text-teal-700 dark:text-teal-300"
              >
                <UserPlus size={14} className="mr-1" />
                {search.trim() ? (
                  <span className="truncate">
                    Crear propietario «<strong className="font-semibold">{search.trim()}</strong>»
                  </span>
                ) : (
                  "Crear un propietario nuevo"
                )}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
