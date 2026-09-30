"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Info, Loader2, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney, parseAmountInput } from "@/lib/format";
import {
  approveBookingRequest,
  getApprovalDefaults,
  rejectBookingRequest,
  type ApprovalDefaults,
} from "@/lib/actions/booking-requests";
import { restoAlLlegar } from "@/lib/marketplace/sena";
import { whatsappLink } from "@/lib/marketplace/display";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { shortDayLabel, stayRangeLabel, transferLines } from "@/lib/marketplace/staff-helpers";

/**
 * Confirmar o rechazar un pedido de la web. Confirmar abre "Confirmar reserva":
 * seña a pedir (chips + monto editable), lo que paga al llegar, el plazo y los
 * datos de transferencia que se le van a mandar. Si el mail no sale, queda a
 * mano el mismo mensaje para pegar en WhatsApp.
 */

export interface RequestActionsData {
  id: string;
  total: number;
  currency: string;
  guestName: string;
  guestPhone: string | null;
  unitTitle: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
}

/** Monto → texto para el input en formato es-AR ("70.000", "1.234,5"). */
function toAmountText(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: true });
}

export function BookingRequestActions({
  request,
  defaults,
  canApprove = true,
  canReject = true,
  compact = false,
}: {
  request: RequestActionsData;
  /** Si no viene, se piden al abrir el modal. */
  defaults?: ApprovalDefaults | null;
  canApprove?: boolean;
  canReject?: boolean;
  /** Botones chicos (tarjeta de la lista). */
  compact?: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  if (!canApprove && !canReject) return null;

  return (
    <div className={cn("flex gap-2", compact ? "flex-row flex-wrap" : "flex-col sm:flex-row")}>
      {canApprove ? (
        <Button
          type="button"
          onClick={() => setApproveOpen(true)}
          size={compact ? "sm" : "default"}
          className={cn(!compact && "min-h-11 px-5 sm:min-h-10")}
        >
          <Check className="size-4" aria-hidden />
          Confirmar reserva
        </Button>
      ) : null}
      {canReject ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setRejectOpen(true)}
          size={compact ? "sm" : "default"}
          className={cn(!compact && "min-h-11 px-5 sm:min-h-10")}
        >
          <X className="size-4" aria-hidden />
          Rechazar
        </Button>
      ) : null}

      {canApprove ? (
        <ApproveDialog open={approveOpen} onOpenChange={setApproveOpen} request={request} initialDefaults={defaults ?? null} />
      ) : null}
      {canReject ? <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} request={request} /> : null}
    </div>
  );
}

// ─── Confirmar ───────────────────────────────────────────────────────────────

type ApprovedResult = {
  bookingId: string;
  guestMessage: string;
  guestWhatsappUrl: string | null;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Mensaje copiado. Pegalo en WhatsApp.");
  } catch {
    toast.error("No pudimos copiar. Seleccioná el texto y copialo a mano.");
  }
}

