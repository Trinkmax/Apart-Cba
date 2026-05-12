"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Star,
  Image as ImageIcon,
  Sparkles,
  MapPin,
  DollarSign,
  ChevronRight,
} from "lucide-react";
import Image from "next/image";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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

export function ListingManagerClient(props: Props) {
  const [tab, setTab] = useState("basics");
  const [published, setPublished] = useState(props.unit.marketplace_published);
  const [publishing, startPublish] = useTransition();

  function handleTogglePublish() {
    const next = !published;
    startPublish(async () => {
      try {
        await setListingPublished(props.unit.id, next);
        setPublished(next);
        toast.success(next ? "¡Tu unidad está publicada en rentOS!" : "Despublicada");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo actualizar");
      }
    });
  }

  const readiness = computeReadiness(props);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-sage-50 to-white p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wide text-neutral-500 font-medium">
            Estado del listing
          </div>
          <div className="text-lg font-semibold text-neutral-900 mt-1">
            {published ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Publicada en rentOS
              </span>
            ) : (
              <span className="flex items-center gap-2 text-neutral-700">
                <EyeOff size={16} />
                Borrador / no publicada
              </span>
            )}
          </div>
          {!readiness.ok && !published ? (
            <p className="text-xs text-amber-700 mt-1.5">
              Antes de publicar: {readiness.missing.join(", ")}.
            </p>
          ) : null}
          {published && props.unit.slug ? (
            <a
              href={`/u/${props.unit.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-sage-600 hover:underline"
            >
              <Eye size={11} /> Ver en el marketplace
              <ChevronRight size={11} />
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={published}
            disabled={publishing || (!readiness.ok && !published)}
            onCheckedChange={handleTogglePublish}
          />
          <span className="text-sm font-medium">{published ? "Publicada" : "Publicar"}</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent border-b border-neutral-200 w-full rounded-none justify-start gap-1 px-0 h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="rounded-lg">
              <t.icon size={14} className="mr-1.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="basics" className="mt-6">
          <BasicsTab unit={props.unit} />
        </TabsContent>
        <TabsContent value="photos" className="mt-6">
          <PhotosTab unitId={props.unit.id} initialPhotos={props.photos} />
        </TabsContent>
        <TabsContent value="amenities" className="mt-6">
          <AmenitiesTab
            unitId={props.unit.id}
            initialCodes={props.amenityCodes}
            catalog={props.amenitiesCatalog}
          />
        </TabsContent>
        <TabsContent value="pricing" className="mt-6">
          <PricingTab
            unitId={props.unit.id}
            basePrice={Number(props.unit.base_price ?? 0)}
            currency={props.unit.marketplace_currency ?? "ARS"}
            initialRules={props.rules}
          />
        </TabsContent>
        <TabsContent value="location" className="mt-6">
          <LocationTab unit={props.unit} mapboxToken={props.mapboxToken} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const TABS = [
  { id: "basics", label: "Listing", icon: Sparkles },
  { id: "photos", label: "Fotos", icon: ImageIcon },
  { id: "amenities", label: "Amenities", icon: Star },
  { id: "pricing", label: "Precios", icon: DollarSign },
  { id: "location", label: "Ubicación", icon: MapPin },
] as const;

function computeReadiness(props: Props): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!props.unit.marketplace_title) missing.push("título");
  if (!props.unit.marketplace_description) missing.push("descripción");
  if (!props.unit.base_price || Number(props.unit.base_price) <= 0) missing.push("precio base");
  if (props.photos.length === 0) missing.push("al menos una foto");
  return { ok: missing.length === 0, missing };
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function BasicsTab({ unit }: { unit: Unit }) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    marketplace_title: unit.marketplace_title ?? unit.name,
    marketplace_description: unit.marketplace_description ?? unit.description ?? "",
    marketplace_property_type: (unit.marketplace_property_type ?? "apartamento") as "apartamento" | "casa" | "loft" | "estudio" | "habitacion" | "duplex" | "ph" | "cabana",
    bedrooms: unit.bedrooms ?? 1,
    bathrooms: unit.bathrooms ?? 1,
    max_guests: unit.max_guests ?? 2,
    size_m2: unit.size_m2 ?? null,
    base_price: Number(unit.base_price ?? 0),
    marketplace_currency: unit.marketplace_currency ?? "ARS",
    cleaning_fee: unit.cleaning_fee ?? null,
    min_nights: unit.min_nights ?? 1,
    max_nights: unit.max_nights ?? null,
    cancellation_policy: (unit.cancellation_policy ?? "flexible") as "flexible" | "moderada" | "estricta",
    house_rules: unit.house_rules ?? "",
    check_in_window_start: unit.check_in_window_start ?? "15:00",
    check_in_window_end: unit.check_in_window_end ?? "22:00",
    instant_book: unit.instant_book,
  });

  function handleSave() {
    startTransition(async () => {
      try {
        const r = await updateListingBasics({ unit_id: unit.id, ...form });
        toast.success("Listing actualizado", {
          description: r.slug ? `Slug: /${r.slug}` : undefined,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        <Field label="Título público" hint="Lo primero que ve un huésped en la card. Hacelo memorable.">
          <input
            value={form.marketplace_title}
            onChange={(e) => setForm({ ...form, marketplace_title: e.target.value })}
            className={inputCls}
            placeholder="Loft luminoso en pleno Güemes con balcón"
            maxLength={120}
          />
        </Field>
        <Field label="Descripción" hint="Describí el lugar, la zona, lo que lo hace especial.">
          <textarea
            rows={8}
            value={form.marketplace_description}
            onChange={(e) => setForm({ ...form, marketplace_description: e.target.value })}
            className={`${inputCls} h-auto py-3`}
            placeholder="Loft de diseño en el corazón de Güemes, a metros de los cafés y restaurantes más cool de Córdoba..."
            maxLength={4000}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de propiedad">
            <select
              value={form.marketplace_property_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  marketplace_property_type: e.target.value as typeof form.marketplace_property_type,
                })
              }
              className={inputCls}
            >
              <option value="apartamento">Departamento</option>
              <option value="casa">Casa</option>
              <option value="loft">Loft</option>
              <option value="estudio">Estudio</option>
              <option value="habitacion">Habitación</option>
              <option value="duplex">Dúplex</option>
              <option value="ph">PH</option>
              <option value="cabana">Cabaña</option>
            </select>
          </Field>
          <Field label="Capacidad máxima">
            <input
              type="number"
              value={form.max_guests}
              onChange={(e) => setForm({ ...form, max_guests: parseInt(e.target.value, 10) || 0 })}
              className={inputCls}
              min={1}
              max={30}
            />
          </Field>
          <Field label="Ambientes">
            <input
              type="number"
              value={form.bedrooms}
              onChange={(e) => setForm({ ...form, bedrooms: parseInt(e.target.value, 10) || 0 })}
              className={inputCls}
              min={0}
            />
          </Field>
          <Field label="Baños">
            <input
              type="number"
              value={form.bathrooms}
              onChange={(e) => setForm({ ...form, bathrooms: parseInt(e.target.value, 10) || 0 })}
              className={inputCls}
              min={0}
            />
          </Field>
          <Field label="Tamaño (m²)">
            <input
              type="number"
              value={form.size_m2 ?? ""}
              onChange={(e) =>
                setForm({ ...form, size_m2: e.target.value ? Number(e.target.value) : null })
              }
              className={inputCls}
              min={0}
              step="0.1"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio base por noche">
            <div className="flex gap-2">
              <input
                type="number"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: Number(e.target.value) })}
                className={inputCls}
                min={0}
              />
              <select
                value={form.marketplace_currency}
                onChange={(e) => setForm({ ...form, marketplace_currency: e.target.value })}
                className="rounded-md border border-neutral-300 px-2 text-sm bg-white"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </Field>
          <Field label="Tarifa de limpieza">
            <input
              type="number"
              value={form.cleaning_fee ?? ""}
              onChange={(e) =>
                setForm({ ...form, cleaning_fee: e.target.value ? Number(e.target.value) : null })
              }
              className={inputCls}
              placeholder="0"
              min={0}
            />
          </Field>
          <Field label="Mínimo de noches">
            <input
              type="number"
              value={form.min_nights}
              onChange={(e) => setForm({ ...form, min_nights: parseInt(e.target.value, 10) || 1 })}
              className={inputCls}
              min={1}
            />
          </Field>
          <Field label="Máximo de noches">
            <input
              type="number"
              value={form.max_nights ?? ""}
              onChange={(e) =>
                setForm({ ...form, max_nights: e.target.value ? parseInt(e.target.value, 10) : null })
              }
              className={inputCls}
              placeholder="Sin límite"
              min={1}
            />
          </Field>
          <Field label="Check-in desde">
            <input
              type="time"
              value={form.check_in_window_start}
              onChange={(e) => setForm({ ...form, check_in_window_start: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Check-in hasta">
            <input
              type="time"
              value={form.check_in_window_end}
              onChange={(e) => setForm({ ...form, check_in_window_end: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Política de cancelación">
          <select
            value={form.cancellation_policy}
            onChange={(e) =>
              setForm({ ...form, cancellation_policy: e.target.value as typeof form.cancellation_policy })
            }
            className={inputCls}
          >
            <option value="flexible">Flexible — cancelar gratis hasta 24h antes</option>
            <option value="moderada">Moderada — gratis hasta 5 días antes, después 50%</option>
            <option value="estricta">Estricta — cargo total al cancelar</option>
          </select>
        </Field>
        <Field label="Reglas de la casa" hint="Qué deben saber los huéspedes (mascotas, fiestas, etc).">
          <textarea
            rows={4}
            value={form.house_rules}
            onChange={(e) => setForm({ ...form, house_rules: e.target.value })}
            className={`${inputCls} h-auto py-3`}
            placeholder="No se permiten mascotas. No fumar. Silencio después de las 22hs."
          />
        </Field>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.instant_book}
              onCheckedChange={(c) => setForm({ ...form, instant_book: c })}
            />
            <div>
              <div className="font-medium text-sm">Reserva al toque</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Los huéspedes confirman al instante, sin tu aprobación. Aumenta conversión ~70%.
              </div>
            </div>
          </label>
        </div>
        <div className="rounded-2xl border border-neutral-200 p-5 sticky top-24">
          <h4 className="text-sm font-semibold mb-3">¿Listo?</h4>
          <ul className="text-xs text-neutral-600 space-y-1.5 mb-4">
            <li>✓ Datos completos en cada tab</li>
            <li>✓ Al menos 1 foto subida</li>
            <li>✓ Precio &gt; 0</li>
            <li>✓ Ubicación marcada en el mapa</li>
          </ul>
          <button
            onClick={handleSave}
            disabled={pending}
            className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-60"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotosTab({
  unitId,
  initialPhotos,
}: {
  unitId: string;
  initialPhotos: UnitPhoto[];
}) {
  const [photos, setPhotos] = useState<UnitPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("La foto supera los 10 MB");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Solo JPG, PNG o WEBP");
      return;
    }
    setUploading(true);
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
        setPhotos((p) => [...p, r.photo as UnitPhoto]);
        toast.success("Foto subida");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Borrar esta foto?")) return;
    try {
      await deleteUnitPhoto(id);
      setPhotos((p) => p.filter((x) => x.id !== id));
      toast.success("Foto eliminada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  async function handleSetCover(id: string) {
    try {
      await setUnitPhotoCover(id);
      setPhotos((p) =>
        p.map((x) => ({ ...x, is_cover: x.id === id }))
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
    setPhotos(next);
    try {
      await reorderUnitPhotos(unitId, next.map((p) => p.id));
    } catch {
      toast.error("No se pudo reordenar");
      setPhotos(photos);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-semibold text-neutral-900">Galería</h3>
          <p className="text-sm text-neutral-500">
            {photos.length === 0
              ? "Subí al menos una foto. La primera será la portada."
              : `${photos.length} ${photos.length === 1 ? "foto" : "fotos"}. La portada es la que aparece primero en las cards.`}
          </p>
        </div>
        <label className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 cursor-pointer">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Subir foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-16 text-center">
          <ImageIcon size={48} className="mx-auto text-neutral-300 mb-3" />
          <p className="text-sm text-neutral-500">Subí la primera foto de tu propiedad.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {photos.map((p, idx) => (
            <div key={p.id} className="relative group">
              <div className="aspect-[4/3] relative rounded-xl overflow-hidden border border-neutral-200 bg-neutral-100">
                <Image src={p.public_url} alt={p.alt_text ?? ""} fill className="object-cover" sizes="33vw" />
                {p.is_cover ? (
                  <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-white/95 text-xs font-medium px-2 py-1 rounded-full">
                    <Star size={11} className="fill-yellow-500 stroke-yellow-500" />
                    Portada
                  </div>
                ) : null}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2 items-center justify-center text-white text-xs">
                  {!p.is_cover ? (
                    <button
                      onClick={() => handleSetCover(p.id)}
                      className="px-3 py-1.5 rounded-full bg-white text-neutral-900 font-medium hover:bg-neutral-100"
                    >
                      Hacer portada
                    </button>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      onClick={() => move(p.id, -1)}
                      className="px-2 py-1 rounded-full bg-white/20 hover:bg-white/30"
                      disabled={idx === 0}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(p.id, 1)}
                      className="px-2 py-1 rounded-full bg-white/20 hover:bg-white/30"
                      disabled={idx === photos.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="px-3 py-1.5 rounded-full bg-sage-500 hover:bg-sage-600 font-medium"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AmenitiesTab({
  unitId,
  initialCodes,
  catalog,
}: {
  unitId: string;
  initialCodes: string[];
  catalog: MarketplaceAmenity[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCodes));
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const groups: Record<string, MarketplaceAmenity[]> = {};
    for (const a of catalog) {
      groups[a.category] = groups[a.category] ?? [];
      groups[a.category].push(a);
    }
    return groups;
  }, [catalog]);

  function toggle(code: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      try {
        await setListingAmenities(unitId, Array.from(selected));
        toast.success(`${selected.size} amenities guardadas`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">
        Marcá todo lo que ofrecés en tu unidad. Los huéspedes filtran por estas.
      </p>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h4 className="font-semibold text-sm text-neutral-700 uppercase tracking-wide mb-3">
            {category}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {items.map((a) => (
              <button
                key={a.code}
                onClick={() => toggle(a.code)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                  selected.has(a.code)
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 hover:border-neutral-400 bg-white"
                )}
              >
                <span className="text-sm">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 shadow-lg disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : null}
          Guardar amenities
        </button>
      </div>
    </div>
  );
}

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
  const [draft, setDraft] = useState({
    name: "",
    rule_type: "date_range" as "date_range" | "weekday",
    start_date: "",
    end_date: "",
    days_of_week: [] as number[],
    price_multiplier: "" as string,
    price_override: "" as string,
    priority: 10,
  });

  async function add() {
    if (!draft.name) {
      toast.error("Nombrá la regla");
      return;
    }
    try {
      const r = await createPricingRule({
        unit_id: unitId,
        name: draft.name,
        rule_type: draft.rule_type,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        days_of_week: draft.days_of_week.length > 0 ? draft.days_of_week : null,
        price_multiplier: draft.price_multiplier ? Number(draft.price_multiplier) : null,
        price_override: draft.price_override ? Number(draft.price_override) : null,
        priority: draft.priority,
      });
      if (r.ok && r.rule) {
        setRules((prev) => [r.rule as UnitPricingRule, ...prev]);
        setOpen(false);
        setDraft({
          name: "",
          rule_type: "date_range",
          start_date: "",
          end_date: "",
          days_of_week: [],
          price_multiplier: "",
          price_override: "",
          priority: 10,
        });
        toast.success("Regla creada");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 p-4 bg-neutral-50 flex items-center justify-between">
        <div>
          <div className="text-xs text-neutral-500 uppercase tracking-wide">Precio base</div>
          <div className="text-xl font-semibold mt-1">
            {currency} {basePrice.toLocaleString("es-AR")} <span className="text-sm text-neutral-500 font-normal">/noche</span>
          </div>
        </div>
        <p className="text-xs text-neutral-500 max-w-xs text-right">
          Editá el precio base desde Listing → Precio base por noche.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-neutral-900">Reglas de precio dinámicas</h3>
          <p className="text-sm text-neutral-500">
            Subí o bajá el precio en temporadas específicas o ciertos días de la semana.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
        >
          <Plus size={14} />
          Nueva regla
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-sm text-neutral-500">
            Sin reglas todavía. El precio base se aplica todos los días.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 p-4 rounded-xl border border-neutral-200 bg-white"
            >
              <div className="flex-1">
                <div className="font-medium text-neutral-900">{r.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {r.rule_type === "date_range"
                    ? `${r.start_date} → ${r.end_date}`
                    : `Días ${r.days_of_week?.map((d) => DAY_NAMES[d]).join(", ")}`}
                  {" · "}
                  {r.price_override
                    ? `${currency} ${r.price_override} fijos`
                    : `× ${r.price_multiplier}`}
                  {" · prioridad "}
                  {r.priority}
                </div>
              </div>
              <Switch
                checked={r.active}
                onCheckedChange={(c) => toggleActive(r.id, c)}
              />
              <button
                onClick={() => remove(r.id)}
                className="text-xs text-sage-600 hover:underline"
              >
                Borrar
              </button>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Nueva regla</h3>
            <Field label="Nombre">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputCls}
                placeholder="Alta temporada verano, Finde largo, etc"
              />
            </Field>
            <Field label="Tipo">
              <select
                value={draft.rule_type}
                onChange={(e) => setDraft({ ...draft, rule_type: e.target.value as "date_range" | "weekday" })}
                className={inputCls}
              >
                <option value="date_range">Rango de fechas</option>
                <option value="weekday">Días de semana</option>
              </select>
            </Field>
            {draft.rule_type === "date_range" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desde">
                  <input
                    type="date"
                    value={draft.start_date}
                    onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Hasta">
                  <input
                    type="date"
                    value={draft.end_date}
                    onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                    className={inputCls}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Días">
                <div className="flex gap-1.5">
                  {DAY_NAMES.map((d, i) => {
                    const sel = draft.days_of_week.includes(i);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          const next = sel
                            ? draft.days_of_week.filter((x) => x !== i)
                            : [...draft.days_of_week, i];
                          setDraft({ ...draft, days_of_week: next });
                        }}
                        className={cn(
                          "h-9 w-9 rounded-full text-xs border",
                          sel
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-300"
                        )}
                      >
                        {d.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Multiplicador" hint="1.5 = +50%">
                <input
                  type="number"
                  step="0.05"
                  value={draft.price_multiplier}
                  onChange={(e) => setDraft({ ...draft, price_multiplier: e.target.value, price_override: "" })}
                  className={inputCls}
                  placeholder="1.5"
                />
              </Field>
              <Field label="O precio fijo">
                <input
                  type="number"
                  value={draft.price_override}
                  onChange={(e) => setDraft({ ...draft, price_override: e.target.value, price_multiplier: "" })}
                  className={inputCls}
                  placeholder={`${basePrice * 2}`}
                />
              </Field>
            </div>
            <Field label="Prioridad" hint="Gana la regla de mayor prioridad si solapan.">
              <input
                type="number"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                className={inputCls}
                min={0}
                max={100}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                onClick={add}
                className="px-5 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
              >
                Crear regla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function LocationTab({ unit, mapboxToken }: { unit: Unit; mapboxToken: string | null }) {
  const [address, setAddress] = useState(unit.address ?? "");
  const [neighborhood, setNeighborhood] = useState(unit.neighborhood ?? "");
  const [lat, setLat] = useState(unit.latitude?.toString() ?? "");
  const [lng, setLng] = useState(unit.longitude?.toString() ?? "");
  const [pending, startTransition] = useTransition();

  async function save() {
    startTransition(async () => {
      try {
        await updateListingLocation({
          unit_id: unit.id,
          address: address || null,
          neighborhood: neighborhood || null,
          latitude: lat ? Number(lat) : null,
          longitude: lng ? Number(lng) : null,
        });
        toast.success("Ubicación actualizada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
    });
  }

  return (
    <div className="space-y-5">
      <Field label="Dirección completa">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={inputCls}
          placeholder="Av. Hipólito Yrigoyen 123"
        />
      </Field>
      <Field label="Barrio">
        <input
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          className={inputCls}
          placeholder="Güemes"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitud" hint="Ej: -31.4201">
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className={inputCls}
            placeholder="-31.4201"
          />
        </Field>
        <Field label="Longitud" hint="Ej: -64.1888">
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className={inputCls}
            placeholder="-64.1888"
          />
        </Field>
      </div>
      <p className="text-xs text-neutral-500">
        💡 Tip: copiá lat/lng desde Google Maps haciendo click derecho en el punto exacto.
      </p>
      <div>
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : null}
          Guardar ubicación
        </button>
      </div>
      {mapboxToken && lat && lng ? (
        <div className="aspect-[16/9] rounded-2xl overflow-hidden border border-neutral-200">
          <iframe
            title="map preview"
            className="w-full h-full"
            src={`https://api.mapbox.com/styles/v1/mapbox/streets-v12.html?title=false&access_token=${mapboxToken}&zoomwheel=false#15/${lat}/${lng}`}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const inputCls =
  "w-full h-10 px-3 rounded-md border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors text-sm";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-neutral-700 mb-1">{label}</div>
      {children}
      {hint ? <div className="text-[11px] text-neutral-500 mt-0.5">{hint}</div> : null}
    </label>
  );
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
