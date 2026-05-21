"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Pencil,
  Plus,
  Trash2,
  Loader2,
  History,
  Wallet,
  Info,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, formatDate, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SETTLEMENT_LINE_META } from "@/lib/settlements/labels";
import {
  updateSettlementBookingRow,
  removeSettlementBookingRow,
  addSettlementLine,
  updateSettlementLine,
  deleteSettlementLine,
} from "@/lib/actions/settlements";
import type { StatementModel } from "@/lib/settlements/statement-model";
import type { SettlementLine, SettlementAuditEntry } from "@/lib/types/database";
import { AddBookingRowDialog } from "./add-booking-row-dialog";

type LineType = SettlementLine["line_type"];
type Unit = { id: string; code: string; name: string };

const ACTION_LABEL: Record<SettlementAuditEntry["action"], string> = {
  line_add: "Cargo agregado",
  row_add: "Reserva agregada",
  line_update: "Cargo editado",
  line_delete: "Cargo eliminado",
  row_update: "Reserva editada",
  status_change: "Cambio de estado",
  payment: "Pago registrado",
  regenerate: "Regenerada",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function Money({ n, c, neg }: { n: number; c: string; neg?: boolean }) {
  if (!n) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "tabular-nums",
        neg && "text-rose-600 dark:text-rose-400",
      )}
    >
      {neg ? "−" : ""}
      {formatMoney(n, c)}
    </span>
  );
}

/**
 * Selector "¿este cambio impacta en Caja?". Siempre visible al editar.
 *   • Pagada  + ON  → postea un asiento de ajuste por la diferencia.
 *   • Pagada  + OFF → solo visual: el documento cambia, el egreso queda intacto.
 *   • Sin pagar + ON  → se refleja en Caja al registrar el pago.
 *   • Sin pagar + OFF → solo visual: no genera ningún movimiento de Caja.
 */
