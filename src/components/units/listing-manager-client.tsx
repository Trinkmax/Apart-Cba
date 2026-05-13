"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  AirVent,
  Accessibility,
  ArrowUpDown,
  Armchair,
  Baby,
  Bath,
  Bed,
  Building,
  Camera,
  Car,
  ChefHat,
  Check,
  CircleDashed,
  Coffee,
  DollarSign,
  Droplets,
  ExternalLink,
  Flame,
  Home,
  Image as ImageIcon,
  Info,
  Laptop,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Mountain,
  PawPrint,
  PlayCircle,
  Plus,
  Shield,
  Shirt,
  Siren,
  Smile,
  Sparkles,
  Star,
  TreePalm,
  Trees,
  Trash2,
  Tv,
  Upload,
  WashingMachine,
  Waves,
  Wifi,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LocationPicker } from "@/components/units/listing/location-picker";
import {
  updateListingBasics,
  updateListingLocation,
  setListingAmenities,
  setListingPublished,
  createPricingRule,
  togglePricingRule,
  deletePricingRule,
} from "@/lib/actions/listings";
import {
  deleteUnitPhoto,
  reorderUnitPhotos,
  setUnitPhotoCover,
  uploadUnitPhoto,
} from "@/lib/actions/unit-photos";
import type {
  MarketplaceAmenity,
  Unit,
  UnitPhoto,
  UnitPricingRule,
} from "@/lib/types/database";

type Props = {
  unit: Unit;
  photos: UnitPhoto[];
  amenityCodes: string[];
  rules: UnitPricingRule[];
  amenitiesCatalog: MarketplaceAmenity[];
  mapboxToken: string | null;
};

const TABS = [
  { id: "basics", label: "Listing", icon: Sparkles },
  { id: "photos", label: "Fotos", icon: ImageIcon },
  { id: "amenities", label: "Amenities", icon: Star },
  { id: "pricing", label: "Precios", icon: DollarSign },
  { id: "location", label: "Ubicación", icon: MapPin },
] as const;

