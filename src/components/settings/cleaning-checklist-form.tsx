"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Loader2, Plus, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCleaningChecklistTemplate } from "@/lib/actions/org";

/**
 * Editor de la plantilla de checklist de limpieza.
 *
 * Es la lista que aparece en cada limpieza nueva para que quien limpia la vaya
 * tildando. Se edita como una lista de renglones: agregar, borrar, subir y
 * bajar. Sin drag & drop a propósito — las flechas se usan igual con el dedo y
 * no hay forma de "soltar en el lugar equivocado".
 */
export function CleaningChecklistForm({
  initialItems,
  defaultItems,
}: {
  /** Lo que tiene guardado la organización ([] = está usando la lista por defecto). */
  initialItems: string[];
  /** La lista por defecto, para poder volver a ella. */
  defaultItems: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const usandoDefault = initialItems.length === 0;
  const [items, setItems] = useState<string[]>(
    initialItems.length > 0 ? initialItems : defaultItems,
  );
  const [nuevo, setNuevo] = useState("");

  function agregar() {
    const item = nuevo.trim();
    if (!item) return;
    if (items.some((i) => i.toLowerCase() === item.toLowerCase())) {
      toast.error("Ese ítem ya está en la lista");
      return;
    }
    setItems((prev) => [...prev, item]);
    setNuevo("");
  }

  function mover(idx: number, delta: number) {
    setItems((prev) => {
      const next = [...prev];
      const destino = idx + delta;
      if (destino < 0 || destino >= next.length) return prev;
      [next[idx], next[destino]] = [next[destino], next[idx]];
      return next;
    });
  }

  function guardar() {
    const limpios = items.map((i) => i.trim()).filter(Boolean);
    if (limpios.length === 0) {
      toast.error("La lista no puede quedar vacía", {
        description: "Si querés la lista original, usá «Volver a la lista sugerida».",
      });
      return;
    }
    startTransition(async () => {
      const r = await updateCleaningChecklistTemplate({ items: limpios });
      if (!r.ok) {
        toast.error("No se pudo guardar", { description: r.error });
        return;
      }
      setItems(r.items);
      toast.success("Checklist guardada", {
        description: "Las limpiezas nuevas van a salir con esta lista.",
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Qué se controla en cada limpieza</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {usandoDefault
                ? "Estás usando la lista sugerida. Editala y guardá para armar la tuya."
                : "Tu lista. Cada limpieza nueva sale con estos ítems para ir tildando."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => setItems(defaultItems)}
            disabled={isPending}
          >
            <RotateCcw size={13} /> Volver a la lista sugerida
          </Button>
        </div>

        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={`${item}-${idx}`} className="flex items-center gap-2">
              <span
                className="text-muted-foreground/50 shrink-0 hidden sm:block"
                aria-hidden
              >
                <GripVertical size={14} />
              </span>
              <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">
                {idx + 1}.
              </span>
              <Input
                value={item}
                onChange={(e) =>
                  setItems((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                }
                className="h-9"
                aria-label={`Ítem ${idx + 1}`}
              />
              <div className="flex items-center shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={() => mover(idx, -1)}
                  disabled={idx === 0 || isPending}
                  aria-label="Subir"
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={() => mover(idx, 1)}
                  disabled={idx === items.length - 1 || isPending}
                  aria-label="Bajar"
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-rose-600"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={isPending}
                  aria-label={`Borrar ${item}`}
                >
                  <X size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
            placeholder="Agregar ítem (ej. Balcón / parrilla)"
            className="h-9"
            aria-label="Nuevo ítem"
          />
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={agregar}
            disabled={isPending}
          >
            <Plus size={14} /> Agregar
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground leading-snug">
          Cambiar esta lista no toca las limpiezas ya hechas: cada una guarda lo que se
          controló ese día.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={guardar} disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar checklist
        </Button>
      </div>
    </div>
  );
}
