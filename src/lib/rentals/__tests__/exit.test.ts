import { describe, expect, it } from "vitest";
import {
  continuationGap,
  exitOverdue,
  findOccupancyConflict,
  isRenewalHandover,
  occupancyEnd,
  planRenewalCut,
  rangesOverlap,
  takesEffectAfterExit,
} from "../exit";

const base = { start_date: "2025-04-01", end_date: "2027-03-31" };

describe("hasta cuándo ocupa un contrato vigente (igual que rental_contracts_no_overlap)", () => {
  it("sin salida: hasta el fin", () => {
    expect(occupancyEnd(base)).toBe("2027-03-31");
  });

  it("con la rescisión notificada: hasta que desocupa, aunque el fin sea después", () => {
    expect(occupancyEnd({ ...base, terminated_at: "2026-12-15" })).toBe("2026-12-15");
  });

  it("vencido con la salida después del fin: hasta la salida", () => {
    expect(occupancyEnd({ ...base, end_date: "2026-10-31", terminated_at: "2026-12-15" })).toBe("2026-12-15");
  });

  it("cobrando la continuación sin salida: sin fin", () => {
    expect(occupancyEnd({ ...base, end_date: "2026-10-31", continuation_billing: true })).toBeNull();
    // La salida registrada manda sobre la continuación.
    expect(occupancyEnd({ ...base, end_date: "2026-10-31", continuation_billing: true, terminated_at: "2026-12-15" })).toBe("2026-12-15");
  });

  it("una salida anterior al inicio no da un rango invertido", () => {
    expect(occupancyEnd({ ...base, terminated_at: "2025-01-01" })).toBe("2025-04-01");
  });
});

describe("rangos que se pisan", () => {
  it("extremos incluidos y sin fin", () => {
    expect(rangesOverlap("2026-12-16", "2028-12-15", "2025-04-01", "2026-12-15")).toBe(false);
    expect(rangesOverlap("2026-12-15", "2028-12-15", "2025-04-01", "2026-12-15")).toBe(true);
    expect(rangesOverlap("2027-06-01", null, "2025-04-01", null)).toBe(true);
    expect(rangesOverlap("2027-06-01", "2027-07-01", "2025-04-01", "2026-10-31")).toBe(false);
  });

  it("el contrato del inquilino nuevo se puede activar durante el preaviso del anterior (P6)", () => {
    const others = [{ id: "a", ...base, terminated_at: "2026-12-15" }];
    expect(findOccupancyConflict(others, { start: "2026-12-16", end: "2028-12-15" })).toBeNull();
    expect(findOccupancyConflict(others, { start: "2026-12-10", end: "2028-12-15" })?.id).toBe("a");
    // El propio no cuenta.
    expect(findOccupancyConflict(others, { selfId: "a", start: "2026-12-10", end: null })).toBeNull();
  });

  it("un vencido que cobra la continuación bloquea cualquier contrato posterior hasta que se registre la salida", () => {
    const others = [{ id: "a", ...base, end_date: "2026-10-31", continuation_billing: true }];
    expect(findOccupancyConflict(others, { start: "2027-02-01", end: "2029-01-31" })?.id).toBe("a");
  });
});

describe("contrato anterior al activar la renovación (P8)", () => {
  it("renovación que empieza al día siguiente del fin: no hay que cortar nada", () => {
    expect(planRenewalCut({ ...base, status: "vigente" }, "2027-04-01")).toEqual({ kind: "none" });
  });

  it("renovación anticipada: se corta el anterior el día antes", () => {
    expect(planRenewalCut({ ...base, status: "vigente" }, "2026-12-01")).toEqual({ kind: "cut", cutDate: "2026-11-30" });
  });

  it("vencido cobrando la continuación: se corta el día antes de la renovación", () => {
    const previous = { ...base, end_date: "2026-10-31", continuation_billing: true, status: "vigente" };
    expect(planRenewalCut(previous, "2026-11-01")).toEqual({ kind: "cut", cutDate: "2026-10-31" });
    expect(planRenewalCut(previous, "2026-12-01")).toEqual({ kind: "cut", cutDate: "2026-11-30" });
  });

  it("con otra salida registrada que pisa la renovación, no la pisa: la decide una persona", () => {
    const previous = { ...base, status: "vigente", terminated_at: "2026-12-15", termination_notice_date: "2026-10-02" };
    expect(planRenewalCut(previous, "2026-12-01")).toEqual({ kind: "exit_after_start", exitDate: "2026-12-15", rescission: true });
    // Si la salida ya es antes, no se toca.
    expect(planRenewalCut(previous, "2026-12-16")).toEqual({ kind: "none" });
  });

  it("anterior ya cerrado o renovación que empieza antes que el anterior", () => {
    expect(planRenewalCut({ ...base, status: "finalizado" }, "2026-12-01")).toEqual({ kind: "none" });
    expect(planRenewalCut({ ...base, status: "vigente" }, "2025-04-01")).toEqual({ kind: "starts_before" });
  });

  it("es un traspaso a la renovación si arranca a más tardar al día siguiente de la salida", () => {
    expect(isRenewalHandover("2026-10-31", "2026-11-01")).toBe(true);
    expect(isRenewalHandover("2026-10-31", "2026-10-15")).toBe(true);
    expect(isRenewalHandover("2026-10-31", "2026-12-01")).toBe(false);
  });
});

describe("continuación sin cobrar, ajustes y salidas vencidas", () => {
  const today = "2026-11-05";
  const expired = { status: "vigente", end_date: "2026-10-31", continuation_billing: false };

  it("vencido sin la continuación y saliendo después del fin: hay meses sin cobrar (P7)", () => {
    expect(continuationGap(expired, "2026-12-15", today)).toBe(true);
    expect(continuationGap(expired, null, today)).toBe(true);
    // Se fue el día del fin, o ya se cobra la continuación, o todavía no venció: no.
    expect(continuationGap(expired, "2026-10-31", today)).toBe(false);
    expect(continuationGap({ ...expired, continuation_billing: true }, "2026-12-15", today)).toBe(false);
    expect(continuationGap({ ...expired, end_date: "2027-03-31" }, "2026-12-15", today)).toBe(false);
  });

  it("un ajuste que rige después de la salida no se aplica (P11)", () => {
    expect(takesEffectAfterExit("2027-01-01", "2026-12-15")).toBe(true);
    expect(takesEffectAfterExit("2026-12-01", "2026-12-15")).toBe(false);
    expect(takesEffectAfterExit("2027-01-01", null)).toBe(false);
  });

  it("salida registrada que ya pasó con el contrato abierto (P12)", () => {
    expect(exitOverdue({ status: "vigente", terminated_at: "2026-11-04" }, today)).toBe(true);
    expect(exitOverdue({ status: "vigente", terminated_at: "2026-11-05" }, today)).toBe(false);
    expect(exitOverdue({ status: "finalizado", terminated_at: "2026-11-01" }, today)).toBe(false);
  });
});
