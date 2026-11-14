import { describe, expect, it } from "vitest";
import { choiceButtons, cleanReplies } from "../replies";

describe("respuestas sugeridas", () => {
  it("limpia espacios, saca repetidas (sin mirar mayúsculas) y corta en 6", () => {
    expect(cleanReplies(["  Sí ", "sí", "Sin seña", "", "Otro\n monto"])).toEqual(["Sí", "Sin seña", "Otro monto"]);
    expect(cleanReplies(["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(6);
    expect(cleanReplies(undefined)).toEqual([]);
  });
  it("nunca pasa de 60 caracteres", () => {
    expect(cleanReplies(["x".repeat(90)])[0]).toHaveLength(60);
  });
});

describe("botones para elegir un candidato", () => {
  it("con nombres distintos, un botón por opción y en el mismo orden", () => {
    expect(
      choiceButtons([
        { label: "Zulma Pereyra · SAL525", detail: "1 al 5 de nov · Confirmada" },
        { label: "Camila Ferreyra · BRASIL", detail: "3 al 9 de nov · Pendiente" },
      ]),
    ).toEqual(["Zulma Pereyra · SAL525", "Camila Ferreyra · BRASIL"]);
  });

  it("dos «Juan Pérez»: los repetidos suman el detalle, el resto queda igual", () => {
    expect(
      choiceButtons([
        { label: "Juan Pérez", detail: "351 555-1234" },
        { label: "Juan Pérez", detail: "11 4444-9999" },
        { label: "Es otra persona: cargar a «Juan Pérez» como huésped nuevo" },
      ]),
    ).toEqual(["Juan Pérez · 351 555-1234", "Juan Pérez · 11 4444-9999", "Es otra persona: cargar a «Juan Pérez» como huésped nuevo"]);
  });

  it("dos tramos del mismo contrato se distinguen por las fechas", () => {
    const b = choiceButtons([
      { label: "Ana Gómez · SAL525", detail: "1 al 31 de oct · Check-out" },
      { label: "Ana Gómez · SAL525", detail: "31 de oct al 30 de nov · Check-in" },
    ]);
    expect(new Set(b).size).toBe(2);
  });

  it("si aun con el detalle se repiten, no hay botones (que elija escribiendo)", () => {
    expect(
      choiceButtons([
        { label: "María López", detail: "Limpieza" },
        { label: "María López", detail: "Limpieza" },
      ]),
    ).toEqual([]);
    expect(choiceButtons([{ label: "María López" }, { label: "maría lópez" }])).toEqual([]);
  });

  it("con más de 6 candidatos no hay botones: conviene acotar", () => {
    expect(choiceButtons(Array.from({ length: 7 }, (_, i) => ({ label: `Opción ${i}` })))).toEqual([]);
    expect(choiceButtons([])).toEqual([]);
  });
});
