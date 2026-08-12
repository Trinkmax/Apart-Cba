import { Check } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { SettlementStatement } from "@/components/settlements/settlement-statement";
import {
  buildStatementModel,
  type StatementInput,
  type StatementLineInput,
} from "@/lib/settlements/statement-model";

/**
 * Liquidaciones a propietarios: el módulo más profundo del sistema y el momento
 * de mayor fricción del negocio.
 *
 * El documento de abajo NO es una maqueta: arma un `StatementInput` de ejemplo y
 * lo pasa por `buildStatementModel` + `<SettlementStatement>`, exactamente el
 * mismo par que usan la pantalla del panel, el PDF y el link público. Lo que ve
 * el visitante en la landing es literalmente lo que va a recibir el propietario.
 */

const POINTS = [
  "Cada línea guarda la reserva o el gasto que la originó, así el dueño puede pedir el detalle y vos lo tenés.",
  "Se puede corregir una liquidación ya emitida y deshacer el cambio: queda el historial completo, no se pisa nada.",
  "Se entrega en PDF, en Excel o como link con la marca de tu operación.",
] as const;

/** Una reserva se representa con tres líneas: ingreso, comisión y limpieza. */
function bookingLines(args: {
  ref: string;
  unit: { id: string; code: string; name: string };
  guest: string;
  source: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  gross: number;
  cleaning: number;
  order: number;
}): StatementLineInput[] {
  const commission = Math.round(args.gross * 0.2);
  const meta = {
    guest_name: args.guest,
    nights: args.nights,
    check_in: args.checkIn,
    check_out: args.checkOut,
    source: args.source,
    mode: "temporario" as const,
    commission_pct: 20,
  };

  return [
    {
      id: `${args.ref}-rev`,
      line_type: "booking_revenue",
      ref_type: "booking",
      ref_id: args.ref,
      unit_id: args.unit.id,
      unit: args.unit,
      description: `Estadía ${args.guest}`,
      amount: args.gross,
      sign: "+",
      currency: "ARS",
      meta,
      display_order: args.order,
    },
    {
      id: `${args.ref}-com`,
      line_type: "commission",
      ref_type: "booking",
      ref_id: args.ref,
      unit_id: args.unit.id,
      unit: args.unit,
      description: "Comisión de administración",
      amount: commission,
      sign: "-",
      currency: "ARS",
      meta,
      display_order: args.order + 1,
    },
    {
      id: `${args.ref}-cle`,
      line_type: "cleaning_charge",
      ref_type: "booking",
      ref_id: args.ref,
      unit_id: args.unit.id,
      unit: args.unit,
      description: "Limpieza de salida",
      amount: args.cleaning,
      sign: "-",
      currency: "ARS",
      meta,
      display_order: args.order + 2,
    },
  ];
}

const UNITS = {
  nc4b: { id: "u-nc4b", code: "NC-4B", name: "Rondeau 240" },
  nc9a: { id: "u-nc9a", code: "NC-9A", name: "Chacabuco 1120" },
  gue2c: { id: "u-gue2c", code: "GUE-2C", name: "Belgrano 760" },
};

function buildSampleStatement(year: number, month: number): StatementInput {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = (day: number) => `${year}-${pad(month)}-${pad(day)}`;

  const lines: StatementLineInput[] = [
    ...bookingLines({ ref: "b1", unit: UNITS.nc4b, guest: "Camila Ferreyra", source: "airbnb", checkIn: d(3), checkOut: d(8), nights: 5, gross: 340_000, cleaning: 12_000, order: 10 }),
    ...bookingLines({ ref: "b2", unit: UNITS.nc4b, guest: "Tomás Bustos", source: "directo", checkIn: d(12), checkOut: d(19), nights: 7, gross: 476_000, cleaning: 12_000, order: 20 }),
    ...bookingLines({ ref: "b3", unit: UNITS.nc9a, guest: "Federico Ledesma", source: "booking", checkIn: d(5), checkOut: d(13), nights: 8, gross: 768_000, cleaning: 15_000, order: 30 }),
    ...bookingLines({ ref: "b4", unit: UNITS.nc9a, guest: "Rocío Aguirre", source: "airbnb", checkIn: d(20), checkOut: d(26), nights: 6, gross: 576_000, cleaning: 15_000, order: 40 }),
    ...bookingLines({ ref: "b5", unit: UNITS.gue2c, guest: "Ana Clara Peralta", source: "airbnb", checkIn: d(2), checkOut: d(9), nights: 7, gross: 427_000, cleaning: 11_000, order: 50 }),
    ...bookingLines({ ref: "b6", unit: UNITS.gue2c, guest: "Mateo Quiroga", source: "directo", checkIn: d(21), checkOut: d(25), nights: 4, gross: 244_000, cleaning: 11_000, order: 60 }),
    {
      id: "o1",
      line_type: "maintenance_charge",
      ref_type: "ticket",
      ref_id: null,
      unit_id: UNITS.nc4b.id,
      unit: UNITS.nc4b,
      description: "Cerrajería: cambio de bombín",
      amount: 48_000,
      sign: "-",
      currency: "ARS",
      display_order: 70,
    },
    {
      id: "o2",
      line_type: "adjustment",
      ref_type: null,
      ref_id: null,
      unit_id: UNITS.gue2c.id,
      unit: UNITS.gue2c,
      description: "Expensas del consorcio",
      amount: 137_500,
      sign: "-",
      currency: "ARS",
      display_order: 80,
    },
  ];

  const gross = 340_000 + 476_000 + 768_000 + 576_000 + 427_000 + 244_000;
  const commission = Math.round(gross * 0.2);
  const deductions = 12_000 * 2 + 15_000 * 2 + 11_000 * 2 + 48_000 + 137_500;

  return {
    // El número del documento se deriva del id (LIQ-año-mes-6 chars), así que
    // acá va un id con pinta de uuid en vez de la palabra "sample".
    id: "9f2ac41e-0b77-4d18-9a5c-6e0f2b1d84cc",
    period_year: year,
    period_month: month,
    period_index: 2,
    period_cycle: 3,
    period_note: null,
    status: "enviada",
    currency: "ARS",
    gross_revenue: gross,
    commission_amount: commission,
    deductions_amount: deductions,
    net_payable: gross - commission - deductions,
    generated_at: null,
    sent_at: null,
    paid_at: null,
    owner: {
      full_name: "Silvana Recalde",
      bank_name: "Banco de Córdoba",
      cbu: null,
      alias_cbu: "silvana.recalde.arq",
    },
    lines,
  };
}

export function SettlementShowcase() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const model = buildStatementModel(
    buildSampleStatement(prev.getFullYear(), prev.getMonth() + 1)
  );

  return (
    <div>
      <Reveal className="max-w-[62ch]">
        <h2 className="text-[30px] font-semibold leading-[1.12] tracking-tight md:text-[40px]">
          La liquidación al propietario deja de ser dos días de Excel.
        </h2>
        <p className="mt-5 leading-relaxed text-muted-foreground">
          rentOS junta las reservas del mes de cada dueño, descuenta comisión, limpiezas y
          arreglos, y arma el detalle línea por línea. Vos revisás y mandás.
        </p>

        <ul className="mt-7 flex flex-col gap-3.5">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Check size={12} strokeWidth={3} />
              </span>
              <span className="text-sm leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={120} className="mt-12">
        <SettlementStatement model={model} />
      </Reveal>
    </div>
  );
}
