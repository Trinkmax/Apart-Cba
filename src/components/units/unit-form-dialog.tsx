"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DualRateFields, type RateField } from "@/components/units/dual-rate-fields";
import { createUnit, updateUnit, type UnitInput } from "@/lib/actions/units";
import { UNIT_DEFAULT_MODE_META, UNIT_STATUSES, UNIT_STATUS_META } from "@/lib/constants";
import { unitMonthlyPrice } from "@/lib/units/pricing";
import { cn } from "@/lib/utils";
import type { Owner, Unit, UnitDefaultMode } from "@/lib/types/database";

/** Referencia estable: un [] literal en el default rompe la memoización. */
const EMPTY_CODES: string[] = [];

/** Monedas del precio de lista (una sola para la noche y el mes). */
const MONEDAS = [
  { value: "ARS", label: "ARS — Pesos" },
  { value: "USD", label: "USD — Dólares" },
  { value: "EUR", label: "EUR — Euros" },
  { value: "USDT", label: "USDT" },
] as const;

/**
 * Código sugerido a partir del nombre: iniciales de las palabras, o las
 * primeras letras si es una sola. "Alto Tucumán 7B" → "AT7B", "Cofico" → "COF".
 * Es sólo una propuesta: el campo sigue siendo editable.
 */
function codigoDesdeNombre(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim();
  if (!limpio) return "";
  const palabras = limpio.split(/\s+/);
  const base =
    palabras.length === 1
      ? palabras[0].slice(0, 3)
      : palabras.map((p) => (/^\d/.test(p) ? p : p[0])).join("");
  return base.toUpperCase().slice(0, 12);
}

/** Primer código libre a partir de la base: AT, AT-2, AT-3… */
function codigoLibre(base: string, usados: Set<string>): string {
  if (!base) return "";
  if (!usados.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const intento = `${base}-${i}`;
    if (!usados.has(intento)) return intento;
  }
  return base;
}

interface UnitFormDialogProps {
  children?: React.ReactNode;
  unit?: Unit;
  owners?: Owner[];
  /**
   * Códigos ya usados en la organización (los pasa la página, que ya tiene el
   * listado). Con esto el formulario propone un código libre y avisa en el
   * campo ANTES de guardar, en vez de dejar que choque contra la base.
   */
  existingCodes?: string[];
  /**
   * Comisión de administración por defecto de la org (Configuración →
   * Organización). Es el valor con el que nace una unidad nueva; si no llega,
   * cae en 20 igual que el servidor.
   */
  orgDefaultCommissionPct?: number | null;
  /** Estado controlado (opcional). Si se pasa, ignora el children/trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function UnitFormDialog({
  children,
  unit,
  orgDefaultCommissionPct,
  existingCodes = EMPTY_CODES,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: UnitFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (!isControlled) setInternalOpen(o);
    controlledOnOpenChange?.(o);
  };
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!unit;

  const initialForm: UnitInput = {
    code: unit?.code ?? "",
    name: unit?.name ?? "",
    address: unit?.address ?? "",
    neighborhood: unit?.neighborhood ?? "",
    floor: unit?.floor ?? "",
    apartment: unit?.apartment ?? "",
    tower: unit?.tower ?? "",
    internal_extra: unit?.internal_extra ?? "",
    bedrooms: unit?.bedrooms ?? null,
    bathrooms: unit?.bathrooms ?? null,
    max_guests: unit?.max_guests ?? 2,
    size_m2: unit?.size_m2 ?? null,
    base_price: unit?.base_price ?? null,
    base_price_currency: unit?.base_price_currency ?? "ARS",
    // Por el helper y no crudo: normaliza el numeric que PostgREST manda como
    // string y nunca trae el precio viejo de una unidad que dejó de ser mixta.
    monthly_price: unitMonthlyPrice(unit),
    cleaning_fee: unit?.cleaning_fee ?? null,
    default_commission_pct:
      unit?.default_commission_pct ?? orgDefaultCommissionPct ?? 20,
    default_mode: (unit?.default_mode as UnitDefaultMode | undefined) ?? "temporario",
    status: unit?.status ?? "disponible",
    description: unit?.description ?? "",
    notes: unit?.notes ?? "",
  };
  const [form, setForm] = useState<UnitInput>(initialForm);
  // El código deja de auto-proponerse en cuanto la persona lo escribe a mano
  // (o si está editando una unidad, que ya tiene el suyo).
  const [codeTouched, setCodeTouched] = useState(isEdit);
  // Error del servidor sobre el campo Código (código repetido).
  const [codeError, setCodeError] = useState<string | null>(null);
  // Error del servidor sobre el precio por mes (vive en la pestaña Precios).
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  // Precios de la tarifa doble con texto que no se puede usar: el form tiene
  // el último número válido, no el que se ve, así que no se guarda.
  const [preciosInvalidos, setPreciosInvalidos] = useState<Partial<Record<RateField, boolean>>>({});

  // Pestañas controladas: el aviso de la vocación y un error del precio por
  // mes tienen que poder llevar a Precios. Cada apertura arranca en Básico,
  // como cuando no estaban controladas (el contenido se desmonta al cerrar).
  const [tab, setTab] = useState("basico");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTab("basico");
      setMonthlyError(null);
      setPreciosInvalidos({});
    }
  }

  /**
   * Lleva a Precios y pone el foco en el campo. Sin esto el foco quedaba en el
   * diálogo (el botón que se tocó se desmonta con la pestaña Básico) o en
   * "Guardar", lejos del error.
   */
  function irAPrecio(campo: RateField) {
    setTab("precios");
    requestAnimationFrame(() => document.getElementById(campo)?.focus());
  }

