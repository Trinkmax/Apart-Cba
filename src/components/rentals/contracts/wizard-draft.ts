/**
 * Borrador local del asistente de contratos. Va en localStorage (sobrevive a
 * cerrar la pestaña: la página promete "queda guardado en este navegador").
 * Funciones puras: la clave, (de)serializar, qué hacer con un borrador de la
 * clave vieja y la marca para reponerlo solo al recargar después de un deploy.
 * La parte con React vive en contract-wizard.tsx.
 *
 * Por qué existe: hasta el 06/10/2026 la clave era una sola para todo el
 * navegador ('rentos.alquileres.wizard.nuevo'). En una compu compartida,
 * alguien de OTRA organización abría "Nuevo contrato" y se le ofrecía
 * recuperar montos, datos de garantía, notas e ids de propiedades y personas
 * ajenas. Ahora la clave es por organización y usuario, como los borradores
 * de propiedades y personas.
 */

import { draftStorageKey } from "../people/form-draft";
import type { WizardState } from "./wizard-state";

const WIZARD_DRAFT_VERSION = 1;

export interface StoredWizardDraft {
  v: typeof WIZARD_DRAFT_VERSION;
  savedAt: string;
  step: number;
  state: WizardState;
}

/** Una clave por contrato (o "nuevo"), organización y usuario. */
export function wizardDraftKey(contractId: string | null, organizationId: string, userId: string): string {
  return draftStorageKey(`contrato.${contractId ?? "nuevo"}`, organizationId, userId);
}

/** La clave vieja, sin organización ni usuario: se adopta si se puede y se borra. */
export function legacyWizardDraftKey(contractId: string | null): string {
  return `rentos.alquileres.wizard.${contractId ?? "nuevo"}`;
}

export function encodeWizardDraft(step: number, state: WizardState, now: Date = new Date()): string {
  return JSON.stringify({ v: WIZARD_DRAFT_VERSION, savedAt: now.toISOString(), step, state } satisfies StoredWizardDraft);
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Lo guardado, o null si no hay, está roto o es de otra versión del asistente. */
export function decodeWizardDraft(raw: string | null | undefined): StoredWizardDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.v !== WIZARD_DRAFT_VERSION || typeof parsed.savedAt !== "string") return null;
    const { state } = parsed;
    if (!isRecord(state) || !Array.isArray(state.parties) || !state.parties.every(isRecord)) return null;
    const step = typeof parsed.step === "number" && Number.isFinite(parsed.step) ? Math.trunc(parsed.step) : 0;
    return { v: WIZARD_DRAFT_VERSION, savedAt: parsed.savedAt, step, state: state as unknown as WizardState };
  } catch {
    return null;
  }
}

/** Ids de la propiedad y de las personas que trae el borrador (sin vacíos). */
export function wizardDraftIds(state: WizardState): string[] {
  const ids: unknown[] = [state.property_id, ...state.parties.map((p) => p.person_id)];
  return ids.filter((id): id is string => typeof id === "string" && id.trim() !== "");
}

/** Trae al menos una propiedad o persona y TODAS son de esta organización. */
function provenFromThisOrg(draft: StoredWizardDraft, knownIds: ReadonlySet<string>): boolean {
  const ids = wizardDraftIds(draft.state);
  return ids.length > 0 && ids.every((id) => knownIds.has(id));
}

/**
 * El borrador de la clave vieja, si se puede pasar a la clave de esta persona;
 * si no, null. Sólo se adopta cuando demuestra ser de esta organización: trae
 * al menos una propiedad o persona y TODAS están entre las de la org. Los ids
 * son únicos entre organizaciones, así que uno ajeno nunca está en la lista.
 * Sin ids no se puede comprobar de quién es (sin propiedad elegida el
 * asistente no pasa del primer paso, así que no se pierde nada que haya
 * costado cargar).
 */
export function adoptableLegacyDraft(raw: string | null | undefined, knownIds: ReadonlySet<string>): StoredWizardDraft | null {
  const draft = decodeWizardDraft(raw);
  return draft && provenFromThisOrg(draft, knownIds) ? draft : null;
}

/** Un borrador de la clave vieja que no se puede adoptar se deja hasta esta edad: puede ser de otra persona u organización. */
export const LEGACY_DRAFT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milisegundos de `savedAt`; uno ilegible cuenta como viejísimo. */
function savedTime(savedAt: string): number {
  const t = Date.parse(savedAt);
  return Number.isFinite(t) ? t : 0;
}

export interface WizardDraftPlan {
  /** Lo que se ofrece recuperar, tal como está guardado (o null). */
  offer: string | null;
  /** Escribir `offer` en la clave de esta persona: es el borrador viejo, adoptado. */
  adopt: boolean;
  /** Borrar la clave vieja. */
  removeLegacy: boolean;
}

/**
 * Qué hacer con el borrador propio y con el de la clave vieja al abrir el asistente:
 * - El viejo se adopta sólo si demuestra ser de esta organización. Si también hay
 *   uno propio, queda el más reciente (una pestaña abierta desde antes del cambio
 *   pudo haber seguido escribiendo en la clave vieja). Adoptado o no, se borra.
 * - Si trae ids pero no se puede adoptar, se deja donde está: puede ser de otra
 *   organización de la misma persona, de otra persona de la oficina o mencionar
 *   algo archivado después. No se le muestra a nadie que no lo pueda reclamar, así
 *   que dejarlo no filtra nada; borrarlo sí le haría perder el contrato a su dueño.
 *   Se borra recién pasados LEGACY_DRAFT_MAX_AGE_DAYS días.
 * - Roto, de otra versión o sin ids: nadie lo va a poder recuperar, se borra.
 */
export function planWizardDraft(
  ownRaw: string | null,
  legacyRaw: string | null,
  knownIds: ReadonlySet<string>,
  now: Date = new Date(),
): WizardDraftPlan {
  const keepOwn: WizardDraftPlan = { offer: ownRaw, adopt: false, removeLegacy: false };
  if (legacyRaw === null) return keepOwn;
  const legacy = decodeWizardDraft(legacyRaw);
  if (!legacy || wizardDraftIds(legacy.state).length === 0) return { ...keepOwn, removeLegacy: true };
  if (provenFromThisOrg(legacy, knownIds)) {
    const own = decodeWizardDraft(ownRaw);
    return !own || savedTime(legacy.savedAt) > savedTime(own.savedAt)
      ? { offer: legacyRaw, adopt: true, removeLegacy: true }
      : { ...keepOwn, removeLegacy: true };
  }
  return { ...keepOwn, removeLegacy: now.getTime() - savedTime(legacy.savedAt) > LEGACY_DRAFT_MAX_AGE_DAYS * DAY_MS };
}

/**
 * Marca (en sessionStorage, por pestaña) de "al recargar, reponé lo cargado":
 * la deja guardar cuando falla por un deploy nuevo, porque el aviso promete que
 * lo cargado vuelve a aparecer. Vale un rato: si alguien recarga mucho después,
 * se le ofrece recuperarlo como siempre en lugar de reponerlo solo.
 */
export const AUTO_RESTORE_WINDOW_MS = 15 * 60 * 1000;

export function wizardAutoRestoreKey(storageKey: string): string {
  return `${storageKey}.recuperar`;
}

export function encodeAutoRestoreMark(now: Date = new Date()): string {
  return String(now.getTime());
}

export function autoRestoreMarkValid(raw: string | null | undefined, now: Date = new Date()): boolean {
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age <= AUTO_RESTORE_WINDOW_MS;
}
