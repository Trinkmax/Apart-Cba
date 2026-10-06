import { describe, expect, it } from "vitest";
import { draftStorageKey } from "../../people/form-draft";
import {
  AUTO_RESTORE_WINDOW_MS,
  LEGACY_DRAFT_MAX_AGE_DAYS,
  adoptableLegacyDraft,
  autoRestoreMarkValid,
  decodeWizardDraft,
  encodeAutoRestoreMark,
  encodeWizardDraft,
  legacyWizardDraftKey,
  ownWizardDraft,
  personDialogReloadNote,
  planWizardDraft,
  wizardAsideKey,
  wizardAutoRestoreKey,
  wizardDraftAfterSave,
  wizardDraftIds,
  wizardDraftKey,
} from "../wizard-draft";
import { defaultWizardState, type WizardParty, type WizardSettings, type WizardState } from "../wizard-state";

const SETTINGS: WizardSettings = {
  payment_window_days: 10,
  grace_days: 0,
  late_fee_type: "diario_pct",
  late_fee_value: 0.5,
  late_fee_payee: "propietario",
  admin_fee_pct: 10,
  admin_fee_vat: false,
  tenant_commission: { basis: "pct_total_contrato", value: 5, vat: false },
  owner_commission: { basis: "ninguna", value: 0, vat: false },
  default_index: "ipc",
  default_adjustment_every: 3,
  default_lag_months: 2,
  default_rounding: "hundred",
  default_duration_months: 24,
};

const PROP = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const GUARANTOR = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG_PROP = "99999999-9999-4999-8999-999999999999";

function party(person_id: string, role: WizardParty["role"], key = `k-${person_id.slice(0, 4)}`): WizardParty {
  return { key, person_id, role, is_primary: role === "inquilino", guarantee_type: null, guarantee_detail: "", guarantor_consent_at: "" };
}

function state(patch: Partial<WizardState> = {}): WizardState {
  return { ...defaultWizardState(SETTINGS, "2026-10-06"), ...patch };
}

const KNOWN = new Set([PROP, TENANT, GUARANTOR]);
const NOW = new Date("2026-10-06T12:00:00.000Z");

describe("claves del borrador del asistente", () => {
  it("separa por contrato, organización y usuario, con el mismo formato que los otros borradores", () => {
    expect(wizardDraftKey(null, "org-a", "user-1")).toBe(draftStorageKey("contrato.nuevo", "org-a", "user-1"));
    expect(wizardDraftKey("c-1", "org-a", "user-1")).toBe(draftStorageKey("contrato.c-1", "org-a", "user-1"));
    expect(wizardDraftKey(null, "org-a", "user-1")).not.toBe(wizardDraftKey(null, "org-b", "user-1"));
    expect(wizardDraftKey(null, "org-a", "user-1")).not.toBe(wizardDraftKey(null, "org-a", "user-2"));
  });

  it("la clave vieja es la que usaba el asistente (sin org ni usuario)", () => {
    expect(legacyWizardDraftKey(null)).toBe("rentos.alquileres.wizard.nuevo");
    expect(legacyWizardDraftKey("c-1")).toBe("rentos.alquileres.wizard.c-1");
  });
});