function ApproveDialog({
  open,
  onOpenChange,
  request,
  initialDefaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestActionsData;
  initialDefaults: ApprovalDefaults | null;
}) {
  const router = useRouter();
  const [defaults, setDefaults] = useState<ApprovalDefaults | null>(initialDefaults);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [senaText, setSenaText] = useState<string>(() => senaTextFrom(initialDefaults));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApprovedResult | null>(null);
  const [pending, startTransition] = useTransition();
  const loadingRef = useRef(false);

  // Sin defaults (tarjeta de la lista): se piden al abrir.
  useEffect(() => {
    if (!open || defaults || loadingRef.current) return;
    loadingRef.current = true;
    getApprovalDefaults(request.id)
      .then((d) => {
        if (!d) {
          setLoadError("No encontramos el pedido. Puede que ya lo haya resuelto otra persona.");
          return;
        }
        setDefaults(d);
        setSenaText(senaTextFrom(d));
      })
      .catch(() => setLoadError("No pudimos cargar los datos del pedido. Probá de nuevo."))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [open, defaults, request.id]);

  const total = request.total;
  const parsed = senaText.trim() === "" ? null : parseAmountInput(senaText);
  const senaInvalid =
    senaText.trim() === ""
      ? "Poné un monto o elegí «Sin seña»."
      : parsed == null || !Number.isFinite(parsed) || parsed < 0
        ? "Revisá el monto."
        : parsed > total
          ? `No puede superar el total (${formatMoney(total, request.currency)}).`
          : null;
  const sena = !senaInvalid && parsed != null ? parsed : null;
  const aLlegar = sena != null ? restoAlLlegar(total, sena > 0 ? sena : null) : null;
  const dueHours = defaults?.dueHours ?? 24;
  const conflicts = defaults?.conflicts ?? [];
  const requestConflicts = defaults?.requestConflicts ?? [];
  const tLines = transferLines(defaults?.transfer ?? null);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
    // Al cerrar se limpia el error de carga: si se vuelve a abrir, se reintenta.
    if (!next && loadError) setLoadError(null);
    if (!next && result) {
      setResult(null);
      router.refresh();
    }
  }

  function confirm() {
    if (sena == null) {
      setError(senaInvalid ?? "Revisá el monto de la seña.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await approveBookingRequest(request.id, { deposit: sena });
      if (!r.ok) {
        setError(r.error);
        toast.error("No pudimos confirmar la reserva", { description: r.error });
        return;
      }
      if (r.emailSent) {
        toast.success("Reserva confirmada. Le mandamos el mail.", {
          action: { label: "Ver reserva", onClick: () => router.push(`/dashboard/reservas/${r.bookingId}`) },
        });
        onOpenChange(false);
        router.refresh();
        return;
      }
      toast.warning("Reserva confirmada, pero el mail no salió", {
        description: "Mandale el mensaje por WhatsApp.",
        action: { label: "Copiar mensaje", onClick: () => void copyText(r.guestMessage) },
        duration: 12_000,
      });
      setResult({ bookingId: r.bookingId, guestMessage: r.guestMessage, guestWhatsappUrl: r.guestWhatsappUrl });
    });
  }

  const guestsText = request.guests === 1 ? "1 huésped" : `${request.guests} huéspedes`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {result ? (
          <ApprovedStep result={result} guestName={request.guestName} onClose={() => handleOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirmar reserva</DialogTitle>
              <DialogDescription>
                {request.unitTitle} · {stayRangeLabel(request.checkIn, request.checkOut, request.nights)} · {guestsText}.
                Total {formatMoney(total, request.currency)}.
              </DialogDescription>
            </DialogHeader>

            {loadError ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {loadError}
              </p>
            ) : !defaults ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando seña y datos de transferencia…
              </p>
            ) : (
              <div className="space-y-5">
                {conflicts.length > 0 ? (
                  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                    <p className="flex items-center gap-1.5 font-medium text-destructive">
                      <AlertTriangle className="size-4" aria-hidden /> Esas fechas ya están ocupadas
                    </p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {conflicts.map((c) => (
                        <li key={c.booking_id}>
                          {c.is_block ? "Bloqueo" : (c.guest_name ?? "Reserva")} · {shortDayLabel(c.check_in)} → {shortDayLabel(c.check_out)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-muted-foreground">Confirmar va a fallar hasta que muevas o canceles esa reserva.</p>
                  </div>
                ) : null}
                {requestConflicts.length > 0 ? (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                    Hay {requestConflicts.length === 1 ? "una solicitud" : `${requestConflicts.length} solicitudes`} de otro canal sin
                    confirmar en esas fechas ({requestConflicts.map((r) => r.channel).join(", ")}).
                  </p>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor={`sena-${request.id}`}>Seña a pedir</Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Montos sugeridos">
                    {defaults.senaOptions.map((o) => {
                      const active = sena != null && sena === o.amount;
                      return (
                        <button
                          key={`${o.label}-${o.amount}`}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setSenaText(o.amount > 0 ? toAmountText(o.amount) : "0");
                            setError(null);
                          }}
                          className={cn(
                            "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                          )}
                        >
                          <span className="font-medium">{o.label}</span>
                          {o.amount > 0 ? (
                            <span className={cn("tabular-nums", active ? "opacity-90" : "text-muted-foreground")}>
                              {formatMoney(o.amount, request.currency)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
                    <Input
                      id={`sena-${request.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="pl-7 tabular-nums"
                      value={senaText}
                      aria-invalid={senaInvalid ? true : undefined}
                      aria-describedby={`sena-${request.id}-help`}
                      onChange={(e) => {
                        setSenaText(e.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                  <div id={`sena-${request.id}-help`} className="text-sm" aria-live="polite">
                    {senaInvalid ? (
                      <span className="text-destructive">{senaInvalid}</span>
                    ) : aLlegar != null ? (
                      <span className="text-muted-foreground">
                        {sena != null && sena > 0 ? (
                          <>
                            Al llegar paga <strong className="font-semibold text-foreground tabular-nums">{formatMoney(aLlegar, request.currency)}</strong>.
                            Tiene {hoursLabel(dueHours)} para transferir la seña.
                          </>
                        ) : (
                          <>Sin seña: paga todo al llegar ({formatMoney(total, request.currency)}).</>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>

                {sena != null && sena > 0 ? <TransferBlock lines={tLines} /> : null}
              </div>
            )}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => handleOpenChange(false)} disabled={pending}>
                Volver
              </Button>
              <Button type="button" className="min-h-11 sm:min-h-9" onClick={confirm} disabled={pending || !defaults || sena == null}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                Confirmar y avisar al huésped
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Texto inicial del input: la seña sugerida ("0" = sin seña). */
function senaTextFrom(d: ApprovalDefaults | null): string {
  if (!d) return "";
  const s = d.senaSuggested;
  return s != null && s > 0 ? toAmountText(s) : "0";
}

/** Datos de transferencia que se van a mandar, o el aviso de que faltan. */
function TransferBlock({ lines }: { lines: string[] }) {
  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">Todavía no cargaste los datos para transferir.</p>
        <p className="mt-0.5">
          El huésped va a ver «te los pasamos por WhatsApp». Cargalos en{" "}
          <Link href="/dashboard/configuracion/web" className="font-medium underline underline-offset-2">
            Configuración › Web y cobros
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Le vamos a mandar estos datos</p>
      <ul className="mt-1.5 space-y-0.5 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="break-words">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Confirmada pero sin mail: el mensaje listo para WhatsApp. */
function ApprovedStep({
  result,
  guestName,
  onClose,
}: {
  result: ApprovedResult;
  guestName: string;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Reserva confirmada</DialogTitle>
        <DialogDescription>
          El mail a {guestName || "el huésped"} no salió. Mandale este mensaje por WhatsApp: tiene la seña, los datos para
          transferir y el link para seguir la reserva.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        readOnly
        value={result.guestMessage}
        rows={10}
        className="font-mono text-xs leading-relaxed"
        aria-label="Mensaje para el huésped"
        onFocus={(e) => e.currentTarget.select()}
      />
      <DialogFooter className="gap-2 sm:gap-2">
        <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
          <Link href={`/dashboard/reservas/${result.bookingId}`} onClick={onClose}>
            Ver reserva
          </Link>
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void copyText(result.guestMessage)}>
          <Copy className="size-4" aria-hidden /> Copiar mensaje
        </Button>
        {result.guestWhatsappUrl ? (
          <Button asChild className="min-h-11 sm:min-h-9">
            <a href={result.guestWhatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden /> Abrir WhatsApp
            </a>
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

// ─── Rechazar ────────────────────────────────────────────────────────────────

const QUICK_REASONS = [
  { key: "fechas", label: "Esas fechas ya no están disponibles", text: "Esas fechas ya no están disponibles." },
  { key: "minimo", label: "No cumple la estadía mínima", text: "Tu estadía no llega a la cantidad mínima de noches de esta unidad." },
  { key: "otro", label: "Otro", text: "" },
] as const;

function RejectDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestActionsData;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  function pick(key: string) {
    const q = QUICK_REASONS.find((r) => r.key === key);
    if (!q) return;
    setPicked(key);
    setReason(q.text);
    setError(null);
    if (key === "otro") requestAnimationFrame(() => textRef.current?.focus());
  }

  function submit() {
    const text = reason.trim();
    if (text.length < 5) {
      setError("Contale al huésped el motivo (al menos unas palabras).");
      textRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await rejectBookingRequest(request.id, text);
      if (!r.ok) {
        setError(r.error);
        toast.error("No pudimos rechazar el pedido", { description: r.error });
        return;
      }
      if (r.emailSent) {
        toast.success("Pedido rechazado. Le avisamos al huésped por mail.");
      } else {
        const wa = whatsappLink(
          request.guestPhone,
          `Hola${request.guestName ? ` ${request.guestName.split(/\s+/)[0]}` : ""}, te escribimos por tu pedido en ${request.unitTitle} (${stayRangeLabel(request.checkIn, request.checkOut, request.nights)}). ${text}`,
        );
        toast.warning("Pedido rechazado, pero el mail no salió", {
          description: wa ? "Avisale al huésped por WhatsApp." : "Avisale al huésped por otro medio.",
          action: wa ? { label: "Abrir WhatsApp", onClick: () => window.open(wa, "_blank", "noopener,noreferrer") } : undefined,
          duration: 12_000,
        });
      }
      onOpenChange(false);
      setReason("");
      setPicked(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechazar pedido</DialogTitle>
          <DialogDescription>
            {request.guestName} va a recibir un mail con el motivo y la invitación a buscar otras fechas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos frecuentes">
            {QUICK_REASONS.map((q) => (
              <button
                key={q.key}
                type="button"
                aria-pressed={picked === q.key}
                onClick={() => pick(q.key)}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  picked === q.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`reject-${request.id}`}>Motivo para el huésped</Label>
            <Textarea
              id={`reject-${request.id}`}
              ref={textRef}
              rows={3}
              maxLength={1000}
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="Contale por qué no podés confirmarla."
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={pending}>
            Volver
          </Button>
          <Button type="button" variant="destructive" className="min-h-11 sm:min-h-9" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
            Rechazar y avisar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
