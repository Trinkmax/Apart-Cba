import { describe, expect, it } from "vitest";
import {
  cajaBillableFor,
  cajaCategoryForExpense,
  canPayFromCaja,
  chargedToHint,
  expenseDisplayState,
  expenseLockReason,
  expensePaymentLabel,
  isPaidByAllowed,
  joinStatementNumbers,
} from "../expense-meta";

describe("cajaCategoryForExpense / cajaBillableFor", () => {
  it("mapea el tipo de gasto a la categoría de Caja", () => {
    expect(cajaCategoryForExpense("reparacion")).toBe("maintenance");
    expect(cajaCategoryForExpense("mantenimiento")).toBe("maintenance");
    expect(cajaCategoryForExpense("servicio")).toBe("utilities");
    expect(cajaCategoryForExpense("impuesto")).toBe("tax");
    expect(cajaCategoryForExpense("expensas_extraordinarias")).toBe("other");
    expect(cajaCategoryForExpense("seguro")).toBe("other");
  });
  it("sólo lo del propietario va a su cuenta en Caja", () => {
    expect(cajaBillableFor("propietario")).toBe("owner");
    expect(cajaBillableFor("inquilino")).toBe("apartcba");
    expect(cajaBillableFor("inmobiliaria")).toBe("apartcba");
  });
});

describe("quién lo pagó", () => {
  it("no ofrece casos que se liquidarían mal", () => {
    expect(isPaidByAllowed("propietario", "propietario")).toBe(false);
    expect(isPaidByAllowed("propietario", "inmobiliaria")).toBe(true);
    expect(isPaidByAllowed("inquilino", "propietario")).toBe(true);
    expect(isPaidByAllowed("inquilino", "inquilino")).toBe(false);
    expect(isPaidByAllowed("inmobiliaria", "pendiente")).toBe(true);
  });
  it("explica qué pasa con el gasto", () => {
    expect(chargedToHint("propietario", "inmobiliaria")).toContain("rendición");
    expect(chargedToHint("inquilino", "propietario")).toContain("el propietario lo recupera");
    expect(chargedToHint("inquilino", "pendiente")).toBe("Se le suma al próximo cargo mensual del inquilino.");
    expect(chargedToHint("inmobiliaria", "inmobiliaria")).toContain("absorbe");
  });
});

describe("estado que se muestra", () => {
  it("depende de a cargo de quién y si ya se aplicó", () => {
    expect(expenseDisplayState({ status: "pendiente", charged_to: "propietario" })).toBe("a_descontar");
    expect(expenseDisplayState({ status: "aplicado", charged_to: "propietario" })).toBe("descontado");
    expect(expenseDisplayState({ status: "pendiente", charged_to: "inquilino" })).toBe("a_cobrar");
    expect(expenseDisplayState({ status: "aplicado", charged_to: "inquilino" })).toBe("cobrado");
    expect(expenseDisplayState({ status: "pendiente", charged_to: "inmobiliaria" })).toBe("inmobiliaria");
    expect(expenseDisplayState({ status: "anulado", charged_to: "propietario" })).toBe("anulado");
  });
  it("describe cómo se pagó", () => {
    expect(expensePaymentLabel({ paid_by: "inmobiliaria", cash_movement_id: "m" }, "Banco")).toEqual({ label: "Pagado desde Caja · Banco", tone: "in" });
    expect(expensePaymentLabel({ paid_by: "pendiente", cash_movement_id: null }).tone).toBe("warn");
    expect(expensePaymentLabel({ paid_by: "propietario", cash_movement_id: null }).label).toBe("Lo pagó el propietario");
  });
});

describe("bloqueos", () => {
  it("un gasto ya aplicado no se edita y dice dónde corregirlo", () => {
    expect(expenseLockReason({ status: "pendiente", charged_to: "propietario" })).toBeNull();
    expect(expenseLockReason({ status: "aplicado", charged_to: "propietario" }, { statementNumber: "0012" })).toContain("N° 0012");
    expect(expenseLockReason({ status: "aplicado", charged_to: "inquilino" }, { chargeLabel: "Octubre 2026" })).toContain("Octubre 2026");
    expect(expenseLockReason({ status: "anulado", charged_to: "inquilino" })).toBe("El gasto está anulado.");
  });
  it("con varios dueños pide anular TODAS las rendiciones que lo descuentan", () => {
    const two = expenseLockReason({ status: "aplicado", charged_to: "propietario" }, { statementNumbers: ["0012", "0013"], statementNumber: "0013" });
    expect(two).toContain("las rendiciones N° 0012 y N° 0013");
    expect(two).toContain("anulá todas esas rendiciones");
    const one = expenseLockReason({ status: "aplicado", charged_to: "propietario" }, { statementNumbers: ["0013"] });
    expect(one).toContain("la rendición N° 0013");
    expect(one).toContain("anulá esa rendición");
    expect(joinStatementNumbers(["0001", "0002", "0003"])).toBe("N° 0001, N° 0002 y N° 0003");
    expect(joinStatementNumbers([])).toBe("");
  });
  it("se paga desde Caja una sola vez y si no lo pagó otro", () => {
    expect(canPayFromCaja({ status: "pendiente", paid_by: "pendiente", cash_movement_id: null })).toBe(true);
    expect(canPayFromCaja({ status: "aplicado", paid_by: "inmobiliaria", cash_movement_id: null })).toBe(true);
    expect(canPayFromCaja({ status: "pendiente", paid_by: "inmobiliaria", cash_movement_id: "m" })).toBe(false);
    expect(canPayFromCaja({ status: "pendiente", paid_by: "propietario", cash_movement_id: null })).toBe(false);
    expect(canPayFromCaja({ status: "anulado", paid_by: "pendiente", cash_movement_id: null })).toBe(false);
  });
});
