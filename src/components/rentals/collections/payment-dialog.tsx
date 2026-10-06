"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, HandCoins, Info, Landmark, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isStaleDeployError, toastActionFailure } from "@/lib/action-failure";
import { openPaymentDialog, previewPayment, registerPayment } from "@/lib/actions/rentals-collections";
import type { PaymentPreview } from "@/lib/rentals/server/payments";
import type { LedgerPaymentSplit, PaymentSetup } from "@/lib/rentals/server/collections-queries";
import type { RentalPaymentMethod } from "@/lib/types/database";
import { formatContractNumber, PAYMENT_METHOD_LABEL } from "@/lib/rentals/labels";
import { formatDate, formatMoney, parseAmountInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChargePicker } from "./charge-picker";
import { PaymentPreviewPanel } from "./payment-preview-panel";
import { PaymentSplitSection } from "./payment-split-section";
import { PaymentSuccess } from "./payment-success";
import { agencyNameOf, joinNames, needsAgencyAccount, routeNoteText, routeReady, toLedgerSplit, withRouteNote, type PayRoute } from "./split-view";
import { Spinner } from "./whatsapp-message-dialog";

export interface PaymentRegistered {
  paymentId: string;
  receiptNumber: number;
  remainder: number;
}

export interface PaymentDialogProps {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Importe precargado (por defecto, lo que debe hoy). */
  defaultAmount?: number | null;
  /** Fecha precargada (YYYY-MM-DD; por defecto hoy). */
  defaultPaidAt?: string | null;
  /** Cargos que el inquilino eligió pagar primero (art. 900 CCyC). */
  preferChargeIds?: string[];
  /** Aviso de pago del portal que se está registrando. */
  reportId?: string | null;
  onRegistered?: (r: PaymentRegistered) => void;
}

const METHODS: RentalPaymentMethod[] = ["transferencia", "efectivo", "mp", "deposito", "cheque", "otro"];
const PREFS_KEY = "rentals:payment-prefs:v1";
const ACCOUNT_TYPE_FOR: Partial<Record<RentalPaymentMethod, string>> = {
  efectivo: "efectivo",
  transferencia: "banco",
  deposito: "banco",
  cheque: "banco",
  mp: "mp",
};

function readPrefs(): { method?: RentalPaymentMethod; accountId?: string } {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as { method?: RentalPaymentMethod; accountId?: string }) : {};
  } catch {
    return {};
  }
}

function savePrefs(p: { method: RentalPaymentMethod; accountId: string | null }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* modo privado: no pasa nada */
  }
}

/** Cuenta sugerida: la del tipo que corresponde al medio; si no, la última usada; si no, la primera. */
function pickAccount(accounts: PaymentSetup["accounts"], method: RentalPaymentMethod, savedId?: string): string {
  const byType = accounts.filter((a) => a.type === ACCOUNT_TYPE_FOR[method]);
  if (savedId && byType.some((a) => a.id === savedId)) return savedId;
  if (byType.length) return byType[0].id;
  if (savedId && accounts.some((a) => a.id === savedId)) return savedId;
  return accounts[0]?.id ?? "";
}

