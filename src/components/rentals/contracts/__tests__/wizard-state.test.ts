import { describe, expect, it } from "vitest";
import {
  applyRegime,
  defaultWizardState,
  endDateOf,
  overridesForSave,
  parseWizard,
  previewInputOf,
  stepOfField,
  suggestedStartDate,
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
});