describe("decodeWizardDraft", () => {
  it("lee lo que guarda encodeWizardDraft", () => {
    const s = state({ property_id: PROP, parties: [party(TENANT, "inquilino")], notes: "Llaves en portería" });
    const decoded = decodeWizardDraft(encodeWizardDraft(3, s, NOW));
    expect(decoded).toEqual({ v: 1, savedAt: NOW.toISOString(), step: 3, state: s });
  });

  it("descarta lo vacío, roto, de otra versión o con otra forma", () => {
    const s = state({ property_id: PROP });
    expect(decodeWizardDraft(null)).toBeNull();
    expect(decodeWizardDraft("")).toBeNull();
    expect(decodeWizardDraft("{no es json")).toBeNull();
    expect(decodeWizardDraft("null")).toBeNull();
    expect(decodeWizardDraft(JSON.stringify({ v: 2, savedAt: NOW.toISOString(), step: 0, state: s }))).toBeNull();
    expect(decodeWizardDraft(JSON.stringify({ v: 1, step: 0, state: s }))).toBeNull();
    expect(decodeWizardDraft(JSON.stringify({ v: 1, savedAt: NOW.toISOString(), step: 0, state: [] }))).toBeNull();
    expect(decodeWizardDraft(JSON.stringify({ v: 1, savedAt: NOW.toISOString(), step: 0, state: { ...s, parties: "x" } }))).toBeNull();
    expect(decodeWizardDraft(JSON.stringify({ v: 1, savedAt: NOW.toISOString(), step: 0, state: { ...s, parties: [null] } }))).toBeNull();
  });

  it("un paso que no es número arranca en el primero", () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW.toISOString(), step: "7", state: state() });
    expect(decodeWizardDraft(raw)?.step).toBe(0);
  });
});

describe("wizardDraftIds", () => {
  it("junta la propiedad y las personas, sin vacíos", () => {
    expect(wizardDraftIds(state())).toEqual([]);
    expect(wizardDraftIds(state({ property_id: PROP, parties: [party(TENANT, "inquilino"), party("", "garante", "vacia")] }))).toEqual([PROP, TENANT]);
  });
});

describe("adoptableLegacyDraft (el borrador de la clave vieja)", () => {
  const legacy = (s: WizardState) => encodeWizardDraft(2, s, NOW);

  it("se adopta si todo lo que trae es de esta organización", () => {
    const s = state({ property_id: PROP, parties: [party(TENANT, "inquilino"), party(GUARANTOR, "garante")], initial_rent: "500.000" });
    expect(adoptableLegacyDraft(legacy(s), KNOWN)?.state).toEqual(s);
  });

  it("alcanza con la propiedad o con una persona para comprobarlo", () => {
    expect(adoptableLegacyDraft(legacy(state({ property_id: PROP })), KNOWN)).not.toBeNull();
    expect(adoptableLegacyDraft(legacy(state({ parties: [party(TENANT, "inquilino")] })), KNOWN)).not.toBeNull();
  });

  it("se tira si trae una propiedad o una persona de otra organización (montos, garantías y notas ajenas)", () => {
    const s = state({ property_id: OTHER_ORG_PROP, parties: [party(TENANT, "inquilino")], notes: "de otra inmobiliaria" });
    expect(adoptableLegacyDraft(legacy(s), KNOWN)).toBeNull();
    const t = state({ property_id: PROP, parties: [party("44444444-4444-4444-8444-444444444444", "garante")] });
    expect(adoptableLegacyDraft(legacy(t), KNOWN)).toBeNull();
  });

  it("se tira si no trae ninguna propiedad ni persona: no se puede saber de quién es", () => {
    expect(adoptableLegacyDraft(legacy(state({ initial_rent: "300.000", notes: "sin ids" })), KNOWN)).toBeNull();
  });

  it("se tira si está roto o es de otra versión", () => {
    expect(adoptableLegacyDraft("{roto", KNOWN)).toBeNull();
    expect(adoptableLegacyDraft(JSON.stringify({ v: 2, savedAt: NOW.toISOString(), step: 0, state: state({ property_id: PROP }) }), KNOWN)).toBeNull();
    expect(adoptableLegacyDraft(null, KNOWN)).toBeNull();
  });
});

