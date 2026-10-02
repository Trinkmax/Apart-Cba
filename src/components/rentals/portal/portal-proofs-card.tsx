import { Check, ChevronDown, ClipboardCheck } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindChip, kindLabel } from "@/components/rentals/proofs/proof-kind-icon";
import { monthInSentence } from "@/components/rentals/proofs/proof-helpers";
import { PortalCard, PortalTitle } from "./portal-payment-card";
import type { TenantPortalProof, TenantPortalView } from "./portal-types";
import { PortalProofUpload } from "./portal-proof-upload";

/**
 * "Expensas y servicios" del portal: qué tiene que presentar este mes, el
 * estado de lo que mandó (con el motivo si se rechazó) y los meses anteriores.
 */

function statusLine(p: TenantPortalProof, currency: string): { text: string; tone: "muted" | "blue" | "emerald" | "rose" | "amber" } {
  switch (p.status) {
    case "en_revision":
      return { text: "Lo estamos revisando", tone: "blue" };
    case "validado":
      return { text: p.amount != null ? `Validado · ${formatMoney(p.amount, currency)}` : "Validado", tone: "emerald" };
    case "rechazado":
      return { text: `Rechazado${p.rejectionReason ? `: ${p.rejectionReason}` : ""}. Volvé a subirlo.`, tone: "rose" };
    case "no_corresponde":
      return { text: "No hace falta este mes", tone: "muted" };
    default:
      return { text: "Falta subirlo", tone: "amber" };
  }
}

const TONE: Record<string, string> = {
  muted: "text-muted-foreground",
  blue: "text-blue-700",
  emerald: "text-emerald-700",
  rose: "text-rose-700",
  amber: "text-amber-700",
};

function ProofLine({ p, view, token }: { p: TenantPortalProof; view: TenantPortalView; token: string }) {
  const s = statusLine(p, view.contract.currency);
  const label = `${kindLabel(p.kind)} de ${monthInSentence(p.period)}`;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <KindChip kind={p.kind} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{kindLabel(p.kind)}</p>
        <p className={cn("text-xs", TONE[s.tone])}>
          {p.status === "validado" && <Check size={12} className="mr-1 inline -translate-y-px" />}
          {s.text}
        </p>
      </div>
      {p.canUpload && (
        <PortalProofUpload
          token={token}
          kind={p.kind}
          period={p.period}
          label={label}
          replace={p.status === "en_revision"}
          brandColor={view.org.brandColor}
        />
      )}
    </li>
  );
}

export function PortalProofsCard({ view, token }: { view: TenantPortalView; token: string }) {
  const { current, history, currentMonth } = view.proofs;
  if (!current.length && !history.length) return null;
  const missingNow = current.filter((p) => p.status === "pendiente" || p.status === "rechazado").length;
  const pendingBefore = history.flatMap((h) => h.proofs).filter((p) => p.status === "pendiente" || p.status === "rechazado");
  return (
    <PortalCard>
      <PortalTitle icon={ClipboardCheck}>Expensas y servicios</PortalTitle>
      <p className="-mt-1 text-sm text-muted-foreground">
        {missingNow
          ? `Subí la foto del comprobante pago de ${monthInSentence(currentMonth)}. Te lleva un minuto.`
          : current.length
            ? `Lo de ${monthInSentence(currentMonth)} está al día. ¡Gracias!`
            : `En ${monthInSentence(currentMonth)} no tenés comprobantes para presentar.`}
      </p>
      {current.length > 0 && <ul className="mt-1 divide-y">{current.map((p) => <ProofLine key={`${p.kind}-${p.period}`} p={p} view={view} token={token} />)}</ul>}

      {pendingBefore.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-medium text-amber-900">También falta de meses anteriores:</p>
          <ul className="divide-y divide-amber-200/70">
            {pendingBefore.map((p) => (
              <li key={`${p.kind}-${p.period}`} className="flex flex-wrap items-center gap-3 py-2.5">
                <KindChip kind={p.kind} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-950">
                    {kindLabel(p.kind)} · {monthInSentence(p.period)}
                  </p>
                  {p.status === "rechazado" && p.rejectionReason && <p className="text-xs text-rose-700">Rechazado: {p.rejectionReason}</p>}
                </div>
                {p.canUpload && (
                  <PortalProofUpload token={token} kind={p.kind} period={p.period} label={`${kindLabel(p.kind)} de ${monthInSentence(p.period)}`} brandColor={view.org.brandColor} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <details className="group mt-3 rounded-xl border bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            Meses anteriores
            <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t px-3 py-3">
            {history.map((h) => (
              <div key={h.month}>
                <p className="mb-1.5 text-xs font-semibold capitalize text-muted-foreground">{monthInSentence(h.month)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {h.proofs.map((p) => {
                    const s = statusLine(p, view.contract.currency);
                    return (
                      <span key={p.kind} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2.5 text-xs" title={s.text}>
                        <KindChip kind={p.kind} size="sm" className="size-6 rounded-full" />
                        <span>{kindLabel(p.kind)}</span>
                        <span className={cn("font-medium", TONE[s.tone])}>
                          {p.status === "validado" ? "✓" : p.status === "en_revision" ? "en revisión" : p.status === "rechazado" ? "rechazado" : p.status === "no_corresponde" ? "no corresponde" : "falta"}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </PortalCard>
  );
}
