import { describe, expect, it } from "vitest";
import { LENS, lensChannelScales, lensMap, lensStretch, rubberBand } from "../lens";

/** Corrimiento (px) que codifica un byte del mapa. */
const shift = (byte: number) => (byte / 255 - 0.5) * LENS.scale;

describe("lensMap", () => {
  it("mide la lente más el margen de cada lado, un píxel por px", () => {
    const m = lensMap(90, 74);
    expect(m.width).toBe(90 + 2 * LENS.margin);
    expect(m.height).toBe(74 + 2 * LENS.margin);
    expect(m.data.length).toBe(m.width * m.height * 4);
  });

  it("deja quieto el centro (128 en rojo y verde)", () => {
    const m = lensMap(90, 74);
    const i = Math.floor(m.width / 2);
    const j = Math.floor(m.height / 2);
    const k = (j * m.width + i) * 4;
    expect(m.data[k]).toBe(128);
    expect(m.data[k + 1]).toBe(128);
    expect(m.data[k + 3]).toBe(255);
  });

  it("cerca del canto va a buscar afuera: hacia la izquierda en el borde izquierdo", () => {
    const m = lensMap(90, 74);
    // Fila del medio, 3 px adentro del borde izquierdo de la lente.
    const j = Math.floor(m.height / 2);
    const i = LENS.margin + 3;
    const k = (j * m.width + i) * 4;
    expect(shift(m.data[k])).toBeLessThan(-5);
    // …y hacia la derecha en el borde derecho.
    const k2 = (j * m.width + (m.width - LENS.margin - 4)) * 4;
    expect(shift(m.data[k2])).toBeGreaterThan(5);
  });

  it("nunca se sale del rango de un byte", () => {
    const m = lensMap(120, 74);
    for (let k = 0; k < m.data.length; k += 4) {
      expect(m.data[k]).toBeGreaterThanOrEqual(0);
      expect(m.data[k]).toBeLessThanOrEqual(255);
    }
  });
});

describe("lensChannelScales", () => {
  it("el rojo se corre más y el azul menos: los flecos", () => {
    const s = lensChannelScales();
    expect(s.g).toBe(LENS.scale);
    expect(s.r).toBeGreaterThan(s.g);
    expect(s.b).toBeLessThan(s.g);
  });
});

describe("lensStretch", () => {
  it("quieto no se estira", () => {
    expect(lensStretch(0)).toEqual({ x: 1, y: 1 });
  });
  it("rápido se alarga y se afina, con tope", () => {
    const s = lensStretch(5);
    expect(s.x).toBeCloseTo(1.1);
    expect(s.y).toBeCloseTo(0.94);
    expect(lensStretch(-5)).toEqual(s);
  });
});

describe("rubberBand", () => {
  it("cada vez cede menos y nunca pasa el límite", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-3)).toBe(0);
    const a = rubberBand(10);
    const b = rubberBand(40);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(rubberBand(10_000)).toBeLessThan(10);
  });
});
