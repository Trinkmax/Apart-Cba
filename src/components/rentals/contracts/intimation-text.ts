import { formatMoney } from "@/lib/format";
import { MONTHS } from "@/lib/settlements/labels";
import type { RentalLateFeeType } from "@/lib/types/database";

/**
 * Texto de la intimación de pago (carta documento) por alquileres impagos.
 *
 * Art. 1222 CCyC: antes de pedir el desalojo por falta de pago hay que intimar
 * de forma fehaciente, con un plazo no menor a 10 días corridos e indicando
 * el lugar de pago. Va al inquilino y, con copia, a cada garante (la mora
 * también se les notifica a ellos). El texto se arma con la deuda al día para
 * copiarlo en el formulario de carta documento del Correo o mandarlo al
 * estudio jurídico.
 */

export interface IntimationLine {
  label: string;
  dueDate: string;
  amount: number;
}

export interface IntimationData {
  today: string;
  /** Ciudad desde donde se firma (la de la propiedad). */
  city: string;
  tenantName: string;
  tenantDoc: string | null;
  /** Dirección completa del inmueble (domicilio contractual del inquilino). */
  propertyAddress: string;
  contractNumber: string;
  /** Fecha del contrato (firma o inicio), YYYY-MM-DD. */
  contractDate: string;
  currency: string;
  lines: IntimationLine[];
  total: number;
  /** "pesos quinientos mil con 00/100" */
  totalWords: string;
  /** Dónde y cómo pagar. */
  paymentPlace: string;
  guarantors: string[];
  signer: string;
  /**
   * Punitorios del contrato; null si no los pacta (tipo "ninguno" o tasa 0).
   * La carta no puede reclamar "punitorios pactados" que el contrato no tiene:
   * es el requisito previo del desalojo y el inquilino la impugnaría.
   */
  lateFee: { type: Exclude<RentalLateFeeType, "ninguno">; value: number } | null;
}

export function longDateEs(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} de ${(MONTHS[m - 1] ?? "").toLowerCase()} de ${y}`;
}

const shortDate = (ymd: string) => ymd.split("-").reverse().join("/");

/** Hasta 4 decimales: en una carta documento la tasa va exacta, sin redondear ni "≈". */
const rate = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 4 });

/**
 * Cierre del reclamo de intereses. Con punitorios pactados se citan con su
 * tasa; sin ellos sólo corresponde el interés moratorio legal (art. 768
 * CCyC: a falta de pacto, la tasa la fijan las leyes o el BCRA).
 */
export function lateFeeClause(lateFee: IntimationData["lateFee"], currency: string): string {
  const tail = "desde cada vencimiento hasta el efectivo pago.";
  if (!lateFee) return `con más los intereses moratorios que correspondan (art. 768 CCyC) ${tail}`;
  const pact =
    lateFee.type === "diario_pct"
      ? `${rate(lateFee.value)} % diario`
      : lateFee.type === "mensual_pct"
        ? `${rate(lateFee.value)} % mensual`
        : `${formatMoney(lateFee.value, currency)} por cada día de atraso`;
  return `con más los intereses punitorios pactados (${pact}) ${tail}`;
}

export function buildIntimationLetter(d: IntimationData): string {
  const doc = d.tenantDoc ? ` (${d.tenantDoc})` : "";
  const detail = d.lines.map((l) => `- ${l.label} (venció el ${shortDate(l.dueDate)}): ${formatMoney(l.amount, d.currency)}`).join("\n");
  const parts = [
    "INTIMACIÓN DE PAGO",
    `${d.city ? `${d.city}, ` : ""}${longDateEs(d.today)}.`,
    `Sr./Sra. ${d.tenantName}${doc}\nDomicilio: ${d.propertyAddress}`,
    `En mi carácter de administrador del inmueble ubicado en ${d.propertyAddress}, por cuenta y orden de su propietario, y en relación con el contrato de locación ${d.contractNumber} del ${shortDate(d.contractDate)}, INTIMO a Ud. para que en el plazo perentorio de DIEZ (10) DÍAS CORRIDOS de recibida la presente abone la suma de ${formatMoney(d.total, d.currency)} (son ${d.totalWords}), que corresponde a:\n${detail}\n${lateFeeClause(d.lateFee, d.currency)}`,
    `Lugar y forma de pago: ${d.paymentPlace}`,
    "Todo ello bajo apercibimiento de iniciar las acciones legales correspondientes, incluido el desalojo por falta de pago (arts. 1219 inc. c y 1222 del Código Civil y Comercial de la Nación) y el cobro ejecutivo de lo adeudado, con costas. Queda Ud. debidamente notificado.",
  ];
  if (d.guarantors.length) {
    parts.push(`Se envía copia de la presente a ${d.guarantors.length === 1 ? "su garante" : "sus garantes"}: ${d.guarantors.join(", ")}.`);
  }
  parts.push(d.signer);
  return parts.join("\n\n");
}
