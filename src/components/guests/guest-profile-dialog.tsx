"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  ShieldAlert,
  ShieldCheck,
  Pencil,
  Save,
  X,
  Loader2,
  CalendarDays,
  Moon,
  DollarSign,
  Clock,
  IdCard,
  StickyNote,
  ConciergeBell,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGuestProfile,
  updateGuest,
  toggleBlacklistGuest,
  type GuestInput,
  type GuestProfile,
} from "@/lib/actions/guests";
import {
  formatMoney,
  formatDate,
  formatDateLong,
  formatTimeAgo,
  formatNights,
  formatPhone,
  getInitials,
} from "@/lib/format";
import { BOOKING_STATUS_META, BOOKING_SOURCE_META } from "@/lib/constants";
import type { BookingStatus, BookingSource, Guest } from "@/lib/types/database";

interface GuestProfileDialogProps {
  guest: Guest;
  children: React.ReactNode;
}

export function GuestProfileDialog({ guest, children }: GuestProfileDialogProps) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Trackeo "previous value": al cambiar `open` o `guest.id` reseteamos el state
  // local durante render — evita los setState dentro de useEffect (regla
  // react-hooks/set-state-in-effect).
  const fetchKey = open ? guest.id : "__closed";
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey);
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey);
    if (!open) {
      setEditing(false);
    } else {
      setLoading(true);
      setProfile(null);
    }
  }

  // El effect ahora sólo dispara la petición — no toca state sincrónicamente,
  // sólo cuando llega la respuesta async (lo que es válido bajo la regla).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getGuestProfile(guest.id)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((e) => toast.error("Error", { description: (e as Error).message }))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, guest.id]);

  const current = profile ?? (guest as GuestProfile);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="sr-only">Perfil de {guest.full_name}</DialogTitle>
        </DialogHeader>

        <ProfileHeader
          guest={current}
          editing={editing}
          onToggleEdit={() => setEditing((e) => !e)}
          onBlacklistChange={() => {
            setProfile((p) => (p ? { ...p, blacklisted: !p.blacklisted } : p));
            router.refresh();
          }}
          isPending={isPending}
        />

        <div className="px-6 pb-2">
          <StatsGrid profile={current} loading={loading && !profile} />
        </div>

        <Tabs defaultValue="datos" className="px-6 pb-6">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="datos">Datos</TabsTrigger>
            <TabsTrigger value="reservas" className="gap-1.5">
              Reservas
              {profile && profile.bookings.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {profile.bookings.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="conserjeria" className="gap-1.5">
              Tareas
              {profile && profile.concierge_requests.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {profile.concierge_requests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="datos" className="mt-4">
            <DatosTab
              guest={current}
              editing={editing}
              isPending={isPending}
              onCancel={() => setEditing(false)}
              onSave={(input) => {
                startTransition(async () => {
                  try {
                    const updated = await updateGuest(guest.id, input);
                    setProfile((p) =>
                      p ? { ...p, ...updated } : (updated as GuestProfile)
                    );
                    setEditing(false);
                    toast.success("Datos actualizados");
                    router.refresh();
                  } catch (e) {
                    toast.error("Error", { description: (e as Error).message });
                  }
                });
              }}
            />
          </TabsContent>

          <TabsContent value="reservas" className="mt-4">
            <ReservasTab loading={loading} bookings={profile?.bookings ?? []} />
          </TabsContent>

          <TabsContent value="conserjeria" className="mt-4">
            <ConserjeriaTab
              loading={loading}
              requests={profile?.concierge_requests ?? []}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── HEADER ─────────── */

function ProfileHeader({
  guest,
  editing,
  onToggleEdit,
  onBlacklistChange,
  isPending,
}: {
  guest: Guest;
  editing: boolean;
  onToggleEdit: () => void;
  onBlacklistChange: () => void;
  isPending: boolean;
}) {
  const [blacklistPending, startBlacklistTransition] = useTransition();
  const [reasonInput, setReasonInput] = useState(guest.blacklist_reason ?? "");
  const [confirmingBlacklist, setConfirmingBlacklist] = useState(false);

  function applyBlacklist(blacklist: boolean) {
    startBlacklistTransition(async () => {
      try {
        await toggleBlacklistGuest(
          guest.id,
          blacklist,
          blacklist ? reasonInput.trim() || undefined : undefined
        );
        toast.success(blacklist ? "Huésped en blacklist" : "Blacklist removido");
        setConfirmingBlacklist(false);
        onBlacklistChange();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="px-6 pt-2 pb-4 flex items-start gap-4">
      <Avatar className="size-16 ring-2 ring-primary/15">
        <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
          {getInitials(guest.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-semibold tracking-tight truncate">
            {guest.full_name}
          </h2>
          {guest.blacklisted && (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert size={11} /> Blacklist
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          {guest.phone && (
            <span className="flex items-center gap-1">
              <Phone size={11} /> {formatPhone(guest.phone)}
            </span>
          )}
          {guest.email && (
            <span className="flex items-center gap-1 truncate">
              <Mail size={11} /> {guest.email}
            </span>
          )}
          {(guest.city || guest.country) && (
            <span className="flex items-center gap-1">
              <MapPin size={11} /> {[guest.city, guest.country].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
        {guest.blacklisted && guest.blacklist_reason && (
          <p className="mt-2 text-xs text-destructive/90 italic">
            Motivo: {guest.blacklist_reason}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!editing ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onToggleEdit}
              disabled={isPending}
            >
              <Pencil size={14} /> Editar
            </Button>
            {!guest.blacklisted ? (
              !confirmingBlacklist ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setConfirmingBlacklist(true)}
                  disabled={blacklistPending}
                >
                  <ShieldAlert size={14} /> Blacklist
                </Button>
              ) : (
                <BlacklistConfirm
                  reason={reasonInput}
                  setReason={setReasonInput}
                  onCancel={() => setConfirmingBlacklist(false)}
                  onConfirm={() => applyBlacklist(true)}
                  pending={blacklistPending}
                />
              )
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => applyBlacklist(false)}
                disabled={blacklistPending}
              >
                {blacklistPending ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                Quitar blacklist
              </Button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function BlacklistConfirm({
  reason,
  setReason,
  onCancel,
  onConfirm,
  pending,
}: {
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo (opcional)"
        className="h-8 text-xs w-44"
        autoFocus
      />
      <Button
        size="sm"
        variant="destructive"
        className="h-8 px-2.5"
        onClick={onConfirm}
        disabled={pending}
      >
        {pending ? <Loader2 className="animate-spin" size={14} /> : "Confirmar"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2"
        onClick={onCancel}
        disabled={pending}
      >
        <X size={14} />
      </Button>
    </div>
  );
}

/* ─────────── KPI GRID ─────────── */

function StatsGrid({ profile, loading }: { profile: Guest & Partial<Pick<GuestProfile, "bookings">>; loading: boolean }) {
  const totalNights = useMemo(() => {
    if (!profile.bookings) return null;
    return profile.bookings.reduce((acc, b) => {
      if (b.status === "cancelada" || b.status === "no_show") return acc;
      return acc + formatNights(b.check_in_date, b.check_out_date);
    }, 0);
  }, [profile.bookings]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <KpiCard
        icon={<CalendarDays size={14} />}
        label="Reservas"
        value={profile.total_bookings ?? 0}
      />
      <KpiCard
        icon={<Moon size={14} />}
        label="Noches"
        value={loading ? "—" : (totalNights ?? 0)}
      />
      <KpiCard
        icon={<DollarSign size={14} />}
        label="Facturado"
        value={formatMoney(profile.total_revenue ?? 0, "ARS")}
      />
      <KpiCard
        icon={<Clock size={14} />}
        label="Última estadía"
        value={profile.last_stay_at ? formatTimeAgo(profile.last_stay_at) : "—"}
      />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ─────────── TAB: DATOS ─────────── */

function DatosTab({
  guest,
  editing,
  isPending,
  onCancel,
  onSave,
}: {
  guest: Guest;
  editing: boolean;
  isPending: boolean;
  onCancel: () => void;
  onSave: (input: GuestInput) => void;
}) {
  // Re-inicialización del form ante cambios de guest o ante entrar/salir de
  // edición — patrón "ajuste de state durante render" sin useEffect+setState.
  const [prevKey, setPrevKey] = useState(`${guest.id}|${editing}`);
  const [form, setForm] = useState<GuestInput>(() => toFormState(guest));
  const nextKey = `${guest.id}|${editing}`;
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setForm(toFormState(guest));
  }

  if (!editing) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <ReadField icon={<IdCard size={13} />} label="Documento">
          {guest.document_type && guest.document_number
            ? `${guest.document_type} ${guest.document_number}`
            : "—"}
        </ReadField>
        <ReadField icon={<Mail size={13} />} label="Email">
          {guest.email ?? "—"}
        </ReadField>
        <ReadField icon={<Phone size={13} />} label="Teléfono">
          {guest.phone ? formatPhone(guest.phone) : "—"}
        </ReadField>
        <ReadField icon={<MapPin size={13} />} label="Ubicación">
          {[guest.city, guest.country].filter(Boolean).join(", ") || "—"}
        </ReadField>
        <ReadField icon={<Calendar size={13} />} label="Fecha de nacimiento">
          {guest.birth_date ? formatDateLong(guest.birth_date) : "—"}
        </ReadField>
        <ReadField icon={<Clock size={13} />} label="Cliente desde">
          {formatDate(guest.created_at)}
        </ReadField>
        <div className="md:col-span-2 mt-2">
          <ReadField icon={<StickyNote size={13} />} label="Notas">
            {guest.notes ? (
              <p className="whitespace-pre-wrap text-sm">{guest.notes}</p>
            ) : (
              "—"
            )}
          </ReadField>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>Nombre completo *</Label>
        <Input
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo doc.</Label>
          <Select
            value={form.document_type ?? "DNI"}
            onValueChange={(v) => setForm({ ...form, document_type: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DNI">DNI</SelectItem>
              <SelectItem value="Pasaporte">Pasaporte</SelectItem>
              <SelectItem value="CUIT">CUIT</SelectItem>
              <SelectItem value="otro">Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label>Número</Label>
          <Input
            value={form.document_number ?? ""}
            onChange={(e) => setForm({ ...form, document_number: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email ?? ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Teléfono</Label>
          <Input
            value={form.phone ?? ""}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>País</Label>
          <Input
            value={form.country ?? "AR"}
            maxLength={3}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label>Ciudad</Label>
          <Input
            value={form.city ?? ""}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Fecha de nacimiento</Label>
        <Input
          type="date"
          value={form.birth_date ?? ""}
          onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Notas</Label>
        <Textarea
          rows={3}
          value={form.notes ?? ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Preferencias, alergias, observaciones…"
        />
      </div>
      <Separator />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

function toFormState(guest: Guest): GuestInput {
  return {
    full_name: guest.full_name,
    document_type: guest.document_type ?? "DNI",
    document_number: guest.document_number ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    country: guest.country ?? "AR",
    city: guest.city ?? "",
    birth_date: guest.birth_date ?? "",
    notes: guest.notes ?? "",
  };
}

function ReadField({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/* ─────────── TAB: RESERVAS ─────────── */

function ReservasTab({
  loading,
  bookings,
}: {
  loading: boolean;
  bookings: GuestProfile["bookings"];
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Aún no hay reservas para este huésped.
      </div>
    );
  }

  return (
    <div className="rounded-lg border divide-y">
      {bookings.map((b) => {
        const statusMeta = BOOKING_STATUS_META[b.status as BookingStatus];
        const sourceMeta = BOOKING_SOURCE_META[b.source as BookingSource];
        const nights = formatNights(b.check_in_date, b.check_out_date);
        return (
          <Link
            key={b.id}
            href={`/dashboard/reservas/${b.id}`}
            className="flex items-center justify-between gap-4 p-3 hover:bg-accent/40 transition-colors group"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  style={{ borderColor: statusMeta?.color, color: statusMeta?.color }}
                  className="gap-1.5"
                >
                  <span
                    className="status-dot"
                    style={{ backgroundColor: statusMeta?.color }}
                  />
                  {statusMeta?.label ?? b.status}
                </Badge>
                {sourceMeta && (
                  <Badge variant="secondary" className="text-[10px]">
                    {sourceMeta.label}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {nights} {nights === 1 ? "noche" : "noches"} · {b.guests_count}p
                </span>
              </div>
              <div className="mt-1 text-sm font-medium flex items-center gap-1.5">
                <CalendarDays size={13} className="text-muted-foreground" />
                {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                {b.unit && (
                  <>
                    <span className="text-muted-foreground mx-1">·</span>
                    <span className="font-mono text-xs text-muted-foreground">{b.unit.code}</span>
                    <span className="text-xs">{b.unit.name}</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold tabular-nums">
                {formatMoney(b.total_amount, b.currency)}
              </div>
              {b.paid_amount < b.total_amount && b.status !== "cancelada" && (
                <div className="text-xs text-amber-600 dark:text-amber-400 tabular-nums">
                  Saldo {formatMoney(b.total_amount - b.paid_amount, b.currency)}
                </div>
              )}
              <ExternalLink
                size={11}
                className="inline-block mt-1 text-muted-foreground/60 group-hover:text-primary transition-colors"
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* ─────────── TAB: CONSERJERÍA ─────────── */

function ConserjeriaTab({
  loading,
  requests,
}: {
  loading: boolean;
  requests: GuestProfile["concierge_requests"];
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Sin tareas para este huésped.
      </div>
    );
  }

  return (
    <div className="rounded-lg border divide-y">
      {requests.map((r) => (
        <div key={r.id} className="p-3 flex items-start gap-3">
          <div className="mt-0.5 size-7 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
            <ConciergeBell size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {r.request_type && (
                <Badge variant="secondary" className="text-[10px]">
                  {r.request_type}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] capitalize">
                {r.status}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {r.priority}
              </Badge>
            </div>
            <p className="mt-1 text-sm">{r.description}</p>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              {r.scheduled_for && (
                <span>Programado: {formatDate(r.scheduled_for)}</span>
              )}
              {r.completed_at && (
                <span>Completado: {formatDate(r.completed_at)}</span>
              )}
            </div>
          </div>
          {r.cost !== null && r.cost !== undefined && (
            <div className="text-sm font-semibold tabular-nums shrink-0">
              {formatMoney(r.cost, r.cost_currency ?? "ARS")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
