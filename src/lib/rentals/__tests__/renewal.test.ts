import { describe, expect, it } from "vitest";
import {
  REGIME_IN_FORCE,
  guarantorConsentError,
  isValidConsent,
  joinNamesEs,
  planGuarantorConsents,
  renewalLegalPatch,
  type GuarantorRow,
  type RenewalLegalSource,
} from "../renewal";

const TODAY = "2026-10-02";

const ley27551: RenewalLegalSource = {
  legal_regime: "ley_27551",
  early_termination_rule: "ley_27551",
  stamp_tax_status: "pagado",
  stamp_tax_amount: 184_500,
  reli_code: "RELI-123456",
};

describe("renewalLegalPatch", () => {
  it("un contrato de la Ley 27.551 renueva como contrato nuevo: DNU, 10 %, sellado pendiente y sin RELI", () => {
    const { patch, changes } = renewalLegalPatch(ley27551);
    expect(patch).toEqual({
      legal_regime: "dnu_70_2023",
      early_termination_rule: "dnu_10pct",
      stamp_tax_status: "pendiente",
      stamp_tax_amount: null,
      reli_code: null,
    });
    expect(REGIME_IN_FORCE).toBe("dnu_70_2023");
    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatch(/DNU 70\/2023.*Ley 27\.551/);
    expect(changes[1]).toMatch(/10 %/);
    expect(changes[2]).toMatch(/se pagó/);
    expect(changes[3]).toMatch(/RELI/);
  });

  it("una rescisión pactada o sin indemnización es un acuerdo de partes: se mantiene", () => {
    expect(renewalLegalPatch({ ...ley27551, early_termination_rule: "pactada" }).patch.early_termination_rule).toBe("pactada");
    expect(renewalLegalPatch({ ...ley27551, early_termination_rule: "sin_penalidad" }).patch.early_termination_rule).toBe("sin_penalidad");
  });

  it("la exención se recalcula y «No se sella» se respeta", () => {
    const exento = renewalLegalPatch({ ...ley27551, stamp_tax_status: "exento", stamp_tax_amount: null });
    expect(exento.patch.stamp_tax_status).toBe("pendiente");
    expect(exento.changes.some((c) => /exención/.test(c))).toBe(true);
    const noAplica = renewalLegalPatch({ ...ley27551, stamp_tax_status: "no_aplica", stamp_tax_amount: "1000" });
    expect(noAplica.patch).toMatchObject({ stamp_tax_status: "no_aplica", stamp_tax_amount: null });
    expect(noAplica.changes.some((c) => /Sellado/.test(c))).toBe(false);
  });

  it("un monto de sellado cargado a mano no pasa a la renovación", () => {
    const r = renewalLegalPatch({ ...ley27551, stamp_tax_status: "pendiente", stamp_tax_amount: "95000.50" });
    expect(r.patch.stamp_tax_amount).toBeNull();
    expect(r.changes.some((c) => /monto cargado a mano/.test(c))).toBe(true);
  });

  it("si ya estaba al día no avisa nada", () => {
    const r = renewalLegalPatch({ legal_regime: "dnu_70_2023", early_termination_rule: "dnu_10pct", stamp_tax_status: "pendiente", stamp_tax_amount: null, reli_code: "  " });
    expect(r.changes).toEqual([]);
  });
});

describe("planGuarantorConsents", () => {
  const parties: GuarantorRow[] = [
    { person_id: "t1", role: "inquilino", guarantor_consent_at: null },
    { person_id: "g1", role: "garante", guarantor_consent_at: null },
    { person_id: "g2", role: "garante", guarantor_consent_at: "2026-09-28" },
    { person_id: "g3", role: "garante", guarantor_consent_at: null },
  ];

  it("cada garante necesita su fecha o salir del contrato; el inquilino no cuenta", () => {
    const plan = planGuarantorConsents(parties, { consents: [{ personId: "g1", consentAt: "2026-10-01" }], remove: ["g3"], today: TODAY });
    expect(plan).toEqual({ updates: [{ personId: "g1", consentAt: "2026-10-01" }], removals: ["g3"], missing: [], invalid: [] });
  });

  it("sin fecha no se activa", () => {
    const plan = planGuarantorConsents(parties, { today: TODAY });
    expect(plan.missing).toEqual(["g1", "g3"]);
    expect(plan.updates).toEqual([]);
  });

  it("una fecha futura o inválida no es una conformidad", () => {
    const plan = planGuarantorConsents(parties, {
      consents: [
        { personId: "g1", consentAt: "2026-10-03" },
        { personId: "g3", consentAt: "02/10/2026" },
      ],
      today: TODAY,
    });
    expect(plan.invalid).toEqual(["g1", "g3"]);
    const stored = planGuarantorConsents([{ person_id: "g9", role: "garante", guarantor_consent_at: "2027-01-01" }], { today: TODAY });
    expect(stored.invalid).toEqual(["g9"]);
  });

  it("la misma fecha que ya estaba guardada no se vuelve a escribir", () => {
    const plan = planGuarantorConsents(parties, {
      consents: [
        { personId: "g2", consentAt: "2026-09-28" },
        { personId: "g1", consentAt: "2026-10-02" },
        { personId: "g3", consentAt: "" },
      ],
      today: TODAY,
    });
    expect(plan.updates).toEqual([{ personId: "g1", consentAt: "2026-10-02" }]);
    expect(plan.missing).toEqual(["g3"]);
  });

  it("conformidad: fecha válida de hoy o anterior", () => {
    expect(isValidConsent("2026-10-02", TODAY)).toBe(true);
    expect(isValidConsent("2026-10-03", TODAY)).toBe(false);
    expect(isValidConsent("", TODAY)).toBe(false);
    expect(isValidConsent(null, TODAY)).toBe(false);
    expect(isValidConsent("2026-02-30", TODAY)).toBe(false);
  });

});

describe("mensajes", () => {
  const names: Record<string, string> = { g1: "Ana Pérez", g3: "Juan Gómez", g4: "Luis Díaz" };
  const nameOf = (id: string) => names[id] ?? "Garante";

  it("nombres en castellano", () => {
    expect(joinNamesEs([])).toBe("");
    expect(joinNamesEs(["Ana"])).toBe("Ana");
    expect(joinNamesEs(["Ana", "Juan", "Luis"])).toBe("Ana, Juan y Luis");
  });

  it("singular y plural, con el artículo y qué hacer", () => {
    const one = guarantorConsentError({ updates: [], removals: [], missing: ["g1"], invalid: [] }, nameOf);
    expect(one).toMatch(/^Falta que Ana Pérez firme la renovación como garante \(art\. 1225 CCyC\)/);
    expect(one).toMatch(/sacalo del contrato\.$/);
    const many = guarantorConsentError({ updates: [], removals: [], missing: ["g1", "g3"], invalid: [] }, nameOf);
    expect(many).toMatch(/^Falta que Ana Pérez y Juan Gómez firmen la renovación como garantes/);
    expect(many).toMatch(/sacalos del contrato\.$/);
  });

  it("primero la fecha mal cargada; en regla, null", () => {
    expect(guarantorConsentError({ updates: [], removals: [], missing: ["g1"], invalid: ["g4"] }, nameOf)).toMatch(/^Revisá la fecha en que firmó Luis Díaz/);
    expect(guarantorConsentError({ updates: [], removals: ["g1"], missing: [], invalid: [] }, nameOf)).toBeNull();
  });
});
