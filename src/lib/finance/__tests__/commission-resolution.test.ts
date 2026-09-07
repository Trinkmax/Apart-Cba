import { describe, expect, it } from "vitest";
import {
  computeBookingEconomics,
  resolveCommissionPct,
} from "@/lib/finance/booking-economics";

/**
 * La comisión de administración se puede configurar en cuatro lugares. Estos
 * casos fijan el orden y, sobre todo, que una organización que NO configuró
 * nada nuevo siga dando exactamente el número de siempre.
 */
describe("resolveCommissionPct", () => {
  it("sin nada configurado cae en 20", () => {
    expect(resolveCommissionPct({})).toEqual({ pct: 20, origin: "default" });
  });

  it("usa el de la unidad cuando no hay política por canal", () => {
    expect(
      resolveCommissionPct({ source: "booking", unitPct: 18, orgPct: 25 }),
    ).toEqual({ pct: 18, origin: "unidad" });
  });

  it("el canal le gana a la unidad", () => {
    expect(
      resolveCommissionPct({
        source: "directo",
        bySource: { directo: 27.5 },
        unitPct: 20,
      }),
    ).toEqual({ pct: 27.5, origin: "canal" });
  });

  it("un canal sin configurar no pisa a la unidad", () => {
    expect(
      resolveCommissionPct({
        source: "booking",
        bySource: { directo: 27.5 },
        unitPct: 20,
      }),
    ).toEqual({ pct: 20, origin: "unidad" });
  });

  it("el acuerdo con el propietario le gana al canal", () => {
    expect(
      resolveCommissionPct({
        source: "directo",
        ownerOverride: 15,
        bySource: { directo: 27.5 },
        unitPct: 20,
      }),
    ).toEqual({ pct: 15, origin: "propietario" });
  });

  it("un 0 explícito es un valor, no un 'sin configurar'", () => {
    expect(
      resolveCommissionPct({ source: "directo", bySource: { directo: 0 }, unitPct: 20 }),
    ).toEqual({ pct: 0, origin: "canal" });
    expect(resolveCommissionPct({ ownerOverride: 0, unitPct: 20 })).toEqual({
      pct: 0,
      origin: "propietario",
    });
  });

  it("con el mapa vacío da lo mismo que antes de la migración 059", () => {
    const antes = 18;
    expect(
      resolveCommissionPct({ source: "booking", bySource: {}, unitPct: antes }).pct,
    ).toBe(antes);
  });

  it("recorta porcentajes fuera de rango en vez de propagarlos", () => {
    expect(resolveCommissionPct({ source: "directo", bySource: { directo: 150 } }).pct).toBe(100);
    expect(resolveCommissionPct({ unitPct: -5 }).pct).toBe(0);
  });
});

describe("caso Habitana: 27,5% en las directas", () => {
  const bySource = { directo: 27.5 };

  it("una reserva directa cobra 27,5 sobre el total", () => {
    const pct = resolveCommissionPct({ source: "directo", bySource, unitPct: 20 }).pct;
    const econ = computeBookingEconomics({
      total: 100_000,
      cleaningFee: 15_000,
      channelPct: 0,
      commissionPct: pct,
      commissionBase: "net_of_channel",
    });
    expect(econ.commission).toBe(27_500);
    expect(econ.ownerNet).toBe(57_500); // 100.000 − 27.500 − 15.000
  });

  it("la misma reserva por Booking usa el % de la unidad y descuenta la plataforma", () => {
    const pct = resolveCommissionPct({ source: "booking", bySource, unitPct: 20 }).pct;
    const econ = computeBookingEconomics({
      total: 100_000,
      cleaningFee: 15_000,
      channelPct: 15,
      commissionPct: pct,
      commissionBase: "net_of_channel",
    });
    expect(pct).toBe(20);
    expect(econ.channelCommission).toBe(15_000);
    expect(econ.commission).toBe(17_000); // 20% de (100.000 − 15.000)
    expect(econ.ownerNet).toBe(53_000);
  });
});
