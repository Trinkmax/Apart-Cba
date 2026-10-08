"use client";

import { useRef, type KeyboardEvent } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSlashFocus } from "@/hooks/use-slash-focus";
import { cn } from "@/lib/utils";

/**
 * La lupa de Caja. Controlada: el padre decide cuándo buscar (debounce) y
 * avisa si hay una búsqueda en vuelo. "/" enfoca, Esc borra (y con el campo
 * vacío, suelta el foco).
 */
export function CashSearchInput({
  value,
  onChange,
  loading = false,
  placeholder = "Buscar depto, persona o importe…",
  size = "default",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** "compact": misma altura y forma que los filtros de al lado (h-9, esquinas de Select). */
  size?: "default" | "compact";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(inputRef);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (value) onChange("");
    else e.currentTarget.blur();
  }

  return (
    <div role="search" className={cn("relative w-full", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Buscar movimientos por depto, persona, concepto o importe"
        className={cn(
          "bg-background pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden",
          size === "compact" ? "h-9" : "h-10 rounded-full shadow-sm",
        )}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Borrar búsqueda"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd
            className="pointer-events-none mr-1 hidden h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-flex"
            title="Tocá / para buscar"
          >
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