export function ListingManagerClient(props: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("basics");
  const [published, setPublished] = useState(props.unit.marketplace_published);
  const [photos, setPhotos] = useState(props.photos);
  const [amenityCodes, setAmenityCodes] = useState(props.amenityCodes);
  const [unit, setUnit] = useState(props.unit);
  const [publishing, startPublish] = useTransition();

  const readiness = useMemo(
    () => computeReadiness(unit, photos),
    [unit, photos],
  );

  function handleTogglePublish() {
    const next = !published;
    startPublish(async () => {
      try {
        await setListingPublished(props.unit.id, next);
        setPublished(next);
        toast.success(
          next ? "¡Publicada en el marketplace!" : "Listing despublicado",
          {
            description: next ? "Los huéspedes ya la pueden ver." : undefined,
          },
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo actualizar");
      }
    });
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <ListingStatus
          published={published}
          publishing={publishing}
          readiness={readiness}
          slug={unit.slug}
          onTogglePublish={handleTogglePublish}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="border-b border-border">
            <TabsList className="bg-transparent rounded-none h-auto p-0 gap-1 w-full justify-start overflow-x-auto">
              {TABS.map((t) => {
                const ok = readiness.tabs[t.id];
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="relative h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground hover:text-foreground gap-2 px-4 transition-colors"
                  >
                    <t.icon size={15} />
                    {t.label}
                    {ok ? (
                      <span className="inline-flex size-1.5 rounded-full bg-emerald-500" />
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <TabsContent value="basics" className="mt-6 focus-visible:outline-none">
            <BasicsTab unit={unit} onUpdated={setUnit} />
          </TabsContent>
          <TabsContent value="photos" className="mt-6 focus-visible:outline-none">
            <PhotosTab
              unitId={unit.id}
              photos={photos}
              onPhotosChange={setPhotos}
            />
          </TabsContent>
          <TabsContent value="amenities" className="mt-6 focus-visible:outline-none">
            <AmenitiesTab
              unitId={unit.id}
              initialCodes={amenityCodes}
              catalog={props.amenitiesCatalog}
              onChange={setAmenityCodes}
            />
          </TabsContent>
          <TabsContent value="pricing" className="mt-6 focus-visible:outline-none">
            <PricingTab
              unitId={unit.id}
              basePrice={Number(unit.base_price ?? 0)}
              currency={unit.marketplace_currency ?? "ARS"}
              initialRules={props.rules}
            />
          </TabsContent>
          <TabsContent value="location" className="mt-6 focus-visible:outline-none">
            <LocationPicker
              mapboxToken={props.mapboxToken}
              initial={{
                address: unit.address ?? "",
                neighborhood: unit.neighborhood ?? "",
                latitude: unit.latitude ?? null,
                longitude: unit.longitude ?? null,
              }}
              onSave={async (v) => {
                await updateListingLocation({
                  unit_id: unit.id,
                  address: v.address || null,
                  neighborhood: v.neighborhood || null,
                  latitude: v.latitude,
                  longitude: v.longitude,
                });
                setUnit({
                  ...unit,
                  address: v.address,
                  neighborhood: v.neighborhood,
                  latitude: v.latitude,
                  longitude: v.longitude,
                });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ─── Header / Status ─────────────────────────────────────────────────────────

type Readiness = {
  ok: boolean;
  done: number;
  total: number;
  checks: Array<{ id: string; label: string; ok: boolean }>;
  tabs: Record<string, boolean>;
};

function computeReadiness(unit: Unit, photos: UnitPhoto[]): Readiness {
  const hasTitle = Boolean(unit.marketplace_title?.trim());
  const hasDescription = Boolean(
    unit.marketplace_description &&
      unit.marketplace_description.trim().length >= 40,
  );
  const hasPrice = !!unit.base_price && Number(unit.base_price) > 0;
  const hasPhoto = photos.length > 0;
  const hasLocation =
    unit.latitude !== null && unit.longitude !== null && Boolean(unit.address);

  const checks = [
    { id: "title", label: "Título y descripción", ok: hasTitle && hasDescription },
    { id: "photo", label: "Al menos 1 foto", ok: hasPhoto },
    { id: "price", label: "Precio base", ok: hasPrice },
    { id: "location", label: "Ubicación marcada", ok: hasLocation },
  ];
  const done = checks.filter((c) => c.ok).length;
  const blockingOk = hasTitle && hasDescription && hasPrice && hasPhoto;

  return {
    ok: blockingOk,
    done,
    total: checks.length,
    checks,
    tabs: {
      basics: hasTitle && hasDescription,
      photos: hasPhoto,
      amenities: true,
      pricing: hasPrice,
      location: hasLocation,
    },
  };
}

function ListingStatus({
  published,
  publishing,
  readiness,
  slug,
  onTogglePublish,
}: {
  published: boolean;
  publishing: boolean;
  readiness: Readiness;
  slug: string | null;
  onTogglePublish: () => void;
}) {
  const pct = Math.round((readiness.done / readiness.total) * 100);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 md:p-6 shadow-sm dark:shadow-none",
        published
          ? "border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-card dark:border-emerald-900/40 dark:from-emerald-950/40 dark:to-white/[0.03]"
          : "border-border dark:border-white/[0.07] bg-gradient-to-br from-sage-50/60 to-card dark:from-white/[0.04] dark:to-white/[0.015]",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Estado del listing
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span
              className={cn(
                "relative flex h-2.5 w-2.5",
                published ? "" : "",
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-full",
                  published
                    ? "bg-emerald-500 animate-ping opacity-60"
                    : "bg-muted-foreground/30",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex rounded-full h-2.5 w-2.5",
                  published ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
            </span>
            <span className="text-lg font-semibold text-foreground">
              {published ? "Publicada en el marketplace" : "Borrador / no publicada"}
            </span>
          </div>
          {published && slug ? (
            <a
              href={`/u/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              Ver en el marketplace
              <ExternalLink size={11} />
            </a>
          ) : null}
        </div>

        {/* Readiness pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {readiness.checks.map((c) => (
            <div
              key={c.id}
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors",
                c.ok
                  ? "border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900/40 dark:text-emerald-400"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {c.ok ? (
                <Check size={11} strokeWidth={3} />
              ) : (
                <CircleDashed size={11} />
              )}
              {c.label}
            </div>
          ))}
        </div>

        {/* Publish toggle */}
        <div className="flex items-center gap-3 md:pl-5 md:border-l md:border-border md:self-stretch md:py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Switch
                  checked={published}
                  disabled={publishing || (!readiness.ok && !published)}
                  onCheckedChange={onTogglePublish}
                  aria-label={published ? "Despublicar" : "Publicar"}
                />
              </span>
            </TooltipTrigger>
            {!readiness.ok && !published ? (
              <TooltipContent side="left" className="max-w-xs">
                Completá los datos esenciales (título, descripción, precio y al menos una foto) para poder publicar.
              </TooltipContent>
            ) : null}
          </Tooltip>
          <div className="hidden md:block">
            <div className="text-sm font-medium text-foreground">
              {published ? "Publicada" : "Publicar"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {readiness.done}/{readiness.total} listos · {pct}%
            </div>
          </div>
        </div>
      </div>

      {/* Subtle progress bar */}
      <div className="mt-4 h-1 w-full rounded-full bg-border/60 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            readiness.ok ? "bg-emerald-500" : "bg-primary/70",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Basics Tab ──────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  { value: "apartamento", label: "Departamento" },
  { value: "casa", label: "Casa" },
  { value: "loft", label: "Loft" },
  { value: "estudio", label: "Estudio" },
  { value: "habitacion", label: "Habitación" },
  { value: "duplex", label: "Dúplex" },
  { value: "ph", label: "PH" },
  { value: "cabana", label: "Cabaña" },
] as const;

const CANCELLATION_POLICIES = [
  {
    value: "flexible",
    title: "Flexible",
    description: "Cancelación gratis hasta 24h antes",
  },
  {
    value: "moderada",
    title: "Moderada",
    description: "Gratis hasta 5 días antes, después 50%",
  },
  {
    value: "estricta",
    title: "Estricta",
    description: "Cargo total al cancelar",
  },
] as const;

function BasicsTab({
  unit,
  onUpdated,
}: {
  unit: Unit;
  onUpdated: (u: Unit) => void;
}) {
  const [pending, startTransition] = useTransition();
  const initialForm = useMemo(
    () => ({
      marketplace_title: unit.marketplace_title ?? unit.name ?? "",
      marketplace_description:
        unit.marketplace_description ?? unit.description ?? "",
      marketplace_property_type: (unit.marketplace_property_type ??
        "apartamento") as (typeof PROPERTY_TYPES)[number]["value"],
      bedrooms: unit.bedrooms ?? 1,
      bathrooms: unit.bathrooms ?? 1,
      max_guests: unit.max_guests ?? 2,
      size_m2: unit.size_m2 ?? null,
      base_price: Number(unit.base_price ?? 0),
      marketplace_currency: (unit.marketplace_currency ?? "ARS") as
        | "ARS"
        | "USD",
      cleaning_fee: unit.cleaning_fee ?? null,
      min_nights: unit.min_nights ?? 1,
      max_nights: unit.max_nights ?? null,
      cancellation_policy: (unit.cancellation_policy ?? "flexible") as
        | "flexible"
        | "moderada"
        | "estricta",
      house_rules: unit.house_rules ?? "",
      check_in_window_start: unit.check_in_window_start ?? "15:00",
      check_in_window_end: unit.check_in_window_end ?? "22:00",
      instant_book: unit.instant_book,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [form, setForm] = useState(initialForm);
  const [savedSnapshot, setSavedSnapshot] = useState(initialForm);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedSnapshot),
    [form, savedSnapshot],
  );

  const titleCount = form.marketplace_title.length;
  const descCount = form.marketplace_description.length;

  function handleSave() {
    startTransition(async () => {
      try {
        const r = await updateListingBasics({
          unit_id: unit.id,
          ...form,
        });
        setSavedSnapshot(form);
        onUpdated({
          ...unit,
          marketplace_title: form.marketplace_title,
          marketplace_description: form.marketplace_description,
          marketplace_property_type: form.marketplace_property_type,
          bedrooms: form.bedrooms,
          bathrooms: form.bathrooms,
          max_guests: form.max_guests,
          size_m2: form.size_m2,
          base_price: form.base_price,
          marketplace_currency: form.marketplace_currency,
          cleaning_fee: form.cleaning_fee,
          min_nights: form.min_nights,
          max_nights: form.max_nights,
          cancellation_policy: form.cancellation_policy,
          house_rules: form.house_rules,
          check_in_window_start: form.check_in_window_start,
          check_in_window_end: form.check_in_window_end,
          instant_book: form.instant_book,
          slug: r.slug ?? unit.slug,
        });
        toast.success("Listing actualizado", {
          description: r.slug ? `URL pública: /u/${r.slug}` : undefined,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <div className="space-y-8 pb-24">
      {/* Identidad pública */}
      <Section
        title="Identidad pública"
        hint="Lo primero que ve un huésped en el marketplace."
      >
        <FieldShell>
          <Label>Título</Label>
          <div className="relative">
            <input
              value={form.marketplace_title}
              onChange={(e) =>
                setForm({ ...form, marketplace_title: e.target.value })
              }
              className={inputCls}
              placeholder="Loft luminoso en Güemes con balcón y vista"
              maxLength={120}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums">
              {titleCount}/120
            </span>
          </div>
          <Hint>Sé específico — los títulos memorables generan más clicks.</Hint>
        </FieldShell>

        <FieldShell>
          <Label>Descripción</Label>
          <div className="relative">
            <textarea
              rows={7}
              value={form.marketplace_description}
              onChange={(e) =>
                setForm({ ...form, marketplace_description: e.target.value })
              }
              className={cn(textareaCls)}
              placeholder="Loft de diseño en el corazón de Güemes. A metros de los cafés y restaurantes más cool de Córdoba. Equipado con todo lo necesario para una estadía perfecta..."
              maxLength={4000}
            />
            <span className="absolute right-3 bottom-3 text-[11px] text-muted-foreground tabular-nums bg-card px-1 rounded">
              {descCount}/4000
            </span>
          </div>
          <Hint>
            {descCount < 40
              ? `Te faltan ${40 - descCount} caracteres mínimos.`
              : "Contá la zona, el ambiente y los detalles que lo hacen especial."}
          </Hint>
        </FieldShell>
      </Section>

      {/* Tipo y capacidad */}
      <Section title="Tipo y capacidad">
        <FieldShell>
          <Label>Tipo de propiedad</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PROPERTY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() =>
                  setForm({ ...form, marketplace_property_type: t.value })
                }
                className={cn(
                  "h-10 px-3 rounded-xl border text-sm font-medium transition-all",
                  form.marketplace_property_type === t.value
                    ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/20"
                    : "border-border bg-background dark:bg-white/[0.02] dark:border-white/[0.06] hover:border-foreground/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </FieldShell>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stepper
            icon={<UserGroupIcon />}
            label="Huéspedes"
            value={form.max_guests}
            onChange={(v) => setForm({ ...form, max_guests: v })}
            min={1}
            max={30}
          />
          <Stepper
            icon={<Bed size={16} className="text-muted-foreground" />}
            label="Ambientes"
            value={form.bedrooms}
            onChange={(v) => setForm({ ...form, bedrooms: v })}
            min={0}
            max={20}
          />
          <Stepper
            icon={<Bath size={16} className="text-muted-foreground" />}
            label="Baños"
            value={form.bathrooms}
            onChange={(v) => setForm({ ...form, bathrooms: v })}
            min={0}
            max={20}
          />
        </div>

        <FieldShell>
          <Label>Superficie (m²)</Label>
          <div className="relative">
            <input
              type="number"
              value={form.size_m2 ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  size_m2: e.target.value ? Number(e.target.value) : null,
                })
              }
              className={inputCls}
              min={0}
              step="0.1"
              placeholder="opcional"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              m²
            </span>
          </div>
        </FieldShell>
      </Section>

      {/* Precios */}
      <Section title="Precios">
        <FieldShell>
          <Label>Moneda</Label>
          <SegmentedControl
            value={form.marketplace_currency}
            onChange={(v) =>
              setForm({ ...form, marketplace_currency: v as "ARS" | "USD" })
            }
            options={[
              { value: "ARS", label: "Pesos · ARS" },
              { value: "USD", label: "Dólares · USD" },
            ]}
          />
        </FieldShell>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell>
            <Label>Precio base por noche</Label>
            <CurrencyInput
              currency={form.marketplace_currency}
              value={form.base_price}
              onChange={(v) => setForm({ ...form, base_price: v })}
            />
            <Hint>Lo que se cobra por noche en temporada normal.</Hint>
          </FieldShell>
          <FieldShell>
            <Label>Tarifa de limpieza</Label>
            <CurrencyInput
              currency={form.marketplace_currency}
              value={form.cleaning_fee ?? 0}
              onChange={(v) => setForm({ ...form, cleaning_fee: v })}
              placeholder="Sin tarifa"
            />
            <Hint>Cargo único por reserva. Dejá en 0 para no cobrarla.</Hint>
          </FieldShell>
        </div>
      </Section>

      {/* Estadía */}
      <Section title="Estadía y reglas">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldShell>
            <Label>Mínimo de noches</Label>
            <input
              type="number"
              value={form.min_nights}
              onChange={(e) =>
                setForm({
                  ...form,
                  min_nights: parseInt(e.target.value, 10) || 1,
                })
              }
              className={inputCls}
              min={1}
            />
          </FieldShell>
          <FieldShell>
            <Label>Máximo de noches</Label>
            <input
              type="number"
              value={form.max_nights ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_nights: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                })
              }
              className={inputCls}
              min={1}
              placeholder="Sin límite"
            />
          </FieldShell>
          <FieldShell>
            <Label>Check-in desde</Label>
            <input
              type="time"
              value={form.check_in_window_start}
              onChange={(e) =>
                setForm({ ...form, check_in_window_start: e.target.value })
              }
              className={inputCls}
            />
          </FieldShell>
          <FieldShell>
            <Label>Check-in hasta</Label>
            <input
              type="time"
              value={form.check_in_window_end}
              onChange={(e) =>
                setForm({ ...form, check_in_window_end: e.target.value })
              }
              className={inputCls}
            />
          </FieldShell>
        </div>

        <FieldShell>
          <Label>Política de cancelación</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {CANCELLATION_POLICIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() =>
                  setForm({ ...form, cancellation_policy: p.value })
                }
                className={cn(
                  "text-left p-3.5 rounded-xl border transition-all",
                  form.cancellation_policy === p.value
                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                    : "border-border bg-background dark:bg-white/[0.02] dark:border-white/[0.06] hover:border-foreground/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "size-4 rounded-full border-2 grid place-items-center transition-colors",
                      form.cancellation_policy === p.value
                        ? "border-primary"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {form.cancellation_policy === p.value ? (
                      <span className="size-2 rounded-full bg-primary" />
                    ) : null}
                  </div>
                  <span className="font-medium text-sm text-foreground">
                    {p.title}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                  {p.description}
                </p>
              </button>
            ))}
          </div>
        </FieldShell>

        <FieldShell>
          <Label>Reglas de la casa</Label>
          <textarea
            rows={3}
            value={form.house_rules ?? ""}
            onChange={(e) => setForm({ ...form, house_rules: e.target.value })}
            className={textareaCls}
            placeholder="No se permiten mascotas. No fumar. Silencio después de las 22hs."
          />
        </FieldShell>

        <label className="flex items-start gap-4 rounded-2xl border border-border bg-background dark:bg-white/[0.02] dark:border-white/[0.06] p-4 cursor-pointer hover:border-foreground/30 transition-colors">
          <div className="mt-0.5 size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
            <Zap size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 font-medium text-sm text-foreground">
              Reserva al toque
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                +70% conv.
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Los huéspedes confirman al instante, sin tu aprobación manual. Aumenta la conversión y rankea mejor en el marketplace.
            </p>
          </div>
          <Switch
            checked={form.instant_book}
            onCheckedChange={(c) => setForm({ ...form, instant_book: c })}
          />
        </label>
      </Section>

      {/* Sticky save bar */}
      <div
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-30 transition-all duration-300",
          dirty
            ? "translate-y-0 opacity-100"
            : "translate-y-20 opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3 rounded-full border border-border bg-background/95 backdrop-blur-md shadow-xl px-3 py-2">
          <span className="pl-3 text-sm text-muted-foreground flex items-center gap-2">
            <Info size={14} />
            Tenés cambios sin guardar
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setForm(savedSnapshot)}
          >
            Descartar
          </Button>
          <Button onClick={handleSave} disabled={pending} size="sm">
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Photos Tab ──────────────────────────────────────────────────────────────

function PhotosTab({
  unitId,
  photos,
  onPhotosChange,
}: {
  unitId: string;
  photos: UnitPhoto[];
  onPhotosChange: (next: UnitPhoto[]) => void;
}) {
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(arr.length);
    let success = 0;
    let current = [...photos];
    for (const file of arr) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`"${file.name}" supera los 10 MB`);
        setUploading((u) => u - 1);
        continue;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`"${file.name}" no es JPG/PNG/WEBP`);
        setUploading((u) => u - 1);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const base64 = bufferToBase64(buffer);
        const r = await uploadUnitPhoto({
          unit_id: unitId,
          file_name: file.name,
          content_type: file.type as "image/jpeg" | "image/png" | "image/webp",
          base64_data: base64,
        });
        if (r.ok && r.photo) {
          current = [...current, r.photo as UnitPhoto];
          onPhotosChange(current);
          success += 1;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al subir");
      } finally {
        setUploading((u) => u - 1);
      }
    }
    if (success > 0) {
      toast.success(
        success === 1 ? "Foto subida" : `${success} fotos subidas`,
      );
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Borrar esta foto?")) return;
    try {
      await deleteUnitPhoto(id);
      onPhotosChange(photos.filter((x) => x.id !== id));
      toast.success("Foto eliminada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  async function handleSetCover(id: string) {
    try {
      await setUnitPhotoCover(id);
      onPhotosChange(
        photos.map((x) => ({ ...x, is_cover: x.id === id })),
      );
      toast.success("Foto de portada actualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = photos.findIndex((p) => p.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= photos.length) return;
    const next = [...photos];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onPhotosChange(next);
    try {
      await reorderUnitPhotos(unitId, next.map((p) => p.id));
    } catch {
      toast.error("No se pudo reordenar");
      onPhotosChange(photos);
    }
  }

  const isUploading = uploading > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg text-foreground">Galería</h3>
          <p className="text-sm text-muted-foreground">
            {photos.length === 0
              ? "Subí al menos una foto. La primera será la portada."
              : `${photos.length} ${photos.length === 1 ? "foto" : "fotos"} · la portada aparece primero en las cards.`}
          </p>
        </div>
        <label className="inline-flex">
          <Button asChild>
            <span className="cursor-pointer">
              {isUploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              {isUploading ? `Subiendo ${uploading}…` : "Subir fotos"}
            </span>
          </Button>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
            multiple
            className="hidden"
            disabled={isUploading}
          />
        </label>
      </div>

      {/* Dropzone (when empty or as add tile) */}
      {photos.length === 0 ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) {
              uploadFiles(e.dataTransfer.files);
            }
          }}
          className={cn(
            "block rounded-2xl border-2 border-dashed p-12 sm:p-16 text-center cursor-pointer transition-all",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-foreground/40 bg-card/40",
          )}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
            multiple
            className="hidden"
          />
          <div className="size-14 rounded-2xl bg-muted grid place-items-center mx-auto mb-4">
            <Upload size={22} className="text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">
            Arrastrá tus fotos acá
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            o tocá para elegirlas. JPG, PNG o WEBP · hasta 10 MB cada una.
          </p>
        </label>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {photos.map((p, idx) => (
            <PhotoCard
              key={p.id}
              photo={p}
              isFirst={idx === 0}
              isLast={idx === photos.length - 1}
              onSetCover={() => handleSetCover(p.id)}
              onDelete={() => handleDelete(p.id)}
              onMoveUp={() => move(p.id, -1)}
              onMoveDown={() => move(p.id, 1)}
            />
          ))}
          {/* Add tile */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) {
                uploadFiles(e.dataTransfer.files);
              }
            }}
            className={cn(
              "aspect-[4/3] rounded-xl border-2 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground",
              dragOver
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:border-foreground/40 bg-card/40",
            )}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = "";
              }}
              multiple
              className="hidden"
            />
            <Plus size={22} />
            <span className="text-xs font-medium">Agregar más</span>
          </label>
        </div>
      )}
    </div>
  );
}

function PhotoCard({
  photo,
  isFirst,
  isLast,
  onSetCover,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  photo: UnitPhoto;
  isFirst: boolean;
  isLast: boolean;
  onSetCover: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="relative group">
      <div className="aspect-[4/3] relative rounded-xl overflow-hidden border border-border bg-muted">
        <Image
          src={photo.public_url}
          alt={photo.alt_text ?? ""}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 33vw"
        />
        {photo.is_cover ? (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-background/95 backdrop-blur text-xs font-medium px-2.5 py-1 rounded-full shadow-sm border border-border">
            <Star size={11} className="fill-amber-500 stroke-amber-500" />
            Portada
          </div>
        ) : null}

        {/* Hover controls */}
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1">
            <IconBtn
              label="Mover arriba"
              disabled={isFirst}
              onClick={onMoveUp}
            >
              <Minus size={13} className="rotate-90" />
            </IconBtn>
            <IconBtn
              label="Mover abajo"
              disabled={isLast}
              onClick={onMoveDown}
            >
              <Minus size={13} className="-rotate-90" />
            </IconBtn>
          </div>
          <div className="flex gap-1">
            {!photo.is_cover ? (
              <IconBtn label="Hacer portada" onClick={onSetCover}>
                <Star size={13} />
              </IconBtn>
            ) : null}
            <IconBtn label="Borrar" onClick={onDelete} destructive>
              <Trash2 size={13} />
            </IconBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "size-8 grid place-items-center rounded-full bg-background/95 backdrop-blur border border-border shadow-sm transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100",
            destructive && "hover:bg-destructive hover:text-white hover:border-destructive",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── Amenities Tab ───────────────────────────────────────────────────────────

const AMENITY_ICONS: Record<string, LucideIcon> = {
  Accessibility,
  Home,
  Car,
  ArrowUpDown,
  TreePalm,
  Laptop,
  Wind,
  Shirt,
  Coffee,
  Wifi,
  AirVent,
  Flame,
  ChefHat,
  WashingMachine,
  Droplets,
  Tv,
  PlayCircle,
  Bed,
  Sparkles,
  Waves,
  Bath,
  Trees,
  Building,
  Mountain,
  PawPrint,
  Baby,
  Smile,
  Armchair,
  Siren,
  Lock,
  Camera,
  Shield,
};

const CATEGORY_LABELS: Record<string, string> = {
  esencial: "Lo esencial",
  comodidad: "Comodidad",
  exterior: "Exterior",
  familia: "Familia",
  seguridad: "Seguridad",
  accesibilidad: "Accesibilidad",
};

function AmenitiesTab({
  unitId,
  initialCodes,
  catalog,
  onChange,
}: {
  unitId: string;
  initialCodes: string[];
  catalog: MarketplaceAmenity[];
  onChange: (codes: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialCodes),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const initialRef = useRef(new Set(initialCodes));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const grouped = useMemo(() => {
    const groups: Record<string, MarketplaceAmenity[]> = {};
    for (const a of catalog) {
      groups[a.category] = groups[a.category] ?? [];
      groups[a.category].push(a);
    }
    return groups;
  }, [catalog]);

  // Auto-save with debounce
  useEffect(() => {
    const current = Array.from(selected).sort();
    const initial = Array.from(initialRef.current).sort();
    if (JSON.stringify(current) === JSON.stringify(initial)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await setListingAmenities(unitId, current);
        initialRef.current = new Set(current);
        setSavedAt(Date.now());
        onChange(current);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [selected, unitId, onChange]);

  function toggle(code: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Marcá todo lo que ofrecés en tu unidad. Los huéspedes filtran por estas opciones cuando buscan.
        </p>
        <SaveIndicator saving={saving} savedAt={savedAt} />
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const count = items.filter((i) => selected.has(i.code)).length;
        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <h4 className="font-semibold text-sm text-foreground uppercase tracking-wider">
                {CATEGORY_LABELS[category] ?? category}
              </h4>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {count}/{items.length}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {items.map((a) => {
                const Icon = (a.icon && AMENITY_ICONS[a.icon]) || Sparkles;
                const isSelected = selected.has(a.code);
                return (
                  <button
                    key={a.code}
                    type="button"
                    onClick={() => toggle(a.code)}
                    className={cn(
                      "group flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all",
                      isSelected
                        ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                        : "border-border bg-card dark:bg-white/[0.03] dark:border-white/[0.07] hover:border-foreground/40",
                    )}
                  >
                    <div
                      className={cn(
                        "size-9 rounded-lg grid place-items-center shrink-0 transition-colors",
                        isSelected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon size={16} />
                    </div>
                    <span
                      className={cn(
                        "text-sm flex-1 min-w-0 truncate",
                        isSelected
                          ? "text-foreground font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      {a.name}
                    </span>
                    {isSelected ? (
                      <Check
                        size={14}
                        className="text-primary shrink-0"
                        strokeWidth={3}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SaveIndicator({
  saving,
  savedAt,
}: {
  saving: boolean;
  savedAt: number | null;
}) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        Guardando…
      </span>
    );
  }
  if (savedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check size={12} strokeWidth={3} />
        Guardado
      </span>
    );
  }
  return null;
}

// ─── Pricing Tab ─────────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const DAY_SHORT = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];

function PricingTab({
  unitId,
  basePrice,
  currency,
  initialRules,
}: {
  unitId: string;
  basePrice: number;
  currency: string;
  initialRules: UnitPricingRule[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [open, setOpen] = useState(false);

  async function toggleActive(id: string, active: boolean) {
    try {
      await togglePricingRule(id, active);
      setRules((p) => p.map((r) => (r.id === id ? { ...r, active } : r)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar esta regla?")) return;
    try {
      await deletePricingRule(id);
      setRules((p) => p.filter((r) => r.id !== id));
      toast.success("Regla eliminada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Base price summary */}
      <div className="rounded-2xl border border-border dark:border-white/[0.07] bg-gradient-to-br from-sage-50/60 to-card dark:from-white/[0.05] dark:to-white/[0.015] shadow-sm dark:shadow-none p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Precio base
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-foreground">
              {currency} {basePrice.toLocaleString("es-AR")}
            </span>
            <span className="text-sm text-muted-foreground">/ noche</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground max-w-xs sm:text-right leading-relaxed">
          Editá el precio base desde la pestaña <strong className="text-foreground">Listing</strong>.<br />
          Las reglas de abajo lo modifican en fechas o días específicos.
        </p>
      </div>

      {/* Rules header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Reglas dinámicas</h3>
          <p className="text-sm text-muted-foreground">
            Cobrá más en alta temporada o aplicá descuentos en días puntuales.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={14} />
          Nueva regla
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 sm:p-14 text-center">
          <div className="size-12 rounded-2xl bg-muted grid place-items-center mx-auto mb-3">
            <DollarSign size={20} className="text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">Sin reglas todavía</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            El precio base se aplica todos los días. Creá una regla para subir precios en feriados, finde o temporada alta.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <PricingRuleCard
              key={r.id}
              rule={r}
              basePrice={basePrice}
              currency={currency}
              onToggle={(active) => toggleActive(r.id, active)}
              onDelete={() => remove(r.id)}
            />
          ))}
        </div>
      )}

      <NewRuleDialog
        open={open}
        onClose={() => setOpen(false)}
        unitId={unitId}
        basePrice={basePrice}
        currency={currency}
        onCreated={(rule) => {
          setRules((p) => [rule, ...p]);
          setOpen(false);
        }}
      />
    </div>
  );
}

function PricingRuleCard({
  rule,
  basePrice,
  currency,
  onToggle,
  onDelete,
}: {
  rule: UnitPricingRule;
  basePrice: number;
  currency: string;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
}) {
  const effective = rule.price_override
    ? Number(rule.price_override)
    : basePrice * Number(rule.price_multiplier ?? 1);
  const delta = effective - basePrice;
  const deltaPct = basePrice > 0 ? Math.round((delta / basePrice) * 100) : 0;

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 rounded-2xl border bg-card dark:bg-white/[0.025] dark:border-white/[0.07] shadow-sm dark:shadow-none transition-opacity",
        rule.active ? "border-border" : "border-border opacity-60",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium text-foreground truncate">{rule.name}</div>
          <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            P{rule.priority}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {rule.rule_type === "date_range" ? (
            <>
              <span className="tabular-nums">{rule.start_date}</span> →{" "}
              <span className="tabular-nums">{rule.end_date}</span>
            </>
          ) : (
            <>
              {rule.days_of_week?.map((d) => DAY_NAMES[d]).join(", ")}
            </>
          )}
        </div>
      </div>

      <div className="hidden sm:block text-right">
        <div className="text-base font-semibold tabular-nums text-foreground">
          {currency} {Math.round(effective).toLocaleString("es-AR")}
        </div>
        <div
          className={cn(
            "text-[11px] tabular-nums",
            delta > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : delta < 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          {delta > 0 ? "+" : ""}
          {deltaPct}% vs base
        </div>
      </div>

      <Switch
        checked={rule.active}
        onCheckedChange={onToggle}
        aria-label="Activar regla"
      />
      <button
        onClick={onDelete}
        className="size-8 grid place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
        aria-label="Borrar regla"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function NewRuleDialog({
  open,
  onClose,
  unitId,
  basePrice,
  currency,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  unitId: string;
  basePrice: number;
  currency: string;
  onCreated: (rule: UnitPricingRule) => void;
}) {
  const [draft, setDraft] = useState({
    name: "",
    rule_type: "date_range" as "date_range" | "weekday",
    start_date: "",
    end_date: "",
    days_of_week: [] as number[],
    price_mode: "multiplier" as "multiplier" | "override",
    price_multiplier: "1.5",
    price_override: "",
    priority: 10,
  });
  const [pending, startTransition] = useTransition();

  function reset() {
    setDraft({
      name: "",
      rule_type: "date_range",
      start_date: "",
      end_date: "",
      days_of_week: [],
      price_mode: "multiplier",
      price_multiplier: "1.5",
      price_override: "",
      priority: 10,
    });
  }

  function handleCreate() {
    if (!draft.name.trim()) {
      toast.error("Dale un nombre a la regla");
      return;
    }
    startTransition(async () => {
      try {
        const r = await createPricingRule({
          unit_id: unitId,
          name: draft.name,
          rule_type: draft.rule_type,
          start_date: draft.start_date || null,
          end_date: draft.end_date || null,
          days_of_week:
            draft.days_of_week.length > 0 ? draft.days_of_week : null,
          price_multiplier:
            draft.price_mode === "multiplier"
              ? Number(draft.price_multiplier)
              : null,
          price_override:
            draft.price_mode === "override"
              ? Number(draft.price_override)
              : null,
          priority: draft.priority,
        });
        if (r.ok && r.rule) {
          toast.success("Regla creada");
          onCreated(r.rule as UnitPricingRule);
          reset();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  }

  const preview = useMemo(() => {
    if (draft.price_mode === "override") {
      return Number(draft.price_override) || 0;
    }
    return basePrice * (Number(draft.price_multiplier) || 1);
  }, [draft.price_mode, draft.price_override, draft.price_multiplier, basePrice]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva regla de precio</DialogTitle>
          <DialogDescription>
            Subí o bajá el precio en fechas o días específicos. Las reglas de mayor prioridad ganan si solapan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FieldShell>
            <Label>Nombre</Label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputCls}
              placeholder="Alta temporada verano, Feriados, Finde largo…"
              autoFocus
            />
          </FieldShell>

          <FieldShell>
            <Label>Aplicar a</Label>
            <SegmentedControl
              value={draft.rule_type}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  rule_type: v as "date_range" | "weekday",
                })
              }
              options={[
                { value: "date_range", label: "Rango de fechas" },
                { value: "weekday", label: "Días de semana" },
              ]}
            />
          </FieldShell>

          {draft.rule_type === "date_range" ? (
            <div className="grid grid-cols-2 gap-3">
              <FieldShell>
                <Label>Desde</Label>
                <input
                  type="date"
                  value={draft.start_date}
                  onChange={(e) =>
                    setDraft({ ...draft, start_date: e.target.value })
                  }
                  className={inputCls}
                />
              </FieldShell>
              <FieldShell>
                <Label>Hasta</Label>
                <input
                  type="date"
                  value={draft.end_date}
                  onChange={(e) =>
                    setDraft({ ...draft, end_date: e.target.value })
                  }
                  className={inputCls}
                />
              </FieldShell>
            </div>
          ) : (
            <FieldShell>
              <Label>Días</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_SHORT.map((d, i) => {
                  const sel = draft.days_of_week.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        const next = sel
                          ? draft.days_of_week.filter((x) => x !== i)
                          : [...draft.days_of_week, i];
                        setDraft({ ...draft, days_of_week: next });
                      }}
                      className={cn(
                        "size-10 rounded-full text-xs font-medium border transition-all",
                        sel
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-foreground/40 text-muted-foreground",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </FieldShell>
          )}

          <FieldShell>
            <Label>Precio</Label>
            <SegmentedControl
              value={draft.price_mode}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  price_mode: v as "multiplier" | "override",
                })
              }
              options={[
                { value: "multiplier", label: "Multiplicador" },
                { value: "override", label: "Precio fijo" },
              ]}
            />
            <div className="mt-3">
              {draft.price_mode === "multiplier" ? (
                <div className="relative">
                  <input
                    type="number"
                    step="0.05"
                    value={draft.price_multiplier}
                    onChange={(e) =>
                      setDraft({ ...draft, price_multiplier: e.target.value })
                    }
                    className={inputCls}
                    placeholder="1.5"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    × precio base
                  </span>
                </div>
              ) : (
                <CurrencyInput
                  currency={currency}
                  value={Number(draft.price_override) || 0}
                  onChange={(v) =>
                    setDraft({ ...draft, price_override: String(v) })
                  }
                  placeholder={String(basePrice * 2)}
                />
              )}
            </div>

            {/* Preview */}
            <div className="mt-3 p-3 rounded-xl bg-muted/50 border border-border">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Precio resultante
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {currency} {Math.round(preview).toLocaleString("es-AR")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  / noche
                </span>
              </div>
            </div>
          </FieldShell>

          <FieldShell>
            <Label>Prioridad</Label>
            <input
              type="number"
              value={draft.priority}
              onChange={(e) =>
                setDraft({ ...draft, priority: Number(e.target.value) })
              }
              className={inputCls}
              min={0}
              max={100}
            />
            <Hint>Gana la regla de mayor prioridad si dos reglas aplican al mismo día.</Hint>
          </FieldShell>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={pending}>
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Crear regla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const inputCls =
  "w-full h-11 px-3.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition";

const textareaCls =
  "w-full px-3.5 py-3 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition resize-y min-h-[120px]";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3 px-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <div className="rounded-2xl border border-border bg-card dark:bg-white/[0.025] dark:border-white/[0.07] shadow-sm dark:shadow-none p-5 sm:p-6 space-y-5">
        {children}
      </div>
    </section>
  );
}

function FieldShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium text-foreground/80">{children}</div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

function Stepper({
  icon,
  label,
  value,
  onChange,
  min = 0,
  max = 99,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-background dark:bg-white/[0.02] dark:border-white/[0.06] p-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
        {icon}
        {label}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="size-9 grid place-items-center rounded-full border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:hover:bg-card transition"
          aria-label={`Disminuir ${label}`}
        >
          <Minus size={14} />
        </button>
        <span className="text-xl font-semibold tabular-nums text-foreground min-w-[2ch] text-center">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="size-9 grid place-items-center rounded-full border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:hover:bg-card transition"
          aria-label={`Aumentar ${label}`}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex p-1 rounded-xl border border-border bg-muted/50 w-full sm:w-auto">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 h-9 px-4 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CurrencyInput({
  currency,
  value,
  onChange,
  placeholder,
}: {
  currency: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium pointer-events-none">
        {currency}
      </span>
      <input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={cn(inputCls, "pl-14 pr-14")}
        min={0}
        placeholder={placeholder ?? "0"}
      />
      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
        / noche
      </span>
    </div>
  );
}

function UserGroupIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
