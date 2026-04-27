"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  Filter,
  History,
  Layers,
  Loader2,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  bulkRestock,
  createAmenity,
  deleteAmenity,
  recordMovement,
  setUnitStock,
  updateAmenity,
  type AmenityInput,
} from "@/lib/actions/amenities";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Amenity,
  InventoryMovement,
  UnitAmenity,
} from "@/lib/types/database";

type UnitLite = { id: string; code: string; name: string };

type MovementWithRefs = InventoryMovement & {
  unit: { id: string; code: string; name: string };
  amenity: { id: string; name: string; icon: string | null; unit_label: string | null };
};

interface Props {
  amenities: Amenity[];
  units: UnitLite[];
  unitAmenities: UnitAmenity[];
  movements: MovementWithRefs[];
}

const ICONS = ["🧻", "☕", "🧼", "🛏️", "🛁", "🍷", "🧴", "🧹", "📦", "💡", "🍴", "👕", "🧊", "🧂"];

export function InventoryWorkspace({
  amenities: initialAmenities,
  units,
  unitAmenities: initialUnitAmenities,
  movements: initialMovements,
}: Props) {
  const router = useRouter();
  const [amenities, setAmenities] = useState(initialAmenities);
  const [unitAmenities, setUnitAmenities] = useState(initialUnitAmenities);
  const [movements, setMovements] = useState(initialMovements);
  const [tab, setTab] = useState("stock");

  const consumables = useMemo(() => amenities.filter((a) => a.consumable), [amenities]);

  // Mapa rápido (unit_id|amenity_id) -> UnitAmenity
  const stockMap = useMemo(() => {
    const m = new Map<string, UnitAmenity>();
    unitAmenities.forEach((ua) => m.set(`${ua.unit_id}|${ua.amenity_id}`, ua));
    return m;
  }, [unitAmenities]);

  const lowStockCount = useMemo(() => {
    let n = 0;
    consumables.forEach((a) => {
      const par = a.default_par_level ?? 1;
      units.forEach((u) => {
        const ua = stockMap.get(`${u.id}|${a.id}`);
        const q = ua?.current_quantity ?? 0;
        const itemPar = ua?.par_level ?? par;
        if (q < itemPar) n++;
      });
    });
    return n;
  }, [consumables, units, stockMap]);

  function applyMovement(mov: InventoryMovement, amenity: Amenity, unit: UnitLite) {
    setUnitAmenities((cur) => {
      const idx = cur.findIndex((x) => x.unit_id === mov.unit_id && x.amenity_id === mov.amenity_id);
      if (idx === -1) {
        return [
          ...cur,
          {
            id: mov.id,
            unit_id: mov.unit_id,
            amenity_id: mov.amenity_id,
            current_quantity: mov.quantity_after ?? Math.max(0, mov.quantity_delta),
            par_level: amenity.default_par_level ?? null,
            last_restocked_at:
              mov.movement_type === "restock" || mov.movement_type === "initial"
                ? mov.performed_at
                : null,
            notes: null,
          },
        ];
      }
      const next = [...cur];
      next[idx] = {
        ...next[idx],
        current_quantity: mov.quantity_after ?? next[idx].current_quantity + mov.quantity_delta,
        last_restocked_at:
          mov.movement_type === "restock" || mov.movement_type === "initial"
            ? mov.performed_at
            : next[idx].last_restocked_at,
      };
      return next;
    });
    setMovements((cur) => [
      {
        ...mov,
        unit: { id: unit.id, code: unit.code, name: unit.name },
        amenity: {
          id: amenity.id,
          name: amenity.name,
          icon: amenity.icon,
          unit_label: amenity.unit_label,
        },
      },
      ...cur,
    ]);
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TabsList className="gap-1">
          <TabsTrigger value="stock" className="gap-2">
            <Layers size={14} /> Stock por unidad
          </TabsTrigger>
          <TabsTrigger value="catalog" className="gap-2">
            <Boxes size={14} /> Catálogo
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell size={14} /> Alertas
            {lowStockCount > 0 && (
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-[10px] px-1.5 py-0 h-4 ml-0.5">
                {lowStockCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History size={14} /> Movimientos
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2">
          {tab === "catalog" && (
            <AmenityFormDialog
              onCreated={(a) => setAmenities((cur) => [...cur, a])}
            >
              <Button className="gap-2">
                <Plus size={16} /> Nuevo ítem
              </Button>
            </AmenityFormDialog>
          )}
        </div>
      </div>

      <TabsContent value="stock" className="m-0">
        <StockMatrix
          consumables={consumables}
          units={units}
          stockMap={stockMap}
          onMutate={(mov, amenity, unit) => {
            applyMovement(mov, amenity, unit);
            router.refresh();
          }}
        />
      </TabsContent>

      <TabsContent value="catalog" className="m-0">
        <Catalog
          amenities={amenities}
          onUpdated={(a) =>
            setAmenities((cur) => cur.map((x) => (x.id === a.id ? a : x)))
          }
          onDeleted={(id) => setAmenities((cur) => cur.filter((x) => x.id !== id))}
        />
      </TabsContent>

      <TabsContent value="alerts" className="m-0">
        <AlertsPanel
          consumables={consumables}
          units={units}
          stockMap={stockMap}
          onRestock={(mov, amenity, unit) => {
            applyMovement(mov, amenity, unit);
            router.refresh();
          }}
        />
      </TabsContent>

      <TabsContent value="history" className="m-0">
        <MovementsLog movements={movements} />
      </TabsContent>
    </Tabs>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STOCK MATRIX (matriz unidad × ítem)
// ════════════════════════════════════════════════════════════════════════════

function StockMatrix({
  consumables,
  units,
  stockMap,
  onMutate,
}: {
  consumables: Amenity[];
  units: UnitLite[];
  stockMap: Map<string, UnitAmenity>;
  onMutate: (mov: InventoryMovement, amenity: Amenity, unit: UnitLite) => void;
}) {
  const [search, setSearch] = useState("");
  const [showOnlyLow, setShowOnlyLow] = useState(false);
  const [selectedAmenityId, setSelectedAmenityId] = useState<string | "all">("all");

  const filteredAmenities = useMemo(() => {
    let xs = consumables;
    if (selectedAmenityId !== "all") xs = xs.filter((a) => a.id === selectedAmenityId);
    return xs;
  }, [consumables, selectedAmenityId]);

  const filteredUnits = useMemo(() => {
    let xs = units;
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter(
        (u) => u.code.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)
      );
    }
    if (showOnlyLow) {
      xs = xs.filter((u) =>
        filteredAmenities.some((a) => {
          const ua = stockMap.get(`${u.id}|${a.id}`);
          const par = ua?.par_level ?? a.default_par_level ?? 1;
          return (ua?.current_quantity ?? 0) < par;
        })
      );
    }
    return xs;
  }, [units, search, showOnlyLow, filteredAmenities, stockMap]);

  if (consumables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <Package className="size-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No hay items consumibles</p>
        <p className="text-xs text-muted-foreground mt-1">
          Agregá items al catálogo y marcalos como "Consumible" para llevar stock por unidad.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/30 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar unidad..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={selectedAmenityId} onValueChange={(v) => setSelectedAmenityId(v as string)}>
          <SelectTrigger className="h-8 text-xs w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los ítems</SelectItem>
            {consumables.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <span>{a.icon ?? "📦"}</span>
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={showOnlyLow ? "default" : "outline"}
          size="sm"
          onClick={() => setShowOnlyLow((v) => !v)}
          className="h-8 gap-1.5 text-xs"
        >
          <AlertTriangle size={13} />
          Solo bajo stock
        </Button>
        <div className="ml-auto">
          <BulkRestockDialog
            amenities={consumables}
            units={filteredUnits}
            onDone={(movs, amenity) => {
              movs.forEach((m) => {
                const u = units.find((x) => x.id === m.unit_id);
                if (u) onMutate(m, amenity, u);
              });
            }}
          />
        </div>
      </div>

      <ScrollArea className="w-full">
        <div className="min-w-fit">
          {/* Header de items */}
          <div className="flex border-b sticky top-0 bg-background z-10">
            <div className="w-[200px] shrink-0 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-r bg-muted/20">
              Unidad
            </div>
            {filteredAmenities.map((a) => (
              <div
                key={a.id}
                className="w-[120px] shrink-0 px-2 py-2 text-center border-r last:border-r-0"
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-base leading-none">{a.icon ?? "📦"}</span>
                  <span className="text-[11px] font-medium leading-tight line-clamp-1">
                    {a.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    par: {a.default_par_level ?? 1} {a.unit_label ?? ""}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Filas */}
          {filteredUnits.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground">
              Sin resultados
            </div>
          ) : (
            filteredUnits.map((u, idx) => (
              <div
                key={u.id}
                className={cn(
                  "flex border-b last:border-b-0",
                  idx % 2 === 1 && "bg-muted/10"
                )}
              >
                <div className="w-[200px] shrink-0 px-3 py-2.5 border-r bg-background/40 sticky left-0 z-[1]">
                  <div className="font-mono text-xs font-semibold">{u.code}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{u.name}</div>
                </div>
                {filteredAmenities.map((a) => {
                  const ua = stockMap.get(`${u.id}|${a.id}`);
                  const qty = ua?.current_quantity ?? 0;
                  const par = ua?.par_level ?? a.default_par_level ?? 1;
                  return (
                    <StockCell
                      key={a.id}
                      unit={u}
                      amenity={a}
                      currentQty={qty}
                      parLevel={par}
                      lastRestockedAt={ua?.last_restocked_at}
                      onMutate={(mov) => onMutate(mov, a, u)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

function StockCell({
  unit,
  amenity,
  currentQty,
  parLevel,
  lastRestockedAt,
  onMutate,
}: {
  unit: UnitLite;
  amenity: Amenity;
  currentQty: number;
  parLevel: number;
  lastRestockedAt: string | null | undefined;
  onMutate: (mov: InventoryMovement) => void;
}) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState<number>(parLevel);
  const [mode, setMode] = useState<"restock" | "consume" | "adjust">("restock");
  const [isPending, startTransition] = useTransition();

  const isLow = currentQty < parLevel;
  const isCritical = currentQty === 0;

  function quickRestock(amount: number) {
    startTransition(async () => {
      try {
        const mov = await recordMovement({
          unit_id: unit.id,
          amenity_id: amenity.id,
          movement_type: "restock",
          quantity_delta: amount,
        });
        onMutate(mov);
        toast.success(`+${amount} ${amenity.unit_label ?? "u"} en ${unit.code}`);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        if (mode === "adjust") {
          const mov = await setUnitStock({
            unit_id: unit.id,
            amenity_id: amenity.id,
            target_quantity: delta,
          });
          if (mov) onMutate(mov);
        } else {
          const mov = await recordMovement({
            unit_id: unit.id,
            amenity_id: amenity.id,
            movement_type: mode,
            quantity_delta: mode === "consume" ? -Math.abs(delta) : Math.abs(delta),
          });
          onMutate(mov);
        }
        toast.success("Stock actualizado");
        setOpen(false);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="w-[120px] shrink-0 border-r last:border-r-0 p-1.5 group">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            className={cn(
              "w-full rounded-md border px-2 py-1.5 text-center transition-all",
              "hover:border-primary/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary",
              isCritical
                ? "border-red-500/40 bg-red-500/5"
                : isLow
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-emerald-500/30 bg-emerald-500/5"
            )}
          >
            <div className="flex items-baseline justify-center gap-1">
              <span
                className={cn(
                  "text-base font-bold tabular-nums",
                  isCritical
                    ? "text-red-600 dark:text-red-400"
                    : isLow
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {currentQty}
              </span>
              <span className="text-[9px] text-muted-foreground">/ {parLevel}</span>
            </div>
            {lastRestockedAt && !isLow && (
              <div className="text-[9px] text-muted-foreground mt-0.5 truncate">
                {formatTimeAgo(lastRestockedAt)}
              </div>
            )}
            {isLow && (
              <div className="text-[9px] font-medium mt-0.5">
                {isCritical ? "AGOTADO" : "BAJO STOCK"}
              </div>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">{amenity.icon ?? "📦"}</span>
              <div>
                <div>{amenity.name}</div>
                <div className="text-xs font-normal text-muted-foreground font-mono">
                  {unit.code} · {unit.name}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex items-center justify-around rounded-lg border p-3 bg-muted/20">
              <Stat label="Actual" value={currentQty} highlight={isLow ? "warn" : "ok"} />
              <Separator orientation="vertical" className="h-10" />
              <Stat label="Par level" value={parLevel} />
              <Separator orientation="vertical" className="h-10" />
              <Stat
                label="Diferencia"
                value={currentQty - parLevel}
                highlight={currentQty - parLevel < 0 ? "warn" : "ok"}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => quickRestock(parLevel - currentQty > 0 ? parLevel - currentQty : parLevel)}
                className="gap-1.5"
              >
                <Sparkles size={14} /> Llenar a par
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => quickRestock(1)}
                className="gap-1.5"
              >
                <Plus size={14} /> +1
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => quickRestock(5)}
                className="gap-1.5"
              >
                <Plus size={14} /> +5
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ajuste personalizado
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["restock", "consume", "adjust"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "px-2 py-1.5 rounded-md text-xs font-medium border transition-all",
                      mode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    )}
                  >
                    {m === "restock" && "Sumar"}
                    {m === "consume" && "Restar"}
                    {m === "adjust" && "Fijar valor"}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {mode === "adjust" ? "Cantidad final" : "Cantidad"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={delta}
                  onChange={(e) => setDelta(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || delta < 0}>
              {isPending && <Loader2 className="animate-spin" size={14} />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "ok" | "warn";
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums mt-0.5",
          highlight === "warn" && "text-amber-600 dark:text-amber-400",
          highlight === "ok" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value > 0 ? "+" : ""}
        {value}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CATALOG (rediseñado, sin overlap)
// ════════════════════════════════════════════════════════════════════════════

function Catalog({
  amenities,
  onUpdated,
  onDeleted,
}: {
  amenities: Amenity[];
  onUpdated: (a: Amenity) => void;
  onDeleted: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Amenity[]>();
    amenities.forEach((a) => {
      const cat = a.category ?? "Sin categoría";
      const arr = map.get(cat) ?? [];
      arr.push(a);
      map.set(cat, arr);
    });
    return Array.from(map.entries());
  }, [amenities]);

  if (amenities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <Boxes className="size-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">Catálogo vacío</p>
        <p className="text-xs text-muted-foreground mt-1">
          Agregá items reutilizables (toallas, café, papel higiénico, etc.)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([cat, items]) => (
        <section key={cat} className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {cat}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((a) => (
              <AmenityCard
                key={a.id}
                amenity={a}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AmenityCard({
  amenity,
  onUpdated,
  onDeleted,
}: {
  amenity: Amenity;
  onUpdated: (a: Amenity) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <AmenityFormDialog amenity={amenity} onUpdated={onUpdated} onDeleted={onDeleted}>
      <button
        className={cn(
          "group w-full text-left rounded-xl border bg-card p-4 transition-all",
          "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "size-12 rounded-xl flex items-center justify-center text-2xl shrink-0",
              "bg-gradient-to-br from-primary/10 to-primary/5 ring-1 ring-primary/10"
            )}
            aria-hidden
          >
            {amenity.icon ?? "📦"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">{amenity.name}</div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {amenity.consumable ? (
                <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                  Consumible
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Fijo
                </Badge>
              )}
              {amenity.consumable && (
                <Badge variant="outline" className="text-[10px] tabular-nums">
                  par {amenity.default_par_level ?? 1} {amenity.unit_label ?? ""}
                </Badge>
              )}
            </div>
          </div>
          <Pencil
            size={14}
            className="text-muted-foreground/40 group-hover:text-primary transition-colors"
          />
        </div>
      </button>
    </AmenityFormDialog>
  );
}

function AmenityFormDialog({
  children,
  amenity,
  onCreated,
  onUpdated,
  onDeleted,
}: {
  children: React.ReactNode;
  amenity?: Amenity;
  onCreated?: (a: Amenity) => void;
  onUpdated?: (a: Amenity) => void;
  onDeleted?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isEdit = !!amenity;
  const [form, setForm] = useState<AmenityInput>({
    name: amenity?.name ?? "",
    category: amenity?.category ?? "Consumibles",
    icon: amenity?.icon ?? "📦",
    consumable: amenity?.consumable ?? true,
    unit_label: amenity?.unit_label ?? "unidades",
    default_par_level: amenity?.default_par_level ?? 1,
    notes: amenity?.notes ?? "",
  });

  function set<K extends keyof AmenityInput>(k: K, v: AmenityInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && amenity) {
          const updated = await updateAmenity(amenity.id, form);
          onUpdated?.(updated);
          toast.success("Item actualizado");
        } else {
          const created = await createAmenity(form);
          onCreated?.(created);
          toast.success("Item creado");
        }
        setOpen(false);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDelete() {
    if (!amenity) return;
    startTransition(async () => {
      try {
        await deleteAmenity(amenity.id);
        onDeleted?.(amenity.id);
        toast.success("Item eliminado");
        setOpen(false);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirmDelete(false);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar item" : "Nuevo item del catálogo"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input
              required
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Toallas, Café, Papel higiénico..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Icono</Label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => set("icon", icon)}
                  className={cn(
                    "size-9 rounded-lg border text-lg transition-all hover:bg-accent",
                    form.icon === icon
                      ? "ring-2 ring-primary border-primary scale-105"
                      : "border-border"
                  )}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.category ?? ""} onValueChange={(v) => set("category", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Consumibles">Consumibles</SelectItem>
                  <SelectItem value="Cocina">Cocina</SelectItem>
                  <SelectItem value="Baño">Baño</SelectItem>
                  <SelectItem value="Dormitorio">Dormitorio</SelectItem>
                  <SelectItem value="Climatización">Climatización</SelectItem>
                  <SelectItem value="Conectividad">Conectividad</SelectItem>
                  <SelectItem value="Edificio">Edificio</SelectItem>
                  <SelectItem value="Otros">Otros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad de medida</Label>
              <Input
                value={form.unit_label ?? ""}
                onChange={(e) => set("unit_label", e.target.value)}
                placeholder="unidades, rollos, sets..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Stock mínimo (par)</Label>
              <Input
                type="number"
                min={0}
                value={form.default_par_level ?? 1}
                onChange={(e) => set("default_par_level", Number(e.target.value))}
                disabled={!form.consumable}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 h-10 bg-muted/20">
              <Label htmlFor="consumable" className="cursor-pointer text-xs">
                Consumible
              </Label>
              <Switch
                id="consumable"
                checked={form.consumable}
                onCheckedChange={(v) => set("consumable", v)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit && !confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar
              </Button>
            )}
            {isEdit && confirmDelete && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-destructive">¿Confirmar?</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  Sí
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  No
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" size={14} />}
                {isEdit ? "Guardar" : "Crear"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ALERTS PANEL
// ════════════════════════════════════════════════════════════════════════════

function AlertsPanel({
  consumables,
  units,
  stockMap,
  onRestock,
}: {
  consumables: Amenity[];
  units: UnitLite[];
  stockMap: Map<string, UnitAmenity>;
  onRestock: (mov: InventoryMovement, amenity: Amenity, unit: UnitLite) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const lows = useMemo(() => {
    const out: { unit: UnitLite; amenity: Amenity; current: number; par: number }[] = [];
    consumables.forEach((a) => {
      units.forEach((u) => {
        const ua = stockMap.get(`${u.id}|${a.id}`);
        const current = ua?.current_quantity ?? 0;
        const par = ua?.par_level ?? a.default_par_level ?? 1;
        if (current < par) out.push({ unit: u, amenity: a, current, par });
      });
    });
    out.sort((a, b) => a.current - b.current || a.unit.code.localeCompare(b.unit.code));
    return out;
  }, [consumables, units, stockMap]);

  if (lows.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-12 text-center">
        <Check className="size-10 mx-auto text-emerald-500 mb-3" />
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          Todo en orden
        </p>
        <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1">
          No hay items por debajo del par level.
        </p>
      </div>
    );
  }

  function quickFill(item: typeof lows[number]) {
    startTransition(async () => {
      try {
        const delta = item.par - item.current;
        const mov = await recordMovement({
          unit_id: item.unit.id,
          amenity_id: item.amenity.id,
          movement_type: "restock",
          quantity_delta: delta,
        });
        onRestock(mov, item.amenity, item.unit);
        toast.success(`+${delta} en ${item.unit.code}`);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-amber-500/5 flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-500" />
        <span className="text-sm font-medium">{lows.length} ítems debajo del par</span>
      </div>
      <div className="divide-y">
        {lows.map(({ unit, amenity, current, par }) => {
          const isCritical = current === 0;
          return (
            <div
              key={`${unit.id}-${amenity.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <span className="text-xl shrink-0" aria-hidden>
                {amenity.icon ?? "📦"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{amenity.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {unit.code}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">{unit.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Stock {current} / par {par} {amenity.unit_label ?? ""}
                </div>
              </div>
              <div
                className={cn(
                  "text-xs font-medium tabular-nums px-2 py-1 rounded-md",
                  isCritical
                    ? "text-red-600 bg-red-500/10"
                    : "text-amber-600 bg-amber-500/10"
                )}
              >
                {isCritical ? "AGOTADO" : `faltan ${par - current}`}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => quickFill({ unit, amenity, current, par })}
              >
                <Sparkles size={13} /> Restock
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MOVEMENTS LOG
// ════════════════════════════════════════════════════════════════════════════

function MovementsLog({ movements }: { movements: MovementWithRefs[] }) {
  if (movements.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <History className="size-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">Sin movimientos</p>
        <p className="text-xs text-muted-foreground mt-1">
          Cuando hagas restock, consumo o ajustes, aparecerán acá.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="divide-y">
        {movements.map((m) => {
          const isPositive = m.quantity_delta > 0;
          const Icon =
            m.movement_type === "restock" || m.movement_type === "initial"
              ? TrendingUp
              : m.movement_type === "consume"
              ? TrendingDown
              : isPositive
              ? ArrowUp
              : ArrowDown;
          return (
            <div
              key={m.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <span
                className={cn(
                  "size-8 rounded-full flex items-center justify-center shrink-0",
                  isPositive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                <Icon size={14} />
              </span>
              <span className="text-lg shrink-0" aria-hidden>
                {m.amenity.icon ?? "📦"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{m.amenity.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {m.unit.code}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">{m.unit.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                  {labelMovement(m.movement_type)} · {formatTimeAgo(m.performed_at)}
                </div>
              </div>
              <div
                className={cn(
                  "font-bold tabular-nums text-sm",
                  isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {isPositive ? "+" : ""}
                {m.quantity_delta}
              </div>
              {m.quantity_after !== null && (
                <div className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                  → {m.quantity_after}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelMovement(t: string) {
  switch (t) {
    case "restock":
      return "Restock";
    case "consume":
      return "Consumo";
    case "adjust":
      return "Ajuste manual";
    case "initial":
      return "Inicial";
    default:
      return t;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BULK RESTOCK
// ════════════════════════════════════════════════════════════════════════════

function BulkRestockDialog({
  amenities,
  units,
  onDone,
}: {
  amenities: Amenity[];
  units: UnitLite[];
  onDone: (movs: InventoryMovement[], amenity: Amenity) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amenityId, setAmenityId] = useState<string>(amenities[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelected = selectedUnits.size === units.length && units.length > 0;

  function toggleAll() {
    if (allSelected) setSelectedUnits(new Set());
    else setSelectedUnits(new Set(units.map((u) => u.id)));
  }

  function toggle(id: string) {
    setSelectedUnits((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (!amenityId || selectedUnits.size === 0 || quantity <= 0) return;
    startTransition(async () => {
      try {
        const movs = await bulkRestock({
          unit_ids: Array.from(selectedUnits),
          amenity_id: amenityId,
          quantity,
        });
        const amenity = amenities.find((a) => a.id === amenityId);
        if (amenity) onDone(movs, amenity);
        toast.success(`Restock aplicado en ${selectedUnits.size} unidades`);
        setOpen(false);
        setSelectedUnits(new Set());
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
          <Sparkles size={13} /> Restock masivo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Restock masivo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select value={amenityId} onValueChange={setAmenityId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {amenities.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span>{a.icon ?? "📦"}</span>
                        {a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cantidad por unidad</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Unidades ({selectedUnits.size}/{units.length})</Label>
              <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
                {allSelected ? "Deseleccionar" : "Seleccionar todas"}
              </Button>
            </div>
            <div className="border rounded-lg max-h-[280px] overflow-auto p-1">
              {units.map((u) => {
                const checked = selectedUnits.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors",
                      checked ? "bg-primary/10" : "hover:bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "size-4 rounded border flex items-center justify-center shrink-0",
                        checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                      )}
                    >
                      {checked && <Check size={11} />}
                    </span>
                    <span className="font-mono text-xs font-medium">{u.code}</span>
                    <span className="text-muted-foreground truncate">{u.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || selectedUnits.size === 0 || !amenityId || quantity <= 0}
            onClick={handleSubmit}
          >
            {isPending && <Loader2 className="animate-spin" size={14} />}
            Aplicar a {selectedUnits.size} unidades
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
