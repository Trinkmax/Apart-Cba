"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Recorte del documento de liquidación para la landing.
 *
 * La liquidación de ejemplo es un documento real y completo: tres unidades, seis
 * reservas, otros cargos y datos bancarios. En desktop entra sin molestar, pero
 * en un teléfono son casi tres pantallas de scroll en el medio de la landing,
 * justo antes del CTA. Acá se muestra el arranque —encabezado, totales y la
 * primera unidad— con un degradé que deja claro que sigue, y un botón para
 * abrirla entera.
 *
 * Sólo aplica en angosto: de `md` para arriba no hay recorte ni botón.
 */
export function StatementPreview({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "relative",
          !open && "max-h-[38rem] overflow-hidden rounded-xl md:max-h-none md:overflow-visible"
        )}
      >
        {children}
        {!open && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-card via-card/85 to-transparent md:hidden"
          />
        )}
      </div>

      <Button
        variant="outline"
        className="mt-4 w-full rounded-full md:hidden"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Ver menos" : "Ver la liquidación completa"}
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
    </div>
  );
}
