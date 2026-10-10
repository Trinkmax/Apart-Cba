import type { BookingSource, SettlementStatus } from "@/lib/types/database";
import { formatMoney } from "@/lib/format";
import { MONTHS, SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { BOOKING_SOURCE_META } from "@/lib/constants";

/**
 * Catálogo de Resultados: umbrales, códigos de aviso, textos y a qué grupo
 * del panel "Para revisar" va cada uno. Sin imports de servidor: lo usan
 * tanto la conciliación como los componentes.
 *
 * Principio: lo que pagó el huésped sale del calendario, lo que se le rinde al
 * propietario sale de su liquidación, y la diferencia se muestra reserva por
 * reserva SIN mezclarla con errores de carga. Cada código de acá es un motivo
 * para sacar una reserva del margen y mandarla a revisar.
 */

// ── Umbrales ─────────────────────────────────────────────────────────────────

/** Diferencia que se considera "coincide" (redondeos de centavos entre co-dueños). */
export const TOL = 1;
/**
 * Menos de $1.000 por noche en ARS es un importe en dólares cargado como pesos:
 * DIVA airbnb "241,53" por 3 noches, SAL648 "437", COLON "1.075" por 148
 * noches. Ninguna estadía real de Córdoba cuesta eso.
 */
export const MIN_ARS_PER_NIGHT = 1000;
/**
 * Un tramo mensual es "consistente" si su total está a ≤4% de renta÷30×noches.
 * Medido en Apart CBA may–sep 2026: 73 de 136 tramos dan exacto y 7 más caen
 * dentro del 4%; de ahí para arriba son tramos mal repartidos o rentas basura.
 */
export const RENT_TOLERANCE = 0.04;
/**
 * Una fila manual (sintética) sólo se asigna a una reserva que cubra al menos
 * la mitad de sus noches: ALVEAR (fila 25/08→28/09) toca 3 noches de un
 * mensual (9%) y 29 de una temporaria (85%); la del 9% no es candidata.
 */
export const SYNTHETIC_MIN_OVERLAP = 0.5;
/** Temporaria de 28 noches o más: los operadores la liquidan mes a mes (CAS1152, DF-3). */
export const LONG_STAY_NIGHTS = 28;

/**
 * Por encima de este % la diferencia de tarifa no se cuenta como margen: se
 * manda a "Para revisar". En Apart CBA la diferencia real ronda el 9% (mediana
 * jun–ago 2026) y sólo 3 de 90 reservas pasaban el 50%; lo que queda arriba
 * casi siempre es un importe mal cargado o una estadía liquidada en parte.
 */
export const HIGH_RATE_DIFF_PCT = 50;
/**
 * Tope de la ventana de liquidaciones hacia atrás (en meses desde el de la
 * vista). Sin tope, cada contrato mensual la estiraba hasta su check-in y en la
 * práctica se traía TODA la historia de la org (275 liquidaciones de 275 en
 * agosto 2026), un período más por mes, para siempre. Lo que empezó antes del
 * tope queda con `historia_incompleta`.
 */
export const MAX_SETTLEMENT_WINDOW_MONTHS = 12;

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ResultsMode = "todos" | "temporario" | "mensual";
export type AggregateView = "depto" | "propietario" | "canal";
export type Coverage = "liquidada" | "parcial" | "sin_liquidar";
export type Outcome = "coincide" | "diferencia" | "liquidado_de_mas" | "sin_conciliar" | "estimada";
export type RowLevel = "revisar" | "sin_liquidar" | "ok";
export type IssueCode =
  | "participaciones"
  | "sin_propietario"
  | "sin_precio"
  | "importe_sospechoso"
  | "moneda_distinta"
  | "renta_inconsistente"
  | "contrato_incompleto"
  | "diferencia_alta"
  | "liquidacion_vieja"
  | "prorrateo_viejo"
  | "liquidado_de_mas"
  | "posible_doble"
  | "falta_en_liquidacion"
  | "cobrada_no_liquidada"
  | "canal_sin_comision";
export type InfoFlag =
  | "por_fechas"
  | "varios_periodos"
  | "estadia_larga"
  | "historia_incompleta"
  | "saldo_huesped"
  | "pieza_en_cero";
/**
 * `prorrateo_mensual` tiene grupo propio y no comparte "La liquidación quedó
 * desactualizada": la reserva no cambió, lo que estaba mal era la cuenta de
 * noches de la generación (fin de mes inclusivo, corregido el 09/10/2026).
 */
export type ReviewGroup =
  | "unidad"
  | "importe_reserva"
  | "liquidacion_desactualizada"
  | "prorrateo_mensual"
  | "liquidado_de_mas"
  | "falta_liquidar"
  | "canal";
export type ReviewWhere = "reserva" | "liquidacion" | "unidad" | "configuracion";
export type OrphanReason =
  | "sin_reserva"
  | "fechas_invalidas"
  | "ambigua"
  | "reserva_cancelada"
  | "reserva_borrada";

// ── Metadatos ────────────────────────────────────────────────────────────────

export const ISSUE_META: Record<
  IssueCode,
  { group: ReviewGroup; priority: 1 | 2 | 3 | 4 | 5 | 6; nullsDiff: boolean; excludesFromTotals: boolean }
> = {
  participaciones: { group: "unidad", priority: 1, nullsDiff: true, excludesFromTotals: false },
  sin_propietario: { group: "unidad", priority: 1, nullsDiff: true, excludesFromTotals: false },
  sin_precio: { group: "importe_reserva", priority: 2, nullsDiff: true, excludesFromTotals: false },
  importe_sospechoso: { group: "importe_reserva", priority: 2, nullsDiff: true, excludesFromTotals: true },
  moneda_distinta: { group: "importe_reserva", priority: 2, nullsDiff: true, excludesFromTotals: true },
  renta_inconsistente: { group: "importe_reserva", priority: 2, nullsDiff: true, excludesFromTotals: false },
  contrato_incompleto: { group: "importe_reserva", priority: 2, nullsDiff: false, excludesFromTotals: false },
  diferencia_alta: { group: "importe_reserva", priority: 2, nullsDiff: true, excludesFromTotals: false },
  liquidacion_vieja: { group: "liquidacion_desactualizada", priority: 3, nullsDiff: true, excludesFromTotals: false },
  prorrateo_viejo: { group: "prorrateo_mensual", priority: 3, nullsDiff: true, excludesFromTotals: false },
  liquidado_de_mas: { group: "liquidado_de_mas", priority: 4, nullsDiff: false, excludesFromTotals: false },
  posible_doble: { group: "liquidado_de_mas", priority: 4, nullsDiff: false, excludesFromTotals: false },
  falta_en_liquidacion: { group: "falta_liquidar", priority: 5, nullsDiff: false, excludesFromTotals: false },
  cobrada_no_liquidada: { group: "falta_liquidar", priority: 5, nullsDiff: true, excludesFromTotals: false },
  canal_sin_comision: { group: "canal", priority: 6, nullsDiff: true, excludesFromTotals: false },
};

export const REVIEW_GROUP_META: Record<ReviewGroup, { label: string; where: ReviewWhere; cta: string }> = {
  unidad: { label: "Revisá los propietarios de la unidad", where: "unidad", cta: "Abrir unidad" },
  importe_reserva: { label: "Revisá el importe de la reserva", where: "reserva", cta: "Abrir reserva" },
  liquidacion_desactualizada: {
    label: "La liquidación quedó desactualizada",
    where: "liquidacion",
    cta: "Abrir liquidación",
  },
  prorrateo_mensual: {
    label: "La liquidación contó mal las noches del mes",
    where: "liquidacion",
    cta: "Abrir liquidación",
  },
  liquidado_de_mas: {
    label: "Se liquidó más de lo que pagó el huésped",
    where: "liquidacion",
    cta: "Abrir liquidación",
  },
  falta_liquidar: { label: "Falta en la liquidación", where: "liquidacion", cta: "Abrir liquidación" },
  canal: {
    label: "Configurá la comisión del canal",
    where: "configuracion",
    cta: "Configurar comisiones",
  },
};

/** Encabezados del panel, en el orden en que se muestran. */
export const REVIEW_WHERE_ORDER: ReviewWhere[] = ["reserva", "liquidacion", "unidad", "configuracion"];
export const REVIEW_WHERE_LABEL: Record<ReviewWhere, string> = {
  reserva: "En la reserva",
  liquidacion: "En la liquidación",
  unidad: "En la unidad",
  configuracion: "En la configuración",
};

/** Ítems del panel que no son un grupo de avisos. */
export const REVIEW_EXTRA_META: Record<"sin_reserva" | "saldo_huesped", { label: string; where: ReviewWhere; cta: string }> = {
  saldo_huesped: { label: "Liquidadas con saldo del huésped", where: "reserva", cta: "Ver reservas" },
  sin_reserva: {
    label: "Filas de liquidación sin reserva en el calendario",
    where: "liquidacion",
    cta: "Ver filas",
  },
};

export const ORPHAN_REASON_LABEL: Record<OrphanReason, string> = {
  sin_reserva: "No hay ninguna reserva en esas fechas",
  fechas_invalidas: "Fila con fechas vacías o invertidas",
  ambigua: "Coincide igual con dos reservas",
  reserva_cancelada: "La reserva está cancelada",
  reserva_borrada: "La reserva ya no existe",
};

/** Canales que cobran comisión: sin % configurado, su diferencia no se puede leer. */
export const OTA_SOURCES: ReadonlySet<BookingSource> = new Set<BookingSource>([
  "airbnb",
  "booking",
  "expedia",
  "vrbo",
]);

// ── Textos ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);
}

