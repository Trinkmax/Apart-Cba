"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { State } from "country-state-city";
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
import { sortByLocaleES, type CountryCode, type StateCode } from "@/lib/geo";

interface StateComboboxProps {
  countryCode: CountryCode | null;
  value: StateCode | null;
  onChange: (code: StateCode) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export interface StateOption {
  code: StateCode;
  name: string;
}

/**
 * Devuelve la lista de estados/provincias del país, ordenada por nombre en es-AR.
 * Memoizamos por country code para no recomputar en cada render.
 */
const _statesCache = new Map<string, StateOption[]>();
export function getStatesOfCountry(countryCode: CountryCode): StateOption[] {
  const cached = _statesCache.get(countryCode);
  if (cached) return cached;
  const raw = State.getStatesOfCountry(countryCode);
  const opts: StateOption[] = raw.map((s) => ({ code: s.isoCode, name: s.name }));
  const sorted = sortByLocaleES(opts, (o) => o.name);
  _statesCache.set(countryCode, sorted);
  return sorted;
}

export function StateCombobox({
  countryCode,
  value,
  onChange,
  id,
  placeholder = "Elegí provincia/estado",
  ariaLabel = "Provincia o estado",
}: StateComboboxProps) {
  const [open, setOpen] = useState(false);
  const states = useMemo(
    () => (countryCode ? getStatesOfCountry(countryCode) : []),
    [countryCode]
  );
  const selected = useMemo(
    () => states.find((s) => s.code === value) ?? null,
    [states, value]
  );

  const disabled = !countryCode || states.length === 0;

  return (
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
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronDown size={14} className="opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) min-w-[260px] p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar provincia…" aria-label="Buscar provincia" />
          <CommandList>
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              {states.map((s) => (
                <CommandItem
                  key={s.code}
                  value={`${s.name} ${s.code}`}
                  onSelect={() => {
                    onChange(s.code);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{s.name}</span>
                  <Check
                    size={14}
                    className={cn(
                      "ml-auto opacity-0",
                      value === s.code && "opacity-100"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
