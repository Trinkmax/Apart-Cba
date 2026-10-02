import { describe, expect, it } from "vitest";
import { chooseDifferenceTarget, type DifferenceTargetCandidate } from "../charges";

// Contrato IPC con desfasaje 1 y ajuste trimestral en junio: el IPC de mayo sale
// ~12/06, después del vencimiento del 10/06. La diferencia aparece el 13/06.
const TODAY = "2026-06-13";

function charge(id: string, over: Partial<DifferenceTargetCandidate> = {}): DifferenceTargetCandidate {
  return { id, kind: "mensual", status: "pendiente", due_date: "2026-06-10", period_start: "2026-06-01", ...over };
}

describe("chooseDifferenceTarget (sin punitorios por días en que la diferencia no existía)", () => {
  it("junio abierto pero ya vencido: la diferencia no va ahí", () => {
    const june = charge("jun");
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBeNull();
  });

  it("junio abierto y todavía en plazo: va al mismo cargo", () => {
    const june = charge("jun", { due_date: "2026-06-20" });
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBe("jun");
  });

  it("junio pagado y mayo todavía abierto (vencido el 10/05): nunca al cargo de mayo", () => {
    const june = charge("jun", { status: "pagado" });
    const may = charge("may", { status: "parcial", due_date: "2026-05-10", period_start: "2026-05-01" });
    expect(chooseDifferenceTarget(june, [may, june], { today: TODAY })).toBeNull();
  });

  it("si hay un mensual abierto que vence más adelante, va al que vence más tarde", () => {
    const june = charge("jun", { status: "pagado" });
    const july = charge("jul", { due_date: "2026-07-10", period_start: "2026-07-01" });
    const aug = charge("ago", { due_date: "2026-08-10", period_start: "2026-08-01" });
    expect(chooseDifferenceTarget(june, [june, july, aug], { today: TODAY })).toBe("ago");
  });

  it("un cargo que vence en menos del aviso mínimo no sirve", () => {
    const june = charge("jun", { due_date: "2026-06-15" });
    expect(chooseDifferenceTarget(june, [june], { today: TODAY })).toBeNull();
    expect(chooseDifferenceTarget(june, [june], { today: TODAY, minNoticeDays: 0 })).toBe("jun");
  });

  it("ni cargos que no son mensuales ni meses posteriores a la salida", () => {
    const june = charge("jun", { status: "pagado" });
    const exit = charge("salida", { kind: "salida", due_date: "2026-07-01", period_start: null });
    const july = charge("jul", { due_date: "2026-07-10", period_start: "2026-07-01" });
    expect(chooseDifferenceTarget(june, [june, exit, july], { today: TODAY, terminatedAt: "2026-06-30" })).toBeNull();
    expect(chooseDifferenceTarget(june, [june, exit, july], { today: TODAY, terminatedAt: "2026-07-15" })).toBe("jul");
  });
});
