import type {
  RentalAdjustmentMethod,
  RentalAdjustmentStatus,
  RentalChargeItemKind,
  RentalContract,
  RentalContractStatus,
  RentalDepositStatus,
  RentalDocumentKind,
  RentalEarlyTerminationRule,
  RentalExpenseCategory,
  RentalExpenseChargedTo,
  RentalExpensasMode,
  RentalGuaranteeType,
  RentalLateFeeType,
  RentalLegalRegime,
  RentalPayee,
  RentalPaymentMethod,
  RentalProofStatus,
  RentalProperty,
  RentalPropertyAvailability,
  RentalPropertyType,
  RentalRounding,
  RentalServiceKind,
  RentalStampTaxStatus,
  RentalStatementStatus,
  RentalUsage,
  RentalIndexCode,
} from "@/lib/types/database";
import { MONTHS } from "@/lib/settlements/labels";
import { diffDays } from "./ymd";

/**
 * Fuente única de labels, colores y formatos del módulo Alquileres.
 * Mismo criterio que `src/lib/settlements/labels.ts`: cada enum tiene su META
 * con label es-AR y color hex (el badge pinta con `color + "15"` de fondo).
 */

export interface StatusMeta {
  label: string;
  color: string;
  description?: string;
}

// ─── Estados ────────────────────────────────────────────────────────────────

/**
 * Estado que se MUESTRA de un contrato: los guardados más "por vencer",
 * "vencido" y la salida ya registrada que todavía no llegó (el contrato sigue
 * vigente —y se sigue cobrando— hasta que el inquilino desocupa).
 */
export type ContractDisplayState =
  | RentalContractStatus
  | "por_vencer"
  | "vencido_ocupado"
  | "rescision_notificada"
  | "salida_programada"
  | "renovado";

export const CONTRACT_STATE_META: Record<ContractDisplayState, StatusMeta> = {
  borrador: { label: "Borrador", color: "#64748b", description: "Todavía no rige: no genera cargos ni ajustes." },
  vigente: { label: "Vigente", color: "#10b981" },
  por_vencer: { label: "Por vencer", color: "#f59e0b", description: "Termina en menos de 90 días." },
  vencido_ocupado: {
    label: "Vencido · sigue ocupando",
    color: "#f97316",
    description:
      "Pasó la fecha de fin y no se cerró: sigue en las mismas condiciones hasta que alguien lo termine (art. 1218 CCyC). Los meses siguientes se cobran sólo si activás el cobro de la continuación.",
  },
  rescision_notificada: {
    label: "Rescisión notificada",
    color: "#e11d48",
    description: "El inquilino avisó que se va: el contrato sigue vigente, y se le sigue cobrando, hasta el día que desocupa. Ese día se cierra solo.",
  },
  salida_programada: {
    label: "Entrega programada",
    color: "#8b5cf6",
    description: "Ya tiene fecha de entrega de llaves: sigue vigente, y se le sigue cobrando, hasta ese día. Después se finaliza solo.",
  },
  renovado: {
    label: "Renovado",
    color: "#0d9488",
    description: "Ya está activa la renovación: este contrato sigue hasta el día anterior a que empiece y ese día se cierra solo, sin cargos de salida.",
  },
  finalizado: { label: "Finalizado", color: "#6366f1" },
  rescindido: { label: "Rescindido", color: "#ef4444" },
};

/** Días antes del fin en que un contrato pasa a "por vencer". */
export const EXPIRING_SOON_DAYS = 90;

/**
 * Lo que mira `contractDisplayState`. Las columnas de la salida son opcionales: sin ellas no se distingue.
 * `renewed`: ya está activa su renovación (no viene en la fila: lo pasa quien la leyó).
 */
export type ContractStateInput = Pick<RentalContract, "status" | "end_date"> &
  Partial<Pick<RentalContract, "terminated_at" | "termination_notice_date">> & { renewed?: boolean };

export function contractDisplayState(c: ContractStateInput, today: string): ContractDisplayState {
  if (c.status !== "vigente") return c.status;
  // Lo sigue la renovación: ni "por vencer" ni "entrega las llaves" (el inquilino no se va).
  if (c.renewed) return "renovado";
  // Salida registrada pero todavía no llegó: manda sobre el vencimiento.
  if (c.terminated_at) return c.termination_notice_date ? "rescision_notificada" : "salida_programada";
  if (c.end_date < today) return "vencido_ocupado";
  if (diffDays(today, c.end_date) <= EXPIRING_SOON_DAYS) return "por_vencer";
  return "vigente";
}