  function setPrecioInvalido(campo: RateField, invalido: boolean) {
    setPreciosInvalidos((p) => (!!p[campo] === invalido ? p : { ...p, [campo]: invalido }));
  }

  const esMixto = form.default_mode === "mixto";
  // Una mixta sin precio por mes: se marca la pestaña para que no quede a medias.
  const faltaPrecioMensual = esMixto && unitMonthlyPrice(form) == null;

  // Sin useMemo: el React Compiler la memoiza sola y con deps manuales se
  // saltea la optimización de todo el componente (regla del linter).
  const takenCodes = new Set(
    existingCodes
      .map((c) => c.toUpperCase())
      .filter((c) => c !== (unit?.code ?? "").toUpperCase()), // el suyo no cuenta
  );

  // Aviso instantáneo: el mismo código en dos unidades es el choque que dejaba
  // el alta muerta con un error en inglés.
  const codeDuplicado =
    !isEdit || form.code.toUpperCase() !== (unit?.code ?? "").toUpperCase()
      ? takenCodes.has(form.code.trim().toUpperCase())
      : false;

  function set<K extends keyof UnitInput>(key: K, value: UnitInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Nombre → propone un código libre mientras nadie lo haya tipeado. */
  function onNameChange(value: string) {
    setForm((f) => {
      if (codeTouched) return { ...f, name: value };
      return { ...f, name: value, code: codigoLibre(codigoDesdeNombre(value), takenCodes) };
    });
    setCodeError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (esMixto) {
      const campo = (["base_price", "monthly_price"] as const).find((c) => preciosInvalidos[c]);
      if (campo) {
        irAPrecio(campo);
        toast.error("Revisá los precios", {
          description:
            campo === "monthly_price"
              ? "El precio por mes no se entiende o está en 0. Corregilo o dejalo vacío."
              : "El precio por noche no se entiende. Corregilo antes de guardar.",
        });
        return;
      }
    }
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    // El precio por mes sobrevive en el form si se cambia la vocación (vuelve
    // a mixto y sigue ahí), pero sólo viaja si la unidad es mixta: el servidor
    // lo borraría igual, y así un valor a medias en un campo que ya no se ve
    // no frena el guardado con un error que nadie puede corregir.
    const payload: UnitInput = esMixto ? form : { ...form, monthly_price: null };
    startTransition(async () => {
      try {
        const r =
          isEdit && unit ? await updateUnit(unit.id, payload) : await createUnit(payload);
        if (!r.ok) {
          // El servidor devuelve el motivo (no lo lanza): en producción una
          // excepción llegaría acá como un texto en inglés sin información.
          if (r.field === "code") setCodeError(r.error);
          if (r.field === "monthly_price") {
            setMonthlyError(r.error);
            irAPrecio("monthly_price");
          }
          toast.error(isEdit ? "No se pudo guardar" : "No se pudo crear la unidad", {
            description: r.error,
          });
          return;
        }
        if (isEdit) {
          toast.success("Unidad actualizada");
        } else {
          toast.success("Unidad creada");
          setForm(initialForm);
          setCodeTouched(false);
        }
        setCodeError(null);
        setMonthlyError(null);
        setOpen(false);
        router.refresh();
        if (typeof window !== "undefined") {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior }))
          );
        }
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        // sm:max-w-2xl y no max-w-2xl: el primitivo trae sm:max-w-lg y a partir
        // de sm le ganaba, así que el diálogo quedaba en 512px y los precios de
        // la tarifa doble (1.100.000 en dos columnas) no entraban.
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar unidad" : "Nueva unidad"}</DialogTitle>
          <DialogDescription>
            Cargá los datos de la unidad. El estado define en qué columna del Kanban aparece.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="basico">Básico</TabsTrigger>
              <TabsTrigger value="caracteristicas">Características</TabsTrigger>
              <TabsTrigger value="precios">
                Precios
                {faltaPrecioMensual && (
                  <>
                    <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
                    <span className="sr-only">(falta el precio por mes)</span>
                  </>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="basico" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Código *</Label>
                  <Input
                    id="code"
                    required
                    value={form.code}
                    onChange={(e) => {
                      setCodeTouched(true);
                      setCodeError(null);
                      set("code", e.target.value.toUpperCase());
                    }}
                    placeholder="NUE-401"
                    aria-invalid={codeDuplicado || !!codeError}
                    aria-describedby="code-help"
                    className={cn(
                      "font-mono",
                      (codeDuplicado || codeError) &&
                        "border-rose-500 focus-visible:ring-rose-500/30",
                    )}
                  />
                  <p
                    id="code-help"
                    className={cn(
                      "text-[11px] leading-snug",
                      codeDuplicado || codeError
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {codeError ??
                      (codeDuplicado
                        ? "Ese código ya está en uso. Cambialo (por ejemplo agregando el piso)."
                        : "Nombre corto para identificarla. Se propone solo.")}
                  </p>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input
                    id="name"
                    required
                    value={form.name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="Loft Nueva Córdoba"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  value={form.address ?? ""}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Av. Hipólito Yrigoyen 555"
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="neighborhood">Barrio</Label>
                  <Input
                    id="neighborhood"
                    value={form.neighborhood ?? ""}
                    onChange={(e) => set("neighborhood", e.target.value)}
                    placeholder="Nueva Córdoba"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tower">Torre</Label>
                  <Input
                    id="tower"
                    value={form.tower ?? ""}
                    onChange={(e) => set("tower", e.target.value)}
                    placeholder="Torre A"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="floor">Piso</Label>
                  <Input
                    id="floor"
                    value={form.floor ?? ""}
                    onChange={(e) => set("floor", e.target.value)}
                    placeholder="4°"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apartment">Depto</Label>
                  <Input
                    id="apartment"
                    value={form.apartment ?? ""}
                    onChange={(e) => set("apartment", e.target.value)}
                    placeholder="B"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="status">Estado inicial</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v as UnitInput["status"])}>
                    <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNIT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          <span className="flex items-center gap-2">
                            <span className="status-dot" style={{ backgroundColor: UNIT_STATUS_META[s].color }} />
                            {UNIT_STATUS_META[s].label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="default_mode">Vocación</Label>
                  <Select
                    value={form.default_mode}
                    onValueChange={(v) => {
                      set("default_mode", v as UnitInput["default_mode"]);
                      // Fuera de mixto la tarifa doble se desmonta y el precio
                      // por mes no viaja: sus marcas de inválido ya no aplican.
                      if (v !== "mixto") setPreciosInvalidos({});
                    }}
                  >
                    <SelectTrigger id="default_mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["temporario", "mensual", "mixto"] as const).map((m) => (
                        <SelectItem key={m} value={m}>
                          <span className="flex items-center gap-2">
                            <span className="status-dot" style={{ backgroundColor: UNIT_DEFAULT_MODE_META[m].color }} />
                            {UNIT_DEFAULT_MODE_META[m].label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    {UNIT_DEFAULT_MODE_META[form.default_mode].description}
                    {esMixto && (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={() => irAPrecio("base_price")}
                          className="whitespace-nowrap rounded-sm font-medium text-violet-700 underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-violet-300"
                        >
                          Cargar precios <span aria-hidden>→</span>
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Descripción para huéspedes / promoción"
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="internal_extra">Extra interno</Label>
                <Textarea
                  id="internal_extra"
                  value={form.internal_extra ?? ""}
                  onChange={(e) => set("internal_extra", e.target.value)}
                  placeholder="Diferencial o comentario interno (no visible al huésped)"
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="caracteristicas" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bedrooms">Dormitorios</Label>
                  <Input
                    id="bedrooms"
                    type="number"
                    min="0"
                    value={form.bedrooms ?? ""}
                    onChange={(e) => set("bedrooms", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bathrooms">Baños</Label>
                  <Input
                    id="bathrooms"
                    type="number"
                    min="0"
                    value={form.bathrooms ?? ""}
                    onChange={(e) => set("bathrooms", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_guests">Capacidad max.</Label>
                  <Input
                    id="max_guests"
                    type="number"
                    min="1"
                    value={form.max_guests ?? ""}
                    onChange={(e) => set("max_guests", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="size_m2">Superficie (m²)</Label>
                  <Input
                    id="size_m2"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.size_m2 ?? ""}
                    onChange={(e) => set("size_m2", e.target.value === "" ? null : Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas internas</Label>
                <Textarea
                  id="notes"
                  value={form.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Acceso, llaves, observaciones..."
                  rows={3}
                />
              </div>
            </TabsContent>

            {/* forceMount: lo tipeado en la tarifa doble vive en el input. Si la
                pestaña se desmontara al ir a Básico, el texto ilegible se perdía
                pero su marca de "inválido" no, y el form no guardaba más. */}
            <TabsContent
              value="precios"
              forceMount
              className="space-y-4 mt-4 data-[state=inactive]:hidden"
            >
              {/* Mixta: tarifa doble (noche + mes) con su comparador. El resto
                  de las vocaciones sigue con el precio por noche solo. */}
              {esMixto && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">Tarifa doble</p>
                      <p
                        id="base_price_currency-help"
                        className="text-[11px] text-muted-foreground leading-snug"
                      >
                        Un precio para estadías cortas y otro para el mes. Los dos
                        precios van en esta moneda.
                      </p>
                    </div>
                    <div className="w-full space-y-1.5 sm:w-48">
                      <Label htmlFor="base_price_currency">Moneda</Label>
                      <Select
                        value={form.base_price_currency}
                        onValueChange={(v) => set("base_price_currency", v)}
                      >
                        <SelectTrigger
                          id="base_price_currency"
                          className="w-full"
                          aria-describedby="base_price_currency-help"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MONEDAS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DualRateFields
                    currency={form.base_price_currency}
                    nightly={form.base_price}
                    monthly={form.monthly_price}
                    onNightlyChange={(v) => {
                      setPrecioInvalido("base_price", false);
                      set("base_price", v);
                    }}
                    onMonthlyChange={(v) => {
                      // Llega sólo con un número válido (tipeado o de un
                      // descuento sugerido): lo que estaba mal ya no está.
                      setMonthlyError(null);
                      setPrecioInvalido("monthly_price", false);
                      set("monthly_price", v);
                    }}
                    onInvalidChange={setPrecioInvalido}
                    monthlyError={monthlyError}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {!esMixto && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="base_price_currency">Moneda</Label>
                      <Select
                        value={form.base_price_currency}
                        onValueChange={(v) => set("base_price_currency", v)}
                      >
                        <SelectTrigger id="base_price_currency"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MONEDAS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="base_price">Precio por noche</Label>
                      <Input
                        id="base_price"
                        type="text"
                        inputMode="decimal"
                        value={form.base_price ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") set("base_price", null);
                          else {
                            const n = Number(v.replace(",", "."));
                            if (Number.isFinite(n)) set("base_price", n);
                          }
                        }}
                        placeholder="0"
                      />
                    </div>
                  </>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="cleaning_fee">Fee limpieza</Label>
                  <Input
                    id="cleaning_fee"
                    type="text"
                    inputMode="decimal"
                    value={form.cleaning_fee ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") set("cleaning_fee", null);
                      else {
                        const n = Number(v.replace(",", "."));
                        if (Number.isFinite(n)) set("cleaning_fee", n);
                      }
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="default_commission_pct">Comisión de administración (%)</Label>
                  <Input
                    id="default_commission_pct"
                    type="text"
                    inputMode="decimal"
                    value={form.default_commission_pct ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      // Vacío ≠ 0%: lo dejamos sin valor para que el servidor
                      // caiga en el default de la org.
                      if (raw === "") return set("default_commission_pct", undefined);
                      const n = Number(raw.replace(",", "."));
                      if (Number.isFinite(n)) set("default_commission_pct", n);
                    }}
                    placeholder={String(orgDefaultCommissionPct ?? 20)}
                  />
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground">
                  Es lo que le descontás al propietario cuando generás la liquidación.
                </p>
                <p>
                  Manda esta comisión, la de la unidad. Si con algún propietario
                  arreglaste otro porcentaje, cargale la excepción en la ficha de la
                  unidad → pestaña <strong>Propietarios</strong>.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || codeDuplicado}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              {isEdit ? "Guardar cambios" : "Crear unidad"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
