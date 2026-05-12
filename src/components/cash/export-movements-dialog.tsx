"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, FileText, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportMovements, type ExportMovementsFilters } from "@/lib/actions/cash";
import { getOrganizationBranding } from "@/lib/actions/org";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import type { CashAccount, MovementCategory } from "@/lib/types/database";

type RangePreset =
  | "today"
  | "yesterday"
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "custom";

const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  last_7: "Últimos 7 días",
  last_30: "Últimos 30 días",
  this_month: "Este mes",
  last_month: "Mes pasado",
  this_year: "Este año",
  last_year: "Año pasado",
  custom: "Personalizado",
};

const CATEGORY_LABELS: Record<MovementCategory, string> = {
  booking_payment: "Pago de reserva",
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
  refund: "Reintegro",
  other: "Otro",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as MovementCategory[];

const DIRECTION_LABEL: Record<"in" | "out", string> = { in: "Ingreso", out: "Egreso" };

const BILLABLE_LABEL: Record<"apartcba" | "owner" | "guest", string> = {
  apartcba: "rentOS",
  owner: "Propietario",
  guest: "Huésped",
};

interface Props {
  accounts: CashAccount[];
  /** Si se pasa, el dialog exporta sólo movimientos de esta cuenta y oculta el filtro de cuentas */
  accountId?: string;
  trigger?: React.ReactNode;
}

export function ExportMovementsDialog({ accounts, accountId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<MovementCategory[]>([]);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [billableTo, setBillableTo] = useState<"all" | "apartcba" | "owner" | "guest">("all");
  const [isPending, startTransition] = useTransition();
  const [pendingFormat, setPendingFormat] = useState<"csv" | "pdf" | null>(null);

  const accountById = useMemo(() => {
    const m = new Map<string, CashAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  function reset() {
    setPreset("this_month");
    setCustomFrom("");
    setCustomTo("");
    setAccountIds([]);
    setCategories([]);
    setDirection("all");
    setBillableTo("all");
  }

  function handleExport(format: "csv" | "pdf") {
    if (!range) {
      toast.error("Seleccioná un rango de fechas válido");
      return;
    }

    const filters: ExportMovementsFilters = {
      fromDate: range.fromIso,
      toDate: range.toIso,
      accountIds: accountId ? [accountId] : accountIds.length ? accountIds : undefined,
      categories: categories.length ? categories : undefined,
      direction,
      billableTo,
    };

    setPendingFormat(format);
    startTransition(async () => {
      try {
        const rows = await exportMovements(filters);
        if (rows.length === 0) {
          toast.info("No se encontraron movimientos para los filtros seleccionados");
          return;
        }

        const filenameSuffix = accountId
          ? sanitize(accountById.get(accountId)?.name ?? "cuenta")
          : "todas";

        if (format === "csv") {
          const csv = buildCsv(rows);
          const filename = `movimientos_${filenameSuffix}_${range.fromLabel}_a_${range.toLabel}.csv`;
          downloadCsv(filename, csv);
        } else {
          const [branding, { generateCashMovementsPDF }] = await Promise.all([
            getOrganizationBranding(),
            import("@/lib/pdf/cash-movements-pdf"),
          ]);
          await generateCashMovementsPDF(
            rows,
            {
              fromLabel: range.fromLabel,
              toLabel: range.toLabel,
              rangeSummary: range.summary,
              filenameSuffix,
            },
            branding,
          );
        }

        toast.success(`Se exportaron ${rows.length.toLocaleString("es-AR")} movimientos`);
        setOpen(false);
      } catch (e) {
        toast.error("Error al exportar", { description: (e as Error).message });
      } finally {
        setPendingFormat(null);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-1.5 sm:gap-2 flex-1 sm:flex-none">
            <Download size={15} />
            <span className="hidden xs:inline sm:inline">Exportar</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Exportar movimientos</DialogTitle>
          <DialogDescription>
            Genera un archivo CSV con los movimientos de caja según los filtros que elijas.
          </DialogDescription>
        </DialogHeader>

        {/* Body del modal: scroll INTERNO acá (no en el DialogContent), así
            el footer sticky siempre permanece visible y los popovers que se
            abren dentro no empujan el footer fuera de la pantalla. */}
        <div className="space-y-5 mt-1 -mx-1 px-1">
          {/* Período */}
          <div className="space-y-2">
            <Label>Período</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                    preset === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-accent border-border"
                  }`}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Desde</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Hasta</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </div>
            )}
            {range ? (
              <p className="text-[11px] text-muted-foreground">
                {range.summary}
              </p>
            ) : (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                Elegí ambas fechas (desde/hasta) para continuar.
              </p>
            )}
          </div>

          {/* Cuentas (sólo en modo "todas") */}
          {!accountId && (
            <div className="space-y-2">
              <Label>Cuentas</Label>
              <MultiSelectPopover
                placeholder={accountIds.length ? `${accountIds.length} seleccionadas` : "Todas las cuentas"}
                items={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  hint: `${a.type} · ${a.currency}`,
                  color: a.color ?? undefined,
                }))}
                selected={accountIds}
                onChange={setAccountIds}
              />
            </div>
          )}

          {/* Categorías */}
          <div className="space-y-2">
            <Label>Categorías</Label>
            <MultiSelectPopover
              placeholder={categories.length ? `${categories.length} seleccionadas` : "Todas las categorías"}
              items={ALL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
              selected={categories}
              onChange={(v) => setCategories(v as MovementCategory[])}
            />
          </div>

          {/* Dirección + Facturable a */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="in">Sólo ingresos</SelectItem>
                  <SelectItem value="out">Sólo egresos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Facturable a</Label>
              <Select value={billableTo} onValueChange={(v) => setBillableTo(v as typeof billableTo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="apartcba">rentOS</SelectItem>
                  <SelectItem value="owner">Propietario</SelectItem>
                  <SelectItem value="guest">Huésped</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleExport("pdf")}
            disabled={!range || isPending}
            className="gap-1.5"
          >
            {pendingFormat === "pdf" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <FileText size={15} />
            )}
            Exportar PDF
          </Button>
          <Button
            type="button"
            onClick={() => handleExport("csv")}
            disabled={!range || isPending}
            className="gap-1.5"
          >
            {pendingFormat === "csv" ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Download size={15} />
            )}
            Exportar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-select reusable
// ────────────────────────────────────────────────────────────────────────────

interface MultiSelectItem {
  value: string;
  label: string;
  hint?: string;
  color?: string;
}

function MultiSelectPopover({
  placeholder,
  items,
  selected,
  onChange,
}: {
  placeholder: string;
  items: MultiSelectItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  }
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className={selected.length ? "" : "text-muted-foreground"}>{placeholder}</span>
          <ChevronDown size={14} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Altura fija con max-height explícito en el contenedor scrolleable.
        // Se evita el patrón flex-1 + min-h-0 porque es frágil cuando el
        // popover se renderiza dentro de un Dialog en algunos navegadores.
        className="p-0 w-[var(--radix-popover-trigger-width)]"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={16}
        avoidCollisions
      >
        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : items.map((i) => i.value))}
            className="text-xs font-medium hover:text-primary"
          >
            {allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
          {selected.length > 0 && !allSelected && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          )}
        </div>
        <div
          className="overflow-y-auto overscroll-contain p-1.5 space-y-0.5"
          style={{ maxHeight: "min(280px, 50svh)" }}
        >
          {items.map((it) => {
            const checked = selected.includes(it.value);
            return (
              <label
                key={it.value}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded cursor-pointer text-sm"
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(it.value)} />
                {it.color && (
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: it.color }}
                  />
                )}
                <span className="truncate flex-1">{it.label}</span>
                {it.hint && <span className="text-[10px] text-muted-foreground capitalize">{it.hint}</span>}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CSV building
// ────────────────────────────────────────────────────────────────────────────

function buildCsv(
  rows: Awaited<ReturnType<typeof exportMovements>>
): string {
  const header = [
    "Fecha",
    "Cuenta",
    "Moneda",
    "Tipo",
    "Categoría",
    "Monto",
    "Saldo posterior",
    "Unidad",
    "Propietario",
    "Descripción",
    "Facturable a",
    "Creado por",
    "ID",
  ];

  const dataRows = rows.map((r) => [
    formatDateTime(r.occurred_at),
    r.account_name,
    r.currency,
    DIRECTION_LABEL[r.direction],
    CATEGORY_LABELS[r.category],
    r.direction === "out" ? -r.amount : r.amount,
    r.running_balance,
    r.unit_code ?? "",
    r.owner_name ?? "",
    r.description ?? "",
    BILLABLE_LABEL[r.billable_to],
    r.created_by_name ?? "",
    r.id,
  ]);

  // Resumen agrupado por moneda
  const byCurrency = new Map<string, { in: number; out: number; count: number }>();
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { in: 0, out: 0, count: 0 };
    if (r.direction === "in") t.in += r.amount;
    else t.out += r.amount;
    t.count += 1;
    byCurrency.set(r.currency, t);
  }

  const summaryRows: (string | number)[][] = [];
  summaryRows.push([]);
  summaryRows.push(["Resumen"]);
  summaryRows.push(["Moneda", "Movimientos", "Total ingresos", "Total egresos", "Neto"]);
  for (const [currency, t] of byCurrency) {
    summaryRows.push([currency, t.count, t.in, t.out, t.in - t.out]);
  }

  return toCsv([header, ...dataRows, ...summaryRows]);
}

// ────────────────────────────────────────────────────────────────────────────
// Range computation
// ────────────────────────────────────────────────────────────────────────────

function computeRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string
): { fromIso: string; toIso: string; fromLabel: string; toLabel: string; summary: string } | null {
  const now = new Date();
  let from: Date;
  let to: Date;

  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    from = new Date(`${customFrom}T00:00:00`);
    to = new Date(`${customTo}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  } else {
    [from, to] = computePresetRange(preset, now);
  }

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const fromLabel = isoDate(from);
  const toLabel = isoDate(to);
  const summary = sameDay(from, to)
    ? `Movimientos del ${formatHuman(from)}`
    : `Del ${formatHuman(from)} al ${formatHuman(to)}`;

  return { fromIso, toIso, fromLabel, toLabel, summary };
}

function computePresetRange(preset: RangePreset, now: Date): [Date, Date] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86400_000);

  switch (preset) {
    case "today":
      return [today, endOfDay(today)];
    case "yesterday":
      return [yesterday, endOfDay(yesterday)];
    case "last_7":
      return [new Date(today.getTime() - 6 * 86400_000), endOfDay(now)];
    case "last_30":
      return [new Date(today.getTime() - 29 * 86400_000), endOfDay(now)];
    case "this_month":
      return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)];
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return [start, end];
    }
    case "this_year":
      return [new Date(now.getFullYear(), 0, 1), endOfDay(now)];
    case "last_year": {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return [start, end];
    }
    default:
      return [today, endOfDay(today)];
  }
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHuman(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function sanitize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
