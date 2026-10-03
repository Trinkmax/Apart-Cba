import { describe, expect, it } from "vitest";
import { CONTRACT_STATE_META, contractDisplayState, contractStateLabel } from "../labels";

const TODAY = "2026-10-02";

describe("estado que se muestra de un contrato", () => {
  it("vigente, por vencer y vencido según la fecha de fin", () => {
    expect(contractDisplayState({ status: "vigente", end_date: "2027-12-31" }, TODAY)).toBe("vigente");
    expect(contractDisplayState({ status: "vigente", end_date: "2026-12-01" }, TODAY)).toBe("por_vencer");
    expect(contractDisplayState({ status: "vigente", end_date: "2026-09-30" }, TODAY)).toBe("vencido_ocupado");
    expect(contractDisplayState({ status: "rescindido", end_date: "2027-12-31", terminated_at: "2026-09-01" }, TODAY)).toBe("rescindido");
  });

  it("con la rescisión notificada sigue vigente y lo dice, con la fecha de desocupación", () => {
    const c = { status: "vigente" as const, end_date: "2027-12-31", terminated_at: "2026-12-15", termination_notice_date: "2026-10-02" };
    expect(contractDisplayState(c, TODAY)).toBe("rescision_notificada");
    expect(contractStateLabel(c, TODAY)).toBe("Rescisión notificada · desocupa el 15/12");
    // La salida manda sobre el vencimiento.
    expect(contractDisplayState({ ...c, end_date: "2026-09-30" }, TODAY)).toBe("rescision_notificada");
  });

  it("entrega programada sin aviso de rescisión; año visible si no es el corriente", () => {
    const c = { status: "vigente" as const, end_date: "2027-01-31", terminated_at: "2027-01-31", termination_notice_date: null };
    expect(contractDisplayState(c, TODAY)).toBe("salida_programada");
    expect(contractStateLabel(c, TODAY)).toBe("Entrega las llaves el 31/01/2027");
  });

  it("sin las columnas de la salida, cae en los estados de siempre", () => {
    expect(contractStateLabel({ status: "vigente", end_date: "2026-09-30" }, TODAY)).toBe(CONTRACT_STATE_META.vencido_ocupado.label);
  });

  it("con la renovación activa no dice «por vencer» ni «entrega las llaves»: sigue hasta el día anterior", () => {
    expect(contractDisplayState({ status: "vigente", end_date: "2026-10-31", renewed: true }, TODAY)).toBe("renovado");
    expect(contractStateLabel({ status: "vigente", end_date: "2026-10-31", renewed: true }, TODAY)).toBe("Renovado · sigue hasta el 31/10");
    // Corte por una renovación anticipada: la fecha es la del corte, no el fin.
    const cut = { status: "vigente" as const, end_date: "2027-03-31", terminated_at: "2026-11-30", termination_notice_date: null, renewed: true };
    expect(contractStateLabel(cut, TODAY)).toBe("Renovado · sigue hasta el 30/11");
    // Ya cerrado, manda el estado guardado.
    expect(contractDisplayState({ status: "finalizado", end_date: "2026-10-31", renewed: true }, TODAY)).toBe("finalizado");
  });
});
