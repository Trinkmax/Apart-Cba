import { describe, expect, it } from "vitest";
import { placePreview } from "../map-preview-placement";

// Un mapa de escritorio chico (ventana de laptop): 470 × 560, tarjeta 248 × 246.
const base = {
  card: { width: 248, height: 246 },
  container: { width: 470, height: 560 },
  pill: { width: 88, height: 34 },
  gap: 12,
  margin: 12,
};
const inside = (p: { left: number; top: number }) =>
  p.left >= 12 && p.top >= 12 && p.left + 248 <= 470 - 12 && p.top + 246 <= 560 - 12;

describe("placePreview", () => {
  it("arriba del precio cuando entra, alineada con el punto", () => {
    const p = placePreview({ ...base, point: { x: 235, y: 400 } });
    expect(p).toEqual({ side: "top", left: 111, top: 108, anchor: 124 });
    expect(inside(p)).toBe(true);
  });

  it("abajo cuando arriba no hay lugar (punto cerca del borde de arriba)", () => {
    const p = placePreview({ ...base, point: { x: 235, y: 100 } });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(112);
    expect(inside(p)).toBe(true);
  });

  it("al costado cuando no entra ni arriba ni abajo", () => {
    const right = placePreview({ ...base, point: { x: 60, y: 300 } });
    expect(right.side).toBe("right");
    expect(right.left).toBe(116);
    expect(right.anchor).toBe(123);
    expect(inside(right)).toBe(true);

    const left = placePreview({ ...base, point: { x: 420, y: 300 } });
    expect(left.side).toBe("left");
    expect(inside(left)).toBe(true);
  });

  it("si no entra de ningún lado, queda entera adentro del mapa y sin anclaje si tapa el precio", () => {
    // Mapa de 400 de alto: ni arriba ni abajo entran; corrida, tapa la píldora.
    const p = placePreview({ ...base, container: { width: 470, height: 400 }, point: { x: 235, y: 200 } });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(142);
    expect(p.anchor).toBeNull();
    expect(p.top + 246).toBeLessThanOrEqual(400 - 12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });

  it("corrida pero todavía del lado del precio: conserva el anclaje", () => {
    // Mapa bajo: arriba no entra por 6 px; corrida contra el borde, sigue arriba del precio.
    const p = placePreview({ ...base, container: { width: 470, height: 500 }, point: { x: 235, y: 302 } });
    expect(p.side).toBe("top");
    expect(p.top).toBe(12);
    expect(p.top + 246).toBeLessThanOrEqual(302 - 34 - 4);
    expect(p.anchor).toBe(124);
  });

  it("pegada a un costado: la tarjeta se corre y el anclaje no se va a la esquina", () => {
    const p = placePreview({ ...base, point: { x: 450, y: 400 } });
    expect(p.side).toBe("top");
    expect(p.left).toBe(210);
    expect(p.anchor).toBeNull();
    expect(inside(p)).toBe(true);
  });

  it("nunca queda con coordenadas negativas aunque el mapa sea más chico que la tarjeta", () => {
    const p = placePreview({ ...base, container: { width: 200, height: 200 }, point: { x: 100, y: 100 } });
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
  });
});
