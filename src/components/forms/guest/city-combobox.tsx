"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { City, State } from "country-state-city";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { sortByLocaleES, type CountryCode, type StateCode } from "@/lib/geo";

interface CityComboboxProps {
  countryCode: CountryCode | null;
  stateCode: StateCode | null;
  value: string | null;
  onChange: (cityName: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
}

interface CityOption {
  name: string;
}

const _citiesCache = new Map<string, CityOption[]>();
function getCitiesOf(countryCode: CountryCode, stateCode: StateCode | null): CityOption[] {
  const key = `${countryCode}|${stateCode ?? "_"}`;
  const cached = _citiesCache.get(key);
  if (cached) return cached;
  const raw =
    stateCode != null
      ? City.getCitiesOfState(countryCode, stateCode)
      : (City.getCitiesOfCountry(countryCode) ?? []);
  // De-dup por nombre — getCitiesOfCountry puede repetir ciudades del mismo nombre
  // en distintos estados.
  const seen = new Set<string>();
  const opts: CityOption[] = [];
  for (const c of raw) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    opts.push({ name: c.name });
  }
  const sorted = sortByLocaleES(opts, (o) => o.name);
  _citiesCache.set(key, sorted);
  return sorted;
}

const RENDER_CAP = 250;

export function CityCombobox({
  countryCode,
  stateCode,
  value,
  onChange,
  id,
  placeholder = "Elegí ciudad",
  ariaLabel = "Ciudad",
}: CityComboboxProps) {
  const [open, setOpen] = useState(false);
  // Toggle "Mi ciudad no aparece" — convierte el field en input libre.
  const [freeText, setFreeText] = useState(false);

  // ¿El país tiene estados? Si sí, exigimos stateCode para listar ciudades.
  // Si no, listamos ciudades directamente del país (ej. Mónaco, Vaticano, etc.).
  const countryHasStates = useMemo(
    () => (countryCode ? State.getStatesOfCountry(countryCode).length > 0 : false),
    [countryCode]
  );

  const cities = useMemo(() => {
    if (!countryCode) return [];
    if (countryHasStates && !stateCode) return [];
    return getCitiesOf(countryCode, stateCode ?? null);
  }, [countryCode, stateCode, countryHasStates]);

  const isTruncated = cities.length > RENDER_CAP;
  const visibleCities = useMemo(
    () => (isTruncated ? cities.slice(0, RENDER_CAP) : cities),
    [cities, isTruncated]
  );

  // Deshabilitado cuando no hay país, o cuando el país tiene estados y no se eligió uno.
  const disabled = !countryCode || (countryHasStates && !stateCode);

  return (
    <div className="space-y-1.5">
      {freeText ? (
        <Input
          id={id}
          aria-label={ariaLabel}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Escribí el nombre de tu ciudad"
        />
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={ariaLabel}
              disabled={disabled}
              className={cn(
                "w-full justify-between font-normal h-9 px-3",
                !value && "text-muted-foreground"
              )}
            >
              <span className="truncate">{value || placeholder}</span>
              <ChevronDown size={14} className="opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-(--radix-popover-trigger-width) min-w-[260px] p-0"
          >
            <Command>
              <CommandInput placeholder="Buscar ciudad…" aria-label="Buscar ciudad" />
              <CommandList>
                <CommandEmpty>Sin resultados</CommandEmpty>
                <CommandGroup>
                  {visibleCities.map((c) => (
                    <CommandItem
                      key={c.name}
                      value={c.name}
                      onSelect={() => {
                        onChange(c.name);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{c.name}</span>
                      <Check
                        size={14}
                        className={cn(
                          "ml-auto opacity-0",
                          value === c.name && "opacity-100"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
                {isTruncated && (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-t">
                    Mostrando {RENDER_CAP} de {cities.length}. Refiná tu búsqueda.
                  </div>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* El toggle se muestra siempre que haya país elegido, para que el usuario
          pueda escribir su ciudad incluso cuando la lista del paquete no la trae. */}
      {countryCode && (
        <div className="flex items-center gap-2">
          <Switch
            id={`${id ?? "city"}-freetext`}
            checked={freeText}
            onCheckedChange={(c) => {
              setFreeText(c);
              // Al alternar limpiamos el valor para evitar confusión visual
              // (un valor que no aparece en la lista vs. un valor escrito a mano).
              onChange("");
            }}
          />
          <Label
            htmlFor={`${id ?? "city"}-freetext`}
            className="text-[11px] text-muted-foreground font-normal cursor-pointer"
          >
            Mi ciudad no aparece
          </Label>
        </div>
      )}
    </div>
  );
}
