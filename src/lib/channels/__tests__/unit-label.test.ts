import { describe, expect, it } from "vitest";
import { unitDisplay } from "../unit-label";

describe("unitDisplay", () => {
  it("código y nombre", () => {
    expect(unitDisplay("SAL648", "SALGUERO II")).toBe("SAL648 · SALGUERO II");
  });
  // Viaggiato: el aviso decía «GAMA · GAMA».
  it("si son lo mismo, una sola vez", () => {
    expect(unitDisplay("GAMA", "GAMA")).toBe("GAMA");
    expect(unitDisplay("Centro", " CENTRO ")).toBe("Centro");
  });
  it("con lo que haya", () => {
    expect(unitDisplay("AT4B", null)).toBe("AT4B");
    expect(unitDisplay(null, "Pampa Mora")).toBe("Pampa Mora");
    expect(unitDisplay("", "  ")).toBe("Una unidad");
    expect(unitDisplay(null, undefined, "Sin unidad")).toBe("Sin unidad");
  });
});
