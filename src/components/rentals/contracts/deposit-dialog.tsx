"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, HandCoins, Loader2, PiggyBank, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { checkDepositSettlement } from "@/lib/rentals/deposit";
import { formatContractNumber } from "@/lib/rentals/labels";
import {
  getRentalDepositSetup,
  markRentalDepositReceived,
  previewRentalDepositApplication,
  reopenRentalDeposit,
  settleRentalDeposit,
} from "@/lib/actions/rentals-contracts";
import { MoneyInput } from "./wizard-fields";
import { editableNumber } from "./wizard-state";

/**
 * Depósito en garantía (068h): marcarlo cobrado cuando no pasó por la cuenta,
 * cerrarlo al terminar el contrato (devolverlo, aplicarlo a lo que quedó
 * debiendo o pasarlo a la renovación) y deshacer ese cierre. Los diálogos leen
 * los datos frescos del servidor al abrirse (deuda al día, cuentas, renovación).
 */

export type DepositDialogMode = "settle" | "mark" | "unmark" | "reopen";

type SetupResult = Awaited<ReturnType<typeof getRentalDepositSetup>>;
type DepositSetup = Extract<SetupResult, { ok: true }>["setup"];
type PreviewResult = Awaited<ReturnType<typeof previewRentalDepositApplication>>;
type DepositPreview = Extract<PreviewResult, { ok: true }>["preview"];

const pad6 = (n: number) => String(n).padStart(6, "0");

function useDepositSetup(contractId: string) {
  const [setup, setSetup] = useState<DepositSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getRentalDepositSetup(contractId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setSetup(res.setup);
        else setError(res.error);
      })
      .catch(() => alive && setError("No se pudieron cargar los datos del depósito. Probá de nuevo."));
    return () => {
      alive = false;
    };
  }, [contractId]);
  return { setup, error };
}

function DialogTitleRow({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <DialogTitle className="flex items-center gap-2">
      <span className={cn("size-8 rounded-lg flex items-center justify-center shrink-0", tone)}>{icon}</span>
      {children}
    </DialogTitle>
  );
}

