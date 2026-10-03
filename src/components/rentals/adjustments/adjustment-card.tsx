import Link from "next/link";
import { ArrowRight, BellRing, CheckCircle2, ChevronDown, Clock3, PencilLine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { INDEX_META, isCoefficientIndex, isIndexCode, type MonthCoverage } from "@/lib/rentals/indices";
import { AUTO_APPLY_HORIZON_DAYS } from "@/lib/rentals/adjustments";
import { addDays, addMonthsToMonth } from "@/lib/rentals/ymd";
import { ADJUSTMENT_STATUS_META, formatContractNumber } from "@/lib/rentals/labels";
import { DateTile, Money, RENTALS_ACCENT, StatusBadge } from "@/components/rentals/ui";
import {
  adjustmentMethodLine,
  formatVariation,
  longDate,
  monthName,
  plainMoney,
  shortDate,
  waitingForIndexText,
} from "./adjustment-text";
import { adjustmentActions, effectiveVariation, isOverridden, newAmountOf, type AdjustmentView } from "./adjustment-view";
import { AdjustmentActions } from "./adjustment-actions";

/**
 * Tarjeta de un ajuste: cuándo rige, de cuánto a cuánto y por qué (índice,
 * meses, niveles), su estado y las acciones. Server-safe: la botonera es el
 * único pedazo cliente. Se usa en /ajustes y en la ficha del contrato.
 */

const LEVEL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

function tileTone(a: AdjustmentView, today: string): "neutral" | "in" | "warn" | "out" {
  if (a.status === "aplicado") return a.effectiveDate <= today ? "in" : "neutral";
  if ((a.status === "pendiente_indice" || a.status === "pendiente_manual" || a.status === "calculado") && a.effectiveDate <= today) return "warn";
  return "neutral";
}

function keyLabel(a: AdjustmentView, key: string): string {
  const daily = a.indexCode && isIndexCode(a.indexCode) && INDEX_META[a.indexCode].frequency === "daily";
  return daily ? `del ${shortDate(key)}` : `de ${monthName(key, true)}`;
}

function CalcDetail({ a }: { a: AdjustmentView }) {
  const label = a.indexCode && isIndexCode(a.indexCode) ? INDEX_META[a.indexCode] : null;
  const rows: { k: string; v: string }[] = [];
  if (a.method === "indice" && label && a.fromKey && a.toKey && a.fromValue != null && a.toValue != null) {
    // Casa Propia se publica como coeficiente de cada mes: los "niveles"
    // guardados son esos coeficientes encadenados (su valor suelto no dice
    // nada), así que se muestran los meses y el producto.
    const coef = a.indexCode != null && isIndexCode(a.indexCode) && isCoefficientIndex(a.indexCode);
    if (coef) {
      rows.push({ k: `Coeficientes ${label.label}`, v: `${monthName(addMonthsToMonth(a.fromKey, 1), true)} a ${monthName(a.toKey, true)}` });
    } else {
      rows.push({ k: `${label.label} ${keyLabel(a, a.fromKey)}`, v: LEVEL.format(a.fromValue) });
      rows.push({ k: `${label.label} ${keyLabel(a, a.toKey)}`, v: LEVEL.format(a.toValue) });
    }
    const raw = a.toValue / a.fromValue;
    rows.push({ k: coef ? "Producto de los coeficientes" : "Variación del índice", v: `× ${LEVEL.format(raw)} (${formatVariation(Math.round((raw - 1) * 10000) / 100)})` });
    if (a.coefficient != null && Math.abs(raw - a.coefficient) > 0.000001) {
      rows.push({ k: a.coefficient > raw ? "El índice bajó: el precio no baja" : "Se aplicó el tope del contrato", v: `× ${LEVEL.format(a.coefficient)}` });
    }
  } else if (a.method === "porcentaje_fijo" && a.fixedPct != null) {
    rows.push({ k: "Aumento pactado", v: formatVariation(a.fixedPct) });
  } else if (a.method === "escalonado") {
    rows.push({ k: "Monto pactado en el contrato", v: a.computedAmount != null ? plainMoney(a.computedAmount, a.currency) : "—" });
  }
  if (a.baseAmount != null && a.coefficient != null && a.computedAmount != null && a.method !== "escalonado") {
    const raw = Math.round(a.baseAmount * a.coefficient * 100) / 100;
    rows.push({ k: `${plainMoney(a.baseAmount, a.currency)} × ${LEVEL.format(a.coefficient)}`, v: plainMoney(raw, a.currency) });
    if (Math.abs(raw - a.computedAmount) > 0.004) rows.push({ k: "Redondeado", v: plainMoney(a.computedAmount, a.currency) });
  }
  if (!rows.length) return null;
  return (
    <details className="group rounded-lg border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        Ver el cálculo
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <dl className="px-3 pb-3 space-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.k} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{r.k}</dt>
            <dd className="font-medium tabular-nums text-right">{r.v}</dd>
          </div>
        ))}
        {label && <p className="pt-1 text-[11px] text-muted-foreground">Fuente: {label.publisher}.</p>}
      </dl>
    </details>
  );
}