/** "septiembre" */
export function monthNameLower(month: number): string {
  return (MONTHS[month - 1] ?? "?").toLowerCase();
}

/** "sep", o "dic 2025" si el año no es el de la vista. */
export function shortPeriodLabel(year: number, month: number, viewYear?: number): string {
  const m = MONTHS_SHORT[month - 1] ?? "?";
  return viewYear === undefined || viewYear === year ? m : `${m} ${year}`;
}

/** "2026-09-10T…" → "10/09". Toma la fecha tal como viene (sin mover zona horaria). */
export function shortDate(isoOrYmd: string): string {
  const s = isoOrYmd.slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

function statusTail(status: SettlementStatus, regenerate: string, edit: string): string {
  if (status === "borrador") return `Está en borrador: ${regenerate}`;
  const label = (SETTLEMENT_STATUS_META[status]?.label ?? status).toLowerCase();
  return `Está ${label}: ${edit}`;
}

/**
 * Textos exactos del `detail` de cada aviso. Viven acá (y no en la UI) porque
 * la conciliación los arma con los números de la fila y el tooltip los
 * muestra tal cual.
 */
export const ISSUE_TEXT = {
  participacionesSuma: (unitCode: string, sumPct: number) =>
    `Las participaciones de ${unitCode} suman ${fmtNumber(sumPct)}%.`,
  participacionesAjeno: (ownerName: string, unitCode: string) =>
    `La liquidación es de ${ownerName}, que no figura como propietario de ${unitCode}.`,
  sinPropietario: (unitCode: string) => `${unitCode} no tiene propietario cargado.`,
  sinPrecio: (ownerRate: number, currency: string) =>
    ownerRate > 0
      ? `La reserva está en $0 y se liquidaron ${formatMoney(ownerRate, currency)}.`
      : "La reserva no tiene importe.",
  importeSospechoso: (guestTotal: number, nights: number, currency: string) =>
    `${formatMoney(guestTotal, currency)} por ${nights} noches: ¿son dólares cargados en pesos?`,
  monedaDistinta: (bookingCurrency: string, settlementCurrency: string) =>
    `La reserva está en ${bookingCurrency} y la liquidación en ${settlementCurrency}.`,
  rentaInconsistente: (rent: number, total: number, nights: number, currency: string) =>
    (rent / 30) * nights > 20 * total
      ? `¿La renta mensual está en otra moneda? Renta ${formatMoney(rent, currency)}, total del tramo ${formatMoney(total, currency)}.`
      : `La renta mensual (${formatMoney(rent, currency)}) no coincide con el total del tramo (${formatMoney(total, currency)} por ${nights} noches).`,
  contratoIncompleto: (sumTotal: number, fromLabel: string, sumRate: number, currency: string) =>
    `El contrato suma ${formatMoney(sumTotal, currency)} y desde ${fromLabel} ya se liquidaron ${formatMoney(sumRate, currency)}.`,
  diferenciaAlta: (guestTotal: number, ownerRate: number, pct: number, currency: string) =>
    `El huésped pagó ${formatMoney(guestTotal, currency)} y se liquidaron ${formatMoney(ownerRate, currency)}: ` +
    `una diferencia del ${fmtNumber(Math.round(pct))}%. Revisá el importe de la reserva o si falta liquidar parte de la estadía.`,
  liquidacionVieja: (changedAt: string, monthLabel: string, generatedAt: string, status: SettlementStatus) =>
    `La reserva cambió el ${shortDate(changedAt)} y la liquidación de ${monthLabel} es del ${shortDate(generatedAt)}. ` +
    statusTail(status, "regenerala.", "editá la fila."),
  /**
   * Desde el 09/10/2026 la generación cuenta bien las noches del mes, así que
   * un borrador automático se arregla regenerándolo. Una fila editada a mano
   * sobrevive a la regeneración: esa hay que editarla.
   */
  prorrateoViejo: (prorateDays: number, nights: number, status: SettlementStatus, regenerable: boolean) =>
    `Se liquidaron ${prorateDays} días y el mes tiene ${nights} noches ocupadas. ` +
    (regenerable ? statusTail(status, "regenerala.", "editá la fila.") : "Editá la fila."),
  liquidadoDeMas: (ownerRate: number, guestTotal: number, currency: string) =>
    `Se liquidaron ${formatMoney(ownerRate, currency)} y el huésped pagó ${formatMoney(guestTotal, currency)}.`,
  posibleDoble: (rows: number, periodsLabel: string) =>
    `Aparece en ${rows} filas de liquidación (${periodsLabel}): ¿liquidada dos veces?`,
  faltaEnLiquidacion: (ownerName: string, monthLabel: string, status: SettlementStatus) =>
    `No está en la liquidación de ${ownerName} de ${monthLabel}. ` +
    (status === "borrador" ? "Regenerala." : "Agregá la fila."),
  cobradaNoLiquidada: (guestTotal: number, currency: string) =>
    `Está en la liquidación en $0 y el huésped pagó ${formatMoney(guestTotal, currency)}.`,
  canalSinComision: (source: BookingSource) =>
    `${BOOKING_SOURCE_META[source]?.label ?? source} no tiene comisión configurada: la diferencia puede ser lo que se lleva la plataforma.`,
} as const;

/** Texto de los avisos informativos (fila expandida). `saldo_huesped` no tiene texto: se ve en Cobrado. */
export const INFO_FLAG_TEXT = {
  por_fechas: () => "Emparejada por fechas",
  varios_periodos: (settlements: number) => `En ${settlements} liquidaciones`,
  estadia_larga: (settlements: number) =>
    `Estadía larga: se liquidó en ${settlements} liquidaciones; considerá cargarla como mensual`,
  historia_incompleta: (firstPeriodLabel: string) =>
    `Empezó antes de la primera liquidación cargada (${firstPeriodLabel}): no se puede conciliar.`,
  saldo_huesped: () => "",
  pieza_en_cero: () => "Fila de liquidación en $0 en estas fechas",
} as const;