/** "15/12" (o "15/12/2027" si no es el año de `today`). */
function dayMonth(ymd: string, today: string): string {
  const dm = `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  return ymd.slice(0, 4) === today.slice(0, 4) ? dm : `${dm}/${ymd.slice(0, 4)}`;
}

/** Label del estado con la fecha cuando importa: "Rescisión notificada · desocupa el 15/12". */
export function contractStateLabel(c: ContractStateInput, today: string): string {
  const state = contractDisplayState(c, today);
  if (state === "rescision_notificada" && c.terminated_at) return `Rescisión notificada · desocupa el ${dayMonth(c.terminated_at, today)}`;
  if (state === "salida_programada" && c.terminated_at) return `Entrega las llaves el ${dayMonth(c.terminated_at, today)}`;
  if (state === "renovado") return `Renovado · sigue hasta el ${dayMonth(c.terminated_at ?? c.end_date, today)}`;
  return CONTRACT_STATE_META[state].label;
}

/** Estado que se muestra de un cargo: el guardado + "vencido" derivado. */
export type ChargeDisplayState = "pendiente" | "parcial" | "pagado" | "vencido" | "anulado";

export const CHARGE_STATE_META: Record<ChargeDisplayState, StatusMeta> = {
  pendiente: { label: "Pendiente", color: "#94a3b8" },
  parcial: { label: "Pago parcial", color: "#f59e0b" },
  pagado: { label: "Pagado", color: "#10b981" },
  vencido: { label: "Vencido", color: "#ef4444" },
  anulado: { label: "Anulado", color: "#64748b" },
};

export function chargeDisplayState(
  c: { status: string; due_date: string; subtotal: number; paid_amount: number; voided_at?: string | null },
  today: string,
): ChargeDisplayState {
  if (c.voided_at || c.status === "anulado") return "anulado";
  if (c.status === "pagado" || c.paid_amount >= c.subtotal - 0.005) return "pagado";
  if (c.due_date < today) return "vencido";
  return c.paid_amount > 0 ? "parcial" : "pendiente";
}

export const ADJUSTMENT_STATUS_META: Record<RentalAdjustmentStatus, StatusMeta> = {
  programado: { label: "Próximo", color: "#94a3b8", description: "Todavía no se publicó el índice que necesita." },
  pendiente_indice: { label: "Esperando índice", color: "#f59e0b", description: "Ya rige pero el índice todavía no salió." },
  pendiente_manual: { label: "Falta cargar el monto", color: "#f97316" },
  calculado: {
    label: "Calculado",
    color: "#3b82f6",
    description: "Ya se sabe el monto. Con la aplicación automática se aplica solo un mes antes de que rija; si no, aplicalo a mano.",
  },
  aplicado: { label: "Aplicado", color: "#10b981" },
  omitido: { label: "No se aplicó", color: "#64748b" },
};

export const PROOF_STATUS_META: Record<RentalProofStatus, StatusMeta> = {
  pendiente: { label: "Falta", color: "#94a3b8" },
  en_revision: { label: "Para revisar", color: "#3b82f6" },
  validado: { label: "Validado", color: "#10b981" },
  rechazado: { label: "Rechazado", color: "#ef4444" },
  no_corresponde: { label: "No corresponde", color: "#64748b" },
};

export const STATEMENT_STATUS_META: Record<RentalStatementStatus, StatusMeta> = {
  borrador: { label: "Borrador", color: "#64748b" },
  emitida: { label: "Emitida", color: "#a855f7" },
  pagada: { label: "Pagada", color: "#10b981" },
  anulada: { label: "Anulada", color: "#ef4444" },
};

/**
 * Una rendición 'pagada' con neto cero o negativo no se pagó: se CERRÓ sin
 * transferencia y su saldo pasa a la próxima rendición (068c). Nunca mostrarla
 * como "Pagada / Transferido".
 */
export function statementClosedWithoutPayout(status: RentalStatementStatus, net: number): boolean {
  return status === "pagada" && net <= 0;
}

export function statementStatusMeta(status: RentalStatementStatus, net: number): StatusMeta {
  return statementClosedWithoutPayout(status, net) ? { label: "Cerrada", color: "#0ea5e9" } : STATEMENT_STATUS_META[status];
}

export const AVAILABILITY_META: Record<RentalPropertyAvailability, StatusMeta> = {
  disponible: { label: "Disponible", color: "#10b981" },
  reservada: { label: "Reservada", color: "#f59e0b" },
  en_refaccion: { label: "En refacción", color: "#f97316" },
  retirada: { label: "Retirada", color: "#64748b" },
};

// ─── Catálogos ──────────────────────────────────────────────────────────────

export const SERVICE_KIND_META: Record<RentalServiceKind, { label: string; iconName: string }> = {
  expensas: { label: "Expensas", iconName: "Building2" },
  luz: { label: "Luz", iconName: "Zap" },
  gas: { label: "Gas", iconName: "Flame" },
  agua: { label: "Agua", iconName: "Droplets" },
  municipal: { label: "Tasa municipal", iconName: "Landmark" },
  inmobiliario: { label: "Impuesto inmobiliario", iconName: "FileText" },
  internet: { label: "Internet", iconName: "Wifi" },
  seguro: { label: "Seguro", iconName: "ShieldCheck" },
  otro: { label: "Otro", iconName: "Receipt" },
};

export const PROPERTY_TYPE_LABEL: Record<RentalPropertyType, string> = {
  departamento: "Departamento",
  casa: "Casa",
  ph: "PH",
  duplex: "Dúplex",
  local: "Local",
  oficina: "Oficina",
  cochera: "Cochera",
  deposito: "Depósito",
  terreno: "Terreno",
  otro: "Otro",
};

export const ITEM_KIND_LABEL: Record<RentalChargeItemKind, string> = {
  alquiler: "Alquiler",
  diferencia_ajuste: "Diferencia por ajuste",
  expensas: "Expensas",
  servicio: "Servicio",
  punitorio: "Intereses por mora",
  honorarios: "Honorarios",
  deposito: "Depósito en garantía",
  sellado: "Sellado",
  reparacion: "Reparación",
  rescision: "Indemnización por rescisión",
  otro: "Otro",
};

export const PAYEE_LABEL: Record<RentalPayee, string> = {
  propietario: "Propietario",
  inmobiliaria: "Inmobiliaria",
  consorcio: "Consorcio",
  tercero: "Tercero",
};

export const PAYMENT_METHOD_LABEL: Record<RentalPaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mp: "Mercado Pago",
  cheque: "Cheque",
  deposito: "Depósito bancario",
  otro: "Otro",
};

export const EXPENSE_CATEGORY_LABEL: Record<RentalExpenseCategory, string> = {
  reparacion: "Reparación",
  mantenimiento: "Mantenimiento",
  expensas_extraordinarias: "Expensas extraordinarias",
  impuesto: "Impuesto",
  servicio: "Servicio",
  seguro: "Seguro",
  honorarios_terceros: "Honorarios de terceros",
  otro: "Otro",
};

export const CHARGED_TO_LABEL: Record<RentalExpenseChargedTo, string> = {
  propietario: "Propietario",
  inquilino: "Inquilino",
  inmobiliaria: "Inmobiliaria",
};

export const GUARANTEE_TYPE_LABEL: Record<RentalGuaranteeType, string> = {
  propietaria: "Garantía propietaria",
  recibo_sueldo: "Recibo de sueldo",
  seguro_caucion: "Seguro de caución",
  fianza: "Fianza personal",
  aval_bancario: "Aval bancario",
  pagare: "Pagaré",
  otra: "Otra",
};

export const USAGE_LABEL: Record<RentalUsage, string> = {
  vivienda: "Vivienda",
  comercial: "Comercial",
  mixto: "Vivienda y comercio",
  cochera: "Cochera",
  otro: "Otro",
};

export interface RegimeMeta {
  label: string;
  description: string;
  /** Lo que el alta de contrato precarga al elegir el régimen. */
  preset: { index: RentalIndexCode | null; every: number | null; duration: number; termination: RentalEarlyTerminationRule };
}

export const LEGAL_REGIME_META: Record<RentalLegalRegime, RegimeMeta> = {
  dnu_70_2023: {
    label: "DNU 70/2023 (vigente)",
    description: "Contratos firmados desde el 29/12/2023: plazo, índice y frecuencia libres; rescisión con 10 % del saldo.",
    preset: { index: "ipc", every: 3, duration: 24, termination: "dnu_10pct" },
  },
  ley_27737: {
    label: "Ley 27.737",
    description: "Firmados entre el 17/10/2023 y el 28/12/2023: 3 años, ajuste semestral por Casa Propia.",
    preset: { index: "casa_propia", every: 6, duration: 36, termination: "ley_27551" },
  },
  ley_27551: {
    label: "Ley 27.551",
    description: "Firmados entre el 01/07/2020 y el 16/10/2023: 3 años, ajuste anual por ICL.",
    preset: { index: "icl", every: 12, duration: 36, termination: "ley_27551" },
  },
  ccyc_2015: {
    label: "Código Civil y Comercial (2015)",
    description: "Contratos anteriores a julio de 2020.",
    preset: { index: null, every: null, duration: 24, termination: "ley_27551" },
  },
};

export const ADJUSTMENT_METHOD_LABEL: Record<RentalAdjustmentMethod, string> = {
  indice: "Por índice",
  porcentaje_fijo: "Porcentaje fijo",
  escalonado: "Montos escalonados",
  manual: "Lo cargo a mano",
  sin_ajuste: "Sin ajuste",
};

export const ROUNDING_LABEL: Record<RentalRounding, string> = {
  none: "Sin redondear",
  unit: "Al peso",
  ten: "A la decena",
  hundred: "A la centena",
  thousand: "Al millar",
};

export const LATE_FEE_TYPE_LABEL: Record<RentalLateFeeType, string> = {
  diario_pct: "% diario",
  mensual_pct: "% mensual",
  fijo_diario: "Monto fijo por día",
  ninguno: "Sin punitorios",
};

export const DEPOSIT_STATUS_LABEL: Record<RentalDepositStatus, string> = {
  pendiente: "A cobrar",
  retenido: "Retenido",
  devuelto: "Devuelto",
  aplicado: "Aplicado a deudas",
  trasladado: "Pasó a la renovación",
  no_aplica: "Sin depósito",
};

export const STAMP_STATUS_LABEL: Record<RentalStampTaxStatus, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  exento: "Exento",
  no_aplica: "No se sella",
};

export const EXPENSAS_MODE_LABEL: Record<RentalExpensasMode, string> = {
  paga_inquilino: "Las paga el inquilino y presenta el comprobante",
  cobra_inmobiliaria: "Se cobran junto con el alquiler",
  no_aplica: "No tiene expensas",
};

export const EARLY_TERMINATION_LABEL: Record<RentalEarlyTerminationRule, string> = {
  dnu_10pct: "10 % del saldo que falta (art. 1221 vigente)",
  ley_27551: "1,5 meses el primer año, 1 mes después (Ley 27.551)",
  pactada: "La que dice el contrato",
  sin_penalidad: "Sin indemnización",
};

export const DOCUMENT_KIND_LABEL: Record<RentalDocumentKind, string> = {
  contrato: "Contrato firmado",
  garantia: "Garantía",
  inventario: "Inventario",
  acta_entrega: "Acta de entrega",
  mandato: "Mandato de administración",
  dni: "DNI",
  recibo_sueldo: "Recibo de sueldo",
  poliza: "Póliza",
  foto: "Foto",
  otro: "Otro",
};

// ─── Formatos ───────────────────────────────────────────────────────────────

/** C-0007 */
export function formatContractNumber(n: number | null | undefined): string {
  return n ? `C-${String(n).padStart(4, "0")}` : "C-—";
}

/** 000123 (se muestra "Recibo N° 000123"). */
export function formatReceiptNumber(n: number | null | undefined): string {
  return n ? String(n).padStart(6, "0") : "—";
}

/** 0012 (se muestra "Rendición N° 0012"). */
export function formatStatementNumber(n: number | null | undefined): string {
  return n ? String(n).padStart(4, "0") : "—";
}

/** "Octubre 2026" a partir de una fecha YYYY-MM-DD. */
export function monthLabelOf(ymd: string): string {
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1] ?? "?"} ${ymd.slice(0, 4)}`;
}

