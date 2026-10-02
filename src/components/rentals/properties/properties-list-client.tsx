"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { LayoutGrid, List, Search, SearchX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { propertyAddress } from "@/lib/rentals/labels";
import { Money, StatusBadge } from "@/components/rentals/ui";
import { foldText } from "@/components/rentals/people/person-helpers";
import { PROPERTY_STATE_META, type PropertyDisplayState } from "./property-helpers";
import type { PropertyListItem } from "./property-types";
import { BalanceLine, ContractStateHint, OwnerAvatars, PropertyCard } from "./property-card";

type Filter = "todas" | PropertyDisplayState;
type View = "tarjetas" | "lista";
const VIEW_KEY = "alquileres.propiedades.vista";
const FILTERS: Filter[] = ["todas", "alquilada", "vacante", "reservada", "en_refaccion", "retirada"];
const VIEW_EVENT = "alquileres:propiedades-vista";
/** Si el navegador no deja usar storage (modo privado), la vista vive en memoria. */
let memoryView: View = "tarjetas";

function readView(): View {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "lista" || saved === "tarjetas") return saved;
  } catch {
    /* sin storage */
  }
  return memoryView;
}

function subscribeView(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(VIEW_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(VIEW_EVENT, cb);
  };
}

function changeView(v: View) {
  memoryView = v;
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* queda en memoria */
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}

function haystack(it: PropertyListItem): string {
  return foldText(
    [
      it.property.code,
      propertyAddress(it.property),
      it.property.neighborhood,
      it.property.city,
      ...it.owners.map((o) => o.full_name),
      it.current?.tenant?.full_name,
      it.draft?.tenant?.full_name,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function PropertiesListClient({ items, today }: { items: PropertyListItem[]; today: string }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todas");
  // Preferencia de vista por navegador (localStorage); el servidor siempre pinta tarjetas.
  const view = useSyncExternalStore(subscribeView, readView, () => "tarjetas" as View);

  const indexed = useMemo(() => items.map((it) => ({ it, hay: haystack(it) })), [items]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { todas: items.length, alquilada: 0, vacante: 0, reservada: 0, en_refaccion: 0, retirada: 0, archivada: 0 };
    for (const it of items) c[it.state]++;
    return c;
  }, [items]);
  const words = foldText(q).split(/\s+/).filter(Boolean);
  const visible = indexed.filter(({ it, hay }) => (filter === "todas" || it.state === filter) && words.every((w) => hay.includes(w))).map((x) => x.it);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80 shrink-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Dirección, código, dueño o inquilino…"
            aria-label="Buscar propiedades"
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto min-w-0 flex-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.filter((f) => f === "todas" || counts[f] > 0).map((f) => {
            const active = filter === f;
            const color = f === "todas" ? null : PROPERTY_STATE_META[f].color;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 h-8 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  !active && "bg-card text-muted-foreground border-input hover:text-foreground hover:bg-accent/40",
                  active && !color && "border-foreground bg-foreground text-background",
                )}
                style={active && color ? { color, backgroundColor: `${color}15`, borderColor: `${color}40` } : undefined}
              >
                {f === "todas" ? "Todas" : f === "alquilada" ? "Alquiladas" : f === "vacante" ? "Vacantes" : PROPERTY_STATE_META[f].label}
                <span className="tabular-nums text-[10px] font-normal opacity-60">{counts[f]}</span>
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="Vista" className="hidden md:inline-flex rounded-lg border bg-card p-0.5 ml-auto">
          {(
            [
              ["tarjetas", LayoutGrid, "Tarjetas"],
              ["lista", List, "Lista"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={label}
              title={label}
              onClick={() => changeView(v)}
              className={cn("size-8 rounded-md flex items-center justify-center transition-colors", view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed gap-2 items-center">
          <SearchX className="size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground">Probá con otra dirección o nombre, o mirá todas las propiedades.</p>
        </Card>
      ) : view === "lista" ? (
        <>
          <div className="hidden md:block">
            <PropertiesTable items={visible} today={today} />
          </div>
          {/* En el celular la lista no entra: siempre tarjetas. */}
          <div className="grid gap-3 sm:grid-cols-2 md:hidden">
            {visible.map((it) => (
              <PropertyCard key={it.property.id} item={it} today={today} />
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((it) => (
            <PropertyCard key={it.property.id} item={it} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Vista de lista (escritorio): una fila por propiedad, la grilla del panel. */
function PropertiesTable({ items, today }: { items: PropertyListItem[]; today: string }) {
  return (
    <Card className="overflow-hidden p-0 gap-0">
      <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b">
        <span className="col-span-4">Propiedad</span>
        <span className="col-span-3">Inquilino</span>
        <span className="col-span-2 text-right">Alquiler</span>
        <span className="col-span-1">Vence</span>
        <span className="col-span-2 text-right">Saldo</span>
      </div>
      <ul className="divide-y">
        {items.map((it) => (
          <li key={it.property.id}>
            <Link
              href={`/dashboard/alquileres/propiedades/${it.property.id}`}
              className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:bg-accent/40"
            >
              <span className="col-span-4 min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{propertyAddress(it.property)}</span>
                  <StatusBadge meta={PROPERTY_STATE_META[it.state]} compact className="shrink-0" />
                </span>
                <span className="mt-0.5 flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{it.property.code}</span>
                  <OwnerAvatars owners={it.owners} max={2} />
                </span>
              </span>
              <span className="col-span-3 min-w-0">
                <span className="block text-sm truncate">
                  {it.current?.tenant?.full_name ?? (it.draft ? `Borrador · ${it.draft.tenant?.full_name ?? "sin inquilino"}` : "—")}
                </span>
                <ContractStateHint item={it} today={today} />
              </span>
              <span className="col-span-2 text-right text-sm">
                {it.current ? (
                  <Money amount={it.current.current_rent} currency={it.current.currency} className="font-medium" />
                ) : it.property.listing_rent ? (
                  <span className="text-muted-foreground text-xs">
                    Pide <Money amount={it.property.listing_rent} currency={it.property.listing_currency ?? "ARS"} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="col-span-1 text-xs text-muted-foreground tabular-nums">{it.current ? formatDate(it.current.end_date, "MM/yyyy") : "—"}</span>
              <span className="col-span-2 text-right">
                {it.current ? <BalanceLine balance={it.current.balance} overdue={it.current.overdue} currency={it.current.currency} /> : <span className="text-muted-foreground text-xs">—</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
