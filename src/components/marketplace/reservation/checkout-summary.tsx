import Image from "next/image";
import Link from "next/link";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { cn } from "@/lib/utils";
import { guestsLabel, nightsLabel, shortDay } from "./format";
import { MoneyRow } from "./stage-parts";

export interface CheckoutSummaryData {
  unit: {
    id: string;
    slug: string;
    title: string;
    tagline: string | null;
    hood: string | null;
    summaryLine: string;
    coverUrl: string | null;
    instant: boolean;
  };
  stay: { checkIn: string; checkOut: string; nights: number; guests: number };
  money: {
    currency: string;
    subtotal: number;
    cleaningFee: number;
    total: number;
    avgNightly: number;
    /** true si las noches no valen todas lo mismo (reglas de precio). */
    variableNightly: boolean;
    sena: number | null;
    /** "1 noche", "30 %". */
    senaRuleLabel: string | null;
    resto: number;
  };
  /** Volver a la ficha con las mismas fechas para cambiarlas. */
  changeDatesHref: string;
}

const dtClass = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500";

/**
 * Resumen del checkout: foto en arco, fechas, desglose y cómo se paga (seña al
 * confirmar, resto al llegar). Mismo contenido en el lateral (desktop) y en el
 * desplegable de arriba (celular).
 */
export function CheckoutSummary({
  data,
  className,
  showHeader = true,
}: {
  data: CheckoutSummaryData;
  className?: string;
  /** El desplegable del celular ya muestra título y total en su botón. */
  showHeader?: boolean;
}) {
  const { unit, stay, money } = data;
  const cur = money.currency || "ARS";
  return (
    <div className={cn("space-y-5", className)}>
      {showHeader ? (
        <div className="flex gap-4">
          <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-b-2xl rounded-t-full bg-cream-200">
            {unit.coverUrl ? (
              <Image src={unit.coverUrl} alt="" fill sizes="80px" className="object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-forest-700/25">
                <ApartLogo variant="symbol" className="h-8" title={null} />
              </div>
            )}
          </div>
          <div className="min-w-0 pt-1">
            {unit.hood ? <p className="text-[0.8125rem] text-ink-500">{unit.hood}</p> : null}
            <p className="text-lg font-extrabold leading-tight tracking-[-0.01em] text-forest-700">{unit.title}</p>
            {unit.tagline ? (
              <p className="font-apart-serif text-[0.9375rem] italic leading-snug text-forest-600">{unit.tagline}</p>
            ) : null}
            <p className="mt-1 text-[0.8125rem] leading-snug text-ink-500">{unit.summaryLine}</p>
          </div>
        </div>
      ) : null}

      <div className={cn(showHeader && "border-t border-cream-300 pt-4")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
          <div>
            <dt className={dtClass}>Llegada</dt>
            <dd className="mt-0.5 font-semibold text-ink-900">{shortDay(stay.checkIn)}</dd>
          </div>
          <div>
            <dt className={dtClass}>Salida</dt>
            <dd className="mt-0.5 font-semibold text-ink-900">{shortDay(stay.checkOut)}</dd>
          </div>
          <div>
            <dt className={dtClass}>Estadía</dt>
            <dd className="mt-0.5 font-semibold text-ink-900">{nightsLabel(stay.nights)}</dd>
          </div>
          <div>
            <dt className={dtClass}>Huéspedes</dt>
            <dd className="mt-0.5 font-semibold text-ink-900">{guestsLabel(stay.guests)}</dd>
          </div>
        </dl>
        <Link
          href={data.changeDatesHref}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700"
        >
          Cambiar fechas o huéspedes
        </Link>
      </div>

      <dl className="space-y-2.5 border-t border-cream-300 pt-4 text-[0.9375rem]">
        <MoneyRow
          label={`${formatCurrency(money.avgNightly, cur)} × ${nightsLabel(stay.nights)}`}
          hint={money.variableNightly ? "Precio promedio por noche" : undefined}
          value={formatCurrency(money.subtotal, cur)}
        />
        {money.cleaningFee > 0 ? <MoneyRow label="Limpieza" value={formatCurrency(money.cleaningFee, cur)} /> : null}
        <MoneyRow label="Total" value={formatCurrency(money.total, cur)} strong className="border-t border-cream-300 pt-2.5" />
      </dl>

      <div className="rounded-2xl bg-leaf-100 px-4 py-3.5 ring-1 ring-leaf-300">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">Cómo se paga</p>
        <dl className="mt-2 space-y-2 text-[0.9375rem]">
          <MoneyRow
            label={unit.instant ? "Seña para asegurarla" : "Seña, cuando te confirmemos"}
            hint={money.senaRuleLabel ? `Equivale a ${money.senaRuleLabel}` : undefined}
            value={money.sena ? formatCurrency(money.sena, cur) : "Sin seña"}
          />
          <MoneyRow
            label="Al llegar"
            hint="En efectivo o por transferencia"
            value={formatCurrency(money.resto, cur)}
          />
        </dl>
        <p className="mt-3 text-[0.8125rem] font-semibold text-forest-700">Hoy no pagás nada.</p>
      </div>
    </div>
  );
}
