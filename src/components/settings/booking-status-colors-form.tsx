"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOKING_STATUS_META } from "@/lib/constants";
import { updateBookingStatusColors } from "@/lib/actions/org";
import type {
  BookingStatus,
  BookingStatusColors,
} from "@/lib/types/database";

const STATUSES = Object.keys(BOOKING_STATUS_META) as BookingStatus[];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BookingStatusColorsForm({
  initialColors,
}: {
  initialColors: BookingStatusColors | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // El input siempre arranca con el color efectivo (override o default)
  // para que el color picker tenga un valor válido. Luego decidimos en submit
  // si se persiste como override (difiere del default) o se omite.
  const [colors, setColors] = useState<Record<BookingStatus, string>>(() => {
    const out = {} as Record<BookingStatus, string>;
    STATUSES.forEach((s) => {
      out[s] = initialColors?.[s] ?? BOOKING_STATUS_META[s].color;
    });
    return out;
  });

  function setColor(s: BookingStatus, value: string) {
    setColors((prev) => ({ ...prev, [s]: value }));
  }

  function resetStatus(s: BookingStatus) {
    setColor(s, BOOKING_STATUS_META[s].color);
  }

  function resetAll() {
    const out = {} as Record<BookingStatus, string>;
    STATUSES.forEach((s) => {
      out[s] = BOOKING_STATUS_META[s].color;
    });
    setColors(out);
  }

  function handleSubmit() {
    // Validar formato
    for (const s of STATUSES) {
      if (!HEX_RE.test(colors[s])) {
        toast.error(`Color inválido para "${BOOKING_STATUS_META[s].label}"`, {
          description: "Esperamos formato #RRGGBB (ej. #10b981).",
        });
        return;
      }
    }
    // Construir payload: solo claves que difieren del default → override.
    // El resto se omite, así que la clave queda con el default automáticamente.
    const payload: BookingStatusColors = {};
    STATUSES.forEach((s) => {
      if (colors[s].toLowerCase() !== BOOKING_STATUS_META[s].color.toLowerCase()) {
        payload[s] = colors[s].toLowerCase();
      }
    });
    startTransition(async () => {
      try {
        await updateBookingStatusColors(payload);
        toast.success("Colores actualizados", {
          description: "Se aplicarán en todas las vistas.",
        });
        router.refresh();
      } catch (e) {
        toast.error("No se pudieron guardar los colores", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {STATUSES.map((s) => {
            const meta = BOOKING_STATUS_META[s];
            const value = colors[s];
            const isOverride = value.toLowerCase() !== meta.color.toLowerCase();
            return (
              <div key={s} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`color-${s}`} className="text-sm">
                    {meta.label}
                  </Label>
                  {isOverride && (
                    <button
                      type="button"
                      onClick={() => resetStatus(s)}
                      className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      title={`Restaurar al default ${meta.color}`}
                    >
                      <RotateCcw size={10} /> Default
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`color-${s}`}
                    type="color"
                    value={value}
                    onChange={(e) => setColor(s, e.target.value)}
                    className="h-10 w-14 cursor-pointer p-1"
                    aria-label={`Color para ${meta.label}`}
                  />
                  <Input
                    type="text"
                    value={value}
                    onChange={(e) => setColor(s, e.target.value)}
                    className="font-mono text-xs uppercase tracking-wide"
                    placeholder="#RRGGBB"
                    pattern="#[0-9a-fA-F]{6}"
                    spellCheck={false}
                  />
                </div>
                {/* Preview pill */}
                <div
                  className="h-2 w-full rounded-sm"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${value}, ${value}CC)`,
                  }}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetAll}
          disabled={isPending}
          className="gap-1.5"
        >
          <RotateCcw size={14} /> Restaurar todos
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
