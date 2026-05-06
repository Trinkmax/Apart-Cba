"use client";

import { useMemo, useState } from "react";
import * as Icons from "lucide-react";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listNodesByCategory } from "@/lib/crm/workflows/registry";
import { cn } from "@/lib/utils";
import type { NodeCategory } from "@/lib/crm/workflows/types";

interface Props {
  onClose: () => void;
  onSelect: (nodeType: string, defaultConfig: Record<string, unknown>) => void;
}

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  trigger: "Triggers",
  messages: "Mensajes",
  logic: "Lógica",
  ai: "IA",
  actions: "Acciones",
  pms: "Apart-Cba",
};

const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: "text-zinc-400",
  messages: "text-emerald-400",
  logic: "text-amber-400",
  ai: "text-violet-400",
  actions: "text-red-400",
  pms: "text-blue-400",
};

export function NodePaletteModal({ onClose, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const grouped = useMemo(() => listNodesByCategory(), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return grouped;
    const out: typeof grouped = { trigger: [], messages: [], logic: [], ai: [], actions: [], pms: [] };
    for (const cat of Object.keys(grouped) as NodeCategory[]) {
      out[cat] = grouped[cat].filter((n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q),
      );
    }
    return out;
  }, [grouped, search]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800 text-zinc-100 p-0">
        <DialogTitle className="sr-only">Agregar nodo al workflow</DialogTitle>
        <div className="border-b border-zinc-800 p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nodo..."
              className="pl-9 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
            />
            <button
              onClick={onClose}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-3 space-y-5">
            {(Object.keys(filtered) as NodeCategory[])
              .filter((cat) => cat !== "trigger") // Triggers solo cuando creamos workflow
              .map((cat) => {
                const items = filtered[cat];
                if (items.length === 0) return null;
                return (
                  <section key={cat}>
                    <h3 className={cn("text-[10px] uppercase tracking-wider font-bold mb-2", CATEGORY_COLOR[cat])}>
                      {CATEGORY_LABEL[cat]}
                    </h3>
                    <div className="space-y-1">
                      {items.map((def) => {
                        const Icon = (Icons[def.icon as keyof typeof Icons] as React.ComponentType<{ size?: number; className?: string }>) ?? Icons.Square;
                        return (
                          <button
                            key={def.type}
                            onClick={() => onSelect(def.type, def.defaultConfig as Record<string, unknown>)}
                            className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-zinc-900 text-left group"
                          >
                            <div className={cn("size-8 rounded-md flex items-center justify-center shrink-0",
                              def.accentColor === "green" && "bg-emerald-500/15 text-emerald-400",
                              def.accentColor === "amber" && "bg-amber-500/15 text-amber-400",
                              def.accentColor === "violet" && "bg-violet-500/15 text-violet-400",
                              def.accentColor === "red" && "bg-red-500/15 text-red-400",
                              def.accentColor === "blue" && "bg-blue-500/15 text-blue-400",
                              def.accentColor === "zinc" && "bg-zinc-500/15 text-zinc-400",
                            )}>
                              <Icon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-zinc-100">{def.label}</div>
                              <div className="text-xs text-zinc-500 line-clamp-1">{def.description}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
