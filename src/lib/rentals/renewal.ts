import type { RentalEarlyTerminationRule, RentalLegalRegime, RentalStampTaxStatus } from "@/lib/types/database";
import { EARLY_TERMINATION_LABEL, LEGAL_REGIME_META } from "./labels";
import { isYmd } from "./ymd";

/**
 * Renovación de un contrato (pura: la usan renewContract, la activación y el
 * asistente).
 *
 * Una renovación es un contrato NUEVO que se firma hoy: copia las condiciones
 * económicas y las personas del anterior, pero no lo que es propio de aquel
 * instrumento. Heredarlo dejaba datos legales viejos con cara de vigentes:
 *
 * - Régimen: el de lo que se firma hoy. Con «Ley 27.551» quedaba también su
 *   regla de rescisión (1,5 / 1 mes, y $0 con 90 días de preaviso) en lugar
 *   del 10 % del saldo del art. 1221: el propietario perdía la indemnización.
 * - Rescisión: la del régimen vigente si venía de la ley derogada. Una
 *   pactada o «sin indemnización» es un acuerdo de las partes: se mantiene.
 * - Sellado: vuelve a pendiente y sin monto. La renovación es otro hecho
 *   imponible y la exención depende del alquiler nuevo y del tope del año.
 *   «No se sella» es una decisión de la inmobiliaria: se respeta.
 * - RELI: el código es el registro del contrato anterior.
 * - Garantes: se copian SIN conformidad. Por el art. 1225 CCyC la fianza
 *   termina con el plazo del contrato anterior y sólo sigue si el garante lo
 *   consiente expresamente: hasta cargar la fecha en que firmó la renovación
 *   (o sacarlo del contrato) la renovación no se activa. Así un contrato
 *   vigente nunca muestra como garante a alguien que no se obligó, y las
 *   pantallas que listan garantes (intimación, ficha PDF, personas) no
 *   necesitan saber de esto.
 */

/** Régimen de los contratos que se firman hoy: DNU 70/2023, vigente desde el 29/12/2023. */
export const REGIME_IN_FORCE: RentalLegalRegime = "dnu_70_2023";

export interface RenewalLegalSource {
  legal_regime: RentalLegalRegime;
  early_termination_rule: RentalEarlyTerminationRule;
  stamp_tax_status: RentalStampTaxStatus;
  stamp_tax_amount: number | string | null;
  reli_code: string | null;
}

export interface RenewalLegalPatch {
  legal_regime: RentalLegalRegime;
  early_termination_rule: RentalEarlyTerminationRule;
  stamp_tax_status: RentalStampTaxStatus;
  stamp_tax_amount: null;
  reli_code: null;
}

/** Lo que la renovación no hereda del contrato anterior y, en castellano, qué cambió (para avisarle a la persona). */
export function renewalLegalPatch(old: RenewalLegalSource): { patch: RenewalLegalPatch; changes: string[] } {
  const legal_regime = REGIME_IN_FORCE;
  const early_termination_rule = old.early_termination_rule === "ley_27551" ? LEGAL_REGIME_META[legal_regime].preset.termination : old.early_termination_rule;
  const stamp_tax_status: RentalStampTaxStatus = old.stamp_tax_status === "no_aplica" ? "no_aplica" : "pendiente";
  const changes: string[] = [];
  if (old.legal_regime !== legal_regime) {
    changes.push(`Régimen: ${LEGAL_REGIME_META[legal_regime].label}; el anterior era ${LEGAL_REGIME_META[old.legal_regime].label}.`);
  }
  if (old.early_termination_rule !== early_termination_rule) {
    changes.push(`Rescisión anticipada: ${EARLY_TERMINATION_LABEL[early_termination_rule]}.`);
  }
  const oldStampAmount = Number(old.stamp_tax_amount ?? 0) || 0;
  if (old.stamp_tax_status === "pagado") changes.push("Sellado: pendiente; el que se pagó era del contrato anterior.");
  else if (old.stamp_tax_status === "exento") changes.push("Sellado: pendiente; la exención se vuelve a calcular con el alquiler nuevo.");
  else if (old.stamp_tax_status === "pendiente" && oldStampAmount > 0) {
    changes.push("Sellado: se borró el monto cargado a mano; se calcula con el alquiler nuevo.");
  }
  if (old.reli_code?.trim()) changes.push("Código RELI: vacío; el anterior era el registro del otro contrato.");
  return { patch: { legal_regime, early_termination_rule, stamp_tax_status, stamp_tax_amount: null, reli_code: null }, changes };
}

