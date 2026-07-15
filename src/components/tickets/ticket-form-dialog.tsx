"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleCheck, Loader2, MessageCircle, Pencil, Phone, UserCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UnitCombobox } from "@/components/ui/unit-combobox";
import { createTicket, updateTicket, type TicketInput } from "@/lib/actions/tickets";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import type { MaintenanceTicket, Unit, Owner } from "@/lib/types/database";
import type { CurrentOccupancy } from "@/lib/actions/bookings";
import type { TicketMember } from "./ticket-detail-dialog";
import { cn } from "@/lib/utils";

const UNASSIGNED = "__none__";

interface Props {
  children: React.ReactNode;
  ticket?: MaintenanceTicket;
  units: Pick<Unit, "id" | "code" | "name">[];
  owners: Owner[];
  members?: TicketMember[];
  defaultUnitId?: string;
  occupancyByUnit?: Record<string, CurrentOccupancy>;
}

export function TicketFormDialog({ children, ticket, units, owners, members, defaultUnitId, occupancyByUnit }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = !!ticket;

  const [form, setForm] = useState<TicketInput>({
    unit_id: ticket?.unit_id ?? defaultUnitId ?? "",
    title: ticket?.title ?? "",
    description: ticket?.description ?? "",
    category: ticket?.category ?? "",
    priority: ticket?.priority ?? "media",
    status: ticket?.status ?? "abierto",
    assigned_to: ticket?.assigned_to ?? null,
    estimated_cost: ticket?.estimated_cost ?? null,
    actual_cost: ticket?.actual_cost ?? null,
    cost_currency: ticket?.cost_currency ?? "ARS",
    billable_to: ticket?.billable_to ?? "apartcba",
    related_owner_id: ticket?.related_owner_id ?? null,
    notes: ticket?.notes ?? "",
    contact_name: ticket?.contact_name ?? null,
    contact_phone: ticket?.contact_phone ?? null,
  });

  function set<K extends keyof TicketInput>(k: K, v: TicketInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (isEdit && ticket) {
          await updateTicket(ticket.id, form);
          toast.success("Ticket actualizado");
        } else {
          await createTicket(form);
          toast.success("Ticket creado");
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar ticket" : "Nuevo ticket"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Unidad *</Label>
            <UnitCombobox
              units={units}
              value={form.unit_id}
              onChange={(id) => set("unit_id", id ?? "")}
              placeholder="Elegir..."
            />
            {form.unit_id && occupancyByUnit && (
              <OccupancyPanel
                key={form.unit_id}
                occupancy={occupancyByUnit[form.unit_id] ?? null}
                onContactChange={(contact) => {
                  set("contact_name", contact.name);
                  set("contact_phone", contact.phone);
                }}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Título *</Label>
            <Input id="title" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Termotanque sin agua caliente" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v as TicketInput["priority"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TICKET_PRIORITY_META).map(([k, m]) => (
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
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as TicketInput["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TICKET_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.category ?? ""} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plomeria">Plomería</SelectItem>
                  <SelectItem value="electricidad">Electricidad</SelectItem>
                  <SelectItem value="electrodomestico">Electrodoméstico</SelectItem>
                  <SelectItem value="pintura">Pintura</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {members && members.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Wrench size={13} /> Asignar a
              </Label>
              <Select
                value={form.assigned_to ?? UNASSIGNED}
                onValueChange={(v) => set("assigned_to", v === UNASSIGNED ? null : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={UNASSIGNED}>Sin asignar</SelectItem>
                  {members.map((mem) => (
                    <SelectItem key={mem.user_id} value={mem.user_id}>
                      {mem.full_name?.trim() || "Sin nombre"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label>Costo estimado</Label>
              <Input type="number" min="0" step="0.01" value={form.estimated_cost ?? ""} onChange={(e) => set("estimated_cost", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Costo real</Label>
              <Input type="number" min="0" step="0.01" value={form.actual_cost ?? ""} onChange={(e) => set("actual_cost", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Lo paga</Label>
              <Select value={form.billable_to} onValueChange={(v) => set("billable_to", v as TicketInput["billable_to"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apartcba">rentOS (absorbe)</SelectItem>
                  <SelectItem value="owner">Propietario (se descuenta de la liquidación)</SelectItem>
                  <SelectItem value="guest">Huésped (se cobra)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.billable_to === "owner" && (
              <div className="space-y-1.5">
                <Label>Propietario</Label>
                <Select value={form.related_owner_id ?? ""} onValueChange={(v) => set("related_owner_id", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {isEdit ? "Guardar" : "Crear ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OccupancyPanel({
  occupancy,
  onContactChange,
}: {
  occupancy: CurrentOccupancy | null;
  onContactChange?: (contact: { name: string | null; phone: string | null }) => void;
}) {
  const occupied = !!occupancy;
  const occName = occupancy?.guest_name?.trim() ?? "";
  const occPhone = occupancy?.guest_phone?.trim() ?? "";

  // Prellenamos el contacto con los datos del ocupante (si hay); recepción
  // puede editarlos o —en un depto vacío— cargar a quién llamar (encargado…).
  const [phone, setPhone] = useState(occPhone);
  const [contactName, setContactName] = useState(occName);
  const [editing, setEditing] = useState(false);

  const trimmed = phone.trim();
  const nameTrimmed = contactName.trim();

  // Guardamos SIEMPRE el nombre+teléfono mostrados en el ticket, para que el
  // técnico tenga con quién coordinar desde el celular; vacío → null. Deps
  // acotadas para no re-disparar en cada render (React Compiler).
  useEffect(() => {
    if (!onContactChange) return;
    onContactChange({ name: nameTrimmed || null, phone: trimmed || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, nameTrimmed]);

  const isMonthly = occupancy?.mode === "mensual";
  const occLabel = isMonthly ? "Inquilino" : "Huésped";
  const statusLabel = occupancy?.status === "check_in" ? "Ocupado" : "Reservado";

  const phoneDigits = trimmed.replace(/\D/g, "");
  const waHref = phoneDigits ? `https://wa.me/${phoneDigits}` : null;
  const telHref = phoneDigits ? `tel:${trimmed}` : null;
  const edited = occupied && (trimmed !== occPhone || nameTrimmed !== occName);

  const cx = occupied
    ? {
        wrap: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
        accent: "text-amber-700 dark:text-amber-400",
        strong: "text-amber-900 dark:text-amber-200",
        soft: "text-amber-700/70 dark:text-amber-300/70",
        link: "text-amber-700 dark:text-amber-300",
        help: "text-amber-800/70 dark:text-amber-300/70",
      }
    : {
        wrap: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30",
        accent: "text-emerald-600 dark:text-emerald-400",
        strong: "text-emerald-900 dark:text-emerald-200",
        soft: "text-emerald-700/70 dark:text-emerald-300/70",
        link: "text-emerald-700 dark:text-emerald-300",
        help: "text-emerald-800/70 dark:text-emerald-300/70",
      };

  return (
    <div className={cn("mt-2 rounded-md border p-3 text-xs", cx.wrap)}>
      <div className="flex items-center gap-2">
        {occupied ? (
          <UserCheck size={14} className={cn("shrink-0", cx.accent)} />
        ) : (
          <CircleCheck size={14} className={cn("shrink-0", cx.accent)} />
        )}
        <span className={cn("font-semibold", cx.strong)}>
          {occupied ? statusLabel : "Disponible"}
        </span>
        <span className={cx.soft}>
          {occupied
            ? `· ${occLabel} hasta ${formatShortDate(occupancy!.check_out_date)}`
            : "— sin huéspedes en el depto"}
        </span>
      </div>

      <div className="mt-2 pl-6">
        {(occupied || nameTrimmed !== "") && (
          <div className="font-medium text-foreground truncate">
            {nameTrimmed || "Sin nombre"}
          </div>
        )}

        {editing ? (
          <div className="mt-1.5 space-y-1.5">
            <Input
              type="tel"
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Teléfono — +54 9 351 555-1234"
              className="h-7 text-xs"
            />
            <div className="flex items-center gap-2">
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nombre del contacto (opcional)"
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => setEditing(false)}
              >
                Listo
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {trimmed ? (
                <span className="truncate tabular-nums text-muted-foreground">{trimmed}</span>
              ) : (
                <span className="italic text-muted-foreground">
                  {occupied ? "Sin teléfono cargado" : "Sin contacto"}
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-[11px] font-medium hover:underline",
                  cx.link
                )}
              >
                <Pencil size={11} /> {trimmed ? "Editar" : "Agregar contacto"}
              </button>
              {edited && (
                <button
                  type="button"
                  onClick={() => {
                    setPhone(occPhone);
                    setContactName(occName);
                  }}
                  className="shrink-0 text-[11px] text-muted-foreground hover:underline"
                >
                  Restablecer
                </button>
              )}
            </div>
            {phoneDigits.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[11px]"
                  title="Llamar"
                >
                  <a href={telHref!}>
                    <Phone size={12} /> Llamar
                  </a>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="h-7 gap-1 bg-[#25D366] px-2 text-[11px] text-white hover:bg-[#1fb955]"
                  title="Coordinar por WhatsApp"
                >
                  <a href={waHref!} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={12} /> WhatsApp
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className={cn("mt-2 pl-6 text-[11px] leading-snug", cx.help)}>
        {occupied
          ? `Coordiná día y horario del arreglo directamente con ${isMonthly ? "el inquilino" : "el huésped"}.`
          : "Depto vacío. Si hay quién abra o coordine (encargado, dueño…), agregá su contacto."}
        {edited ? " Estás usando datos distintos a los de la reserva." : ""}
      </p>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
