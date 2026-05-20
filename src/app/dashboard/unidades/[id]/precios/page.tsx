import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, DollarSign } from "lucide-react";
import { getUnit } from "@/lib/actions/units";
import { listActiveRules, getCalendarPrices } from "@/lib/actions/pricing";
import { RateCalendarClient } from "@/components/pricing/rate-calendar-client";

export default async function UnitPricingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [unit, rules, calendar] = await Promise.all([
    getUnit(id),
    listActiveRules(id),
    getCalendarPrices(id, year, month),
  ]);
  if (!unit) notFound();

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <Link
        href={`/dashboard/unidades/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Volver a {unit.name}
      </Link>

      <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <DollarSign size={20} />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Tarifas — {unit.code} · {unit.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestioná precios base, reglas estacionales y tarifas por día de semana
          </p>
        </div>
      </div>

      <RateCalendarClient
        unitId={id}
        initialYear={year}
        initialMonth={month}
        initialDays={calendar.days}
        initialBasePrice={calendar.basePrice}
        initialCurrency={calendar.currency}
        initialRules={rules}
      />
    </div>
  );
}