/** Importe para el input en formato es-AR ("543.500" / "543.500,50"). */
function editableAmount(n: number): string {
  if (!(n > 0)) return "";
  const cents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("es-AR", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

/** Hubo un deploy con la pantalla abierta: reintentar no sirve, recargar sí. */
const STALE_DEPLOY_TEXT = "Se actualizó el sistema mientras tenías esto abierto: recargá la página para seguir.";
/** Se cortó antes de la respuesta: el cobro pudo haber entrado igual (reintentar a ciegas lo duplica). */
const UNKNOWN_OUTCOME_TEXT =
  "Se cortó antes de la respuesta y el cobro pudo haber quedado registrado. Recargá la página y mirá la cuenta del inquilino antes de volver a intentar.";

export function PaymentDialog(props: PaymentDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[94dvh] overflow-y-auto">
        {open ? (
          <PaymentDialogBody {...props} close={() => onOpenChange(false)} />
        ) : (
          <DialogHeader className="sr-only">
            <DialogTitle>Registrar cobro</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; error: string; stale?: boolean }
  | { kind: "form" }
  | {
      kind: "success";
      paymentId: string;
      receiptNumber: number;
      remainder: number;
      amount: number;
      stillOwes: number;
      /** Cobra el propietario: cómo se repartió (el reparto que guardó el servidor). */
      split: LedgerPaymentSplit | null;
      /** Cómo pagó el inquilino (sólo si hubo parte de la inmobiliaria). */
      route: PayRoute | null;
    };

type Settled = { key: string; preview: PaymentPreview | null; error: string | null };

/** Clave de la vista previa: si cambia algo de esto, hay que volver a pedírsela al servidor. */
function previewKeyOf(amount: number | null, paidAt: string, preferIds: string[], waive: boolean): string {
  return `${amount ?? "x"}|${paidAt}|${preferIds.join(",")}|${waive ? 1 : 0}`;
}

function PaymentDialogBody(props: PaymentDialogProps & { close: () => void }) {
  const router = useRouter();
  // Las props de apertura se fijan al montar (el cuerpo se monta en cada apertura).
  const [initial] = useState(() => ({
    contractId: props.contractId,
    defaultAmount: props.defaultAmount ?? null,
    defaultPaidAt: props.defaultPaidAt ?? null,
    preferChargeIds: props.preferChargeIds ?? [],
    reportId: props.reportId ?? null,
  }));
  const { contractId } = initial;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [setup, setSetup] = useState<PaymentSetup | null>(null);
  const [settled, setSettled] = useState<Settled>({ key: "", preview: null, error: null });
  const [amountText, setAmountText] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState<RentalPaymentMethod>("transferencia");
  const [accountId, setAccountId] = useState("");
  const [accountTouched, setAccountTouched] = useState(false);
  const [choosing, setChoosing] = useState(initial.preferChargeIds.length > 0);
  const [prefer, setPrefer] = useState<string[]>(initial.preferChargeIds);
  const [waive, setWaive] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldError, setFieldError] = useState<{ field?: string; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshingOwners, setRefreshingOwners] = useState(false);
  // Cobra el propietario: cómo pagó de verdad el inquilino. Arranca en «cada uno su parte»
  // porque es como trabaja la inmobiliaria (dos transferencias, lo eligió el usuario el
  // 06/10/2026); las otras dos opciones quedan a la vista para la excepción, y con «todo al
  // propietario» no se registra hasta que él pase la parte de la inmobiliaria.
  const [route, setRoute] = useState<PayRoute | null>("cada_uno");
  const [ownerPassed, setOwnerPassed] = useState(false);
  // El registro reventó sin respuesta: el cobro pudo haber entrado. Volver a tocar «Registrar»
  // lo duplicaría (y duplicaría el ingreso en Caja), así que el botón pasa a «Recargar la página».
  const [mustReload, setMustReload] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const reqId = useRef(0);
  // La vista previa se pide en cada tecla: si falla en racha (deploy nuevo, sin red), un solo aviso.
  const previewFailNotified = useRef(false);

  const parsedAmount = parseAmountInput(amountText);
  const amountEmpty = amountText.trim() === "";
  // Sin importe la vista previa igual muestra la deuda y los intereses del día (con 0).
  const previewAmount = amountEmpty ? 0 : parsedAmount;
  const preferIds = choosing ? prefer : [];
  const queryKey = previewKeyOf(previewAmount, paidAt, preferIds, waive);
  const inputError =
    phase.kind !== "form" || !setup
      ? null
      : previewAmount == null || previewAmount < 0
        ? "Escribí el importe con números (por ejemplo 543.500 o 543500,50)."
        : !paidAt
          ? "Elegí la fecha del pago."
          : paidAt > setup.today
            ? "La fecha del pago no puede ser futura."
            : null;
  const previewLoading = phase.kind === "form" && !inputError && queryKey !== settled.key;

  // Apertura: datos del contrato + cuentas + primera vista previa, en un solo viaje.
  useEffect(() => {
    let alive = true;
    openPaymentDialog({
      contractId: initial.contractId,
      amount: initial.defaultAmount,
      paidAt: initial.defaultPaidAt,
      preferChargeIds: initial.preferChargeIds,
    })
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setPhase({ kind: "error", error: res.error });
          return;
        }
        const prefs = readPrefs();
        const m = prefs.method && METHODS.includes(prefs.method) ? prefs.method : "transferencia";
        const text = editableAmount(res.amount);
        setSetup(res.setup);
        setAmountText(text);
        setPaidAt(res.paidAt);
        setMethod(m);
        setAccountId(pickAccount(res.setup.accounts, m, prefs.accountId));
        const amount = text.trim() === "" ? 0 : parseAmountInput(text);
        setSettled({ key: previewKeyOf(amount, res.paidAt, initial.preferChargeIds, false), preview: res.preview, error: null });
        setPhase({ kind: "form" });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        toastActionFailure(e, "No se pudo abrir el cobro");
        const stale = isStaleDeployError(e);
        setPhase({ kind: "error", error: stale ? STALE_DEPLOY_TEXT : "No pudimos abrir el cobro. Revisá la conexión y probá de nuevo.", stale });
      });
    return () => {
      alive = false;
    };
  }, [initial, attempt]);

  // Vista previa del SERVIDOR, con 350 ms de respiro entre teclas.
  useEffect(() => {
    if (phase.kind !== "form" || inputError || previewAmount == null || queryKey === settled.key) return;
    const id = ++reqId.current;
    const ids = choosing ? prefer : [];
    const timer = setTimeout(() => {
      previewPayment({ contractId, amount: previewAmount, paidAt, preferChargeIds: ids, waiveLateFees: waive })
        .then((res) => {
          if (id !== reqId.current) return;
          previewFailNotified.current = false;
          if (!res.ok) setSettled((prev) => ({ key: queryKey, preview: prev.preview, error: res.error }));
          else setSettled({ key: queryKey, preview: res.preview, error: null });
        })
        .catch((e: unknown) => {
          if (id !== reqId.current) return;
          if (!previewFailNotified.current) {
            previewFailNotified.current = true;
            toastActionFailure(e, "No se pudo recalcular el cobro");
          }
          const error = isStaleDeployError(e) ? STALE_DEPLOY_TEXT : "No pudimos recalcular. Revisá la conexión.";
          setSettled((prev) => ({ key: queryKey, preview: prev.preview, error }));
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [queryKey, phase.kind, inputError, settled.key, contractId, previewAmount, paidAt, choosing, prefer, waive]);

  const preview = settled.preview;
  const currency = setup?.contract.currency ?? "ARS";
  const needsAccount = setup?.contract.collector === "inmobiliaria";
  const noAccounts = !!setup && needsAccount && setup.accounts.length === 0;
  // Cobra el propietario: el inquilino le transfiere su parte a él y la de la inmobiliaria
  // (honorarios…) entra a la cuenta de Caja que se elija acá (la misma `accountId`).
  // Sin reparto (servidor viejo o contrato sin datos) queda como antes: nada entra a Caja.
  const ownerCollects = setup?.contract.collector === "propietario";
  const split = ownerCollects ? (preview?.split ?? null) : null;
  const needsAgency = needsAgencyAccount(split);
  const agencyName = agencyNameOf(setup?.orgName);
  const allocated = Math.round((preview?.allocations ?? []).reduce((s, a) => s + a.amount, 0) * 100) / 100;
  const stillOwes = preview ? Math.max(0, Math.round((preview.totalDebt - allocated) * 100) / 100) : 0;
  const canSubmit =
    phase.kind === "form" &&
    !inputError &&
    !previewLoading &&
    !settled.error &&
    parsedAmount != null &&
    parsedAmount > 0 &&
    (!needsAccount || !!accountId) &&
    (!needsAgency || !!accountId) &&
    !submitting;

  function changeMethod(m: RentalPaymentMethod) {
    setMethod(m);
    if (!accountTouched && setup) setAccountId(pickAccount(setup.accounts, m));
  }

  function changeAccount(id: string) {
    setAccountId(id);
    setAccountTouched(true);
    if (fieldError?.field === "accountId" || fieldError?.field === "agencyAccountId") setFieldError(null);
  }

  function changeRoute(r: PayRoute) {
    setRoute(r);
    if (fieldError?.field === "route") setFieldError(null);
  }

  function changeOwnerPassed(v: boolean) {
    setOwnerPassed(v);
    if (fieldError?.field === "route") setFieldError(null);
  }

  /** Después de cargar el CBU / alias en la ficha del propietario: trae sus datos sin perder lo escrito. */
  function refreshOwners() {
    setRefreshingOwners(true);
    openPaymentDialog({ contractId, amount: parsedAmount != null && parsedAmount > 0 ? parsedAmount : null, paidAt, preferChargeIds: [] })
      .then((res) => {
        if (!res.ok) {
          toast.error("No se pudieron leer los datos del propietario", { description: res.error });
          return;
        }
        // Todo el setup: si de paso creó una cuenta de Caja en otra pestaña, también aparece.
        setSetup(res.setup);
        setAccountId((cur) => (res.setup.accounts.some((a) => a.id === cur) ? cur : pickAccount(res.setup.accounts, method, readPrefs().accountId)));
        const missing = res.setup.owners.filter((o) => !o.cbu?.trim() && !o.alias?.trim()).map((o) => o.name);
        if (!res.setup.owners.length) {
          toast.info("La propiedad no tiene propietario cargado", { description: "Agregalo en la ficha de la propiedad." });
        } else if (missing.length) {
          toast.info(`Todavía falta el CBU o alias de ${joinNames(missing)}`, { description: "Cargalo en su ficha y volvé a tocar «Ya lo cargué»." });
        } else {
          toast.success("Listo: ya están los datos para transferir");
        }
      })
      .catch((e: unknown) => toastActionFailure(e, "No se pudieron leer los datos del propietario"))
      .finally(() => setRefreshingOwners(false));
  }

  function submit() {
    if (!setup || parsedAmount == null) return;
    if (!(parsedAmount > 0)) {
      setFieldError({ field: "amount", error: "Ingresá un importe mayor a cero." });
      return;
    }
    if (needsAccount && !accountId) {
      setFieldError({ field: "accountId", error: "Elegí la cuenta de Caja donde entró la plata." });
      return;
    }
    if (needsAgency && !routeReady(route, ownerPassed)) {
      setFieldError({
        field: "route",
        error:
          route === "todo_propietario"
            ? `Registralo cuando el propietario te pase los ${formatMoney(split?.agency.total ?? 0, currency)} de ${agencyName}. Si ya te los pasó, tildá «El propietario ya me pasó…».`
            : "Elegí cómo pagó el inquilino.",
      });
      document.getElementById("pay-route")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (needsAgency && !accountId) {
      setFieldError({ field: "agencyAccountId", error: `Elegí la cuenta de Caja donde entró la parte de ${agencyName}.` });
      return;
    }
    setFieldError(null);
    const owes = stillOwes;
    const chosenAccountName = setup.accounts.find((a) => a.id === accountId)?.name ?? null;
    const usedAccount = needsAccount || needsAgency ? accountId : null;
    const usedRoute = needsAgency ? route : null;
    // Si no le pagó a cada uno su parte, queda dicho en la nota interna del cobro.
    const routeNote = usedRoute && split ? routeNoteText(usedRoute, split, agencyName, currency) : "";
    startSubmit(async () => {
      try {
        const res = await registerPayment({
          contractId,
          amount: parsedAmount,
          paidAt,
          preferChargeIds: choosing ? prefer : [],
          waiveLateFees: waive,
          method,
          accountId: needsAccount ? accountId : null,
          agencyAccountId: needsAgency ? accountId : null,
          reference: reference.trim() || null,
          payerName: payerName.trim() || null,
          notes: withRouteNote(notes, routeNote),
          reportId: initial.reportId,
        });
        if (!res.ok) {
          setFieldError({ field: "field" in res ? res.field : undefined, error: res.error });
          toast.error("No se pudo registrar el cobro", { description: res.error });
          // La cuenta del inquilino pudo cambiar (otro cobro, un cargo nuevo): se vuelve a pedir la
          // vista previa, así el reparto y la imputación que se ven son los de ahora.
          setSettled((prev) => ({ ...prev, key: "" }));
          return;
        }
        // Un cobro sin cuenta (todo del propietario) no pisa la última cuenta elegida.
        savePrefs({ method, accountId: usedAccount ?? readPrefs().accountId ?? null });
        setPhase({
          kind: "success",
          paymentId: res.paymentId,
          receiptNumber: res.receiptNumber,
          remainder: res.remainder,
          amount: parsedAmount,
          stillOwes: owes,
          // El reparto que guardó el servidor (lo recalcula con datos frescos), no la vista previa.
          split: res.split ? toLedgerSplit(res.split, chosenAccountName) : null,
          route: usedRoute,
        });
        props.onRegistered?.({ paymentId: res.paymentId, receiptNumber: res.receiptNumber, remainder: res.remainder });
        router.refresh();
      } catch (e) {
        const stale = isStaleDeployError(e);
        toastActionFailure(e, "No se pudo registrar el cobro", { retry: UNKNOWN_OUTCOME_TEXT });
        setFieldError({ error: stale ? STALE_DEPLOY_TEXT : UNKNOWN_OUTCOME_TEXT });
        setMustReload(true);
      }
    });
  }

  const header = (
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <span className="size-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <HandCoins size={16} />
        </span>
        Registrar cobro
      </DialogTitle>
      <DialogDescription className="truncate">
        {setup ? `${formatContractNumber(setup.contract.number)} · ${setup.contract.address} · ${setup.contract.tenantName}` : "Preparando la cuenta del inquilino…"}
      </DialogDescription>
    </DialogHeader>
  );

  if (phase.kind === "success" && setup) {
    return (
      <>
        <DialogHeader className="sr-only">
          <DialogTitle>Cobro registrado</DialogTitle>
          <DialogDescription>Recibo listo para descargar o mandar.</DialogDescription>
        </DialogHeader>
        <PaymentSuccess
          paymentId={phase.paymentId}
          receiptNumber={phase.receiptNumber}
          amount={phase.amount}
          currency={currency}
          stillOwes={phase.stillOwes}
          remainder={phase.remainder}
          tenantEmail={setup.contract.tenantEmail}
          tenantPhone={setup.contract.tenantPhone}
          split={phase.split}
          route={phase.route}
          agencyName={agencyName}
          onClose={props.close}
        />
      </>
    );
  }

  if (phase.kind === "loading" || phase.kind === "success") {
    return (
      <>
        {header}
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          <div className="space-y-3">
            {[44, 40, 40, 64].map((h, i) => (
              <div key={i} className="rounded-lg bg-muted animate-pulse" style={{ height: h }} />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-muted/60 animate-pulse" />
        </div>
      </>
    );
  }

  if (phase.kind === "error") {
    return (
      <>
        {header}
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{phase.error}</div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close}>
            Cerrar
          </Button>
          {phase.stale ? (
            <Button className="gap-2" onClick={() => window.location.reload()}>
              <RotateCcw size={14} /> Recargar la página
            </Button>
          ) : (
            <Button
              className="gap-2"
              onClick={() => {
                setPhase({ kind: "loading" });
                setAttempt((a) => a + 1);
              }}
            >
              <RotateCcw size={14} /> Reintentar
            </Button>
          )}
        </DialogFooter>
      </>
    );
  }

  if (!setup) return null;
  const overdueTotal = preview
    ? Math.round(preview.charges.filter((c) => c.dueDate < paidAt).reduce((s, c) => s + c.outstanding, 0) * 100) / 100
    : 0;
  const quick = [
    preview && preview.totalDebt > 0 ? { label: "Todo lo que debe", value: preview.totalDebt } : null,
    overdueTotal > 0 && preview && overdueTotal < preview.totalDebt - 0.004 ? { label: "Sólo lo vencido", value: overdueTotal } : null,
  ].filter((q): q is { label: string; value: number } => !!q);
  const errorFor = (f: string) => (fieldError?.field === f ? fieldError.error : null);

  return (
    <>
      {header}
      {initial.reportId && (
        <p className="rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
          <Info size={14} className="mt-px shrink-0" /> Estás registrando un aviso de pago que mandó el inquilino desde su link. Revisá el importe y la fecha con el comprobante.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-start">
        <div className="space-y-4 min-w-0">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Importe ({currency})</Label>
            <Input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className="h-11 text-lg tabular-nums"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={!!inputError || !!errorFor("amount")}
            />
            {quick.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setAmountText(editableAmount(q.value))}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors min-h-7",
                      Math.abs((parsedAmount ?? -1) - q.value) < 0.005
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "bg-card text-muted-foreground hover:text-foreground hover:bg-accent/40",
                    )}
                  >
                    {q.label}: {formatMoney(q.value, currency)}
                  </button>
                ))}
              </div>
            )}
            {(inputError || errorFor("amount")) && <p className="text-xs text-rose-600 dark:text-rose-400">{inputError ?? errorFor("amount")}</p>}
            {amountEmpty && !errorFor("amount") && <p className="text-[11px] text-muted-foreground">Escribí cuánto pagó el inquilino.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-date">Fecha del pago</Label>
            <Input id="pay-date" type="date" className="h-10" value={paidAt} max={setup.today} onChange={(e) => setPaidAt(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              {initial.reportId && initial.defaultPaidAt
                ? `El inquilino avisó que pagó el ${formatDate(initial.defaultPaidAt)}. Si el comprobante dice otra fecha, cambiala: los intereses se calculan hasta ahí.`
                : "Si pagó otro día, poné esa fecha: los intereses se calculan hasta ahí."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Medio de pago</Label>
              <Select value={method} onValueChange={(v) => changeMethod(v as RentalPaymentMethod)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsAccount && !noAccounts && (
              <div className="space-y-1.5">
                <Label>Entró en la cuenta</Label>
                <Select
                  value={accountId}
                  onValueChange={(v) => {
                    setAccountId(v);
                    setAccountTouched(true);
                  }}
                >
                  <SelectTrigger className="h-10 w-full" aria-invalid={!!errorFor("accountId")}>
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
                {errorFor("accountId") && <p className="text-xs text-rose-600 dark:text-rose-400">{errorFor("accountId")}</p>}
              </div>
            )}
          </div>
          {noAccounts && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              No hay cuentas de Caja activas en {currency}. <Link href="/dashboard/caja" className="underline hover:no-underline">Creá una en Caja</Link> para registrar el cobro.
            </p>
          )}
          {ownerCollects &&
            (split ? (
              <PaymentSplitSection
                split={split}
                owners={setup.owners}
                agencyName={agencyName}
                currency={currency}
                method={method}
                loading={previewLoading}
                stale={!!inputError || (settled.key === queryKey && !!settled.error)}
                accounts={setup.accounts}
                accountId={accountId}
                onAccountChange={changeAccount}
                accountError={errorFor("agencyAccountId")}
                route={route}
                onRouteChange={changeRoute}
                ownerPassed={ownerPassed}
                onOwnerPassedChange={changeOwnerPassed}
                routeError={errorFor("route")}
                debt={preview?.totalDebt}
                onAmountToDebt={preview && preview.totalDebt > 0 ? () => setAmountText(editableAmount(preview.totalDebt)) : undefined}
                onRefreshOwners={refreshOwners}
                refreshingOwners={refreshingOwners}
              />
            ) : (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
                <Landmark size={14} className="mt-px shrink-0" />
                Este contrato lo cobra el propietario directamente: queda registrado y sale el recibo, pero no entra a Caja.
              </p>
            ))}

          {preview && (
            <ChargePicker
              charges={preview.charges.map((c) => ({ id: c.id, label: c.label, dueDate: c.dueDate, outstanding: c.outstanding }))}
              selected={prefer}
              onChange={setPrefer}
              choosing={choosing}
              onChoosingChange={setChoosing}
              paidAt={paidAt}
              currency={currency}
            />
          )}

          {preview && (preview.lateFees.length > 0 || waive) && (
            <label className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-accent/20 transition-colors">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Condonar intereses por mora</span>
                <span className="block text-[11px] text-muted-foreground">
                  Lo condonado no vuelve en el próximo cobro. Si sigue debiendo, desde esta fecha corren intereses nuevos.
                </span>
              </span>
              <Switch checked={waive} onCheckedChange={setWaive} aria-label="Condonar intereses por mora" />
            </label>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground min-h-8"
              aria-expanded={showMore}
            >
              <ChevronDown size={14} className={cn("transition-transform", showMore && "rotate-180")} />
              Más datos (referencia, quién pagó, nota)
            </button>
            {showMore && (
              <div className="mt-2 space-y-3 animate-fade-in">
                <div className="space-y-1.5">
                  <Label htmlFor="pay-ref">N° de operación o referencia</Label>
                  <Input id="pay-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="Ej: 0001234567" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-payer">Lo pagó otra persona</Label>
                  <Input id="pay-payer" value={payerName} maxLength={120} onChange={(e) => setPayerName(e.target.value)} placeholder="Nombre de quien pagó (si no fue el inquilino)" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-notes">Nota interna</Label>
                  <Input id="pay-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Sólo la ve el equipo" />
                </div>
              </div>
            )}
          </div>
        </div>

        <PaymentPreviewPanel
          preview={preview}
          loading={previewLoading}
          amount={parsedAmount}
          paidAt={paidAt}
          waive={waive}
          lateFeeHint={setup.contract.lateFeeHint}
          error={settled.key === queryKey ? settled.error : null}
        />
      </div>

      {fieldError && !fieldError.field && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{fieldError.error}</p>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={props.close} disabled={submitting}>
          Cancelar
        </Button>
        {mustReload ? (
          <Button onClick={() => window.location.reload()} className="gap-2 min-w-44">
            <RotateCcw size={14} /> Recargar la página
          </Button>
        ) : (
          <Button onClick={submit} disabled={!canSubmit} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white min-w-44">
            {submitting ? <Spinner /> : <HandCoins size={14} />}
            {parsedAmount && parsedAmount > 0 ? `Registrar ${formatMoney(parsedAmount, currency)}` : "Registrar cobro"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