function LoadingBody({ error }: { error: string | null }) {
  if (error) return <p className="text-sm rounded-lg bg-rose-500/[0.08] text-rose-900 dark:text-rose-200 px-3 py-2">{error}</p>;
  return (
    <div className="space-y-3" aria-busy>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/** Monta el diálogo que corresponde (abierto mientras esté montado). */
export function DepositDialog({
  contractId,
  mode,
  onOpenChange,
}: {
  contractId: string;
  mode: DepositDialogMode | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (mode === "settle") return <SettleDepositDialog contractId={contractId} onOpenChange={onOpenChange} />;
  if (mode === "reopen") return <ReopenDepositDialog contractId={contractId} onOpenChange={onOpenChange} />;
  if (mode === "mark") return <MarkDepositDialog contractId={contractId} onOpenChange={onOpenChange} />;
  if (mode === "unmark") return <UnmarkDepositDialog contractId={contractId} onOpenChange={onOpenChange} />;
  return null;
}

// ─── Aviso de la ficha de un contrato terminado ─────────────────────────────

/**
 * Reemplaza al viejo "Acordate de devolverlo": dice en qué está el depósito y
 * trae el botón para resolverlo. Cuando el depósito se cierra, desaparece.
 */
export function DepositBanner({
  contractId,
  amount,
  currency,
  status,
  tracked,
  renewalNumber,
}: {
  contractId: string;
  amount: number;
  currency: string;
  status: string;
  tracked: boolean;
  renewalNumber: number | null;
}) {
  const [mode, setMode] = useState<DepositDialogMode | null>(null);
  if (!(amount > 0) || (status !== "retenido" && status !== "pendiente")) return null;
  const money = formatMoney(amount, currency);
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <p className="text-xs text-amber-800 dark:text-amber-200 flex-1 min-w-0">
          {status === "retenido" ? (
            <>
              Depósito de {money} en garantía: falta devolverlo, aplicarlo a lo que quedó debiendo
              {renewalNumber != null ? ` o pasarlo a la renovación ${formatContractNumber(renewalNumber)}` : ""}.
            </>
          ) : tracked ? (
            <>Depósito de {money}: no figura cobrado. Lo que se le cargó de depósito sigue impago en la cuenta del inquilino: queda cobrado al registrar ese cobro.</>
          ) : (
            <>Depósito de {money}: no figura cobrado. Si se cobró por fuera del sistema, marcalo como cobrado y después cerralo.</>
          )}
        </p>
        {status === "retenido" && (
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0 self-start sm:self-auto" onClick={() => setMode("settle")}>
            <PiggyBank size={14} /> Cerrar el depósito
          </Button>
        )}
        {status === "pendiente" && !tracked && (
          <Button size="sm" variant="outline" className="gap-1.5 shrink-0 self-start sm:self-auto" onClick={() => setMode("mark")}>
            <HandCoins size={14} /> Marcar como cobrado
          </Button>
        )}
      </div>
      <DepositDialog contractId={contractId} mode={mode} onOpenChange={(open) => !open && setMode(null)} />
    </>
  );
}

// ─── Marcar / desmarcar cobrado ─────────────────────────────────────────────

const NO_ACCOUNT = "none";

function MarkDepositDialog({ contractId, onOpenChange }: { contractId: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { setup, error } = useDepositSetup(contractId);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(NO_ACCOUNT);
  const today = setup?.today ?? "";
  const day = date ?? today;

  function submit() {
    if (!setup) return;
    startTransition(async () => {
      const res = await markRentalDepositReceived(contractId, { received: true, date: day, accountId: accountId === NO_ACCOUNT ? null : accountId });
      if (!res.ok) {
        toast.error("No se pudo marcar el depósito", { description: res.error });
        return;
      }
      toast.success("Depósito cobrado", {
        description: res.movementId ? "Quedó retenido y se registró el ingreso en Caja." : "Quedó retenido. Cuando termine el contrato, cerralo desde la ficha.",
      });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitleRow icon={<HandCoins size={16} />} tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            Marcar depósito como cobrado
          </DialogTitleRow>
          <DialogDescription>
            Para un depósito que se cobró por fuera del sistema, por ejemplo en un contrato que ya venía corriendo.
            {setup ? ` Depósito de ${formatMoney(setup.contract.depositAmount, setup.contract.depositCurrency)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {!setup ? (
          <LoadingBody error={error} />
        ) : setup.tracked ? (
          <p className="text-sm rounded-lg bg-amber-500/[0.08] text-amber-900 dark:text-amber-200 px-3 py-2">
            El depósito está en la cuenta del inquilino: queda cobrado solo cuando registrás ese cobro.
          </p>
        ) : (
          <div className="space-y-3">
            {setup.previous && setup.previous.depositStatus === "retenido" && (
              // Renovación: si es el mismo depósito, se pasa desde el contrato anterior; si no, quedaría dos veces en garantía.
              <p className="text-xs rounded-lg bg-amber-500/[0.08] text-amber-900 dark:text-amber-200 px-3 py-2 leading-snug">
                ¿Es el mismo depósito del {formatContractNumber(setup.previous.number)}? Pasalo desde{" "}
                <Link href={`/dashboard/alquileres/contratos/${setup.previous.id}`} className="underline underline-offset-2 font-medium">
                  la ficha de ese contrato
                </Link>{" "}
                («Cerrar el depósito» → «Pasa a la renovación»), así no figura dos veces.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dep-cobrado-fecha">Se cobró el</Label>
              <Input id="dep-cobrado-fecha" type="date" value={day} max={today} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            {setup.contract.holder === "inmobiliaria" ? (
              <div className="space-y-1.5">
                <Label>¿Entró a una cuenta de Caja?</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-10 w-full" aria-label="Cuenta de Caja">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>No registrar en Caja</SelectItem>
                    {setup.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Si la plata todavía no figura en Caja, elegí la cuenta: se registra el ingreso y, al devolverlo, sale de ahí. Si ya estaba en el saldo, dejalo sin cuenta.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Lo guarda el propietario: no se registra nada en Caja.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !setup || setup.tracked || !day} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <HandCoins size={14} />} Marcar como cobrado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnmarkDepositDialog({ contractId, onOpenChange }: { contractId: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await markRentalDepositReceived(contractId, { received: false, date: new Date().toISOString().slice(0, 10), accountId: null });
      if (!res.ok) {
        toast.error("No se pudo deshacer", { description: res.error });
        return;
      }
      toast.success("El depósito vuelve a figurar a cobrar", { description: res.movementId ? "También se borró su ingreso en Caja." : undefined });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitleRow icon={<Undo2 size={16} />} tone="bg-amber-500/15 text-amber-700 dark:text-amber-400">
            Desmarcar depósito cobrado
          </DialogTitleRow>
          <DialogDescription>
            El depósito vuelve a figurar «a cobrar». Si al marcarlo se registró el ingreso en Caja, ese movimiento también se borra.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Desmarcar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deshacer el cierre ─────────────────────────────────────────────────────

function ReopenDepositDialog({ contractId, onOpenChange }: { contractId: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { setup, error } = useDepositSetup(contractId);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const s = setup?.settlement ?? null;
  const currency = setup?.contract.depositCurrency ?? "ARS";
  const effects = [
    s?.payment_id ? `Se anula el cobro con que se aplicó a deudas${s.receipt_number ? ` (recibo ${pad6(s.receipt_number)})` : ""}: esas deudas vuelven a quedar abiertas.` : null,
    s?.movement_id ? `Se borra de Caja la devolución de ${formatMoney(Number(s.returned ?? 0), currency)}.` : null,
    s?.renewal_id ? `La renovación${s.renewal_number ? ` ${formatContractNumber(s.renewal_number)}` : ""} deja de tenerlo en garantía.` : null,
  ].filter((x): x is string => Boolean(x));

  function submit() {
    startTransition(async () => {
      const res = await reopenRentalDeposit(contractId, reason);
      if (!res.ok) {
        toast.error("No se pudo deshacer el cierre", { description: res.error });
        return;
      }
      toast.success("Se deshizo el cierre del depósito", { description: "Vuelve a figurar en garantía: cerralo de nuevo desde la ficha." });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitleRow icon={<Undo2 size={16} />} tone="bg-amber-500/15 text-amber-700 dark:text-amber-400">
            Deshacer el cierre del depósito
          </DialogTitleRow>
          <DialogDescription>Para corregir un cierre mal hecho: el depósito vuelve a figurar en garantía y lo cerrás de nuevo.</DialogDescription>
        </DialogHeader>
        {!setup ? (
          <LoadingBody error={error} />
        ) : (
          <div className="space-y-3">
            {effects.length > 0 && (
              <ul className="text-sm space-y-1 list-disc pl-5 marker:text-muted-foreground">
                {effects.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dep-reabrir-motivo">Por qué se deshace</Label>
              <Input
                id="dep-reabrir-motivo"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Me equivoqué de cuenta, el importe no era ese…"
                maxLength={200}
              />
              <p className="text-[11px] text-muted-foreground">Queda en el historial del contrato.</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !setup || reason.trim().length < 3} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Deshacer cierre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cerrar el depósito ─────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Por qué no se le puede pasar el depósito a la renovación (null = se puede, o no hay renovación). */
function renewalIssueOf(s: DepositSetup): string | null {
  const r = s.renewal;
  if (!r) return null;
  const n = formatContractNumber(r.number);
  if (r.status === "borrador") return `La renovación ${n} todavía es un borrador: activala para pasarle el depósito.`;
  if (!(r.depositAmount > 0)) return `La renovación ${n} no tiene depósito cargado: si el depósito sigue en garantía, editala y poné el monto.`;
  if (r.depositCurrency !== s.contract.depositCurrency) return `El depósito de la renovación ${n} es en ${r.depositCurrency}: no se le puede pasar uno en ${s.contract.depositCurrency}.`;
  if (r.depositStatus !== "pendiente" && r.depositStatus !== "retenido") return `La renovación ${n} ya tiene su depósito cerrado.`;
  return null;
}

function OutcomeOption({ selected, onSelect, icon, title, hint }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "text-left rounded-xl border px-3 py-2.5 transition-colors",
        selected ? "border-indigo-500/60 bg-indigo-500/[0.07] ring-1 ring-indigo-500/30" : "hover:bg-accent/40",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">{hint}</span>
    </button>
  );
}

function SettleDepositDialog({ contractId, onOpenChange }: { contractId: string; onOpenChange: (open: boolean) => void }) {
  const { setup, error } = useDepositSetup(contractId);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitleRow icon={<PiggyBank size={16} />} tone="bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
            Cerrar el depósito
          </DialogTitleRow>
          <DialogDescription>
            {setup
              ? `Depósito de ${formatMoney(setup.contract.heldAmount, setup.contract.depositCurrency)}${
                  Math.abs(setup.contract.heldAmount - setup.contract.depositAmount) > 0.005
                    ? ` cobrado (el contrato dice ${formatMoney(setup.contract.depositAmount, setup.contract.depositCurrency)}: lo que no se cobró no se devuelve)`
                    : ""
                } · lo guarda ${setup.contract.holder === "propietario" ? "el propietario" : "la inmobiliaria"}.`
              : "Devolvelo, aplicalo a lo que quedó debiendo o pasalo a la renovación."}
          </DialogDescription>
        </DialogHeader>
        {/* Dónde está la plata de verdad, si no es lo que dice el contrato: de eso sale si mueve Caja. */}
        {setup?.contract.holderNote && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">{setup.contract.holderNote}</p>
        )}
        {setup ? (
          <SettleForm contractId={contractId} setup={setup} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <LoadingBody error={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettleForm({ contractId, setup, onClose }: { contractId: string; setup: DepositSetup; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const c = setup.contract;
  const renewal = setup.renewal;
  const renewalIssue = renewalIssueOf(setup);
  const canPass = Boolean(renewal) && !renewalIssue;
  // Con una renovación activa lo más probable es que el depósito siga en garantía.
  const [outcome, setOutcome] = useState<"cerrar" | "renovacion">(canPass ? "renovacion" : "cerrar");
  const allocatable = setup.blocker === null;
  const [appliedText, setAppliedText] = useState(() => editableNumber(setup.suggestion.applied));
  const [returnedText, setReturnedText] = useState(() => editableNumber(setup.suggestion.returned));
  const [returnedTouched, setReturnedTouched] = useState(false);
  const [date, setDate] = useState(setup.today);
  const [accountId, setAccountId] = useState(() => setup.accounts.find((a) => a.isDefault)?.id ?? setup.accounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [waive, setWaive] = useState(false);
  const [previewState, setPreviewState] = useState<{ key: string; preview: DepositPreview | null; error: string | null } | null>(null);

  const applied = parseAmountInput(appliedText) ?? 0;
  const returned = parseAmountInput(returnedText) ?? 0;
  const fromCaja = c.holder === "inmobiliaria" && returned > 0;
  const showPreview = outcome === "cerrar" && allocatable && applied > 0 && Boolean(date);
  const previewKey = `${applied}|${date}|${waive}`;
  const current = previewState?.key === previewKey ? previewState : null;

  // Qué paga lo aplicado: la misma imputación que un cobro, con los intereses a esa fecha.
  useEffect(() => {
    if (!showPreview) return;
    let alive = true;
    const t = setTimeout(() => {
      previewRentalDepositApplication(contractId, { applied, date, waiveLateFees: waive })
        .then((res) => {
          if (!alive) return;
          setPreviewState(res.ok ? { key: previewKey, preview: res.preview, error: null } : { key: previewKey, preview: null, error: res.error });
        })
        .catch(() => alive && setPreviewState({ key: previewKey, preview: null, error: "No se pudo calcular qué cubre." }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [contractId, showPreview, applied, date, waive, previewKey]);

  const debt = allocatable ? (current?.preview?.debt ?? setup.debt ?? 0) : null;
  const check =
    outcome === "cerrar" ? checkDepositSettlement({ depositAmount: c.heldAmount, currency: c.depositCurrency, applied, returned, debt, note }) : null;
  const difference = check?.difference ?? 0;
  const lateFees = current?.preview ? current.preview.lateFeesTotal || current.preview.waivedTotal : 0;

  function changeApplied(v: string) {
    setAppliedText(v);
    // Lo devuelto acompaña a lo aplicado hasta que alguien lo toque a mano.
    if (!returnedTouched) setReturnedText(editableNumber(Math.max(0, round2(c.heldAmount - (parseAmountInput(v) ?? 0)))));
  }

  function applyAllDebt() {
    const a = round2(Math.min(c.heldAmount, Math.max(0, setup.debt ?? 0)));
    setAppliedText(editableNumber(a));
    setReturnedText(editableNumber(round2(c.heldAmount - a)));
    setReturnedTouched(false);
  }

  const disabled =
    pending ||
    !date ||
    (outcome === "renovacion"
      ? !canPass
      : !check?.ok || (fromCaja && !accountId) || (showPreview && !current?.preview));

  function submit() {
    startTransition(async () => {
      const res = await settleRentalDeposit(contractId, {
        outcome,
        applied: outcome === "cerrar" ? applied : 0,
        returned: outcome === "cerrar" ? returned : 0,
        date,
        accountId: outcome === "cerrar" && fromCaja ? accountId : null,
        note,
        waiveLateFees: waive,
      });
      if (!res.ok) {
        toast.error(outcome === "renovacion" ? "No se pudo pasar el depósito" : "No se pudo cerrar el depósito", { description: res.error });
        return;
      }
      if (res.status === "trasladado") {
        toast.success("Depósito pasado a la renovación", { description: renewal ? `Sigue en garantía del ${formatContractNumber(renewal.number)}.` : undefined });
      } else {
        const parts = [
          applied > 0
            ? allocatable
              ? `Se aplicaron ${formatMoney(applied, c.currency)} a lo que quedó debiendo${res.receiptNumber ? ` (recibo ${pad6(res.receiptNumber)})` : ""}.`
              : `Quedaron anotados ${formatMoney(applied, c.depositCurrency)} por deudas: bonificá esos cargos desde la cuenta corriente.`
            : null,
          returned > 0
            ? fromCaja
              ? `La devolución de ${formatMoney(returned, c.depositCurrency)} salió de Caja.`
              : `Quedó anotado que el propietario devolvió ${formatMoney(returned, c.depositCurrency)}.`
            : null,
        ].filter(Boolean);
        toast.success(res.status === "aplicado" ? "Depósito aplicado a deudas" : "Depósito cerrado", { description: parts.join(" ") });
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div className="space-y-4">
        {renewal &&
          (canPass ? (
            <div role="radiogroup" aria-label="Qué pasa con el depósito" className="grid gap-2 sm:grid-cols-2">
              <OutcomeOption
                selected={outcome === "renovacion"}
                onSelect={() => setOutcome("renovacion")}
                icon={<ArrowRightLeft size={15} className="text-indigo-600 dark:text-indigo-400" />}
                title={`Pasa a la renovación ${formatContractNumber(renewal.number)}`}
                hint="Sigue en garantía: no se devuelve ni sale de Caja."
              />
              <OutcomeOption
                selected={outcome === "cerrar"}
                onSelect={() => setOutcome("cerrar")}
                icon={<HandCoins size={15} className="text-emerald-600 dark:text-emerald-400" />}
                title="Devolverlo o aplicarlo"
                hint="A lo que quedó debiendo, y el resto se le devuelve."
              />
            </div>
          ) : (
            <p className="text-xs rounded-lg bg-muted px-3 py-2 text-muted-foreground leading-snug">{renewalIssue}</p>
          ))}

        {outcome === "renovacion" && renewal ? (
          <p className="text-sm text-muted-foreground leading-snug">
            {formatContractNumber(c.number)} queda con el depósito «pasado a la renovación» y {formatContractNumber(renewal.number)} lo tiene en garantía. Si la
            renovación cobra una diferencia de depósito, esa diferencia se sigue cobrando por su cuenta.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="dep-aplicar">Aplicar a lo que quedó debiendo</Label>
              <MoneyInput
                id="dep-aplicar"
                value={appliedText}
                onChange={changeApplied}
                currency={c.depositCurrency}
                invalid={check?.ok === false && check.field === "applied"}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                {allocatable ? (
                  setup.debt && setup.debt > 0.004 ? (
                    <>
                      Hoy debe {formatMoney(setup.debt, c.currency)} (con los intereses al día).{" "}
                      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={applyAllDebt}>
                        Aplicar lo que debe
                      </button>
                    </>
                  ) : (
                    "No quedó nada por cobrar en su cuenta."
                  )
                ) : (
                  setup.blocker
                )}
              </p>
              {showPreview && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs space-y-1">
                  {!current ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> Calculando qué cubre…
                    </span>
                  ) : current.error || !current.preview ? (
                    <span className="text-rose-700 dark:text-rose-300">{current.error ?? "No se pudo calcular qué cubre."}</span>
                  ) : (
                    <>
                      <p className="font-medium text-muted-foreground">Cubre</p>
                      <ul className="space-y-0.5">
                        {current.preview.lines.map((l, i) => (
                          <li key={`${l.description}-${i}`} className="flex justify-between gap-3">
                            <span className="truncate">{l.description}</span>
                            <span className="tabular-nums shrink-0">{formatMoney(l.amount, c.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {allocatable && lateFees > 0 && (
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox checked={waive} onCheckedChange={(v) => setWaive(v === true)} className="mt-0.5" />
                  <span>Condonar los intereses por mora ({formatMoney(lateFees, c.currency)})</span>
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dep-devolver">Devolver al inquilino</Label>
              <MoneyInput
                id="dep-devolver"
                value={returnedText}
                onChange={(v) => {
                  setReturnedText(v);
                  setReturnedTouched(true);
                }}
                currency={c.depositCurrency}
                invalid={check?.ok === false && check.field === "returned"}
                placeholder="0"
              />
              {c.holder === "propietario" && <p className="text-[11px] text-muted-foreground">Lo devuelve el propietario: queda anotado, no mueve Caja.</p>}
            </div>

            {fromCaja && (
              <div className="space-y-1.5">
                <Label>Sale de la cuenta</Label>
                {setup.accounts.length === 0 ? (
                  <p className="text-xs rounded-lg bg-rose-500/[0.08] text-rose-900 dark:text-rose-200 px-3 py-2">
                    No hay cuentas activas en {c.depositCurrency}. Creá una en Caja para registrar la devolución.
                  </p>
                ) : (
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="h-10 w-full" aria-label="Cuenta de Caja">
                      <SelectValue placeholder="Elegí la cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {setup.accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="dep-fecha">Fecha</Label>
            <Input id="dep-fecha" type="date" value={date} max={setup.today} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dep-nota">{check?.ok === false && check.field === "note" ? "Nota" : "Nota (opcional)"}</Label>
            <Textarea
              id="dep-nota"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Descuento por pintura, se devuelve al valor del último mes…"
              aria-invalid={check?.ok === false && check.field === "note"}
              className="min-h-10 resize-none"
            />
          </div>
        </div>

        {outcome === "cerrar" && Math.abs(difference) > 0.01 && (
          <p className="text-xs rounded-lg bg-amber-500/[0.08] text-amber-900 dark:text-amber-200 px-3 py-2">
            Aplicado más devuelto suma {formatMoney(round2(applied + returned), c.depositCurrency)}: {formatMoney(Math.abs(difference), c.depositCurrency)}{" "}
            {difference > 0 ? "más" : "menos"} que el depósito.{check?.ok === false && check.field === "note" ? " Contá por qué en la nota." : ""}
          </p>
        )}
        {check?.ok === false && check.field !== "note" && <p className="text-xs text-rose-700 dark:text-rose-300">{check.error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={disabled} className="gap-2">
          {pending ? <Loader2 size={14} className="animate-spin" /> : outcome === "renovacion" ? <ArrowRightLeft size={14} /> : <PiggyBank size={14} />}
          {outcome === "renovacion" ? "Pasar a la renovación" : "Cerrar el depósito"}
        </Button>
      </DialogFooter>
    </>
  );
}
