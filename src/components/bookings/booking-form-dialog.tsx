"use client";

import { useState, useTransition, useEffect } from "react";
import { CalendarRange, Loader2, Plus, UserPlus, Search, House, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GuestFormDialog } from "@/components/guests/guest-form-dialog";
import { createBooking, updateBooking, type BookingInput } from "@/lib/actions/bookings";
import { searchGuests } from "@/lib/actions/guests";
import { BOOKING_MODE_META, BOOKING_SOURCE_META, BOOKING_STATUS_META } from "@/lib/constants";
import { formatNights } from "@/lib/format";
import {
  MAX_BOOKING_NIGHTS,
  nightsBetween,
  splitBookingSegments,
} from "@/lib/booking-split";
import { cn } from "@/lib/utils";
import type {
  Booking,
  BookingMode,
  BookingWithRelations,
  CashAccount,
  Guest,
  Unit,
  UnitDefaultMode,
} from "@/lib/types/database";

// ─── Helpers para inputs monetarios ─────────────────────────────────────────
// Aceptan tanto `.` como `,` como separador decimal. Vacío → null.
function parseMoneyInput(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  // Si tenía un solo punto (input internacional), revertir el primer reemplazo.
  // Heurística: si normalized no parsea, probamos el original con punto.
  const direct = Number(trimmed.replace(",", "."));
  const n = Number.isFinite(direct) ? direct : Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatMoneyValue(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  // Mostrar con punto decimal (consistente con type="text" + inputMode decimal)
  return Number.isInteger(n) ? String(n) : String(n);
}

// Util compartido (mismo módulo que usa el server action) — mantiene cliente y
// servidor en sync por construcción. NO duplicar la lógica acá.

type SelectedGuest = Pick<Guest, "id" | "full_name" | "phone" | "email">;

type UnitForBookingForm = Pick<
  Unit,
  | "id"
  | "code"
  | "name"
  | "default_commission_pct"
  | "base_price"
  | "base_price_currency"
  | "cleaning_fee"
> & { default_mode?: UnitDefaultMode };

type ExistingBookingForOverlap = {
  id: string;
  unit_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
};

interface BookingFormDialogProps {
  children?: React.ReactNode;
  booking?: Booking | BookingWithRelations;
  units: UnitForBookingForm[];
  /** Cuentas de caja activas — para registrar el cobro al crear/actualizar la reserva */
  accounts?: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  /** Reservas ya existentes — usadas para detectar overlaps antes de enviar al server */
  existingBookings?: ExistingBookingForOverlap[];
  defaultUnitId?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  /** Si se setea, el dialog arranca abierto y no necesita trigger */
  defaultOpen?: boolean;
  /** Estado controlado (opcional). Si se pasa, ignora defaultOpen y children. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Callback cuando el dialog se cierra (para coordinar con el parent) */
  onClosed?: () => void;
}

export function BookingFormDialog({
  children,
  booking,
  units,
  accounts = [],
  existingBookings,
  defaultUnitId,
  defaultCheckIn,
  defaultCheckOut,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onClosed,
}: BookingFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (!isControlled) setInternalOpen(o);
    controlledOnOpenChange?.(o);
  };
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!booking;

  const [selectedGuest, setSelectedGuest] = useState<SelectedGuest | null>(
    () => (booking && "guest" in booking ? booking.guest ?? null : null)
  );
  const [guestSearchOpen, setGuestSearchOpen] = useState(false);
  const [guestQuery, setGuestQuery] = useState("");
  const [guestResults, setGuestResults] = useState<Guest[]>([]);

  // ─── State del form ────────────────────────────────────────────────────────
  // Campos monetarios y porcentajes los manejamos como STRING en el form (vacío
  // = "no cargado") para que el placeholder se vea limpio. Al submit los
  // parseamos con parseMoneyInput. Esto resuelve el problema de "0 que no se
  // borra" y permite ingreso con `.` o `,` como separador decimal.
  type FormShape = Omit<
    BookingInput,
    | "total_amount"
    | "paid_amount"
    | "commission_pct"
    | "cleaning_fee"
    | "monthly_rent"
    | "monthly_expenses"
    | "security_deposit"
    | "monthly_inflation_adjustment_pct"
  > & {
    /**
     * Precio por noche (modo temporario). NO se persiste — el server recibe
     * `total_amount` ya calculado como `price_per_night × nights`. La comisión
     * se decide en liquidaciones, no acá.
     */
    price_per_night: string;
    /**
     * Total del período (modo mensual). En temporario se calcula en vivo
     * desde price_per_night × nights y se muestra como display readonly.
     */
    total_amount: string;
    paid_amount: string;
    commission_pct: string;
    cleaning_fee: string;
    monthly_rent: string;
    monthly_expenses: string;
    security_deposit: string;
    monthly_inflation_adjustment_pct: string;
    /** Cuenta de caja a la que se imputa el `paid_amount` (no se persiste en bookings) */
    account_id: string | null;
    /**
     * En modo edición: importe a SUMAR al `paid_amount` actual (no lo
     * sobrescribe). En modo creación se ignora — usá `paid_amount` directo.
     */
    add_payment: string;
  };

  // Derivar price_per_night inicial: en edición = total / nights del booking;
  // en creación = vacío (lo rellena el auto-cálculo desde unit.base_price).
  const initialPricePerNight = (() => {
    if (!booking) return "";
    const ci = booking.check_in_date;
    const co = booking.check_out_date;
    const n = ci && co ? nightsBetween(ci, co) : 0;
    const total = Number(booking.total_amount ?? 0);
    if (n > 0 && total > 0) {
      return formatMoneyValue(Math.round((total / n) * 100) / 100);
    }
    return "";
  })();

  const [form, setForm] = useState<FormShape>({
    unit_id: booking?.unit_id ?? defaultUnitId ?? "",
    guest_id: booking?.guest_id ?? null,
    source: booking?.source ?? "directo",
    external_id: booking?.external_id ?? "",
    status: booking?.status ?? "confirmada",
    mode: booking?.mode ?? "temporario",
    check_in_date: booking?.check_in_date ?? defaultCheckIn ?? "",
    check_in_time: booking?.check_in_time ?? "14:00",
    check_out_date: booking?.check_out_date ?? defaultCheckOut ?? "",
    check_out_time: booking?.check_out_time ?? "10:00",
    guests_count: booking?.guests_count ?? 2,
    currency: booking?.currency ?? "ARS",
    price_per_night: initialPricePerNight,
    total_amount: formatMoneyValue(booking?.total_amount),
    paid_amount: formatMoneyValue(booking?.paid_amount),
    commission_pct:
      booking?.commission_pct !== null && booking?.commission_pct !== undefined
        ? formatMoneyValue(booking.commission_pct)
        : "20",
    cleaning_fee: formatMoneyValue(booking?.cleaning_fee),
    monthly_rent: formatMoneyValue(booking?.monthly_rent),
    monthly_expenses: formatMoneyValue(booking?.monthly_expenses),
    security_deposit: formatMoneyValue(booking?.security_deposit),
    monthly_inflation_adjustment_pct: formatMoneyValue(booking?.monthly_inflation_adjustment_pct),
    rent_billing_day: booking?.rent_billing_day ?? null,
    notes: booking?.notes ?? "",
    internal_notes: booking?.internal_notes ?? "",
    account_id: null,
    add_payment: "",
  });

  // Importe ya cobrado al abrir el form (snapshot — no muta cuando el usuario
  // tipea "Agregar pago"). Sólo aplica en modo edición.
  const previousPaid = Number(booking?.paid_amount ?? 0);

  // Tracking del input "tocado" — si el usuario editó manualmente el precio
  // (temporario) o el total del período (mensual), dejamos de auto-calcular.
  const [priceTouched, setPriceTouched] = useState(isEdit);
  const [totalTouched, setTotalTouched] = useState(isEdit);

  function set<K extends keyof FormShape>(k: K, v: FormShape[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function setMode(next: BookingMode) {
    setForm((f) => {
      // Defaults razonables al pasar a mensual: billing_day = 1
      if (next === "mensual" && f.mode !== "mensual") {
        return {
          ...f,
          mode: next,
          rent_billing_day: f.rent_billing_day ?? 1,
        };
      }
      return { ...f, mode: next };
    });
  }

  // ─── Auto-cálculo de precio/total ────────────────────────────────────────
  // Modo temporario: auto-rellena price_per_night desde unit.base_price si el
  // usuario no lo tocó. El total se deriva en vivo (price × nights).
  // Modo mensual: auto-rellena total_amount desde monthly_rent × días/30.
  // Patrón "ajuste de state durante render" para no violar
  // react-hooks/set-state-in-effect.
  const autoKey = `${form.unit_id}|${form.mode}|${form.monthly_rent}|${form.check_in_date}|${form.check_out_date}`;
  const [prevAutoKey, setPrevAutoKey] = useState(autoKey);
  if (prevAutoKey !== autoKey) {
    setPrevAutoKey(autoKey);
    const u = units.find((x) => x.id === form.unit_id);
    const nightsCount = nightsBetween(form.check_in_date, form.check_out_date);
    if (form.mode === "mensual" && !totalTouched) {
      const rent = parseMoneyInput(form.monthly_rent);
      if (rent && nightsCount > 0) {
        const computed = Math.round((rent / 30) * nightsCount * 100) / 100;
        setForm((f) => ({ ...f, total_amount: formatMoneyValue(computed) }));
      }
    } else if (form.mode !== "mensual" && !priceTouched && u?.base_price) {
      setForm((f) => ({
        ...f,
        price_per_night: formatMoneyValue(Number(u.base_price)),
      }));
    }
  }

  // Buscar guests al tipear
  useEffect(() => {
    if (!guestSearchOpen) return;
    const t = setTimeout(async () => {
      if (guestQuery.trim().length >= 2) {
        const results = await searchGuests(guestQuery);
        setGuestResults(results);
      } else {
        setGuestResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [guestQuery, guestSearchOpen]);

  // Auto-fill currency + cleaning_fee + commission + mode cuando elige unit
  function onSelectUnit(unitId: string) {
    set("unit_id", unitId);
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    if (u.base_price_currency && !isEdit) set("currency", u.base_price_currency);
    if (u.cleaning_fee && !form.cleaning_fee) {
      set("cleaning_fee", formatMoneyValue(u.cleaning_fee));
    }
    if (u.default_commission_pct !== null && u.default_commission_pct !== undefined && !isEdit) {
      set("commission_pct", formatMoneyValue(u.default_commission_pct));
    }
    // Sugerencia de modo si la unidad tiene vocación clara y no estamos editando
    if (!isEdit && u.default_mode && u.default_mode !== "mixto") {
      setMode(u.default_mode);
    }
  }

  const nights =
    form.check_in_date && form.check_out_date && form.check_out_date > form.check_in_date
      ? formatNights(form.check_in_date, form.check_out_date)
      : 0;

  // En temporario: total = precio/noche × noches. En mensual: total tipeado.
  const pricePerNightNum = parseMoneyInput(form.price_per_night) ?? 0;
  const totalNum =
    form.mode === "mensual"
      ? parseMoneyInput(form.total_amount) ?? 0
      : Math.round(pricePerNightNum * nights * 100) / 100;
  // Comisión ya no se ingresa en este form — se decide en liquidaciones.
  // Mantenemos el valor del state (default 20% o el que ya tenga el booking)
  // para no perder data en edición; el server decide el fallback definitivo.
  const commissionPctNum = parseMoneyInput(form.commission_pct);

  // ─── Split preview: cualquier reserva > MAX_BOOKING_NIGHTS se divide ───
  const splitSegments =
    !isEdit &&
    form.check_in_date &&
    form.check_out_date &&
    form.check_out_date > form.check_in_date
      ? splitBookingSegments(
          form.check_in_date,
          form.check_out_date,
          MAX_BOOKING_NIGHTS
        )
      : [];

  // ─── Warning si la unidad tiene vocación distinta al modo elegido (excepto mixto) ───
  const selectedUnit = units.find((u) => u.id === form.unit_id);
  const unitVocation = (selectedUnit?.default_mode ?? "temporario") as UnitDefaultMode;
  const modeMismatchWarning =
    selectedUnit && unitVocation !== "mixto" && unitVocation !== form.mode
      ? `La unidad ${selectedUnit.code} tiene vocación ${unitVocation === "temporario" ? "temporaria" : "mensual"}. Igual podés cargar la reserva, pero confirmá que es lo que querés.`
      : null;

  // Filtrar cuentas por moneda elegida
  const accountsForCurrency = accounts.filter((a) => a.currency === form.currency);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // En edición, el delta a cobrar viene de "Agregar pago" y se SUMA al
    // paid_amount existente. En creación se usa el paid_amount tipeado.
    const addPayment = isEdit ? parseMoneyInput(form.add_payment) ?? 0 : 0;
    const paidAmount = isEdit
      ? previousPaid + addPayment
      : parseMoneyInput(form.paid_amount) ?? 0;
    // El "delta" (lo que va a generar movimiento de caja) es lo nuevo: en
    // edición, sólo el `add_payment`; en creación, el `paid_amount` inicial.
    const cashDelta = isEdit ? addPayment : paidAmount;
    const payload: BookingInput & { account_id?: string | null } = {
      unit_id: form.unit_id,
      guest_id: form.guest_id,
      source: form.source,
      external_id: form.external_id,
      status: form.status,
      mode: form.mode,
      check_in_date: form.check_in_date,
      check_in_time: form.check_in_time,
      check_out_date: form.check_out_date,
      check_out_time: form.check_out_time,
      guests_count: form.guests_count,
      currency: form.currency,
      total_amount: totalNum,
      paid_amount: paidAmount,
      commission_pct: commissionPctNum,
      cleaning_fee: parseMoneyInput(form.cleaning_fee),
      monthly_rent: parseMoneyInput(form.monthly_rent),
      monthly_expenses: parseMoneyInput(form.monthly_expenses),
      security_deposit: parseMoneyInput(form.security_deposit),
      monthly_inflation_adjustment_pct: parseMoneyInput(form.monthly_inflation_adjustment_pct),
      rent_billing_day: form.rent_billing_day ?? null,
      notes: form.notes,
      internal_notes: form.internal_notes,
      account_id: cashDelta > 0 ? form.account_id : null,
    };
    if (cashDelta > 0 && !payload.account_id && accountsForCurrency.length > 0) {
      toast.error("Falta seleccionar cuenta de cobro", {
        description: `Elegí en qué cuenta querés registrar el cobro de ${form.currency}`,
      });
      return;
    }
    // Pre-check de overlap (mismo unit, status confirmada/check_in, rangos
    // [in, out) que se solapan). Replica el constraint bookings_no_overlap
    // del Postgres para dar un mensaje claro antes de pegarle al server,
    // donde Next.js enmascara el Error.message en producción.
    if (existingBookings && form.unit_id && form.check_in_date && form.check_out_date) {
      const conflict = existingBookings.find((b) => {
        if (b.unit_id !== form.unit_id) return false;
        if (booking && b.id === booking.id) return false;
        if (b.status !== "confirmada" && b.status !== "check_in") return false;
        return (
          b.check_in_date < form.check_out_date &&
          b.check_out_date > form.check_in_date
        );
      });
      if (conflict) {
        const u = units.find((x) => x.id === form.unit_id);
        toast.error("Ya existe una reserva en esa unidad", {
          description: `${u?.name ?? "La unidad"} está ocupada del ${conflict.check_in_date} al ${conflict.check_out_date}. Editá esa reserva en lugar de crear una nueva.`,
        });
        return;
      }
    }
    startTransition(async () => {
      try {
        if (isEdit && booking) {
          await updateBooking(booking.id, payload);
          toast.success("Reserva actualizada");
        } else {
          await createBooking(payload);
          toast.success("Reserva creada");
        }
        setOpen(false);
        router.refresh();
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
        if (!o) onClosed?.();
      }}
    >
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Modo de estadía: switch tipo segmented control en top de jerarquía */}
          <ModeSwitch mode={form.mode} onChange={setMode} disabled={isEdit && booking?.status === "check_out"} />

          {/* Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Unidad *</Label>
              <Select value={form.unit_id} onValueChange={onSelectUnit} required>
                <SelectTrigger><SelectValue placeholder="Elegí la unidad" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {units.map((u) => {
                    const dm: UnitDefaultMode = (u.default_mode ?? "temporario") as UnitDefaultMode;
                    const dmLabel =
                      dm === "mixto" ? "Mx" : dm === "mensual" ? "M" : "T";
                    const dmTone =
                      dm === "mixto"
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                        : dm === "mensual"
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200"
                          : "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200";
                    return (
                      <SelectItem key={u.id} value={u.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center size-4 rounded-sm text-[9px] font-bold",
                              dmTone
                            )}
                            title={`Vocación: ${dm}`}
                          >
                            {dmLabel}
                          </span>
                          <span className="font-mono text-xs">{u.code}</span>
                          <span className="truncate">{u.name}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as BookingInput["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BOOKING_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <span className="status-dot" style={{ backgroundColor: m.color }} />
                        {m.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Guest combobox */}
          <div className="space-y-1.5">
            <Label>Huésped</Label>
            <div className="flex gap-2">
              <Popover open={guestSearchOpen} onOpenChange={setGuestSearchOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="flex-1 justify-start gap-2 font-normal">
                    <Search size={14} className="text-muted-foreground" />
                    {selectedGuest?.full_name ?? (form.guest_id ? "Seleccionado" : "Buscar huésped existente…")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Nombre, email, teléfono…" value={guestQuery} onValueChange={setGuestQuery} />
                    <CommandList>
                      <CommandEmpty>{guestQuery.length < 2 ? "Escribí al menos 2 caracteres" : "Sin resultados"}</CommandEmpty>
                      <CommandGroup>
                        {guestResults.map((g) => (
                          <CommandItem
                            key={g.id}
                            value={g.id}
                            onSelect={() => {
                              setSelectedGuest(g);
                              set("guest_id", g.id);
                              setGuestSearchOpen(false);
                            }}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{g.full_name}</span>
                              <span className="text-xs text-muted-foreground">{g.phone ?? g.email ?? ""}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <GuestFormDialog
                onCreated={(g) => {
                  setSelectedGuest(g);
                  set("guest_id", g.id);
                }}
              >
                <Button type="button" variant="outline" className="gap-2">
                  <UserPlus size={14} /> Nuevo
                </Button>
              </GuestFormDialog>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Check-in *</Label>
              <Input
                type="date"
                required
                min="2020-01-01"
                max="2100-12-31"
                value={form.check_in_date}
                onChange={(e) => set("check_in_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input type="time" value={form.check_in_time} onChange={(e) => set("check_in_time", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Check-out *</Label>
              <Input
                type="date"
                required
                min={form.check_in_date || "2020-01-01"}
                max="2100-12-31"
                value={form.check_out_date}
                onChange={(e) => set("check_out_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input type="time" value={form.check_out_time} onChange={(e) => set("check_out_time", e.target.value)} />
            </div>
          </div>

          {nights > 0 && (
            <div className="text-xs text-muted-foreground">
              Estadía: <span className="font-medium text-foreground">{nights} {nights === 1 ? "noche" : "noches"}</span>
            </div>
          )}

          {/* Origen + huéspedes */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Origen</Label>
              <Select value={form.source} onValueChange={(v) => set("source", v as BookingInput["source"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BOOKING_SOURCE_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>ID externo</Label>
              <Input value={form.external_id ?? ""} onChange={(e) => set("external_id", e.target.value)} placeholder="HMABCDEF" />
            </div>
            <div className="space-y-1.5">
              <Label>N° de huéspedes</Label>
              <Input type="number" min="1" value={form.guests_count} onChange={(e) => set("guests_count", Number(e.target.value))} />
            </div>
          </div>

          {/* Campos específicos de mensual */}
          {form.mode === "mensual" && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <House size={14} className="text-violet-600 dark:text-violet-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                  Términos del alquiler mensual
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_rent">Renta mensual</Label>
                  <Input
                    id="monthly_rent"
                    type="text"
                    inputMode="decimal"
                    value={form.monthly_rent}
                    onChange={(e) => set("monthly_rent", e.target.value)}
                    placeholder="Opcional — definí después"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_expenses">Expensas / mes</Label>
                  <Input
                    id="monthly_expenses"
                    type="text"
                    inputMode="decimal"
                    value={form.monthly_expenses}
                    onChange={(e) => set("monthly_expenses", e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="security_deposit">Depósito en garantía</Label>
                  <Input
                    id="security_deposit"
                    type="text"
                    inputMode="decimal"
                    value={form.security_deposit}
                    onChange={(e) => set("security_deposit", e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rent_billing_day">Día de cobro</Label>
                  <Input
                    id="rent_billing_day"
                    type="number"
                    min="1"
                    max="28"
                    value={form.rent_billing_day ?? ""}
                    onChange={(e) => set("rent_billing_day", e.target.value === "" ? null : Number(e.target.value))}
                    placeholder="1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_inflation_adjustment_pct">Ajuste por inflación %</Label>
                  <Input
                    id="monthly_inflation_adjustment_pct"
                    type="text"
                    inputMode="decimal"
                    value={form.monthly_inflation_adjustment_pct}
                    onChange={(e) => set("monthly_inflation_adjustment_pct", e.target.value)}
                    placeholder="Opcional"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Informativo. El ajuste se aplica manualmente al editar la renta.
                  </p>
                </div>
                <div className="space-y-1.5 rounded-md bg-violet-50 dark:bg-violet-950/30 p-3 text-xs">
                  <span className="text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300 font-semibold">
                    Total estimado del período
                  </span>
                  <div className="font-mono text-base font-semibold text-violet-900 dark:text-violet-100">
                    {(() => {
                      if (!form.check_in_date || !form.check_out_date) return "—";
                      const days = nightsBetween(form.check_in_date, form.check_out_date);
                      const months = days / 30;
                      const rent = parseMoneyInput(form.monthly_rent) ?? 0;
                      const exp = parseMoneyInput(form.monthly_expenses) ?? 0;
                      const total = (rent + exp) * months;
                      return total > 0 ? total.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : "—";
                    })()}
                  </div>
                  <p className="text-[10px] text-violet-700/80 dark:text-violet-300/80">
                    {parseMoneyInput(form.monthly_rent) ?? 0 > 0
                      ? `Renta + expensas × meses ocupados`
                      : "Cargá la renta para ver el total"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Warning: vocación de la unidad distinta al modo elegido */}
          {modeMismatchWarning && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <span aria-hidden className="mt-0.5">⚠</span>
              <span>{modeMismatchWarning}</span>
            </div>
          )}

          {/* Split preview: la reserva se va a dividir en N períodos */}
          {splitSegments.length >= 2 && (
            <div className="rounded-lg border border-violet-300/60 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800/40 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <House size={14} className="text-violet-700 dark:text-violet-300" />
                <span className="text-xs font-semibold text-violet-900 dark:text-violet-100">
                  Esta reserva se dividirá en {splitSegments.length} períodos de hasta {MAX_BOOKING_NIGHTS} noches
                </span>
              </div>
              <p className="text-[11px] text-violet-800/80 dark:text-violet-300/80">
                Una reserva no puede exceder {MAX_BOOKING_NIGHTS} noches. Cada
                período se factura, cobra y liquida de forma independiente.
                Quedan agrupados en el mismo contrato (lease group) y se ven
                consecutivos en el calendario.
              </p>
              <ol className="space-y-1 text-[11px]">
                {splitSegments.map((seg, i) => (
                  <li
                    key={`${seg.from}-${seg.to}`}
                    className="flex items-center justify-between gap-2 rounded bg-background/60 px-2 py-1"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] text-violet-700 dark:text-violet-300 tabular-nums">
                        {i + 1}/{splitSegments.length}
                      </span>
                      <span className="truncate">
                        {seg.from} → {seg.to}
                      </span>
                    </span>
                    <span className="font-mono text-muted-foreground tabular-nums shrink-0">
                      {seg.nights}n
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Money — grid simétrico de 5 cols: labels en una línea, inputs
              alineados, helper text con altura fija para que todas las
              columnas tengan exactamente la misma altura visual. */}
          {(() => {
            const pendingNum = Math.max(
              0,
              totalNum -
                (isEdit
                  ? previousPaid
                  : parseMoneyInput(form.paid_amount) ?? 0)
            );
            const labelCls = "whitespace-nowrap text-xs sm:text-sm";
            const helperCls =
              "text-[10px] text-muted-foreground min-h-[14px] leading-[14px] whitespace-nowrap overflow-hidden text-ellipsis";
            const readonlyBoxCls =
              "flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 py-1 text-sm font-mono tabular-nums text-muted-foreground";
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t pt-4">
                {/* 1. Moneda */}
                <div className="space-y-1.5">
                  <Label className={labelCls}>Moneda</Label>
                  <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USDT">USDT</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className={helperCls}>&nbsp;</p>
                </div>

                {/* 2. Precio/noche (temporario) o Total (mensual) */}
                {form.mode === "mensual" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="total_amount" className={labelCls}>Total</Label>
                    <Input
                      id="total_amount"
                      type="text"
                      inputMode="decimal"
                      value={form.total_amount}
                      onFocus={(e) => {
                        if (e.target.value === "0") {
                          setTotalTouched(true);
                          set("total_amount", "");
                        }
                      }}
                      onChange={(e) => {
                        setTotalTouched(true);
                        set("total_amount", e.target.value);
                      }}
                      placeholder={(() => {
                        const rent = parseMoneyInput(form.monthly_rent);
                        if (rent && nights > 0) {
                          return formatMoneyValue(Math.round((rent / 30) * nights * 100) / 100);
                        }
                        return "0";
                      })()}
                    />
                    <p className={helperCls}>Total del período</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="price_per_night" className={labelCls}>Precio/noche</Label>
                    <Input
                      id="price_per_night"
                      type="text"
                      inputMode="decimal"
                      value={form.price_per_night}
                      onFocus={(e) => {
                        if (e.target.value === "0") {
                          setPriceTouched(true);
                          set("price_per_night", "");
                        }
                      }}
                      onChange={(e) => {
                        setPriceTouched(true);
                        set("price_per_night", e.target.value);
                      }}
                      placeholder={(() => {
                        const u = units.find((x) => x.id === form.unit_id);
                        return u?.base_price ? formatMoneyValue(Number(u.base_price)) : "0";
                      })()}
                    />
                    <p className={helperCls}>Tarifa por noche</p>
                  </div>
                )}

                {/* 3. Cobrado */}
                <div className="space-y-1.5">
                  <Label htmlFor="paid_amount" className={labelCls}>Cobrado</Label>
                  <Input
                    id="paid_amount"
                    type="text"
                    inputMode="decimal"
                    value={isEdit ? formatMoneyValue(previousPaid) : form.paid_amount}
                    onFocus={(e) => {
                      if (!isEdit && e.target.value === "0") set("paid_amount", "");
                    }}
                    onChange={(e) => set("paid_amount", e.target.value)}
                    placeholder="0"
                    readOnly={isEdit}
                    disabled={isEdit}
                    className={isEdit ? "bg-muted/40 cursor-not-allowed" : undefined}
                  />
                  <p className={helperCls}>
                    {isEdit ? "Usá \"Agregar pago\" para sumar más" : "Pagado al ingresar"}
                  </p>
                </div>

                {/* 4. Total (temporario, calculado) o Saldo (mensual, calculado) */}
                <div className="space-y-1.5">
                  <Label className={labelCls}>
                    {form.mode === "mensual" ? "Saldo" : "Total"}
                  </Label>
                  <div
                    className={readonlyBoxCls}
                    aria-label={form.mode === "mensual" ? "Saldo pendiente" : "Total calculado"}
                  >
                    {form.mode === "mensual"
                      ? pendingNum > 0
                        ? pendingNum.toLocaleString("es-AR", { maximumFractionDigits: 2 })
                        : "—"
                      : totalNum > 0
                        ? totalNum.toLocaleString("es-AR", { maximumFractionDigits: 2 })
                        : "—"}
                  </div>
                  <p className={helperCls}>
                    {form.mode === "mensual"
                      ? "Total − cobrado"
                      : nights > 0 && pricePerNightNum > 0
                        ? `${formatMoneyValue(pricePerNightNum)} × ${nights}n`
                        : "Precio × noches"}
                  </p>
                </div>

                {/* 5. Limpieza */}
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label htmlFor="cleaning_fee" className={labelCls}>Limpieza</Label>
                  <Input
                    id="cleaning_fee"
                    type="text"
                    inputMode="decimal"
                    value={form.cleaning_fee}
                    onChange={(e) => set("cleaning_fee", e.target.value)}
                    placeholder="0"
                  />
                  <p className={helperCls}>Fee de limpieza</p>
                </div>
              </div>
            );
          })()}

          {/* Cobrar en cuenta — siempre visible en creación y edición */}
          {(() => {
            const totalNumLocal = totalNum;
            const pendingBefore = isEdit
              ? Math.max(0, totalNumLocal - previousPaid)
              : Math.max(0, totalNumLocal - (parseMoneyInput(form.paid_amount) ?? 0));
            const addNum = isEdit
              ? parseMoneyInput(form.add_payment) ?? 0
              : parseMoneyInput(form.paid_amount) ?? 0;
            const requireAccount = addNum > 0;
            return (
              <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Label htmlFor="account_id" className="flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200">
                    <Wallet size={13} /> Cobrar en cuenta {requireAccount && "*"}
                  </Label>
                  <div className="text-[10px] text-emerald-900/80 dark:text-emerald-200/80 tabular-nums">
                    Saldo pendiente:{" "}
                    <span className="font-semibold">
                      {form.currency}{" "}
                      {pendingBefore.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
                {accountsForCurrency.length === 0 ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    No hay cuentas activas en {form.currency}. Cargá una cuenta primero en Caja.
                  </p>
                ) : (
                  <Select
                    value={form.account_id ?? undefined}
                    onValueChange={(v) => set("account_id", v)}
                  >
                    <SelectTrigger id="account_id">
                      <SelectValue placeholder={`Elegí cuenta en ${form.currency}…`} />
                    </SelectTrigger>
                    <SelectContent>
                      {accountsForCurrency.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} <span className="text-[10px] text-muted-foreground ml-1">· {a.type}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label htmlFor={isEdit ? "add_payment" : "create_paid_amount"} className="text-[10px] text-emerald-900/80 dark:text-emerald-200/80">
                      Importe ({form.currency})
                    </Label>
                    <Input
                      id={isEdit ? "add_payment" : "create_paid_amount"}
                      type="text"
                      inputMode="decimal"
                      value={isEdit ? form.add_payment : form.paid_amount}
                      onChange={(e) => set(isEdit ? "add_payment" : "paid_amount", e.target.value)}
                      placeholder={pendingBefore > 0 ? formatMoneyValue(pendingBefore) : "0"}
                      aria-label="Importe del pago"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 gap-1.5 shrink-0"
                    disabled={pendingBefore <= 0 && addNum === 0}
                    onClick={() => {
                      if (pendingBefore > 0) {
                        set(
                          isEdit ? "add_payment" : "paid_amount",
                          formatMoneyValue(
                            isEdit ? pendingBefore : (parseMoneyInput(form.paid_amount) ?? 0) + pendingBefore
                          )
                        );
                      }
                    }}
                  >
                    <Plus size={14} /> Agregar pago
                  </Button>
                </div>
                <p className="text-[10px] text-emerald-800/80 dark:text-emerald-300/80">
                  {!isEdit && addNum > 0 && (
                    <>
                      Se generará un movimiento en caja por {form.currency}{" "}
                      {addNum.toLocaleString("es-AR", { maximumFractionDigits: 2 })} al guardar.
                    </>
                  )}
                  {isEdit && addNum > 0 && (
                    <>
                      Se agregará un pago de {form.currency}{" "}
                      {addNum.toLocaleString("es-AR", { maximumFractionDigits: 2 })}. Cobrado total pasará a {form.currency}{" "}
                      {(previousPaid + addNum).toLocaleString("es-AR", { maximumFractionDigits: 2 })}{" "}
                      · Saldo restante: {form.currency}{" "}
                      {Math.max(0, totalNumLocal - previousPaid - addNum).toLocaleString("es-AR", { maximumFractionDigits: 2 })}.
                    </>
                  )}
                  {addNum === 0 && pendingBefore > 0 && (
                    <>Tocá &quot;Agregar pago&quot; para saldar todo, o tipeá un importe parcial.</>
                  )}
                  {addNum === 0 && pendingBefore === 0 && totalNumLocal > 0 && (
                    <>La reserva ya está saldada.</>
                  )}
                </p>
              </div>
            );
          })()}

          <div className="space-y-1.5">
            <Label>Notas para el huésped</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notas internas</Label>
            <Textarea rows={2} value={form.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} placeholder="Solo el equipo lo ve" />
          </div>

          <DialogFooter className="sm:bg-background sm:border-t sm:px-6 sm:py-3 sm:-mx-6 sm:-mb-6 sm:mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "Guardar" : "Crear reserva"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Subcomponentes (nivel de módulo, NO inline para evitar re-mount) ──────
interface ModeSwitchProps {
  mode: BookingMode;
  onChange: (next: BookingMode) => void;
  disabled?: boolean;
}

/**
 * Segmented control para elegir modo de estadía. Visualmente "premium":
 * el bloque seleccionado eleva un fondo color con glow y el contenido cambia
 * de tipografía. Bloquea cambios cuando la reserva está en check_out (post-mortem).
 */
function ModeSwitch({ mode, onChange, disabled = false }: ModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Modo de estadía"
      className={cn(
        "grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1",
        disabled && "opacity-60 pointer-events-none"
      )}
    >
      {(["temporario", "mensual"] as const).map((m) => {
        const meta = BOOKING_MODE_META[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={cn(
              "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all",
              "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? cn("bg-background shadow-sm ring-1", meta.ringClass)
                : "hover:bg-background/60 text-muted-foreground"
            )}
          >
            <div
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-sm font-bold transition-colors",
                active ? cn(meta.badgeBgClass, meta.textClass) : "bg-muted text-muted-foreground"
              )}
            >
              {m === "temporario" ? <CalendarRange size={15} /> : <House size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-semibold", active && meta.textClass)}>
                {meta.label}
              </div>
              <div className="text-[10px] leading-tight text-muted-foreground line-clamp-2">
                {meta.description}
              </div>
            </div>
            {active && (
              <span
                aria-hidden
                className="absolute right-2 top-2 size-1.5 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