describe("planWizardDraft (qué se ofrece y qué pasa con la clave vieja)", () => {
  const at = (iso: string, s: WizardState) => encodeWizardDraft(2, s, new Date(iso));
  const mine = state({ property_id: PROP, parties: [party(TENANT, "inquilino")] });
  const foreign = state({ property_id: OTHER_ORG_PROP, notes: "de otra inmobiliaria" });

  it("sin clave vieja ofrece el propio y no toca nada", () => {
    const own = at("2026-10-06T10:00:00Z", mine);
    expect(planWizardDraft(own, null, KNOWN, NOW)).toEqual({ offer: own, adopt: false, removeLegacy: false });
    expect(planWizardDraft(null, null, KNOWN, NOW)).toEqual({ offer: null, adopt: false, removeLegacy: false });
  });

  it("adopta el viejo de esta organización y lo borra", () => {
    const legacy = at("2026-10-05T18:00:00Z", mine);
    expect(planWizardDraft(null, legacy, KNOWN, NOW)).toEqual({ offer: legacy, adopt: true, removeLegacy: true });
  });

  it("con los dos, queda el más reciente (una pestaña vieja pudo seguir escribiendo en la clave vieja)", () => {
    const older = at("2026-10-06T09:00:00Z", mine);
    const newer = at("2026-10-06T11:00:00Z", mine);
    expect(planWizardDraft(older, newer, KNOWN, NOW)).toEqual({ offer: newer, adopt: true, removeLegacy: true });
    expect(planWizardDraft(newer, older, KNOWN, NOW)).toEqual({ offer: newer, adopt: false, removeLegacy: true });
  });

  it("nunca ofrece uno de otra organización, pero lo deja para su dueño", () => {
    const legacy = at("2026-10-05T18:00:00Z", foreign);
    expect(planWizardDraft(null, legacy, KNOWN, NOW)).toEqual({ offer: null, adopt: false, removeLegacy: false });
    const own = at("2026-10-06T10:00:00Z", mine);
    expect(planWizardDraft(own, legacy, KNOWN, NOW)).toEqual({ offer: own, adopt: false, removeLegacy: false });
  });

  it("el que no se puede adoptar se borra pasados los 30 días", () => {
    const old = at("2026-09-05T11:00:00Z", foreign);
    expect(LEGACY_DRAFT_MAX_AGE_DAYS).toBe(30);
    expect(planWizardDraft(null, old, KNOWN, NOW).removeLegacy).toBe(true);
    expect(planWizardDraft(null, at("2026-09-07T12:00:00Z", foreign), KNOWN, NOW).removeLegacy).toBe(false);
  });

  it("roto, de otra versión o sin propiedad ni personas: se borra (nadie lo puede recuperar)", () => {
    expect(planWizardDraft(null, "{roto", KNOWN, NOW)).toEqual({ offer: null, adopt: false, removeLegacy: true });
    const v2 = JSON.stringify({ v: 2, savedAt: NOW.toISOString(), step: 0, state: mine });
    expect(planWizardDraft(null, v2, KNOWN, NOW).removeLegacy).toBe(true);
    expect(planWizardDraft(null, at("2026-10-06T10:00:00Z", state({ notes: "sin ids" })), KNOWN, NOW)).toEqual({
      offer: null,
      adopt: false,
      removeLegacy: true,
    });
  });
});

