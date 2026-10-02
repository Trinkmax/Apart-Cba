import { AlertCircle, CalendarClock, CircleCheck, Clock, Info, Landmark, XCircle } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CopyTextButton } from "@/components/rentals/proofs/copy-text-button";
import { dueInWords, parsePaymentInstructions } from "./portal-helpers";
import type { TenantPortalCharge, TenantPortalView } from "./portal-types";
import { PortalReportPayment } from "./portal-report-payment";

/**
 * "Tu próximo pago" (lo primero que ve el inquilino), los avisos que mandó y
 * "Cómo pagar" con CBU / alias para copiar con un toque. Server component con
 * islas cliente (avisar pago, copiar).
 */

export function PortalCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border bg-card p-4 shadow-sm sm:p-5", className)}>{children}</section>;
}

export function PortalTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: typeof Info }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
      {Icon && <Icon size={15} />}
      {children}
    </h2>
  );
}

function ChargeLines({ charge, currency, today }: { charge: TenantPortalCharge; currency: string; today: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{charge.label}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(charge.outstanding, currency)}</p>
      </div>
      <p className={cn("text-xs", charge.state === "vencido" ? "text-rose-700" : "text-muted-foreground")}>
        {dueInWords(today, charge.dueDate)} · {formatDate(charge.dueDate)}
        {charge.paid > 0 ? ` · ya pagaste ${formatMoney(charge.paid, currency)}` : ""}
      </p>
      <ul className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
        {charge.items.map((i, idx) => (
          <li key={`${i.description}-${idx}`} className="flex justify-between gap-3">
            <span className="min-w-0">{i.description}</span>
            <span className="shrink-0 tabular-nums">{formatMoney(i.outstanding, currency)}</span>
          </li>
        ))}
      </ul>
      {charge.lateFee && (
        <p className="text-[11px] text-rose-700/90">
          Incluye {formatMoney(charge.lateFee.amount, currency)} de intereses por mora: {charge.lateFee.explanation}.
        </p>
      )}
    </div>
  );
}

export function PortalPaymentCard({ view, token }: { view: TenantPortalView; token: string }) {
  const { debt, contract, today, org } = view;
  const currency = contract.currency;
  const overdue = debt.charges.filter((c) => c.state === "vencido");
  const upcoming = debt.charges.filter((c) => c.state !== "vencido").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = upcoming[0] ?? null;
  const suggested = overdue.length ? debt.overdue : next ? next.outstanding : contract.currentRent;

  let tone: "rose" | "brand" | "emerald";
  let eyebrow: string;
  let amount: number;
  if (overdue.length) {
    tone = "rose";
    eyebrow = "Tenés un saldo vencido";
    amount = debt.overdue;
  } else if (next) {
    tone = "brand";
    eyebrow = "Tu próximo pago";
    amount = next.outstanding;
  } else {
    tone = "emerald";
    eyebrow = "Estás al día";
    amount = 0;
  }

  return (
    <PortalCard className={cn("overflow-hidden p-0 sm:p-0", tone === "rose" && "border-rose-300")}>
      <div
        className={cn("px-4 pb-4 pt-5 sm:px-5", tone === "rose" && "bg-rose-50", tone === "emerald" && "bg-emerald-50")}
        style={tone === "brand" ? { backgroundColor: `${org.brandColor}12` } : undefined}
      >
        <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : "text-foreground/70")}>
          {tone === "rose" ? <AlertCircle size={14} /> : tone === "emerald" ? <CircleCheck size={14} /> : <CalendarClock size={14} />}
          {eyebrow}
        </p>
        {tone === "emerald" ? (
          <>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-800">¡Gracias! No debés nada</p>
            <p className="mt-1 text-sm text-emerald-900/80">Tu alquiler hoy es de {formatMoney(contract.currentRent, currency)} por mes.</p>
          </>
        ) : (
          <>
            <p className={cn("mt-1.5 text-4xl font-bold leading-none tracking-tight tabular-nums", tone === "rose" && "text-rose-700")}>{formatMoney(amount, currency)}</p>
            {next && !overdue.length && <p className="mt-2 text-sm text-muted-foreground">{dueInWords(today, next.dueDate)} · {formatDate(next.dueDate, "EEEE d 'de' MMMM")}</p>}
            {overdue.length > 0 && debt.total > debt.overdue + 0.005 && (
              <p className="mt-2 text-sm text-muted-foreground">Total con lo que vence después: {formatMoney(debt.total, currency)}</p>
            )}
          </>
        )}
        {view.credit > 0.005 && (
          <p className="mt-2 text-sm text-emerald-800">Tenés {formatMoney(view.credit, currency)} a favor: se descuentan del próximo pago.</p>
        )}
      </div>
      {(overdue.length > 0 || next) && (
        <div className="space-y-4 border-t px-4 py-4 sm:px-5">
          {(overdue.length ? overdue : [next!]).map((c) => (
            <ChargeLines key={c.id} charge={c} currency={currency} today={today} />
          ))}
          {overdue.length > 0 && next && (
            <p className="text-xs text-muted-foreground">
              Después vence {next.label.toLowerCase()} ({formatDate(next.dueDate)}): {formatMoney(next.outstanding, currency)}.
            </p>
          )}
        </div>
      )}
      {view.canReportPayment && (
        <div className="border-t px-4 py-4 sm:px-5">
          <PortalReportPayment token={token} currency={currency} suggestedAmount={suggested} today={today} brandColor={org.brandColor} />
        </div>
      )}
    </PortalCard>
  );
}

export function PortalReports({ view }: { view: TenantPortalView }) {
  const visible = view.reports.filter((r) => r.status !== "registrado").slice(0, 4);
  if (!visible.length) return null;
  const currency = view.contract.currency;
  return (
    <div className="space-y-2">
      {visible.map((r) => (
        <div
          key={r.id}
          className={cn(
            "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
            r.status === "pendiente" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          {r.status === "pendiente" ? <Clock size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
          <p>
            {r.status === "pendiente" ? (
              <>Recibimos tu aviso de <strong>{r.amount != null ? formatMoney(r.amount, currency) : "pago"}</strong>{r.paidOn ? ` del ${formatDate(r.paidOn)}` : ""}. Lo estamos verificando.</>
            ) : (
              <>No pudimos confirmar tu aviso de <strong>{r.amount != null ? formatMoney(r.amount, currency) : "pago"}</strong>{r.reason ? `: ${r.reason}` : ""}. Si es un error, escribinos.</>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PortalHowToPay({ view }: { view: TenantPortalView }) {
  const lines = parsePaymentInstructions(view.org.paymentInstructions);
  return (
    <PortalCard>
      <PortalTitle icon={Landmark}>Cómo pagar</PortalTitle>
      {view.contract.paysOwnerDirectly ? (
        <p className="text-sm text-muted-foreground">El alquiler se lo pagás directamente al propietario. Si ya pagaste, avisanos igual con «Ya pagué» para darte el recibo.</p>
      ) : lines.length ? (
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className={cn("flex items-center justify-between gap-3", l.copy && "rounded-xl border bg-muted/30 px-3 py-2")}>
              <p className={cn("min-w-0 break-words text-sm", l.copy && "font-mono text-[13px]")}>{l.text}</p>
              {l.copy && <CopyTextButton text={l.copy.value} label="Copiar" toastTitle={`${l.copy.label} copiado`} className="h-10 shrink-0" />}
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">Después de transferir, tocá «Ya pagué» y subí el comprobante.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Consultá con la inmobiliaria cómo pagar (más abajo tenés cómo contactarla).</p>
      )}
    </PortalCard>
  );
}
