import { describe, expect, it } from "vitest";
import type { RentalContract } from "@/lib/types/database";
import {
  applyRegime,
  defaultWizardState,
  endDateOf,
  guarantorsMissingConsent,
  overridesForSave,
  parseWizard,
  partyField,
  previewInputOf,
  stepOfField,
  suggestedStartDate,
  wizardStateFromContract,
  type WizardSettings,
  type WizardState,
} from "../wizard-state";

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

function filled(): WizardState {
  const s = defaultWizardState(SETTINGS, "2026-10-02");
  return {
    ...s,
    property_id: "11111111-1111-4111-8111-111111111111",
    parties: [
      {
        key: "a",
        person_id: "22222222-2222-4222-8222-222222222222",
        role: "inquilino",
        is_primary: true,
        guarantee_type: null,
        guarantee_detail: "",
        guarantor_consent_at: "",
      },
    ],
    initial_rent: "500.000",
  };
}

describe("wizard-state", () => {
  it("inicio sugerido: el 1° del mes que viene", () => {
    expect(suggestedStartDate("2026-10-02")).toBe("2026-11-01");
    expect(suggestedStartDate("2026-12-15")).toBe("2027-01-01");
    expect(suggestedStartDate("2026-10-01")).toBe("2026-10-01");
  });

  it("los defaults salen de la configuración", () => {
    const s = defaultWizardState(SETTINGS, "2026-10-02");
    expect(s.late_fee_value).toBe("0,5");
    expect(s.admin_fee_pct).toBe("10");
    expect(s.tenant_commission).toEqual({ basis: "pct_total_contrato", value: "5", vat: false });
  });

  it("arma el input con los importes en formato argentino", () => {
    const { input, issues } = parseWizard(filled());
    expect(issues).toEqual([]);
    expect(input).toMatchObject({ initial_rent: 500_000, duration_months: 24, adjustment_every_months: 3, late_fee_value: 0.5 });
    expect(input?.parties?.[0]).toMatchObject({ role: "inquilino", is_primary: true, guarantee_details: {} });
  });

  it("errores por paso, sin guardar ceros", () => {
    const s = { ...filled(), initial_rent: "quinientos", parties: [] };
    const { input, issues } = parseWizard(s);
    expect(input).toBeNull();
    expect(issues.map((i) => i.step)).toEqual(["partes", "plazo"]);
    expect(issues[1].message).toMatch(/500\.000/);
  });

  it("el régimen precarga índice, frecuencia y plazo", () => {
    const s = applyRegime(filled(), "ley_27551");
    expect(s).toMatchObject({ index_code: "icl", adjustment_every_months: "12", duration_months: "36", early_termination_rule: "ley_27551" });
  });

  it("vista previa sólo cuando alcanza", () => {
    expect(previewInputOf({ ...filled(), initial_rent: "" })).toBeNull();
    const p = previewInputOf({ ...filled(), overrides: { "1": { amount: "540.000", reason: "" }, "2": { amount: "", reason: "" } } });
    expect(p?.overrides).toEqual([{ sequence: 1, amount: 540_000 }]);
    expect(endDateOf(filled())).toBe("2028-10-31");
  });

  it("montos reales con motivo por defecto", () => {
    const s = { ...filled(), overrides: { "2": { amount: "612.400", reason: " " } } };
    expect(overridesForSave(s)).toEqual([{ sequence: 2, amount: 612_400, reason: "Monto real al cargar el contrato" }]);
    expect(stepOfField("initial_rent")).toBe("plazo");
    expect(stepOfField("nada")).toBeNull();
  });

  it("un contrato nuevo arranca con el régimen vigente y no es renovación", () => {
    expect(defaultWizardState(SETTINGS, "2026-10-02")).toMatchObject({ legal_regime: "dnu_70_2023", early_termination_rule: "dnu_10pct", is_renewal: false });
  });

  it("la renovación sale de renewed_from_id", () => {
    const base = { ...parseWizard(filled()).input, steps: null, services: [], tenant_commission: null, owner_commission: null, renewed_from_id: null };
    const parties = [{ person_id: "g1", role: "garante" as const, is_primary: false, guarantee_type: "fianza" as const, guarantee_details: { detalle: "Recibo" }, guarantor_consent_at: null }];
    expect(wizardStateFromContract(base as unknown as RentalContract, parties).is_renewal).toBe(false);
    const renewal = wizardStateFromContract({ ...base, renewed_from_id: "33333333-3333-4333-8333-333333333333" } as unknown as RentalContract, parties);
    expect(renewal.is_renewal).toBe(true);
    expect(renewal.parties[0]).toMatchObject({ guarantee_detail: "Recibo", guarantor_consent_at: "" });
  });

  it("en una renovación cada garante necesita la fecha en que firmó (el borrador se guarda igual)", () => {
    const garante = (key: string, person_id: string, guarantor_consent_at: string) =>
      ({ key, person_id, role: "garante", is_primary: false, guarantee_type: "propietaria", guarantee_detail: "", guarantor_consent_at }) as const;
    const s: WizardState = { ...filled(), is_renewal: true, parties: [...filled().parties, garante("g", "g1", ""), garante("h", "g2", "2026-09-30"), garante("i", "", "")] };
    expect(guarantorsMissingConsent(s).map((p) => p.person_id)).toEqual(["g1"]);
    expect(guarantorsMissingConsent({ ...s, is_renewal: false })).toEqual([]);
    // Con "hoy", una fecha futura todavía no es una firma.
    expect(guarantorsMissingConsent(s, "2026-09-29").map((p) => p.person_id)).toEqual(["g1", "g2"]);
    const withoutEmptyRow = { ...s, parties: s.parties.filter((p) => p.person_id) };
    const { input, issues } = parseWizard(withoutEmptyRow);
    expect(issues).toEqual([]);
    expect(input?.parties?.map((p) => p.guarantor_consent_at)).toEqual([null, null, "2026-09-30"]);
  });

  it("una fecha de conformidad ilegible se marca en el paso de las partes", () => {
    const s: WizardState = {
      ...filled(),
      parties: [
        ...filled().parties,
        { key: "g", person_id: "g1", role: "garante", is_primary: false, guarantee_type: "fianza", guarantee_detail: "", guarantor_consent_at: "31/12/2026" },
      ],
    };
    // Apunta a la fecha de ESE garante, no al buscador de inquilinos.
    expect(parseWizard(s).issues).toEqual([{ step: "partes", field: partyField.consent("g"), message: "Revisá la fecha en que firmó el garante." }]);
  });

  it("cada aviso de las partes apunta a su control", () => {
    const row = (key: string, person_id: string, role: "inquilino" | "garante", is_primary = false) =>
      ({ key, person_id, role, is_primary, guarantee_type: role === "garante" ? "fianza" : null, guarantee_detail: "", guarantor_consent_at: "" }) as const;
    // Sin inquilino: su propio campo (el buscador), y el paso queda en "partes".
    const noTenant = parseWizard({ ...filled(), parties: [row("g", "g1", "garante")] }).issues;
    expect(noTenant).toEqual([{ step: "partes", field: "tenant", message: "Falta el inquilino: buscalo o cargalo." }]);
    expect(stepOfField("tenant")).toBe("partes");
    // Fila vacía, dos titulares y persona repetida: la fila que hay que tocar.
    const messy = parseWizard({
      ...filled(),
      parties: [row("a", "t1", "inquilino", true), row("b", "t2", "inquilino", true), row("c", "", "garante"), row("d", "t1", "inquilino")],
    }).issues;
    expect(messy.map((i) => i.field)).toEqual([partyField.row("c"), partyField.primary("a"), partyField.row("d")]);
    expect(new Set(messy.map((i) => i.step))).toEqual(new Set(["partes"]));
  });
});
