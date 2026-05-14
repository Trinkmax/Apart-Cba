"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
import { getAllCountriesES, type CountryCode } from "@/lib/geo";

interface CountryComboboxProps {
  value: CountryCode | null;
  onChange: (code: CountryCode) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export function CountryCombobox({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Elegí un país",
  ariaLabel = "País",
}: CountryComboboxProps) {
  const [open, setOpen] = useState(false);
  const countries = useMemo(() => getAllCountriesES(), []);
  const selected = useMemo(
    () => countries.find((c) => c.code === value) ?? null,
    [countries, value]
  );

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
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                <span aria-hidden className="text-base leading-none">
                  {selected.flag}
                </span>
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="truncate">{placeholder}</span>
            )}
          </span>
          <ChevronDown size={14} className="opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) min-w-[260px] p-0"
      >
        <Command>
          <CommandInput placeholder="Buscar país…" aria-label="Buscar país" />
          <CommandList>
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              {countries.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <span aria-hidden className="text-base leading-none">
                    {c.flag}
                  </span>
                  <span className="truncate">{c.name}</span>
                  <Check
                    size={14}
                    className={cn(
                      "ml-auto opacity-0",
                      value === c.code && "opacity-100"
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