// ─── Garantes (art. 1225 CCyC) ──────────────────────────────────────────────

export interface GuarantorRow {
  person_id: string;
  role: string;
  guarantor_consent_at: string | null;
}

export interface GuarantorConsent {
  personId: string;
  consentAt: string;
}

export interface GuarantorConsentPlan {
  /** Fechas de conformidad nuevas, para guardar antes de activar. */
  updates: GuarantorConsent[];
  /** Garantes que no firmaron la renovación y salen del contrato. */
  removals: string[];
  /** Siguen sin fecha: la renovación no se puede activar. */
  missing: string[];
  /** Fecha inválida o futura: una conformidad que todavía no se dio no cuenta. */
  invalid: string[];
}

/** Hay conformidad: una fecha válida de hoy o anterior (una futura todavía no se dio). */
export function isValidConsent(consentAt: string | null | undefined, today: string): boolean {
  return isYmd(consentAt) && consentAt <= today;
}

/**
 * Garantes de una renovación al activarla: cada uno necesita la fecha en que
 * dio su conformidad —la guardada o la que se carga en el momento— o salir
 * del contrato.
 */
export function planGuarantorConsents(
  parties: readonly GuarantorRow[],
  input: { consents?: readonly GuarantorConsent[]; remove?: readonly string[]; today: string },
): GuarantorConsentPlan {
  const given = new Map((input.consents ?? []).filter((c) => c.consentAt).map((c) => [c.personId, c.consentAt]));
  const remove = new Set(input.remove ?? []);
  const valid = (d: string) => isValidConsent(d, input.today);
  const plan: GuarantorConsentPlan = { updates: [], removals: [], missing: [], invalid: [] };
  for (const p of parties) {
    if (p.role !== "garante") continue;
    if (remove.has(p.person_id)) {
      plan.removals.push(p.person_id);
      continue;
    }
    const fresh = given.get(p.person_id);
    if (fresh) {
      if (!valid(fresh)) plan.invalid.push(p.person_id);
      else if (fresh !== p.guarantor_consent_at) plan.updates.push({ personId: p.person_id, consentAt: fresh });
    } else if (!p.guarantor_consent_at) plan.missing.push(p.person_id);
    else if (!valid(p.guarantor_consent_at)) plan.invalid.push(p.person_id);
  }
  return plan;
}

/** "Ana", "Ana y Juan", "Ana, Juan y Pedro". */
export function joinNamesEs(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Por qué no se puede activar todavía (null si los garantes están en regla). */
export function guarantorConsentError(plan: GuarantorConsentPlan, nameOf: (personId: string) => string): string | null {
  if (plan.invalid.length) {
    return `Revisá la fecha en que firmó ${joinNamesEs(plan.invalid.map(nameOf))}: tiene que ser una fecha válida, de hoy o anterior.`;
  }
  if (!plan.missing.length) return null;
  const many = plan.missing.length > 1;
  return `Falta que ${joinNamesEs(plan.missing.map(nameOf))} ${many ? "firmen" : "firme"} la renovación como ${many ? "garantes" : "garante"} (art. 1225 CCyC): la garantía del contrato anterior no sigue sola. Cargá la fecha en que ${many ? "dio su conformidad cada uno" : "dio su conformidad"} o ${many ? "sacalos" : "sacalo"} del contrato.`;
}
