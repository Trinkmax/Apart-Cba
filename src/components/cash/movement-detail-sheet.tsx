"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRightLeft,
  Building,
  Building2,
  BedDouble,
  User2,
  Calendar,
  ExternalLink,
  Wallet,
  Edit,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Lock,
  X,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getMovementDetail,
  listMovementAudit,
  previewMovementUpdate,
  updateMovement,
  type CashMovementAuditEntry,
  type MovementDetail,
  type UpdateMovementInput,
  type PreviewResult,
} from "@/lib/actions/cash";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashAccount, Unit } from "@/lib/types/database";
import { MovementDeleteAlert } from "./movement-delete-alert";

const CATEGORY_LABELS: Record<UpdateMovementInput["category"], string> = {
  booking_payment: "Cobro de reserva",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación a propietario",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  salary: "Sueldo",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  refund: "Devolución",
  other: "Otro",
};

interface Props {
  movementId: string | null;
  open: boolean;
  onClose: () => void;
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
}

export function MovementDetailSheet({ movementId, open, onClose, accounts, units }: Props) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl sm:w-[36rem] flex flex-col p-0">
        {open && movementId ? (
          <SheetLoader
            // key fuerza remount al cambiar de movimiento, lo que también
            // resetea tab y detalle sin necesidad de setState en effects.
            key={movementId}
            movementId={movementId}
            accounts={accounts}
            units={units}
            onClose={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetLoader({
  movementId,
  accounts,
  units,
  onClose,
}: {
  movementId: string;
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  const [audit, setAudit] = useState<CashMovementAuditEntry[]>([]);
  const [tab, setTab] = useState<"detalle" | "editar">("detalle");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMovementDetail(movementId), listMovementAudit(movementId)])
      .then(([d, a]) => {
        if (!cancelled) {
          setDetail(d);
          setAudit(a);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error("No se pudo cargar el movimiento", { description: (e as Error).message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  if (!detail) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <SheetBody
      detail={detail}
      audit={audit}
      accounts={accounts}
      units={units}
      tab={tab}
      setTab={setTab}
      onClose={onClose}
    />
  );
}

function SheetBody({
  detail,
  audit,
  accounts,
  units,
  tab,
  setTab,
  onClose,
}: {
  detail: MovementDetail;
  audit: CashMovementAuditEntry[];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  tab: "detalle" | "editar";
  setTab: (t: "detalle" | "editar") => void;
  onClose: () => void;
}) {
  const isIn = detail.direction === "in";
  const isTransfer = detail.category === "transfer";
  const isLockedSettlement = detail.linked_settlement?.is_locked ?? false;
  const isScheduleLinked = detail.linked_schedule !== null;
  const canEditCategory = !isTransfer && !isScheduleLinked;
  const canEditDirection = !isScheduleLinked && !isTransfer;

  return (
    <>
      <SheetHeader className="border-b px-5 py-4 gap-2">
        <SheetTitle className="sr-only">Movimiento de caja</SheetTitle>
        <SheetDescription className="sr-only">Detalle del movimiento</SheetDescription>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "size-10 rounded-xl flex items-center justify-center shrink-0",
              isTransfer
                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                : isIn
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            )}
          >
            {isTransfer ? <ArrowRightLeft size={18} /> : isIn ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="font-normal text-[10px]">
                {CATEGORY_LABELS[detail.category]}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{formatDateTime(detail.occurred_at)}</span>
            </div>
            <div
              className={cn(
                "text-2xl sm:text-3xl font-semibold tabular-nums mt-0.5",
                isIn ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
              )}
            >
              {isIn ? "+" : "−"} {formatMoney(detail.amount, detail.currency)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-accent flex items-center justify-center shrink-0 transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>
      </SheetHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "detalle" | "editar")} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-5 mt-3 self-start">
          <TabsTrigger value="detalle">Detalle</TabsTrigger>
          <TabsTrigger value="editar" disabled={isLockedSettlement}>
            Editar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="detalle" className="flex-1 overflow-y-auto px-5 pb-5 pt-3 space-y-4 mt-0">
          <DetailPane detail={detail} audit={audit} />
        </TabsContent>

        <TabsContent value="editar" className="flex-1 overflow-y-auto px-5 pb-5 pt-3 mt-0">
          {isLockedSettlement ? (
            <LockedNotice detail={detail} />
          ) : (
            <EditPane
              detail={detail}
              accounts={accounts}
              units={units}
              canEditCategory={canEditCategory}
              canEditDirection={canEditDirection}
              onSaved={() => {
                setTab("detalle");
              }}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Footer destructivo siempre visible (excepto si está bloqueado) */}
      {tab === "detalle" && !isLockedSettlement && (
        <div className="border-t px-5 py-3 flex items-center justify-between gap-2">
          <MovementDeleteAlert
            movement={detail}
            onDeleted={onClose}
            trigger={
              <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1.5">
                <Trash2 size={14} /> Eliminar
              </Button>
            }
          />
          <Button onClick={() => setTab("editar")} className="gap-1.5">
            <Edit size={14} /> Editar
          </Button>
        </div>
      )}
      {tab === "detalle" && isLockedSettlement && detail.linked_settlement && (
        <div className="border-t px-5 py-3" />
      )}
    </>
  );
}

const BILLABLE_META: Record<"apartcba" | "owner" | "guest", { label: string; icon: React.ReactNode; cls: string }> = {
  apartcba: {
    label: "Organización",
    icon: <Building size={11} />,
    cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  },
  owner: {
    label: "Propietario",
    icon: <User2 size={11} />,
    cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  },
  guest: {
    label: "Huésped",
    icon: <BedDouble size={11} />,
    cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  },
};

function DetailPane({ detail, audit }: { detail: MovementDetail; audit: CashMovementAuditEntry[] }) {
  const lastEntry = audit[0] ?? null;
  const billable = BILLABLE_META[detail.billable_to ?? "apartcba"];
  return (
    <>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 inline-flex items-center gap-2 text-xs font-medium",
          billable.cls
        )}
      >
        {billable.icon}
        <span>Imputado a: {billable.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Cuenta">
          {detail.account ? (
            <Link
              href={`/dashboard/caja/${detail.account.id}`}
              className="flex items-center gap-2 hover:underline"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: detail.account.color ?? "#0F766E" }} />
              {detail.account.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
        <Field label="Moneda">{detail.currency}</Field>
        {detail.unit && (
          <Field label="Unidad">
            <Link href={`/dashboard/unidades/${detail.unit.id}`} className="hover:underline flex items-center gap-1.5">
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{detail.unit.code}</span>
              <span className="truncate">{detail.unit.name}</span>
            </Link>
          </Field>
        )}
        {detail.owner && (
          <Field label="Propietario">
            <Link href={`/dashboard/propietarios/${detail.owner.id}`} className="hover:underline truncate block">
              {detail.owner.full_name}
            </Link>
          </Field>
        )}
      </div>

      {detail.description && (
        <Field label="Descripción">
          <p className="text-sm whitespace-pre-wrap">{detail.description}</p>
        </Field>
      )}

      <Separator />

      {/* Vinculación */}
      {(detail.linked_booking || detail.linked_schedule || detail.linked_transfer || detail.linked_settlement) && (
        <div className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Vinculado a</h3>

          {detail.linked_schedule && detail.linked_booking && (
            <Link
              href={`/dashboard/reservas/${detail.linked_booking.id}`}
              className="block rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                  <Calendar size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    Cuota {detail.linked_schedule.sequence_number}/{detail.linked_schedule.total_count}
                    <span className="text-xs text-muted-foreground ml-2 font-normal">
                      vencía {detail.linked_schedule.due_date}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                    <span>Esperado: {formatMoney(detail.linked_schedule.expected_amount, detail.linked_schedule.currency)}</span>
                    <span>Cobrado: {formatMoney(detail.linked_schedule.paid_amount, detail.linked_schedule.currency)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="text-[10px] capitalize">{detail.linked_schedule.status}</Badge>
                  </div>
                </div>
                <ExternalLink size={14} className="text-muted-foreground shrink-0 mt-1" />
              </div>
            </Link>
          )}

          {detail.linked_booking && !detail.linked_schedule && (
            <Link
              href={`/dashboard/reservas/${detail.linked_booking.id}`}
              className="block rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                  <Building2 size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    Reserva {detail.linked_booking.guest_name ?? detail.linked_booking.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {detail.linked_booking.check_in_date} → {detail.linked_booking.check_out_date}
                    {detail.linked_booking.unit_code && (
                      <span className="ml-2 font-mono">· {detail.linked_booking.unit_code}</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs flex items-center gap-3">
                    <span className="text-muted-foreground">Total: {formatMoney(detail.linked_booking.total_amount, detail.linked_booking.currency)}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">Cobrado: {formatMoney(detail.linked_booking.paid_amount, detail.linked_booking.currency)}</span>
                  </div>
                </div>
                <ExternalLink size={14} className="text-muted-foreground shrink-0 mt-1" />
              </div>
            </Link>
          )}

          {detail.linked_transfer && detail.linked_transfer.sibling && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <ArrowRightLeft size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">Transferencia entre cuentas</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Lado contrario en{" "}
                    <Link href={`/dashboard/caja/${detail.linked_transfer.sibling.account_id}`} className="font-medium hover:underline">
                      {detail.linked_transfer.sibling.account_name}
                    </Link>
                    : {detail.linked_transfer.sibling.direction === "in" ? "+" : "−"}{" "}
                    {formatMoney(detail.linked_transfer.sibling.amount, detail.linked_transfer.sibling.currency)}
                  </div>
                  {detail.linked_transfer.exchange_rate && (
                    <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      Cotización: {detail.linked_transfer.exchange_rate.toFixed(4)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {detail.linked_settlement && (
            <div
              className={cn(
                "rounded-xl border p-4 flex items-start gap-3",
                detail.linked_settlement.is_locked
                  ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300/60 dark:border-amber-800/40"
                  : "bg-card"
              )}
            >
              <div className="size-10 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Wallet size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  Liquidación {String(detail.linked_settlement.period_month).padStart(2, "0")}/{detail.linked_settlement.period_year}
                  <Badge variant="outline" className="text-[10px] capitalize">{detail.linked_settlement.status}</Badge>
                </div>
                {detail.linked_settlement.owner_name && (
                  <div className="text-xs text-muted-foreground mt-0.5">{detail.linked_settlement.owner_name}</div>
                )}
                {detail.linked_settlement.is_locked && (
                  <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <Lock size={11} /> Bloqueado: editá desde la liquidación.
                  </div>
                )}
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={`/dashboard/liquidaciones/${detail.linked_settlement.id}`}>Abrir</Link>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Auditoría informativa */}
      {audit.length > 0 && lastEntry && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
              Historial de cambios
              <span className="text-muted-foreground/60 font-normal">({audit.length})</span>
            </h3>
            <div className="rounded-xl border bg-muted/20 p-3 text-xs space-y-2">
              {audit.slice(0, 5).map((e) => (
                <div key={e.id} className="flex items-start gap-2.5 not-last:pb-2 not-last:border-b border-border/60">
                  <div
                    className={cn(
                      "size-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase",
                      e.action === "delete"
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    )}
                    title={e.action === "delete" ? "Eliminación" : "Edición"}
                  >
                    {(e.actor_name || "?").trim().charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate">{e.actor_name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {formatDateTime(e.occurred_at)}
                      </span>
                    </div>
                    <div className="text-muted-foreground capitalize">
                      {e.action === "delete" ? "Eliminó el movimiento" : describeChanges(e.changes)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              El historial es informativo. No afecta el saldo de la cuenta.
            </p>
          </div>
        </>
      )}
    </>
  );
}

function describeChanges(changes: CashMovementAuditEntry["changes"]): string {
  const keys = Object.keys(changes ?? {});
  if (keys.length === 0) return "Editó el movimiento";
  const labels: Record<string, string> = {
    amount: "importe",
    direction: "dirección",
    account_id: "cuenta",
    category: "categoría",
    description: "descripción",
    occurred_at: "fecha",
    unit_id: "unidad",
    owner_id: "propietario",
  };
  return `Editó ${keys.map((k) => labels[k] ?? k).join(", ")}`;
}

function LockedNotice({ detail }: { detail: MovementDetail }) {
  const s = detail.linked_settlement!;
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-4 flex items-start gap-3">
      <Lock size={18} className="text-amber-700 dark:text-amber-300 mt-0.5" />
      <div className="text-sm text-amber-900 dark:text-amber-200">
        <div className="font-semibold">Movimiento bloqueado</div>
        <p className="mt-1">
          Está vinculado a la liquidación {String(s.period_month).padStart(2, "0")}/{s.period_year} en estado{" "}
          <span className="font-medium">{s.status}</span>. Anulá la liquidación primero para poder editarlo.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/dashboard/liquidaciones/${s.id}`}>Abrir liquidación</Link>
        </Button>
      </div>
    </div>
  );
}

function EditPane({
  detail,
  accounts,
  units,
  canEditCategory,
  canEditDirection,
  onSaved,
}: {
  detail: MovementDetail;
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  canEditCategory: boolean;
  canEditDirection: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  // Cuentas con la misma moneda (no se puede cambiar de moneda)
  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => a.currency === detail.currency && a.active),
    [accounts, detail.currency]
  );

  const [form, setForm] = useState<UpdateMovementInput>({
    id: detail.id,
    account_id: detail.account_id,
    direction: detail.direction,
    amount: Number(detail.amount),
    category: detail.category,
    unit_id: detail.unit_id,
    owner_id: detail.owner_id,
    description: detail.description ?? "",
    occurred_at: detail.occurred_at,
    billable_to: detail.billable_to ?? "apartcba",
    actor_name: "",
  });

  function set<K extends keyof UpdateMovementInput>(k: K, v: UpdateMovementInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setPreview(null);
  }

  const isDirty =
    form.account_id !== detail.account_id ||
    form.direction !== detail.direction ||
    Number(form.amount) !== Number(detail.amount) ||
    form.category !== detail.category ||
    (form.unit_id ?? null) !== (detail.unit_id ?? null) ||
    (form.owner_id ?? null) !== (detail.owner_id ?? null) ||
    (form.description ?? "") !== (detail.description ?? "") ||
    form.occurred_at !== detail.occurred_at ||
    form.billable_to !== (detail.billable_to ?? "apartcba");

  const actorOk = (form.actor_name?.trim().length ?? 0) >= 2;

  function runPreview() {
    setPreviewLoading(true);
    previewMovementUpdate({
      ...form,
      is_delete: false,
      force_transfer: false,
    })
      .then(setPreview)
      .catch((e) => toast.error("Error de validación", { description: (e as Error).message }))
      .finally(() => setPreviewLoading(false));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await updateMovement(form);
        const effects = (res.side_effects ?? []).filter((x) => x !== "Movimiento actualizado");
        toast.success("Movimiento actualizado", {
          description: effects.length ? effects.join(" · ") : undefined,
        });
        onSaved();
        router.refresh();
      } catch (e) {
        toast.error("No se pudo guardar", { description: (e as Error).message });
      }
    });
  }

  const selectedUnit = units.find((u) => u.id === form.unit_id) ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!canEditDirection}
          onClick={() => set("direction", "in")}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg p-2.5 border-2 transition-all text-sm",
            form.direction === "in"
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-border hover:border-emerald-500/50",
            !canEditDirection && "opacity-50 cursor-not-allowed"
          )}
        >
          <ArrowDownToLine size={14} />
          Ingreso
        </button>
        <button
          type="button"
          disabled={!canEditDirection}
          onClick={() => set("direction", "out")}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg p-2.5 border-2 transition-all text-sm",
            form.direction === "out"
              ? "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-400"
              : "border-border hover:border-rose-500/50",
            !canEditDirection && "opacity-50 cursor-not-allowed"
          )}
        >
          <ArrowUpFromLine size={14} />
          Egreso
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Importe ({detail.currency})</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount || ""}
            onChange={(e) => set("amount", Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cuenta</Label>
          <Select value={form.account_id} onValueChange={(v) => set("account_id", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {eligibleAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Categoría</Label>
        <Select
          value={form.category}
          onValueChange={(v) => set("category", v as UpdateMovementInput["category"])}
          disabled={!canEditCategory}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORY_LABELS)
              .filter(([k]) => canEditCategory || k === form.category)
              .map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        {!canEditCategory && (
          <p className="text-[11px] text-muted-foreground">
            La categoría está bloqueada por el tipo de vínculo (cuota o transferencia).
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Fecha y hora</Label>
        <Input
          type="datetime-local"
          value={toLocalInput(form.occurred_at ?? detail.occurred_at)}
          onChange={(e) => set("occurred_at", new Date(e.target.value).toISOString())}
        />
      </div>

      {units.length > 0 && (
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Building2 size={13} className="text-muted-foreground" />
            Unidad
            <span className="text-[10px] font-normal text-muted-foreground ml-0.5">(opcional)</span>
          </Label>
          <div className="flex gap-1.5">
            <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={unitPickerOpen}
                  className={cn("flex-1 justify-between font-normal", !selectedUnit && "text-muted-foreground")}
                >
                  {selectedUnit ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded bg-muted">{selectedUnit.code}</span>
                      <span className="truncate">{selectedUnit.name}</span>
                    </span>
                  ) : (
                    "Sin unidad asignada"
                  )}
                  <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar por código o nombre…" />
                  <CommandList>
                    <CommandEmpty>Sin coincidencias</CommandEmpty>
                    <CommandGroup>
                      {units.map((u) => {
                        const active = form.unit_id === u.id;
                        return (
                          <CommandItem
                            key={u.id}
                            value={`${u.code} ${u.name}`}
                            onSelect={() => {
                              set("unit_id", u.id);
                              setUnitPickerOpen(false);
                            }}
                            className="flex items-center gap-2"
                          >
                            <Check size={13} className={cn("shrink-0", active ? "opacity-100" : "opacity-0")} />
                            <span className="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded bg-muted">{u.code}</span>
                            <span className="truncate">{u.name}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedUnit && (
              <Button type="button" variant="ghost" size="icon" onClick={() => set("unit_id", null)} className="shrink-0">
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          ¿Quién paga / recibe? *
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { v: "apartcba", label: "Organización", icon: <Building size={14} /> },
            { v: "owner", label: "Propietario", icon: <User2 size={14} /> },
            { v: "guest", label: "Huésped", icon: <BedDouble size={14} /> },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => set("billable_to", opt.v)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg p-2.5 border-2 transition-all text-xs",
                form.billable_to === opt.v
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {opt.icon}
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Descripción</Label>
        <Textarea rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
      </div>

      {/* Auditoría: nombre del administrador que firma el cambio */}
      <div className="space-y-1.5 rounded-xl border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40 p-3">
        <Label className="text-amber-900 dark:text-amber-200 text-[11px] uppercase tracking-wider font-semibold">
          ¿Quién está haciendo este cambio? *
        </Label>
        <Input
          required
          value={form.actor_name ?? ""}
          onChange={(e) => set("actor_name", e.target.value)}
          placeholder="Nombre del administrador"
          className="h-9 bg-background"
        />
        <p className="text-[10px] text-amber-800/80 dark:text-amber-200/80">
          Queda registrado en el historial junto con la fecha y hora.
        </p>
      </div>

      {/* Preview de side-effects */}
      <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Vista previa de impacto
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runPreview}
            disabled={previewLoading || !isDirty}
            className="gap-1.5 h-7 text-xs"
          >
            {previewLoading && <Loader2 size={12} className="animate-spin" />}
            Calcular
          </Button>
        </div>
        {!preview && (
          <p className="text-[11px] text-muted-foreground">
            {isDirty
              ? "Tocá «Calcular» para ver qué entidades se afectarán antes de guardar."
              : "Hacé un cambio para ver su impacto."}
          </p>
        )}
        {preview && preview.blockers.length > 0 && (
          <div className="space-y-1">
            {preview.blockers.map((b, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-md p-2"
              >
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{b === "TRANSFER_REQUIRES_CONFIRM" ? "Esta transferencia requiere confirmación al eliminar." : b}</span>
              </div>
            ))}
          </div>
        )}
        {preview && preview.side_effects.length > 0 && (
          <ul className="space-y-1">
            {preview.side_effects.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
        {preview && preview.blockers.length === 0 && preview.side_effects.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Sin efectos colaterales.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onSaved}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isPending || !isDirty || !actorOk || (preview?.blockers?.length ?? 0) > 0}
          className="gap-1.5"
          title={!actorOk ? "Indicá tu nombre antes de guardar" : undefined}
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 truncate">{children}</div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  // Convierte ISO a formato `YYYY-MM-DDTHH:mm` aceptado por <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