function CajaImpactToggle({
  value,
  onChange,
  currency,
  delta,
  paid,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  currency: string;
  delta: number;
  paid: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex items-start gap-3 transition-colors",
        value
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
          : "bg-muted/40",
      )}
    >
      <Switch
        id={id}
        checked={value}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
      <div className="space-y-0.5 min-w-0">
        <Label htmlFor={id} className="text-sm cursor-pointer">
          {value ? "Impacta en Caja" : "Solo visual"}
        </Label>
        <p className="text-xs text-muted-foreground">
          {value ? (
            paid ? (
              <>
                Genera un asiento de ajuste en Caja
                {delta !== 0 && (
                  <>
                    {" "}
                    de{" "}
                    <span className="font-medium text-foreground">
                      {delta > 0 ? "+" : "−"}
                      {formatMoney(Math.abs(delta), currency)}
                    </span>
                  </>
                )}
                .
              </>
            ) : (
              <>Se refleja en Caja al registrar el pago.</>
            )
          ) : paid ? (
            <>
              Actualiza solo el documento (PDF / planilla). No mueve Caja: el
              egreso ya pagado queda intacto.
            </>
          ) : (
            <>
              Actualiza solo el documento (PDF / planilla). No genera ningún
              movimiento de Caja.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Editor de fila ─────────────────────────── */

function RowEditor({
  open,
  onOpenChange,
  settlementId,
  currency,
  paid,
  currentNet,
  row,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settlementId: string;
  currency: string;
  paid: boolean;
  currentNet: number;
  row: StatementModel["units"][number]["rows"][number];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [guest, setGuest] = useState(row.guest === "—" ? "" : row.guest);
  const [checkIn, setCheckIn] = useState(row.check_in ?? "");
  const [checkOut, setCheckOut] = useState(row.check_out ?? "");
  const [nights, setNights] = useState(String(row.nights ?? 0));
  const [gross, setGross] = useState(String(row.gross));
  const [pct, setPct] = useState(
    String(
      row.commissionPct ??
        (row.gross > 0 ? round2((row.commission / row.gross) * 100) : 0),
    ),
  );
  const [commission, setCommission] = useState(String(row.commission));
  const [expenses, setExpenses] = useState(String(row.expenses));
  const [impactCaja, setImpactCaja] = useState(true);

  const oldNet = round2(row.gross - row.commission - row.expenses);
  const newNet = round2(num(gross) - num(commission) - num(expenses));
  const delta = round2(newNet - oldNet);
  const projected = round2(currentNet + delta);

  function onGross(v: string) {
    setGross(v);
    const g = num(v);
    setCommission(String(round2((g * num(pct)) / 100)));
  }
  function onPct(v: string) {
    setPct(v);
    setCommission(String(round2((num(gross) * num(v)) / 100)));
  }
  function onCommission(v: string) {
    setCommission(v);
    const g = num(gross);
    setPct(g > 0 ? String(round2((num(v) / g) * 100)) : "0");
  }

  function save() {
    if (num(gross) < 0) {
      toast.error("El bruto no puede ser negativo");
      return;
    }
    start(async () => {
      try {
        const res = await updateSettlementBookingRow({
          settlement_id: settlementId,
          ref_id: row.ref_id!,
          nights: Math.max(0, Math.round(num(nights))),
          gross: round2(num(gross)),
          commission: round2(num(commission)),
          expenses: round2(num(expenses)),
          guest_name: guest.trim() || null,
          check_in: checkIn || null,
          check_out: checkOut || null,
          impact_caja: impactCaja,
        });
        toast.success("Reserva actualizada", {
          description:
            res.adjustmentId != null
              ? `Asiento de ajuste en Caja de ${formatMoney(Math.abs(res.delta), currency)}`
              : res.visualOnly && paid
                ? "Solo visual — Caja sin cambios"
                : undefined,
        });
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo guardar", {
          description: (e as Error).message,
        });
      }
    });
  }

  function remove() {
    start(async () => {
      try {
        const res = await removeSettlementBookingRow({
          settlement_id: settlementId,
          ref_id: row.ref_id!,
          impact_caja: impactCaja,
        });
        toast.success("Reserva quitada de la liquidación", {
          description:
            res.adjustmentId != null
              ? `Asiento de ajuste en Caja de ${formatMoney(Math.abs(res.delta), currency)}`
              : res.visualOnly && paid
                ? "Solo visual — Caja sin cambios"
                : undefined,
        });
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo quitar", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar reserva</DialogTitle>
          <DialogDescription>
            Ajustá noches o importes (por común acuerdo). El neto se recalcula
            solo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Huésped</Label>
            <Input value={guest} onChange={(e) => setGuest(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Ingreso</Label>
              <Input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Egreso</Label>
              <Input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Noches</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={nights}
                onChange={(e) => setNights(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Bruto</Label>
              <Input
                type="number"
                step="0.01"
                value={gross}
                onChange={(e) => onGross(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>% comisión</Label>
              <Input
                type="number"
                step="0.01"
                value={pct}
                onChange={(e) => onPct(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Comisión</Label>
              <Input
                type="number"
                step="0.01"
                value={commission}
                onChange={(e) => onCommission(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Gastos (limpieza / expensas)</Label>
            <Input
              type="number"
              step="0.01"
              value={expenses}
              onChange={(e) => setExpenses(e.target.value)}
            />
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Neto de esta fila</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(newNet, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Neto liquidación</span>
              <span className="tabular-nums flex items-center gap-1.5">
                <span className="text-muted-foreground">
                  {formatMoney(currentNet, currency)}
                </span>
                <ArrowRight size={11} className="text-muted-foreground" />
                <span
                  className={cn(
                    "font-medium",
                    delta > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : delta < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "",
                  )}
                >
                  {formatMoney(projected, currency)}
                </span>
              </span>
            </div>
          </div>

          <CajaImpactToggle
            value={impactCaja}
            onChange={setImpactCaja}
            currency={currency}
            delta={delta}
            paid={paid}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-2"
                disabled={pending}
              >
                <Trash2 size={14} /> Quitar reserva
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Quitar la reserva?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminan todas sus líneas de la liquidación
                  {paid &&
                    (impactCaja
                      ? " y se genera el ajuste correspondiente en Caja"
                      : " (solo visual: Caja queda intacta)")}
                  . Queda registrado en el historial.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={remove}
                  className="bg-rose-600 hover:bg-rose-700"
                >
                  Quitar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending} className="gap-2">
              {pending && <Loader2 size={14} className="animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Otros cargos ─────────────────────────── */

const CHARGE_TYPES: { value: LineType; label: string }[] = [
  { value: "adjustment", label: "Ajuste" },
  { value: "cleaning_charge", label: "Limpieza" },
  { value: "maintenance_charge", label: "Mantenimiento" },
  { value: "expenses_fraction", label: "Expensas / servicios" },
  { value: "commission", label: "Comisión" },
];

function ChargeDialog({
  open,
  onOpenChange,
  settlementId,
  currency,
  paid,
  units,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settlementId: string;
  currency: string;
  paid: boolean;
  units: Unit[];
  initial?: {
    id: string;
    description: string;
    amount: number;
    sign: "+" | "-";
    line_type: LineType;
    unitCode: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lineType, setLineType] = useState<LineType>(
    initial?.line_type ?? "adjustment",
  );
  const [sign, setSign] = useState<"+" | "-">(initial?.sign ?? "-");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : "",
  );
  const [unitId, setUnitId] = useState("none");
  const [impactCaja, setImpactCaja] = useState(true);

  function submit() {
    if (description.trim().length < 2 || !(num(amount) > 0)) {
      toast.error("Completá descripción e importe (> 0)");
      return;
    }
    start(async () => {
      try {
        const payload = {
          line_type: lineType,
          description: description.trim(),
          amount: round2(num(amount)),
          sign,
          impact_caja: impactCaja,
        };
        const res = initial
          ? await updateSettlementLine({ id: initial.id, ...payload })
          : await addSettlementLine({
              settlement_id: settlementId,
              unit_id: unitId === "none" ? null : unitId,
              ...payload,
            });
        toast.success(initial ? "Cargo actualizado" : "Cargo agregado", {
          description:
            res?.adjustmentId != null
              ? `Asiento de ajuste en Caja de ${formatMoney(Math.abs(res.delta), currency)}`
              : res?.visualOnly && paid
                ? "Solo visual — Caja sin cambios"
                : undefined,
        });
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo guardar", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Editar cargo" : "Agregar cargo / ajuste"}
          </DialogTitle>
          <DialogDescription>
            Para liquidar “unas cositas más” por común acuerdo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={lineType}
                onValueChange={(v) => setLineType(v as LineType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Signo</Label>
              <Select
                value={sign}
                onValueChange={(v) => setSign(v as "+" | "-")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="+">+ Suma al neto</SelectItem>
                  <SelectItem value="-">− Resta del neto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Luz, reintegro, bonificación…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Importe</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {!initial && (
              <div className="space-y-1.5">
                <Label>Unidad (opcional)</Label>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sin unidad</SelectItem>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.code} · {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <CajaImpactToggle
            value={impactCaja}
            onChange={setImpactCaja}
            currency={currency}
            paid={paid}
            delta={round2(
              (sign === "+" ? 1 : -1) * num(amount) -
                (initial
                  ? (initial.sign === "+" ? 1 : -1) * initial.amount
                  : 0),
            )}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Historial ─────────────────────────── */

function AuditSheet({
  open,
  onOpenChange,
  audit,
  currency,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  audit: SettlementAuditEntry[];
  currency: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Historial de cambios</SheetTitle>
          <SheetDescription>
            Quién modificó la liquidación, qué cambió y su impacto en Caja.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6 space-y-3">
          {audit.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">
              Sin cambios registrados todavía.
            </p>
          )}
          {audit.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border p-3 text-sm space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary" className="font-normal">
                  {ACTION_LABEL[a.action] ?? a.action}
                </Badge>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock size={11} />
                  {formatTimeAgo(a.occurred_at)}
                </span>
              </div>
              <div className="text-muted-foreground">
                por <span className="text-foreground">{a.actor_name}</span>
              </div>
              {a.changes && typeof a.changes === "object" && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(
                    a.changes as Record<string, unknown>,
                  ).map(([k, val]) => {
                    const fromTo = val as
                      | { from?: unknown; to?: unknown }
                      | unknown;
                    const isFT =
                      fromTo &&
                      typeof fromTo === "object" &&
                      ("from" in (fromTo as object) ||
                        "to" in (fromTo as object));
                    return (
                      <li key={k}>
                        <span className="font-medium text-foreground/80">
                          {k}
                        </span>
                        {isFT ? (
                          <>
                            :{" "}
                            {String(
                              (fromTo as { from?: unknown }).from ?? "—",
                            )}{" "}
                            → {String((fromTo as { to?: unknown }).to ?? "—")}
                          </>
                        ) : (
                          <>: {String(val)}</>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {a.side_effects?.length > 0 && (
                <div className="flex flex-col gap-1 pt-1">
                  {a.side_effects.map((s, i) => (
                    <span
                      key={i}
                      className="text-[11px] inline-flex items-center gap-1.5 text-primary"
                    >
                      <Wallet size={11} /> {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Importes en {currency}.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────── Documento ─────────────────────────── */

export function EditableSettlementStatement({
  model,
  settlementId,
  currency,
  status,
  paid,
  units,
  audit,
}: {
  model: StatementModel;
  settlementId: string;
  currency: string;
  status: string;
  paid: boolean;
  units: Unit[];
  audit: SettlementAuditEntry[];
}) {
  const c = currency;
  const [editingRow, setEditingRow] = useState<
    StatementModel["units"][number]["rows"][number] | null
  >(null);
  const [addCharge, setAddCharge] = useState(false);
  const [addBooking, setAddBooking] = useState(false);
  const [editCharge, setEditCharge] = useState<
    | {
        id: string;
        description: string;
        amount: number;
        sign: "+" | "-";
        line_type: LineType;
        unitCode: string | null;
      }
    | null
  >(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingCharge, setDeletingCharge] = useState<{
    id: string;
    description: string;
    signed: number;
  } | null>(null);
  const [delImpact, setDelImpact] = useState(true);
  const [deletingRow, setDeletingRow] = useState<
    StatementModel["units"][number]["rows"][number] | null
  >(null);
  const [delRowImpact, setDelRowImpact] = useState(true);
  const router = useRouter();
  const [pending, start] = useTransition();

  const lastEdit = audit[0] ?? null;
  const editable = status !== "anulada";

  // El modelo de "otros" ya trae el id real de la settlement_line.
  const otros = useMemo(
    () => model.otros.map((o, i) => ({ ...o, key: `${o.id}-${i}` })),
    [model.otros],
  );

  function confirmRemoveCharge() {
    if (!deletingCharge) return;
    const { id } = deletingCharge;
    start(async () => {
      try {
        const res = await deleteSettlementLine(id, delImpact);
        toast.success("Cargo eliminado", {
          description:
            res?.adjustmentId != null
              ? `Asiento de ajuste en Caja de ${formatMoney(Math.abs(res.delta), c)}`
              : res?.visualOnly && paid
                ? "Solo visual — Caja sin cambios"
                : undefined,
        });
        setDeletingCharge(null);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo eliminar", {
          description: (e as Error).message,
        });
      }
    });
  }

  function confirmRemoveRow() {
    const r = deletingRow;
    if (!r?.ref_id) return;
    start(async () => {
      try {
        const res = await removeSettlementBookingRow({
          settlement_id: settlementId,
          ref_id: r.ref_id!,
          impact_caja: delRowImpact,
        });
        toast.success("Reserva quitada de la liquidación", {
          description:
            res.adjustmentId != null
              ? `Asiento de ajuste en Caja de ${formatMoney(Math.abs(res.delta), c)}`
              : res.visualOnly && paid
                ? "Solo visual — Caja sin cambios"
                : undefined,
        });
        setDeletingRow(null);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo quitar", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Card className="overflow-hidden p-0 gap-0">
      {/* Header */}
      <div className="brand-gradient text-white px-5 sm:px-7 py-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.12),transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] opacity-80">
              Estado de liquidación
            </div>
            <div className="text-lg sm:text-xl font-bold mt-1 font-mono">
              {model.number}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base sm:text-lg font-semibold">
              {model.periodLabel}
            </div>
            <div
              className="inline-flex items-center gap-1.5 text-[11px] font-medium mt-1 px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "oklch(1 0 0 / 0.16)" }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: model.statusColor }}
              />
              {model.statusLabel}
            </div>
          </div>
        </div>
        <div className="relative mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-white/75 flex items-center gap-1.5">
            {lastEdit ? (
              <>
                <Clock size={12} />
                Última edición por{" "}
                <span className="font-medium text-white">
                  {lastEdit.actor_name}
                </span>{" "}
                · {formatTimeAgo(lastEdit.occurred_at)}
              </>
            ) : (
              <>
                <Info size={12} /> Editá tocando una fila o un cargo
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1.5 bg-white/15 hover:bg-white/25 text-white border-0"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={13} /> Historial
            {audit.length > 0 && (
              <span className="ml-0.5 text-[10px] opacity-80">
                ({audit.length})
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Datos */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        {[
          ["Propietario", model.owner.full_name],
          ["Período", model.periodLabel],
          ["Moneda", model.currency],
          ["Generada", formatDate(model.generated_at, "dd/MM/yyyy HH:mm")],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {k}
            </dt>
            <dd className="text-sm font-medium mt-0.5 truncate">{v}</dd>
          </div>
        ))}
      </dl>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-y">
        <Kpi label="Bruto" value={formatMoney(model.totals.gross, c)} />
        <Kpi
          label="Comisión"
          value={`−${formatMoney(model.totals.commission, c)}`}
        />
        <Kpi
          label="Gastos"
          value={`−${formatMoney(model.totals.deductions, c)}`}
        />
        <div className="bg-primary/5 px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Neto a transferir
          </div>
          <div
            className={cn(
              "text-xl font-bold mt-1 tabular-nums",
              model.totals.net >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {formatMoney(model.totals.net, c)}
          </div>
        </div>
      </div>

      {/* Banner contexto Caja */}
      {editable && (
        <div
          className={cn(
            "flex items-start gap-2.5 px-4 sm:px-6 py-2.5 text-xs border-b",
            paid
              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          <Wallet size={14} className="mt-0.5 shrink-0" />
          <span>
            {paid ? (
              <>
                Liquidación <strong>pagada</strong>. En cada cambio elegís si{" "}
                <strong>impacta en Caja</strong> (postea un asiento de ajuste
                por la diferencia, sin reescribir el egreso original) o es{" "}
                <strong>solo visual</strong>. Todo queda en el historial a tu
                nombre.
              </>
            ) : (
              <>
                Tocá una fila o un cargo para editar. En cada cambio elegís si{" "}
                <strong>impacta en Caja</strong> o es <strong>solo visual</strong>;
                todo queda en el historial.
              </>
            )}
          </span>
        </div>
      )}

      {/* Planilla */}
      <div className="p-4 sm:p-6 space-y-6">
        {editable && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">Reservas</h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={() => setAddBooking(true)}
            >
              <Plus size={13} /> Agregar reserva
            </Button>
          </div>
        )}
        {model.units.length === 0 && (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed py-4 text-center">
            Sin reservas en este período. Usá “Agregar reserva” para cargar una
            a mano.
          </p>
        )}

        {model.units.map((u) => (
          <div key={u.code} className="space-y-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">
                {u.code}{" "}
                <span className="text-muted-foreground font-normal">
                  · {u.name}
                </span>
              </h3>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="h-9">Ingreso</TableHead>
                    <TableHead className="h-9">Egreso</TableHead>
                    <TableHead className="h-9">Huésped</TableHead>
                    <TableHead className="h-9 text-center">Noches</TableHead>
                    <TableHead className="h-9 text-right">Bruto</TableHead>
                    <TableHead className="h-9 text-right">Comisión</TableHead>
                    <TableHead className="h-9 text-right">Gastos</TableHead>
                    <TableHead className="h-9 text-right">Neto</TableHead>
                    {editable && (
                      <TableHead className="h-9 w-14" aria-label="Acciones" />
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {u.rows.map((b) => (
                    <TableRow
                      key={b.ref_id}
                      className={cn(
                        "text-sm group/row",
                        editable &&
                          b.ref_id &&
                          "cursor-pointer hover:bg-accent/40",
                      )}
                      onClick={
                        editable && b.ref_id
                          ? () => setEditingRow(b)
                          : undefined
                      }
                    >
                      <TableCell className="whitespace-nowrap">
                        {b.check_in ? formatDate(b.check_in) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {b.check_out ? formatDate(b.check_out) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {b.guest}
                        {b.mode === "mensual" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            mensual
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {b.nights ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(b.gross, c)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money n={b.commission} c={c} neg />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money n={b.expenses} c={c} neg />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {formatMoney(b.net, c)}
                      </TableCell>
                      {editable && (
                        <TableCell className="w-14 p-0">
                          {b.ref_id && (
                            <div className="flex items-center justify-center gap-0.5 pr-1 opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity">
                              <Pencil
                                size={13}
                                className="hidden sm:block text-muted-foreground"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-rose-600"
                                aria-label="Quitar reserva"
                                disabled={pending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDelRowImpact(true);
                                  setDeletingRow(b);
                                }}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={4} className="text-right">
                      Subtotal {u.code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(u.subtotal.gross, c)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money n={u.subtotal.commission} c={c} neg />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money n={u.subtotal.expenses} c={c} neg />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(u.subtotal.net, c)}
                    </TableCell>
                    {editable && <TableCell className="w-14" />}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
        ))}

        {/* Otros cargos */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">Otros cargos</h3>
            </div>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={() => setAddCharge(true)}
              >
                <Plus size={13} /> Agregar cargo
              </Button>
            )}
          </div>
          {otros.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-lg border border-dashed py-4 text-center">
              Sin otros cargos. Usá “Agregar cargo” para sumar luz, reintegros
              o ajustes por común acuerdo.
            </p>
          ) : (
            <div className="rounded-lg border divide-y">
              {otros.map((o) => {
                const lm = SETTLEMENT_LINE_META[o.line_type];
                const id = o.id;
                return (
                  <div
                    key={o.key}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm group/charge",
                      editable && id && "hover:bg-accent/30",
                    )}
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: lm?.color ?? "#64748b" }}
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {o.description}
                      {o.unitCode && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground font-mono">
                          {o.unitCode}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums font-medium shrink-0",
                        o.sign === "+"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {o.sign === "+" ? "+" : "−"}
                      {formatMoney(o.amount, c)}
                    </span>
                    {editable && id && (
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/charge:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="Editar cargo"
                          onClick={() =>
                            setEditCharge({
                              id,
                              description: o.description,
                              amount: o.amount,
                              sign: o.sign,
                              line_type: o.line_type,
                              unitCode: o.unitCode,
                            })
                          }
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-rose-600"
                          aria-label="Eliminar cargo"
                          disabled={pending}
                          onClick={() => {
                            setDelImpact(true);
                            setDeletingCharge({
                              id,
                              description: o.description,
                              signed:
                                (o.sign === "+" ? 1 : -1) * o.amount,
                            });
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagar a */}
        {(model.owner.bank_name ||
          model.owner.cbu ||
          model.owner.alias_cbu) && (
          <div className="rounded-lg bg-muted/40 border p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Pagar a
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Banco</div>
                <div className="font-medium">
                  {model.owner.bank_name ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">CBU</div>
                <div className="font-mono text-xs break-all select-all">
                  {model.owner.cbu ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Alias</div>
                <div className="font-mono select-all">
                  {model.owner.alias_cbu ?? "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {editingRow && (
        <RowEditor
          open={!!editingRow}
          onOpenChange={(o) => !o && setEditingRow(null)}
          settlementId={settlementId}
          currency={c}
          paid={paid}
          currentNet={model.totals.net}
          row={editingRow}
        />
      )}
      <ChargeDialog
        open={addCharge}
        onOpenChange={setAddCharge}
        settlementId={settlementId}
        currency={c}
        paid={paid}
        units={units}
      />
      <AddBookingRowDialog
        open={addBooking}
        onOpenChange={setAddBooking}
        settlementId={settlementId}
        currency={c}
        units={units}
        currentNet={model.totals.net}
      />
      {editCharge && (
        <ChargeDialog
          open={!!editCharge}
          onOpenChange={(o) => !o && setEditCharge(null)}
          settlementId={settlementId}
          currency={c}
          paid={paid}
          units={units}
          initial={editCharge}
        />
      )}
      <AuditSheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        audit={audit}
        currency={c}
      />

      <AlertDialog
        open={!!deletingCharge}
        onOpenChange={(o) => !o && setDeletingCharge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el cargo?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deletingCharge?.description}”. Queda registrado en el
              historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <CajaImpactToggle
            value={delImpact}
            onChange={setDelImpact}
            currency={c}
            paid={paid}
            delta={deletingCharge ? round2(-deletingCharge.signed) : 0}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveCharge}
              disabled={pending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deletingRow}
        onOpenChange={(o) => !o && setDeletingRow(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRow && deletingRow.guest !== "—"
                ? `“${deletingRow.guest}”`
                : "Esta reserva"}
              {deletingRow?.check_in && deletingRow?.check_out
                ? ` · ${formatDate(deletingRow.check_in)} → ${formatDate(deletingRow.check_out)}`
                : ""}
              . Se eliminan todas sus líneas de la liquidación y no se le cobra
              en este período. Queda registrado en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <CajaImpactToggle
            value={delRowImpact}
            onChange={setDelRowImpact}
            currency={c}
            paid={paid}
            delta={deletingRow ? round2(-deletingRow.net) : 0}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveRow}
              disabled={pending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-base sm:text-lg font-semibold mt-1 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}
