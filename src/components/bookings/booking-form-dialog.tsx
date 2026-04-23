"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2, UserPlus, Search } from "lucide-react";
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
import { BOOKING_SOURCE_META, BOOKING_STATUS_META } from "@/lib/constants";
import { formatNights } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Booking, Guest, Unit } from "@/lib/types/database";

interface BookingFormDialogProps {
  children: React.ReactNode;
  booking?: Booking;
  units: Pick<Unit, "id" | "code" | "name" | "default_commission_pct" | "base_price" | "base_price_currency" | "cleaning_fee">[];
  defaultUnitId?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  /** Callback cuando el dialog se cierra (para coordinar con el parent) */
  onClosed?: () => void;
}

export function BookingFormDialog({
  children,
  booking,
  units,
  defaultUnitId,
  defaultCheckIn,
  defaultCheckOut,
  onClosed,
}: BookingFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!booking;

  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestSearchOpen, setGuestSearchOpen] = useState(false);
  const [guestQuery, setGuestQuery] = useState("");
  const [guestResults, setGuestResults] = useState<Guest[]>([]);

  const [form, setForm] = useState<BookingInput>({
    unit_id: booking?.unit_id ?? defaultUnitId ?? "",
    guest_id: booking?.guest_id ?? null,
    source: booking?.source ?? "directo",
    external_id: booking?.external_id ?? "",
    status: booking?.status ?? "confirmada",
    check_in_date: booking?.check_in_date ?? defaultCheckIn ?? "",
    check_in_time: booking?.check_in_time ?? "15:00",
    check_out_date: booking?.check_out_date ?? defaultCheckOut ?? "",
    check_out_time: booking?.check_out_time ?? "11:00",
    guests_count: booking?.guests_count ?? 2,
    currency: booking?.currency ?? "ARS",
    total_amount: booking?.total_amount ?? 0,
    paid_amount: booking?.paid_amount ?? 0,
    commission_pct: booking?.commission_pct ?? null,
    cleaning_fee: booking?.cleaning_fee ?? null,
    notes: booking?.notes ?? "",
    internal_notes: booking?.internal_notes ?? "",
  });

  function set<K extends keyof BookingInput>(k: K, v: BookingInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
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

  // Auto-fill currency + cleaning_fee + commission cuando elige unit
  function onSelectUnit(unitId: string) {
    set("unit_id", unitId);
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    if (u.base_price_currency && !isEdit) set("currency", u.base_price_currency);
    if (u.cleaning_fee && !form.cleaning_fee) set("cleaning_fee", u.cleaning_fee);
    if (u.default_commission_pct !== null && u.default_commission_pct !== undefined && !isEdit) {
      set("commission_pct", u.default_commission_pct);
    }
  }

  const nights =
    form.check_in_date && form.check_out_date && form.check_out_date > form.check_in_date
      ? formatNights(form.check_in_date, form.check_out_date)
      : 0;

  const commissionAmount =
    form.commission_pct !== null && form.commission_pct !== undefined
      ? (Number(form.total_amount) * Number(form.commission_pct)) / 100
      : 0;
  const ownerNet = Number(form.total_amount) - commissionAmount - Number(form.cleaning_fee ?? 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && booking) {
          await updateBooking(booking.id, form);
          toast.success("Reserva actualizada");
        } else {
          await createBooking(form);
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
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Unidad *</Label>
              <Select value={form.unit_id} onValueChange={onSelectUnit} required>
                <SelectTrigger><SelectValue placeholder="Elegí la unidad" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="font-mono text-xs mr-2">{u.code}</span>
                      {u.name}
                    </SelectItem>
                  ))}
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
                    {selectedGuest?.full_name ?? form.guest_id ? selectedGuest?.full_name ?? "Seleccionado" : "Buscar huésped existente…"}
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
              <Input type="date" required value={form.check_in_date} onChange={(e) => set("check_in_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input type="time" value={form.check_in_time} onChange={(e) => set("check_in_time", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Check-out *</Label>
              <Input type="date" required value={form.check_out_date} onChange={(e) => set("check_out_date", e.target.value)} />
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

          {/* Money */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USDT">USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Total</Label>
              <Input type="number" min="0" step="0.01" value={form.total_amount} onChange={(e) => set("total_amount", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Cobrado</Label>
              <Input type="number" min="0" step="0.01" value={form.paid_amount} onChange={(e) => set("paid_amount", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Comisión %</Label>
              <Input type="number" min="0" max="100" step="0.01" value={form.commission_pct ?? ""} onChange={(e) => set("commission_pct", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Fee limpieza</Label>
              <Input type="number" min="0" step="0.01" value={form.cleaning_fee ?? ""} onChange={(e) => set("cleaning_fee", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
          </div>

          {form.total_amount > 0 && (
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted/40 rounded-lg text-xs">
              <div>
                <div className="text-muted-foreground">Comisión Apart Cba</div>
                <div className="font-medium font-mono">{commissionAmount.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Fee limpieza</div>
                <div className="font-medium font-mono">{Number(form.cleaning_fee ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Neto al propietario</div>
                <div className="font-semibold font-mono text-emerald-600 dark:text-emerald-400">{ownerNet.toFixed(2)}</div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notas para el huésped</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notas internas</Label>
            <Textarea rows={2} value={form.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} placeholder="Solo el equipo lo ve" />
          </div>

          <DialogFooter>
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
