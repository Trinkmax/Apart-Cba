"use client";

import { Variable } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const VARIABLES = [
  { group: "Contacto", items: [
    { name: "contact.name", desc: "Nombre del contacto" },
    { name: "contact.phone", desc: "Teléfono E.164" },
    { name: "contact_name", desc: "Alias corto" },
  ]},
  { group: "Mensaje", items: [
    { name: "text", desc: "Texto del mensaje recibido" },
    { name: "type", desc: "Tipo de mensaje" },
  ]},
  { group: "Huésped (si linkeado)", items: [
    { name: "guest_name", desc: "Nombre completo del guest" },
  ]},
  { group: "Booking activo", items: [
    { name: "unit_code", desc: "Código de unidad" },
    { name: "unit_name", desc: "Nombre de unidad" },
    { name: "checkin_date", desc: "Fecha de check-in" },
    { name: "checkout_date", desc: "Fecha de check-out" },
  ]},
  { group: "Propietario", items: [
    { name: "owner_name", desc: "Nombre propietario" },
  ]},
  { group: "Workflow", items: [
    { name: "ai_response", desc: "Última respuesta IA" },
    { name: "ai_summary", desc: "Resumen IA del thread" },
    { name: "http_body", desc: "Body de último HTTP" },
    { name: "http_status", desc: "Status HTTP" },
  ]},
];

interface Props {
  onInsert: (variable: string) => void;
}

export function VariablePicker({ onInsert }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <Variable className="size-3 mr-1" /> Variables
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 max-h-72 overflow-y-auto" align="end">
        {VARIABLES.map((g) => (
          <div key={g.group} className="border-b border-border last:border-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-3 py-1.5 bg-muted/40">
              {g.group}
            </div>
            <ul>
              {g.items.map((it) => (
                <li key={it.name}>
                  <button
                    type="button"
                    onClick={() => onInsert(`{{${it.name}}}`)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted text-sm flex items-center justify-between gap-2"
                  >
                    <code className="text-xs font-mono">{`{{${it.name}}}`}</code>
                    <span className="text-[10px] text-muted-foreground truncate">{it.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