/** "Período 2/3" o "Período 7" (contrato sin ajuste). */
export function cyclePositionLabel(indexInCycle: number | null | undefined, cycleLength: number | null | undefined): string | null {
  if (!indexInCycle || indexInCycle < 1) return null;
  return cycleLength && cycleLength > 0 ? `Período ${indexInCycle}/${cycleLength}` : `Período ${indexInCycle}`;
}

/** "Octubre 2026 · Período 2/3" */
export function chargeLabel(periodStart: string, indexInCycle: number | null, cycleLength: number | null): string {
  const pos = cyclePositionLabel(indexInCycle, cycleLength);
  return pos ? `${monthLabelOf(periodStart)} · ${pos}` : monthLabelOf(periodStart);
}

/** "Dean Funes 450 · 3°B" (sin ciudad). */
export function propertyAddress(
  p: Pick<RentalProperty, "street" | "street_number" | "floor" | "apartment" | "tower">,
): string {
  const main = [p.street, p.street_number].filter(Boolean).join(" ");
  const unit = [p.tower ? `Torre ${p.tower}` : null, p.floor ? `${p.floor}°` : null, p.apartment]
    .filter(Boolean)
    .join(" ")
    .replace(/° /, "°");
  return unit ? `${main} · ${unit}` : main;
}
