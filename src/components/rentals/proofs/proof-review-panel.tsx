"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/rentals/ui";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import { formatDateTime, parseAmountInput } from "@/lib/format";
import { PROOF_STATUS_META } from "@/lib/rentals/labels";
import { markProofNotApplicable, reopenProof, reviewProof } from "@/lib/actions/rentals-proofs";
import type { RentalProofStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { QUICK_REJECT_REASONS } from "./proof-helpers";
import type { ProofItem } from "./proof-types";

/**
 * Validar / rechazar un comprobante. El padre lo monta con `key={proof.id}`
 * para que cada comprobante arranque con su importe y sin motivo cargado.
 * Con `shortcuts`, A valida y R abre el rechazo (sólo en el panel visible).
 */

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role='combobox'],[role='listbox']");
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/25 bg-black/5 px-1 font-mono text-[10px] font-semibold leading-none dark:bg-white/10",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function ProofReviewPanel({
  proof,
  onDecided,
  onReopened,
  shortcuts = false,
}: {
  proof: ProofItem;
  onDecided?: (id: string, status: RentalProofStatus) => void;
  onReopened?: (id: string) => void;
  shortcuts?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amountText, setAmountText] = useState(() => formatMoneyEditable(proof.amount));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(proof.rejectionReason ?? "");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [notifyByMail, setNotifyByMail] = useState(!!proof.tenantEmail);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reviewable = proof.status === "en_revision" || proof.status === "pendiente" || proof.status === "rechazado";

  function undo(id: string) {
    startTransition(async () => {
      const res = await reopenProof(id);
      if (!res.ok) {
        toast.error("No se pudo deshacer", { description: res.error });
        return;
      }
      toast.success("Listo: volvió a la cola para revisar");
      onReopened?.(id);
      router.refresh();
    });
  }

  function decide(decision: "validado" | "rechazado") {
    const text = amountText.trim();
    const amount = text ? parseAmountInput(text) : null;
    if (text && (amount == null || amount < 0)) {
      toast.error("Revisá el importe", { description: "Escribilo como 45.000 o 45.000,50." });
      return;
    }
    if (decision === "rechazado" && !reason.trim()) {
      setReasonError("Contá por qué: el inquilino lo lee en su link.");
      reasonRef.current?.focus();
      return;
    }
    const id = proof.id;
    startTransition(async () => {
      const res = await reviewProof(id, {
        decision,
        reason: decision === "rechazado" ? reason.trim() : null,
        amount,
        notifyTenant: decision === "rechazado" && notifyByMail,
      });
      if (!res.ok) {
        if (res.field === "reason") setReasonError(res.error);
        toast.error(decision === "validado" ? "No se pudo validar" : "No se pudo rechazar", { description: res.error });
        return;
      }
      toast.success(decision === "validado" ? "Comprobante validado" : "Comprobante rechazado", {
        description:
          decision === "rechazado"
            ? res.emailed
              ? "Le mandamos el motivo por mail y lo ve en su link."
              : "El inquilino ve el motivo en su link."
            : undefined,
        action: { label: "Deshacer", onClick: () => undo(id) },
      });
      onDecided?.(id, decision);
      router.refresh();
    });
  }

  function notApplicable() {
    const id = proof.id;
    startTransition(async () => {
      const res = await markProofNotApplicable(id);
      if (!res.ok) {
        toast.error("No se pudo marcar", { description: res.error });
        return;
      }
      toast.success("Marcado como «no corresponde»", { action: { label: "Deshacer", onClick: () => undo(id) } });
      onDecided?.(id, "no_corresponde");
      router.refresh();
    });
  }

  function startReject() {
    setRejecting(true);
    requestAnimationFrame(() => reasonRef.current?.focus());
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (pending || !reviewable || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    // Con un diálogo abierto (subir, descartar…) las letras son para ese diálogo.
    if (document.querySelector("[role='dialog'],[role='alertdialog']")) return;
    const k = e.key.toLowerCase();
    if (k === "a") {
      e.preventDefault();
      decide("validado");
    } else if (k === "r") {
      e.preventDefault();
      startReject();
    }
  });
  useEffect(() => {
    if (!shortcuts) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);

  if (!reviewable) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge meta={PROOF_STATUS_META[proof.status]} />
          {proof.reviewedAt && (
            <span className="text-xs text-muted-foreground">
              {proof.reviewerName ? `${proof.reviewerName} · ` : ""}
              {formatDateTime(proof.reviewedAt)}
            </span>
          )}
        </div>
        {proof.notes && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{proof.notes}</p>}
        <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={() => undo(proof.id)}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Volver a revisar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      {proof.status === "rechazado" && proof.rejectionReason && !rejecting && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          Se rechazó antes: {proof.rejectionReason}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`amount-${proof.id}`}>Importe del comprobante ({proof.proofCurrency || proof.currency})</Label>
        <Input
          id={`amount-${proof.id}`}
          type="text"
          inputMode="decimal"
          placeholder="Opcional · 0,00"
          className="h-10 text-lg tabular-nums"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Sirve para tener el historial de lo que paga de expensas y servicios.</p>
      </div>

      {!rejecting ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-12 gap-2 bg-emerald-600 text-base text-white hover:bg-emerald-700"
            disabled={pending}
            onClick={() => decide("validado")}
          >
            {pending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            Validar
            {shortcuts && <Kbd className="ml-1 hidden lg:inline-flex">A</Kbd>}
          </Button>
          <Button
            variant="outline"
            className="h-12 gap-2 border-rose-300/70 text-base text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-800/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
            disabled={pending}
            onClick={startReject}
          >
            <X size={18} />
            Rechazar
            {shortcuts && <Kbd className="ml-1 hidden lg:inline-flex">R</Kbd>}
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
          <Label htmlFor={`reason-${proof.id}`} className="text-rose-800 dark:text-rose-200">
            ¿Por qué lo rechazás?
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setReason(r);
                  setReasonError(null);
                  reasonRef.current?.focus();
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  reason === r ? "border-rose-500 bg-rose-500 text-white" : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Textarea
            id={`reason-${proof.id}`}
            ref={reasonRef}
            rows={2}
            maxLength={500}
            value={reason}
            placeholder="Ej.: la foto está cortada, no se ve el importe."
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setRejecting(false);
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                decide("rechazado");
              }
            }}
            aria-invalid={!!reasonError}
          />
          {reasonError && <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{reasonError}</p>}
          {proof.tenantEmail && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={notifyByMail} onCheckedChange={(v) => setNotifyByMail(v === true)} />
              Avisarle por mail ({proof.tenantEmail})
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700" disabled={pending} onClick={() => decide("rechazado")}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Rechazar comprobante
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <span className="text-[11px] text-muted-foreground hidden lg:inline">Ctrl + Enter para confirmar</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={notApplicable}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Ban size={12} /> No corresponde este mes
      </button>
    </div>
  );
}
