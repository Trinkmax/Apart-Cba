import { FileSignature, Mail, MessageCircle, Phone, ReceiptText, TrendingUp } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { daysUntil, formatPctAr } from "./portal-helpers";
import { PortalCard, PortalTitle } from "./portal-payment-card";
import type { TenantPortalView } from "./portal-types";
import { PortalReceiptButton } from "./portal-receipt-button";

/** "Tus pagos", "Tu contrato" y "¿Dudas?" del portal del inquilino. */

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function PortalPaymentsCard({ view, token }: { view: TenantPortalView; token: string }) {
  return (
    <PortalCard>
      <PortalTitle icon={ReceiptText}>Tus pagos</PortalTitle>
      {view.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay pagos registrados. Cuando registremos uno, acá vas a poder bajar el recibo.</p>
      ) : (
        <ul className="divide-y">
          {view.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl border bg-muted/40 leading-none">
                <span className="text-sm font-bold tabular-nums">{Number(p.paidAt.slice(8, 10))}</span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{MONTHS_SHORT[Number(p.paidAt.slice(5, 7)) - 1]}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tabular-nums">{formatMoney(p.amount, p.currency)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.methodLabel}
                  {p.receiptNumber ? ` · Recibo N° ${p.receiptNumber}` : ""}
                </p>
              </div>
              {view.receiptsAvailable && p.receiptNumber && <PortalReceiptButton token={token} paymentId={p.id} receiptNumber={p.receiptNumber} />}
            </li>
          ))}
        </ul>
      )}
    </PortalCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function remainingLabel(today: string, end: string): string {
  const d = daysUntil(today, end);
  if (d < 0) return `terminó el ${formatDate(end)}`;
  if (d === 0) return "termina hoy";
  if (d <= 60) return `faltan ${d} días`;
  const months = Math.round(d / 30.44);
  return `faltan ${months} ${months === 1 ? "mes" : "meses"}`;
}

export function PortalContractCard({ view }: { view: TenantPortalView }) {
  const { contract: c, nextAdjustment, adjustments, today } = view;
  return (
    <PortalCard>
      <PortalTitle icon={FileSignature}>Tu contrato</PortalTitle>
      <dl className="divide-y">
        <Row label="Contrato">
          <span className="font-mono text-[13px]">{c.number}</span>
          <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium", c.status === "vigente" ? "bg-emerald-100 text-emerald-800" : c.status === "por_vencer" || c.status === "vencido_ocupado" || c.status === "rescision_notificada" || c.status === "salida_programada" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>
            {c.statusLabel}
          </span>
        </Row>
        <Row label="Plazo">
          del {formatDate(c.startDate)} al {formatDate(c.endDate)}
          <span className="block text-xs text-muted-foreground">
            {c.moveOutDate ? `Entregás las llaves el ${formatDate(c.moveOutDate)} · ${remainingLabel(today, c.moveOutDate)}` : remainingLabel(today, c.endDate)}
          </span>
        </Row>
        <Row label="Alquiler hoy">
          <span className="font-semibold tabular-nums">{formatMoney(c.currentRent, c.currency)}</span> por mes
        </Row>
        <Row label="Actualización">
          {c.adjustmentSummary}
          {c.indexExplanation && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{c.indexExplanation}</span>}
        </Row>
        {nextAdjustment && (
          <Row label="Próximo ajuste">
            <span className="font-medium">{formatDate(nextAdjustment.date, "d 'de' MMMM yyyy")}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{nextAdjustment.explanation}</span>
          </Row>
        )}
      </dl>
      {adjustments.length > 0 && (
        <div className="mt-3 rounded-xl border bg-muted/20 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <TrendingUp size={13} /> Ajustes anteriores
          </p>
          <ul className="space-y-2.5">
            {adjustments.map((a) => (
              <li key={a.effectiveDate} className="text-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-muted-foreground">Desde el {formatDate(a.effectiveDate)}</span>
                  <span className="tabular-nums">
                    {a.from != null && <span className="text-muted-foreground">{formatMoney(a.from, c.currency)} → </span>}
                    <span className="font-semibold">{formatMoney(a.to, c.currency)}</span>
                    {a.variationPct != null && <span className="ml-1.5 text-xs text-muted-foreground">({a.variationPct >= 0 ? "+" : ""}{formatPctAr(a.variationPct)})</span>}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{a.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PortalCard>
  );
}

export function PortalContactCard({ view }: { view: TenantPortalView }) {
  const { org } = view;
  const hasAny = org.whatsapp || org.email || org.phone;
  return (
    <PortalCard>
      <PortalTitle>¿Dudas?</PortalTitle>
      {hasAny ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {org.whatsapp && (
            <a href={`https://wa.me/${org.whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1f9d55] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#188046]">
              <MessageCircle size={17} /> Escribinos por WhatsApp
            </a>
          )}
          {org.email && (
            <a href={`mailto:${org.email}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors hover:bg-accent">
              <Mail size={16} /> {org.email}
            </a>
          )}
          {org.phone && !org.whatsapp && (
            <a href={`tel:${org.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors hover:bg-accent">
              <Phone size={16} /> {org.phone}
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Comunicate con {org.name} por los medios de siempre.</p>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Este link es personal: no lo compartas. Si lo perdiste o alguien más lo tiene, pedile a la inmobiliaria uno nuevo y este deja de
        funcionar.
      </p>
    </PortalCard>
  );
}