describe("borrador de antes puesto aparte", () => {
  const older = encodeWizardDraft(2, state({ property_id: PROP, notes: "el de antes" }), new Date("2026-10-03T10:00:00Z"));
  const newer = encodeWizardDraft(4, state({ property_id: PROP, notes: "el de hoy" }), NOW);

  it("la clave cuelga de la del borrador y es distinta de la marca", () => {
    const key = wizardDraftKey(null, "org-a", "user-1");
    expect(wizardAsideKey(key)).toBe(`${key}.anterior`);
    expect(wizardAsideKey(key)).not.toBe(wizardAutoRestoreKey(key));
    expect(wizardAsideKey(key)).not.toBe(wizardAsideKey(wizardDraftKey(null, "org-a", "user-2")));
  });

  it("al abrir manda el de la clave principal; el de aparte queda guardado sin ofrecerse", () => {
    expect(ownWizardDraft(newer, older)).toEqual({ raw: newer, promoteAside: false });
    expect(ownWizardDraft(newer, null)).toEqual({ raw: newer, promoteAside: false });
  });

  it("si la principal está vacía, el de aparte vuelve a ofrecerse (y pasa a la principal)", () => {
    expect(ownWizardDraft(null, older)).toEqual({ raw: older, promoteAside: true });
    expect(ownWizardDraft(null, null)).toEqual({ raw: null, promoteAside: false });
  });

  it("al guardar un alta, lo de antes sin elegir se conserva para la próxima", () => {
    expect(wizardDraftAfterSave(true, null, older)).toEqual({ main: older, aside: null });
    expect(wizardDraftAfterSave(true, older, null)).toEqual({ main: older, aside: null });
    expect(wizardDraftAfterSave(true, newer, older)).toEqual({ main: newer, aside: older });
    expect(wizardDraftAfterSave(true, null, null)).toEqual({ main: null, aside: null });
  });

  it("no deja el mismo borrador dos veces (si no, uno descartado volvería a ofrecerse)", () => {
    expect(wizardDraftAfterSave(true, older, older)).toEqual({ main: older, aside: null });
  });

  it("al guardar una edición se tira: lo guardado es más nuevo y recuperarlo lo desharía", () => {
    expect(wizardDraftAfterSave(false, null, older)).toEqual({ main: null, aside: null });
    expect(wizardDraftAfterSave(false, newer, older)).toEqual({ main: null, aside: null });
  });
});

describe("personDialogReloadNote (falló guardar una persona nueva desde el asistente)", () => {
  it("si el asistente vuelve solo, dice dónde volver a abrir el formulario", () => {
    expect(personDialogReloadNote("solo", true, "Inquilino nuevo")).toBe(
      "Al volver, en «Inquilino y garantes» tocá de nuevo «Inquilino nuevo»: lo que cargaste vuelve a aparecer.",
    );
    expect(personDialogReloadNote("solo", true, "Garante nuevo")).toContain("«Garante nuevo»");
  });

  it("sin borrador del formulario sólo promete lo del contrato", () => {
    expect(personDialogReloadNote("solo", false, "Inquilino nuevo")).toBe("Lo del contrato vuelve a aparecer.");
  });

  it("si quedó para recuperar, lo dice; si no se pudo guardar, no promete nada", () => {
    expect(personDialogReloadNote("recuperar", true, "Inquilino nuevo")).toBe("Después, tocá «Recuperar» arriba de los pasos.");
    expect(personDialogReloadNote(null, true, "Inquilino nuevo")).toBeNull();
  });
});

describe("marca para reponer lo cargado al recargar", () => {
  it("la clave cuelga de la del borrador", () => {
    const key = wizardDraftKey(null, "org-a", "user-1");
    expect(wizardAutoRestoreKey(key)).toBe(`${key}.recuperar`);
    expect(wizardAutoRestoreKey(key)).not.toBe(wizardAutoRestoreKey(wizardDraftKey(null, "org-b", "user-1")));
  });

  it("vale durante 15 minutos", () => {
    const mark = encodeAutoRestoreMark(NOW);
    expect(autoRestoreMarkValid(mark, NOW)).toBe(true);
    expect(autoRestoreMarkValid(mark, new Date(NOW.getTime() + AUTO_RESTORE_WINDOW_MS))).toBe(true);
    expect(autoRestoreMarkValid(mark, new Date(NOW.getTime() + AUTO_RESTORE_WINDOW_MS + 1))).toBe(false);
  });

  it("sin marca, rota o del futuro no repone nada", () => {
    expect(autoRestoreMarkValid(null, NOW)).toBe(false);
    expect(autoRestoreMarkValid("", NOW)).toBe(false);
    expect(autoRestoreMarkValid("ayer", NOW)).toBe(false);
    expect(autoRestoreMarkValid(encodeAutoRestoreMark(new Date(NOW.getTime() + 60_000)), NOW)).toBe(false);
  });
});
