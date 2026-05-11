"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { upsertDateMark, removeDateMark } from "@/lib/actions/date-marks";
import { cn } from "@/lib/utils";
import type { OrgDateMark } from "@/lib/types/database";

const QUICK_SWATCHES: { color: string; name: string }[] = [
  { color: "#DC2626", name: "Rojo (feriado nacional)" },
  { color: "#EA580C", name: "Naranja (feriado provincial)" },
  { color: "#CA8A04", name: "Amarillo (no laborable)" },
  { color: "#9333EA", name: "Violeta (puente)" },
  { color: "#16A34A", name: "Verde (evento)" },
];

const DEFAULT_COLOR = QUICK_SWATCHES[0].color;
const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface Props {
  /** ISO yyyy-MM-dd */
  date: string;
  mark: OrgDateMark | undefined;
  canEdit: boolean;
  children: React.ReactNode;
}

export function DateMarkPopover({ date, mark, canEdit, children }: Props) {
  const [open, setOpen] = useState(false);
  // No render del form si no hay nada útil: sin permiso y sin marca
  if (!canEdit && !mark) {
    return <>{children}</>;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        align="center"
        side="bottom"
        sideOffset={4}
      >
        <DateMarkForm
          key={`${date}:${mark?.color ?? ""}:${mark?.label ?? ""}`}
          date={date}
          mark={mark}
          canEdit={canEdit}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function DateMarkForm({
  date,
  mark,
  canEdit,
  onDone,
}: {
  date: string;
  mark: OrgDateMark | undefined;
  canEdit: boolean;
  onDone: () => void;
}) {
  const initialColor = mark?.color ?? DEFAULT_COLOR;
  const [color, setColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [label, setLabel] = useState(mark?.label ?? "");
  const [isPending, startTransition] = useTransition();
  const [isRemoving, startRemove] = useTransition();

  const dateLabel = format(parseISO(date), "EEEE d 'de' MMMM yyyy", { locale: es });
  const isValidHex = HEX_REGEX.test(hexInput);

  function handleSave() {
    if (!isValidHex) {
      toast.error("Color inválido", { description: "Usá formato #RRGGBB" });
      return;
    }
    startTransition(async () => {
      const result = await upsertDateMark({
        date,
        color: hexInput.toUpperCase(),
        label: label.trim() || null,
      });
      if (!result.ok) {
        toast.error("No se pudo guardar", { description: result.error });
        return;
      }
      toast.success("Marca guardada");
      onDone();
    });
  }

  function handleRemove() {
    startRemove(async () => {
      const result = await removeDateMark({ date });
      if (!result.ok) {
        toast.error("No se pudo quitar", { description: result.error });
        return;
      }
      toast.success("Marca eliminada");
      onDone();
    });
  }

  function applySwatch(c: string) {
    setColor(c);
    setHexInput(c);
  }

  function onHexChange(value: string) {
    let next = value.startsWith("#") ? value : `#${value}`;
    next = next.slice(0, 7);
    setHexInput(next);
    if (HEX_REGEX.test(next)) setColor(next);
  }

  // Read-only view
  if (!canEdit) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
        <div className="flex items-center gap-2">
          <span
            className="size-5 rounded-full border"
            style={{ backgroundColor: mark?.color }}
            aria-hidden
          />
          <span className="text-sm font-medium">{mark?.label || "Sin etiqueta"}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Solo admin/recepción puede editar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted-foreground capitalize">{dateLabel}</div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_SWATCHES.map((s) => (
            <button
              key={s.color}
              type="button"
              title={s.name}
              onClick={() => applySwatch(s.color)}
              className={cn(
                "size-7 rounded-full border-2 transition-transform hover:scale-110",
                color.toLowerCase() === s.color.toLowerCase()
                  ? "border-foreground shadow-sm"
                  : "border-border/30"
              )}
              style={{ backgroundColor: s.color }}
            >
              {color.toLowerCase() === s.color.toLowerCase() && (
                <Check size={12} className="text-white mx-auto drop-shadow" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Selector de color"
            value={isValidHex ? color : DEFAULT_COLOR}
            onChange={(e) => applySwatch(e.target.value.toUpperCase())}
            className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Input
            value={hexInput}
            onChange={(e) => onHexChange(e.target.value)}
            placeholder="#RRGGBB"
            className="h-8 font-mono text-xs uppercase"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dm_label" className="text-xs">Etiqueta (opcional)</Label>
        <Input
          id="dm_label"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 80))}
          placeholder="Feriado nacional"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {mark ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={isPending || isRemoving}
            className="text-destructive hover:text-destructive h-8"
          >
            {isRemoving ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Trash2 size={12} className="mr-1" />}
            Quitar
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDone}
            disabled={isPending}
            className="h-8"
          >
            <X size={12} className="mr-1" />
            Cancelar
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending || isRemoving || !isValidHex}
          className="h-8"
        >
          {isPending && <Loader2 size={12} className="mr-1 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}
