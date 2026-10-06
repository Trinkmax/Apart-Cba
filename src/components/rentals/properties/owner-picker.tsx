"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { OTHER_PERSON_HINT } from "@/lib/rentals/property-input";
import { foldText } from "@/components/rentals/people/person-helpers";
import type { OwnerOption } from "./property-types";
import { archivedOwnerMessage, findOwnerByName, ownerDetails } from "./owner-rows";

/**
 * Buscador de propietarios (tabla `owners` de la org) con "Crear «…»" al pie:
 * si no está, la fila pasa a "propietario nuevo" (se crea al guardar la propiedad).
 * Si el nombre buscado ya está cargado (o archivado), no se ofrece crearlo: no
 * se puede cargar dos veces el mismo nombre. Se dice cómo distinguir a otra persona.
 */
export function OwnerPicker({
  id,
  value,
  pendingName,
  options,
  archived,
  excludeIds,
  onChange,
  onCreate,
  invalid,
}: {
  id?: string;
  value: string;
  /** La fila es un propietario nuevo a crear: el botón muestra su nombre. */
  pendingName?: string | null;
  options: OwnerOption[] | null;
  /** Archivados: no se eligen, pero tampoco se puede crear otro con el mismo nombre. */
  archived?: OwnerOption[] | null;
  excludeIds: string[];
  onChange: (ownerId: string) => void;
  onCreate: (name: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options?.find((o) => o.id === value) ?? null;
  const visible = (options ?? []).filter((o) => o.id === value || !excludeIds.includes(o.id));
  const pending = pendingName != null;
  // Lo buscado ya está cargado con ese mismo nombre: crearlo de nuevo sólo podía fallar al guardar.
  const match = search.trim() ? findOwnerByName(options, search) : null;
  const matchElsewhere = Boolean(match && match.id !== value && excludeIds.includes(match.id));
  const matchDetails = match ? ownerDetails(match) : "";
  const archivedMatch = !match && search.trim() ? findOwnerByName(archived, search) : null;

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
          className={cn(
            "w-full justify-between font-normal h-10 px-3 min-w-0",
            !selected && !pending && "text-muted-foreground",
            pending && !selected && "border-teal-600/40 text-teal-800 dark:text-teal-200",
            invalid && "border-rose-500/60",
          )}
        >
          <span className="truncate">
            {options === null
              ? "Cargando propietarios…"
              : selected
                ? selected.full_name
                : pending
                  ? pendingName.trim()
                    ? `Nuevo: ${pendingName.trim()}`
                    : "Propietario nuevo"
                  : "Buscá o creá el propietario"}
          </span>
          <ChevronsUpDown size={14} className="opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--radix-popover-trigger-width) min-w-[280px] p-0">
        <Command filter={(itemValue, term) => (foldText(itemValue).includes(foldText(term).trim()) ? 1 : 0)}>
          <CommandInput placeholder="Nombre, DNI o teléfono…" value={search} onValueChange={setSearch} aria-label="Buscar propietario" />
          <CommandList className="max-h-72">
            {!match && !archivedMatch && (
              <CommandEmpty className="py-3 text-center text-sm text-muted-foreground">
                {search.trim() ? "No hay propietarios con ese nombre." : "Todavía no hay propietarios cargados."}
              </CommandEmpty>
            )}
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
                      {/* Teléfono, mail y DNI: con dos nombres parecidos, así se sabe cuál es. */}
                      {ownerDetails(o) && <span className="block truncate text-[11px] text-muted-foreground">{ownerDetails(o)}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup forceMount>
              {match ? (
                <p className="px-2 py-2 text-xs leading-snug text-muted-foreground" role="note">
                  <strong className="font-semibold text-foreground">{match.full_name}</strong>
                  {matchElsewhere && matchDetails ? ` (${matchDetails})` : ""}{" "}
                  {matchElsewhere ? "ya está en otra fila de esta propiedad." : "ya está cargado: elegilo de la lista."} {OTHER_PERSON_HINT}
                </p>
              ) : archivedMatch ? (
                <p className="px-2 py-2 text-xs leading-snug text-muted-foreground" role="note">
                  {archivedOwnerMessage(archivedMatch)}
                </p>
              ) : (
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
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
