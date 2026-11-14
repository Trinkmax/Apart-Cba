import { describe, expect, it } from "vitest";
import { DONUT_LENGTH, donutSegments, gapForPixels } from "../donut";

const sumDash = (dashArray: string) => dashArray.split(" ").map(Number).reduce((a, b) => a + b, 0);

describe("donutSegments", () => {
  it("las partes en cero no se dibujan y cada trazo da la vuelta entera con su hueco", () => {
    const segs = donutSegments(
      [
        { key: "ocupado", value: 64 },
        { key: "mantenimiento", value: 0 },
        { key: "limpieza", value: 6 },
        { key: "disponible", value: 3 },
      ],
      { gap: 5 },
    );
    expect(segs.map((s) => s.key)).toEqual(["ocupado", "limpieza", "disponible"]);
    for (const s of segs) expect(sumDash(s.dashArray)).toBeCloseTo(DONUT_LENGTH, 1);
    expect(segs[0].share).toBeCloseTo(64 / 73, 5);
  });

  it("arranca a las 12 y cada parte empieza donde terminó la anterior", () => {
    const segs = donutSegments(
      [
        { key: "a", value: 1 },
        { key: "b", value: 1 },
      ],
      { gap: 10 },
    );
    expect(segs[0].dashOffset).toBe(-5);
    expect(segs[1].dashOffset).toBe(-505);
    expect(segs[0].dashArray).toBe("490 510");
  });

  it("una sola parte es el anillo entero, sin hueco", () => {
    const segs = donutSegments([{ key: "ocupado", value: 21 }, { key: "disponible", value: 0 }], { gap: 5 });
    expect(segs).toEqual([{ key: "ocupado", value: 21, share: 1, dashArray: "1000 0", dashOffset: 0 }]);
  });

  it("una parte chiquita igual se ve", () => {
    const segs = donutSegments(
      [
        { key: "ocupado", value: 999 },
        { key: "mantenimiento", value: 1 },
      ],
      { gap: 5, minVisible: 3 },
    );
    expect(Number(segs[1].dashArray.split(" ")[0])).toBe(3);
  });

  it("sin unidades no hay nada que dibujar", () => {
    expect(donutSegments([{ key: "ocupado", value: 0 }], { gap: 5 })).toEqual([]);
  });
});

describe("gapForPixels", () => {
  it("2 px en una torta de 176 px", () => {
    // Circunferencia del anillo: π × 176 × 0,8 ≈ 442 px → 2 px ≈ 4,5 de 1000.
    expect(gapForPixels(2, 176)).toBeCloseTo(4.52, 1);
  });
});