export function AdjustmentCard({
  adj,
  today,
  canEdit,
  showContract = true,
  autoApply,
  coverage,
}: {
  adj: AdjustmentView;
  today: string;
  canEdit: boolean;
  /** false dentro de la ficha del contrato (ya se sabe de qué contrato es). */
  showContract?: boolean;
  /** "Aplicar ajustes automáticamente" de la org: si está, un ajuste lejano se aplica solo. */
  autoApply?: boolean;
  /** Casa Propia: lo cargado (IndexSummary.coverage) para nombrar el mes que de verdad falta; sin esto se nombra el final de la ventana. */
  coverage?: MonthCoverage | null;
}) {
  const meta = ADJUSTMENT_STATUS_META[adj.status];
  // Calculado y lejos de regir con auto-aplicación: se aplica solo, nada que hacer.
  const scheduled = adj.status === "calculado" && !!autoApply && adj.effectiveDate > addDays(today, AUTO_APPLY_HORIZON_DAYS);
  const amount = newAmountOf(adj);
  const variation = effectiveVariation(adj);
  const overridden = isOverridden(adj);
  const methodLine = adjustmentMethodLine(
    { method: adj.method, index_code: adj.indexCode, from_key: adj.fromKey, to_key: adj.toKey },
    adj.every,
    { fixedPct: adj.fixedPct },
  );
  const position = adj.totalAdjustments > 0 ? `Ajuste ${adj.sequence} de ${adj.totalAdjustments}` : `Ajuste ${adj.sequence}`;
  const contractHref = `/dashboard/alquileres/contratos/${adj.contractId}?tab=ajustes`;

  return (
    <Card
      id={`ajuste-${adj.id}`}
      className="scroll-mt-24 gap-3 p-4 sm:p-5 transition-shadow target:ring-2 target:ring-[#0d9488]/50 target:shadow-md"
    >
      <div className="flex items-start gap-3">
        <DateTile date={adj.effectiveDate} tone={tileTone(adj, today)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showContract ? (
              <Link href={contractHref} className="min-w-0 truncate text-sm font-medium hover:underline underline-offset-2">
                {adj.address}
              </Link>
            ) : (
              <span className="text-sm font-medium">{position}</span>
            )}
            <StatusBadge meta={meta} compact />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {showContract
              ? [formatContractNumber(adj.contractNumber), adj.tenantName, position].filter(Boolean).join(" · ")
              : `Rige desde el ${longDate(adj.effectiveDate)}`}
          </p>
        </div>
        {variation != null && amount != null && (
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-sm font-semibold tabular-nums"
            style={{ color: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}12`, borderColor: `${RENTALS_ACCENT}35` }}
          >
            {formatVariation(variation)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pl-[3.75rem]">
        {adj.baseAmount != null && <Money amount={adj.baseAmount} currency={adj.currency} tone="muted" className="text-sm" />}
        {adj.status !== "omitido" && <ArrowRight size={14} className="self-center text-muted-foreground" aria-hidden />}
        {adj.status === "omitido" ? (
          <span className="text-sm text-muted-foreground">sigue igual</span>
        ) : amount != null ? (
          <Money amount={amount} currency={adj.currency} className="text-xl font-semibold tracking-tight" />
        ) : adj.status === "pendiente_manual" ? (
          <span className="text-sm font-medium text-orange-600 dark:text-orange-400">falta cargar el monto</span>
        ) : (
          <span className="text-xl font-semibold text-muted-foreground/60" aria-label="todavía sin calcular">
            ?
          </span>
        )}
      </div>

      <div className="space-y-2 pl-[3.75rem]">
        <p className="text-xs text-muted-foreground">{methodLine}</p>
        {(adj.status === "pendiente_indice" || adj.status === "programado") && adj.method === "indice" && amount == null && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <Clock3 size={13} className="mt-px shrink-0" />
            {waitingForIndexText(adj.indexCode, adj.toKey, { coverage, fromKey: adj.fromKey })}
          </p>
        )}
        {adj.status === "calculado" && (
          <p className="text-xs text-blue-700 dark:text-blue-300">
            {scheduled
              ? `Ya está calculado: se aplica solo el ${shortDate(addDays(adj.effectiveDate, -AUTO_APPLY_HORIZON_DAYS))}, con tiempo para avisarle al inquilino. No hace falta hacer nada.`
              : "Ya está calculado. Aplicalo para que los cargos salgan con el monto nuevo."}
          </p>
        )}
        {overridden && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <PencilLine size={13} className="mt-px shrink-0" />
            <span>
              Fijado a mano{adj.overrideReason ? `: ${adj.overrideReason}` : ""}.
              {adj.computedAmount != null && ` El índice daba ${plainMoney(adj.computedAmount, adj.currency)} (${formatVariation(adj.variationPct)}).`}
            </span>
          </p>
        )}
        {adj.status === "omitido" && adj.overrideReason && (
          <p className="text-xs text-muted-foreground">No se aplicó: {adj.overrideReason}</p>
        )}
        {adj.status === "aplicado" && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs",
              adj.notifiedAt ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300",
            )}
          >
            {adj.notifiedAt ? <CheckCircle2 size={13} /> : <BellRing size={13} />}
            {adj.notifiedAt
              ? `Avisado${adj.notifiedOn ? ` el ${shortDate(adj.notifiedOn)}` : ""}${adj.notifiedVia === "email" ? " por mail" : adj.notifiedVia === "whatsapp" ? " por WhatsApp" : ""}`
              : "Todavía no se le avisó al inquilino"}
          </p>
        )}
        <CalcDetail a={adj} />
      </div>

      {canEdit && Object.values(adjustmentActions(adj)).some(Boolean) && (
        <div className="pl-0 sm:pl-[3.75rem]">
          <AdjustmentActions adj={adj} today={today} canEdit={canEdit} scheduled={scheduled} />
        </div>
      )}
    </Card>
  );
}
