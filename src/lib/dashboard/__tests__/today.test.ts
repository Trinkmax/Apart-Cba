import { describe, expect, it } from "vitest";
import { briefLines, briefTone, cleaningState, headlineText, hhmm, sortCleanings } from "../today";

const counts = { checkIns: 0, checkOuts: 0, dirtyWithArrival: 0, dirty: 0, requests: 0 };

describe("headlineText", () => {
  it("dice quién entra y quién sale, en singular y plural", () => {
    expect(headlineText({ checkIns: 5, checkOuts: 3 })).toBe("Hoy entran 5 y salen 3.");
    expect(headlineText({ checkIns: 1, checkOuts: 1 })).toBe("Hoy entra 1 y sale 1.");
    expect(headlineText({ checkIns: 0, checkOuts: 2 })).toBe("Hoy no entra nadie y salen 2.");
    expect(headlineText({ checkIns: 2, checkOuts: 0 })).toBe("Hoy entran 2.");
    expect(headlineText({ checkIns: 0, checkOuts: 0 })).toBe("Hoy no entra ni sale nadie.");
  });
});

describe("briefLines / briefTone", () => {
  it("lo sucio con llegada gana a lo sucio a secas", () => {
    expect(briefLines({ ...counts, dirtyWithArrival: 2, dirty: 7 })).toEqual(["2 unidades siguen sucias y tienen llegada hoy."]);
    expect(briefLines({ ...counts, dirty: 1 })).toEqual(["1 unidad para limpiar."]);
  });

  it("las solicitudes sin responder se cuentan y ponen el día en alerta", () => {
    expect(briefLines({ ...counts, requests: 1 })).toEqual(["1 solicitud espera respuesta."]);
    expect(briefTone({ ...counts, requests: 1 })).toBe("alert");
    expect(briefTone({ ...counts, checkIns: 3 })).toBe("busy");
    expect(briefTone(counts)).toBe("calm");
  });
});

describe("hhmm", () => {
  it("recorta los segundos y tolera vacíos", () => {
    expect(hhmm("14:00:00")).toBe("14:00");
    expect(hhmm("9:30")).toBe("09:30");
    expect(hhmm(null)).toBeNull();
    expect(hhmm("")).toBeNull();
  });
});

describe("cleaningState", () => {
  it("lee el estado de la tarea, y una fila sin tarea es sin asignar", () => {
    expect(cleaningState({ task_id: "t", status: "verificada", assigned_to: null })).toBe("lista");
    expect(cleaningState({ task_id: "t", status: "completada", assigned_to: "u" })).toBe("lista");
    expect(cleaningState({ task_id: "t", status: "en_progreso", assigned_to: "u" })).toBe("en_curso");
    expect(cleaningState({ task_id: "t", status: "pendiente", assigned_to: "u" })).toBe("asignada");
    expect(cleaningState({ task_id: null, status: null, assigned_to: null })).toBe("sin_asignar");
  });
});

describe("sortCleanings", () => {
  const row = (unit_id: string, extra: Partial<{ status: string; check_out_time: string; overdue: boolean; assigned_to: string }> = {}) => ({
    unit_id,
    task_id: "t-" + unit_id,
    status: extra.status ?? "pendiente",
    assigned_to: extra.assigned_to ?? null,
    check_out_time: extra.check_out_time ?? "10:00:00",
    overdue: extra.overdue,
  });

  it("primero las que tienen gente entrando, después las atrasadas, las listas al final", () => {
    const sorted = sortCleanings(
      [
        row("lista", { status: "verificada" }),
        row("tarde", { check_out_time: "12:00:00" }),
        row("atrasada", { overdue: true }),
        row("temprano", { check_out_time: "08:00:00" }),
        row("con-llegada", { check_out_time: "11:00:00" }),
      ],
      new Set(["con-llegada"]),
    );
    expect(sorted.map((r) => r.unit_id)).toEqual(["con-llegada", "atrasada", "temprano", "tarde", "lista"]);
  });
});
