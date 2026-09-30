"use client";

import { FileSignature, MessageCircleQuestion, ReceiptText } from "lucide-react";
import { ProcessSteps } from "@/components/marketplace/brand/process-steps";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { senaStepLabel } from "@/lib/marketplace/widget-quote";
import { useListingStay } from "./stay-context";

/**
 * Las estadías por mes no se piden por la web: se consultan. Tres pasos con el
 * mismo dibujo que ProcessSteps (vertical), sin seña ni "pedís tus fechas".
 */
function MonthlyConsultSteps({ responseHours }: { responseHours: number }) {
  const steps = [
    {
      icon: MessageCircleQuestion,
      title: "Nos consultás",
      body: "Escribinos con las fechas y cuántas personas se quedan. Todavía no pagás nada.",
    },
    {
      icon: ReceiptText,
      title: "Te pasamos precio y condiciones",
      body: `En menos de ${hoursLabel(responseHours)} te mandamos el precio final de tu estadía y qué incluye.`,
    },
    {
      icon: FileSignature,
      title: "Coordinamos contrato y pago",
      body: "Si te sirve, armamos el contrato y acordamos juntos la forma de pago.",
    },
  ];
  return (
    <ol className="relative space-y-4">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-3">
          {i < steps.length - 1 ? (
            <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-12px)] w-px bg-forest-700/15" />
          ) : null}
          <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-t-full rounded-b-md bg-leaf-200 text-forest-700">
            <s.icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-sm font-bold text-forest-700">{s.title}</p>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-500">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Cómo se paga" en UNA línea, para el plegable de celular y tablet: con
 * fechas, los montos ("Seña de $ 80.000 · $ 160.000 al llegar"); sin fechas,
 * la regla ("Seña de 1 noche · el resto, al llegar"); por mes, la consulta.
 */
export function PaymentSummary() {
  const { evaluation, settings, listing, view } = useListingStay();
  const currency = listing.marketplace_currency;
  if (view === "mes" || evaluation.kind === "monthly") return <>Se consulta: precio, contrato y forma de pago</>;
  if (evaluation.kind === "nightly") {
    if (evaluation.sena == null) return <>Sin seña: pagás todo al llegar</>;
    // Sin aria-live: la barra de reservar ya anuncia el total al cambiar las fechas.
    return (
      <>
        Seña de <span className="tabular-nums">{formatCurrency(evaluation.sena, currency)}</span> ·{" "}
        <span className="tabular-nums">{formatCurrency(evaluation.resto, currency)}</span> al llegar
      </>
    );
  }
  const rule = senaStepLabel(null, settings.deposit, currency);
  if (!rule) return <>Sin seña: pagás todo al llegar</>;
  return <>{settings.deposit.rule === "percent" ? `Seña del ${rule}` : `Seña de ${rule}`} · el resto, al llegar</>;
}

/**
 * "Cómo se paga": los cuatro pasos reales con la seña de ESTA estadía (monto
 * si ya hay fechas; si no, la regla: "1 noche", "30 %"). Por mes (pestaña
 * "Por mes", unidad sólo mensual o 28+ noches), los pasos de la consulta.
 */
export function PaymentSteps() {
  const { evaluation, settings, listing, view } = useListingStay();
  if (view === "mes" || evaluation.kind === "monthly") {
    return <MonthlyConsultSteps responseHours={settings.responseHours} />;
  }
  const senaLabel = senaStepLabel(evaluation, settings.deposit, listing.marketplace_currency);
  const nightly = evaluation.kind === "nightly" ? evaluation : null;

  return (
    <div className="space-y-5">
      <ProcessSteps
        layout="vertical"
        responseHours={settings.responseHours}
        senaLabel={senaLabel}
        instant={listing.instant_book}
      />
      {nightly && nightly.sena != null ? (
        <p className="rounded-2xl bg-paper px-4 py-3 text-[0.875rem] leading-relaxed text-ink-700 ring-1 ring-cream-300" aria-live="polite">
          Para tus fechas: seña de{" "}
          <strong className="font-bold text-forest-700 tabular-nums">{formatCurrency(nightly.sena, listing.marketplace_currency)}</strong> y{" "}
          <strong className="font-bold text-forest-700 tabular-nums">{formatCurrency(nightly.resto, listing.marketplace_currency)}</strong> al llegar.
        </p>
      ) : null}
    </div>
  );
}
