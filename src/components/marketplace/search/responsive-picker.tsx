"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "./stepper";

/**
 * Un selector que en desktop es un Popover anclado a sus campos y en mobile
 * una hoja a pantalla completa con encabezado, cuerpo scrolleable y pie fijo.
 * Los campos (trigger) los dibuja quien lo usa y abren con `onOpenChange(true)`.
 */
export function ResponsivePicker({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  desktop,
  mobile,
  mobileFooter,
  align = "start",
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  title: string;
  description?: string;
  desktop: React.ReactNode;
  mobile: React.ReactNode;
  mobileFooter?: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
}) {
  const isDesktop = useIsDesktop();
  const anchorRef = useRef<HTMLDivElement>(null);
  // El campo que abrió el selector: sin PopoverTrigger, Radix devolvía el foco
  // a un trigger que no existe y caía en <body> (el teclado perdía su lugar).
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function rememberField(e: React.SyntheticEvent) {
    const field = (e.target as HTMLElement | null)?.closest?.("button");
    if (field) returnFocusRef.current = field;
  }

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} onPointerDownCapture={rememberField} onFocusCapture={rememberField}>
            {trigger}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align={align}
          sideOffset={10}
          aria-label={title}
          onInteractOutside={(e) => {
            // Click en los propios campos: lo manejan ellos (evita cerrar y reabrir).
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Si el foco ya quedó en otro lado útil (se tocó otro campo), se respeta.
            const active = document.activeElement;
            const content = e.currentTarget instanceof Node ? e.currentTarget : null;
            if (active && active !== document.body && !content?.contains(active)) return;
            const back = returnFocusRef.current;
            (back?.isConnected ? back : anchorRef.current?.querySelector<HTMLElement>("button"))?.focus();
          }}
          className={cn(
            "w-auto max-w-[calc(100vw-2rem)] rounded-3xl border-cream-300 bg-paper p-5 font-apart shadow-apart-lg",
            contentClassName,
          )}
        >
          {desktop}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      <div ref={anchorRef}>{trigger}</div>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="h-[100dvh] gap-0 border-0 bg-cream p-0 font-apart"
        >
          <div className="flex items-center justify-between gap-3 border-b border-cream-300 bg-paper px-4 py-3 safe-top">
            <div className="min-w-0">
              <SheetTitle className="font-apart text-lg font-extrabold tracking-[-0.02em] text-forest-700">
                {title}
              </SheetTitle>
              {description ? (
                <SheetDescription className="text-sm text-ink-500">{description}</SheetDescription>
              ) : (
                <SheetDescription className="sr-only">{title}</SheetDescription>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
              className="grid size-11 shrink-0 place-items-center rounded-full text-forest-700 outline-none hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">{mobile}</div>
          {mobileFooter ? (
            <div className="border-t border-cream-300 bg-paper px-4 pt-3 safe-bottom">{mobileFooter}</div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Campo-botón de los buscadores: etiqueta chica arriba, valor abajo. */
export function FieldButton({
  label,
  value,
  placeholder,
  onClick,
  active = false,
  className,
  icon,
  ...rest
}: {
  label: string;
  value: string | null;
  placeholder: string;
  /** Opcional: dentro de un PopoverTrigger el toggle lo maneja Radix. */
  onClick?: () => void;
  active?: boolean;
  className?: string;
  icon?: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "onClick" | "value">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={cn(
        "flex h-16 w-full min-w-0 items-center gap-3 rounded-2xl px-4 text-left outline-none transition-colors duration-200",
        "focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
        active ? "bg-paper shadow-apart-md ring-1 ring-forest-700/25" : "hover:bg-cream-200/70",
        className,
      )}
      {...rest}
    >
      {icon ? <span className="shrink-0 text-forest-600">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">{label}</span>
        <span
          className={cn(
            "block truncate text-[0.9375rem]",
            value ? "font-semibold text-ink-900" : "text-ink-500",
          )}
        >
          {value ?? placeholder}
        </span>
      </span>
    </button>
  );
}
