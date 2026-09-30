import { describe, expect, it } from "vitest";
import type { UnitPricingRule } from "@/lib/types/database";
import {
  availabilityRedirectCode,
  evaluateCheckoutStay,
  listingReturnPath,
  parseGuests,
  type CheckoutGuardListing,
} from "../checkout-guard";

const listing: CheckoutGuardListing = {
  base_price: 50000,
  cleaning_fee: 10000,
  pricing_rules: [],
  min_nights: 2,
  max_nights: 20,
  max_guests: 3,
};

const run = (checkIn: string | null, checkOut: string | null, guests: string | null = "2", l = listing) =>
  evaluateCheckoutStay({ checkIn, checkOut, guests, todayIso: "2026-10-01", listing: l });

describe("evaluateCheckoutStay", () => {
  it("estadía válida: devuelve noches y precio", () => {
    const r = run("2026-10-03", "2026-10-06");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nights).toBe(3);
      expect(r.guests).toBe(2);
      expect(r.pricing.total).toBe(160000);
    }
  });

  it("sin fechas vuelve a la ficha sin aviso", () => {
    expect(run(null, null)).toMatchObject({ ok: false, code: null });
  });

  it("fechas inválidas, invertidas o pasadas", () => {
    expect(run("2026-13-01", "2026-10-06")).toMatchObject({ ok: false, code: "fechas" });
    expect(run("2026-10-06", "2026-10-03")).toMatchObject({ ok: false, code: "fechas" });
    expect(run("2026-09-20", "2026-09-25")).toMatchObject({ ok: false, code: "pasado" });
  });

  it("28+ noches se consultan y conservan las fechas", () => {
    const r = run("2026-10-03", "2026-11-05");
    expect(r).toMatchObject({ ok: false, code: "mensual", keep: { checkIn: "2026-10-03", checkOut: "2026-11-05" } });
  });

  it("huéspedes, mínimo y máximo de noches", () => {
    expect(run("2026-10-03", "2026-10-06", "5")).toMatchObject({ ok: false, code: "huespedes" });
    expect(run("2026-10-03", "2026-10-04")).toMatchObject({ ok: false, code: "minimo" });
    expect(run("2026-10-02", "2026-10-25", "1", { ...listing, max_nights: 20 })).toMatchObject({ ok: false, code: "maximo" });
  });

  it("una regla de precio puede subir el mínimo", () => {
    const rule = {
      id: "r1",
      active: true,
      rule_type: "date_range",
      start_date: "2026-12-30",
      end_date: "2027-01-02",
      days_of_week: null,
      priority: 1,
      price_override: 90000,
      price_multiplier: null,
      min_nights_override: 4,
    } as unknown as UnitPricingRule;
    const r = run("2026-12-30", "2027-01-02", "2", { ...listing, pricing_rules: [rule] });
    expect(r).toMatchObject({ ok: false, code: "minimo" });
  });

  it("sin precio no se puede pedir", () => {
    expect(run("2026-10-03", "2026-10-06", "2", { ...listing, base_price: 0, cleaning_fee: 0 })).toMatchObject({
      ok: false,
      code: "no_disponible",
    });
  });
});

describe("helpers", () => {
  it("parseGuests", () => {
    expect(parseGuests("3")).toBe(3);
    expect(parseGuests("0")).toBe(1);
    expect(parseGuests("abc")).toBe(1);
    expect(parseGuests(["4", "2"])).toBe(4);
  });

  it("availabilityRedirectCode", () => {
    expect(availabilityRedirectCode("Esas fechas ya están reservadas")).toBe("ocupado");
    expect(availabilityRedirectCode("Hay una solicitud pendiente para esas fechas. Probá con otras o esperá unas horas.")).toBe("pendiente");
    expect(availabilityRedirectCode("Las fechas son inválidas")).toBe("fechas");
    expect(availabilityRedirectCode("Error verificando reservas: timeout")).toBeNull();
    expect(availabilityRedirectCode(null)).toBeNull();
  });

  it("listingReturnPath", () => {
    expect(listingReturnPath("parana", { checkIn: "2026-10-03", checkOut: "2026-10-06", guests: 2 }, "ocupado")).toBe(
      "/u/parana?checkin=2026-10-03&checkout=2026-10-06&huespedes=2&error=ocupado",
    );
    expect(listingReturnPath("parana", { checkIn: null, checkOut: null, guests: 1 }, null)).toBe("/u/parana");
  });
});
