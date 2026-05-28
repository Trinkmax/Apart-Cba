"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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

export type UnitComboboxOption = {
  id: string;
  code: string;
  name: string;
};

type Props<T extends UnitComboboxOption> = {
  units: T[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  renderPrefix?: (unit: T) => ReactNode;
};

export function UnitCombobox<T extends UnitComboboxOption>({
  units,
  value,
  onChange,
  placeholder = "Elegí la unidad",
  allowEmpty = false,
  emptyLabel = "Sin unidad",
  disabled,
  className,
  id,
  ariaLabel = "Unidad",
  searchPlaceholder = "Buscar por código o nombre…",
  renderPrefix,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => (value ? units.find((u) => u.id === value) ?? null : null),
    [units, value]
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
            !selected && "text-muted-foreground",
            className
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate min-w-0">
              {renderPrefix?.(selected)}
              <span className="font-mono text-xs">{selected.code}</span>
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
          <ChevronsUpDown size={14} className="opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) min-w-[280px] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              {allowEmpty && (
                <CommandItem
                  value={emptyLabel}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    size={14}
                    className={cn("mr-2", !value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="text-muted-foreground italic">{emptyLabel}</span>
                </CommandItem>
              )}
              {units.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.code} ${u.name}`}
                  onSelect={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    size={14}
                    className={cn(
                      "mr-2",
                      value === u.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {renderPrefix?.(u)}
                  <span className="font-mono text-xs text-muted-foreground mr-2">
                    {u.code}
                  </span>
                  <span className="truncate">{u.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
