"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CopyCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/rentals/ui";
import { getExpensasGrid, saveExpensasAmounts } from "@/lib/actions/rentals-collections";
import type { ExpensasGridRow } from "@/lib/rentals/server/collections-queries";
import { formatContractNumber, monthLabelOf, CHARGE_STATE_META } from "@/lib/rentals/labels";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { multiMoney } from "./board-helpers";
import { cn } from "@/lib/utils";
import { Spinner } from "./whatsapp-message-dialog";

const toText = (n: number | null) => (n != null && n > 0 ? n.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "");

/** Grilla para cargar las expensas del mes de los contratos cuyas expensas cobra la inmobiliaria. */
export function ExpensasSheet({ month, count }: { month: string; count: number }) {
  const [open, setOpen] = useState(false);
  // Importes tipeados y sin guardar (los informa la grilla). Cerrar con Esc, tocando
  // afuera o con la X no los tira en silencio: primero se pregunta, adentro del panel.
  const [dirty, setDirty] = useState(0);
  const [askClose, setAskClose] = useState(false);
  const close = () => {
    setDirty(0);
    setAskClose(false);
    setOpen(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else if (dirty > 0) setAskClose(true);
        else close();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Building2 size={14} /> Cargar expensas
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums">{count}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl sm:w-[36rem] flex flex-col p-0 gap-0">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Building2 size={16} className="text-sky-600" /> Expensas de {monthLabelOf(month)}
          </SheetTitle>
          <SheetDescription>
            Se suman al alquiler del mes de cada inquilino y, cuando se cobran, quedan para pagarle al consorcio.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <ExpensasGrid
            month={month}
            onDone={close}
            onDirtyChange={(n) => {
              setDirty(n);
              // Si deshizo todos los cambios, la pregunta ya no aplica (no reaparece al seguir tipeando).
              if (n === 0) setAskClose(false);
            }}
            askClose={askClose && dirty > 0}
            onKeepEditing={() => setAskClose(false)}
            onDiscard={close}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type GridState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; rows: ExpensasGridRow[] };

function ExpensasGrid({
  month,
  onDone,
  onDirtyChange,
  askClose,
  onKeepEditing,
  onDiscard,
}: {
  month: string;
  onDone: () => void;
  /** Cuántos importes quedaron sin guardar: el panel lo usa para preguntar antes de cerrar. */
  onDirtyChange: (n: number) => void;
  /** Se quiso cerrar con cambios sin guardar: mostrar la confirmación. */
  askClose: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<GridState>({ status: "loading" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [loader] = useState(() => () => getExpensasGrid(month));

  useEffect(() => {
    let alive = true;
    loader()
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setState({ status: "error", error: res.error });
          return;
        }
        setValues(Object.fromEntries(res.rows.map((r) => [r.contractId, toText(r.amount)])));
        setState({ status: "ready", rows: res.rows });
      })
      .catch(() => alive && setState({ status: "error", error: "No pudimos leer las expensas. Probá de nuevo." }));
    return () => {
      alive = false;
    };
  }, [loader]);

  const rows = state.status === "ready" ? state.rows : [];
  const editable = rows.filter((r) => r.chargeId);
  const changed = editable.filter((r) => {
    const n = parseAmountInput(values[r.contractId] ?? "");
    return Math.abs((n ?? 0) - (r.amount ?? 0)) > 0.004;
  });
  const dirtyCount = changed.length;
  useEffect(() => {
    onDirtyChange(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  if (state.status === "loading") {
    return (
      <div className="p-5 space-y-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return <p className="m-5 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-300">{state.error}</p>;
  }

  const fillable = editable.filter((r) => !values[r.contractId] && r.lastAmount);
  // Un total por moneda: un contrato en dólares no se suma a los pesos.
  const totalText = multiMoney(editable.map((r) => ({ amount: parseAmountInput(values[r.contractId] ?? "") ?? 0, currency: r.currency })));

  function save() {
    const bad = changed.find((r) => (values[r.contractId] ?? "").trim() && parseAmountInput(values[r.contractId]) == null);
    if (bad) {
      setErrors({ [bad.contractId]: "Escribí el importe con números." });
      return;
    }
    setErrors({});
    const payload = changed.map((r) => ({ contractId: r.contractId, amount: parseAmountInput(values[r.contractId] ?? "") }));
    startTransition(async () => {
      const res = await saveExpensasAmounts(month, payload);
      if (!res.ok) {
        toast.error("No se pudieron guardar las expensas", { description: res.error });
        return;
      }
      if (res.errors.length) {
        setErrors(Object.fromEntries(res.errors.map((e) => [e.contractId, e.error])));
        // Lo que sí se guardó deja de contar como cambio: si no, seguía en "con cambios"
        // y el aviso de "sin guardar" al cerrar lo contaba como perdido.
        const failed = new Set(res.errors.map((e) => e.contractId));
        const saved = new Map(payload.filter((x) => !failed.has(x.contractId)).map((x) => [x.contractId, x.amount] as const));
        setState((st) =>
          st.status === "ready" ? { ...st, rows: st.rows.map((r) => (saved.has(r.contractId) ? { ...r, amount: saved.get(r.contractId) ?? null } : r)) } : st,
        );
        toast.warning(`Se guardaron ${res.saved}; ${res.errors.length} con problemas`, { description: "Revisá los marcados en rojo." });
        router.refresh();
        return;
      }
      toast.success(res.saved === 1 ? "Expensas guardadas en 1 contrato" : `Expensas guardadas en ${res.saved} contratos`);
      router.refresh();
      onDone();
    });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Ningún contrato vigente tiene las expensas a cobrar por la inmobiliaria.
          </p>
        ) : (
          <>
            {fillable.length > 0 && (
              <button
                type="button"
                onClick={() => setValues((v) => ({ ...v, ...Object.fromEntries(fillable.map((r) => [r.contractId, toText(r.lastAmount)])) }))}
                className="w-full flex items-start gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10 transition-colors"
              >
                <CopyCheck size={15} className="mt-0.5 shrink-0 text-primary" />
                <span className="text-xs">
                  <span className="font-medium">Repetir las del mes pasado</span> en {fillable.length} {fillable.length === 1 ? "contrato vacío" : "contratos vacíos"} (después
                  ajustás las que cambiaron).
                </span>
              </button>
            )}
            <ul className="space-y-2">
              {rows.map((r) => {
                const err = errors[r.contractId];
                const meta = r.chargeState ? CHARGE_STATE_META[r.chargeState] : null;
                return (
                  <li key={r.contractId} className={cn("rounded-lg border bg-card p-3", !r.chargeId && "bg-muted/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.address}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {formatContractNumber(r.contractNumber)} · {r.tenantName}
                          {r.consortium ? ` · ${r.consortium}` : ""}
                        </p>
                      </div>
                      {meta && <StatusBadge meta={meta} compact />}
                    </div>
                    {r.chargeId ? (
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={r.lastAmount ? `Mes pasado: ${toText(r.lastAmount)}` : "0,00"}
                          className="h-10 tabular-nums"
                          value={values[r.contractId] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [r.contractId]: e.target.value }))}
                          aria-label={`Expensas de ${r.address}`}
                          aria-invalid={!!err}
                        />
                        <span className="text-[11px] text-muted-foreground text-right leading-tight">
                          {r.paidOnItem > 0 ? (
                            <>cobrado<br />{formatMoney(r.paidOnItem, r.currency)}</>
                          ) : r.lastAmount ? (
                            <>mes pasado<br />{formatMoney(r.lastAmount, r.currency)}</>
                          ) : (
                            r.currency
                          )}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">{r.blockedReason}</p>
                    )}
                    {err && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {askClose && (
        <div role="alert" className="border-t border-amber-500/30 bg-amber-500/10 px-5 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-xs text-amber-900 dark:text-amber-100">
            {pending
              ? "Se están guardando las expensas…"
              : `Tenés ${dirtyCount} ${dirtyCount === 1 ? "expensa" : "expensas"} sin guardar. Si cerrás, se pierden.`}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onKeepEditing}>
              Seguir editando
            </Button>
            <Button size="sm" variant="outline" onClick={onDiscard} disabled={pending}>
              Descartar y cerrar
            </Button>
          </div>
        </div>
      )}
      <div className="border-t px-5 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Total <span className="font-semibold text-foreground tabular-nums">{totalText}</span>
          {changed.length > 0 && <> · {changed.length} con cambios</>}
        </p>
        <Button onClick={save} disabled={pending || changed.length === 0} className="gap-2">
          {pending ? <Spinner /> : <Save size={14} />} Guardar
        </Button>
      </div>
    </>
  );
}
