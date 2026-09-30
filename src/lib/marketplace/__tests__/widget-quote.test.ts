import { describe, expect, it } from "vitest";
import type { UnitPricingRule } from "@/lib/types/database";
import {
  addMonthsIso,
  BRAND_OG_IMAGE,
  checkoutHref,
  listingOgImageUrl,
  consultMailto,
  consultMessage,
  descriptionBlocks,
  listingMetaDescription,
  listingMetaTitle,
  pickSimilarListings,
  effectiveMinNights,
  evaluateStay,
  isCalendarDayDisabled,
  isCalendarDayStruck,
  longDayEs,
  monthsFromNights,
  nextBlockedAfter,
  parseStayParams,
  rangeHasBlockedNight,
  resolveRangeSelection,
  senaStepLabel,
  viewOptions,
  type EvaluateStayParams,
  type WidgetListing,
} from "@/lib/marketplace/widget-quote";

const TODAY = "2026-10-01";

function listing(over: Partial<WidgetListing> = {}): WidgetListing {
  return {
    id: "unit-1",
    display_title: "Paraná",
    base_price: 70000,
    cleaning_fee: 15000,
    monthly_price: null,
    marketplace_currency: "ARS",
    instant_book: false,
    default_mode: "temporario",
    min_nights: 2,
    max_nights: null,
    max_guests: 3,
    pricing_rules: [],
    ...over,
  };
}

function params(over: Partial<EvaluateStayParams> = {}): EvaluateStayParams {
  return {
    listing: listing(),
    view: "noche",
    checkIn: "2026-10-10",
    checkOut: "2026-10-13",
    guests: 2,
    blocked: new Set<string>(),
    today: TODAY,
    policy: { rule: "one_night", percent: null },
    ...over,
  };
}

function rule(over: Partial<UnitPricingRule>): UnitPricingRule {
  return {
    id: "r1",
    unit_id: "unit-1",
    organization_id: "org",
    name: "Temporada",
    rule_type: "date_range",
    start_date: "2026-12-20",
    end_date: "2027-01-10",
    days_of_week: null,
    price_multiplier: null,
    price_override: null,
    min_nights_override: null,
    priority: 1,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

// Ocupadas las noches del 15 y 16 (una reserva 15→17).
const BLOCKED = new Set(["2026-10-15", "2026-10-16"]);

describe("calendario: noches half-open y checkout de recambio", () => {
  it("encuentra la primera noche ocupada después de la llegada", () => {
    expect(nextBlockedAfter(BLOCKED, "2026-10-10")).toBe("2026-10-15");
    expect(nextBlockedAfter(BLOCKED, "2026-10-16")).toBeNull();
    expect(nextBlockedAfter(BLOCKED, "")).toBeNull();
  });

  it("detecta rangos que pisan una noche ocupada (la salida no cuenta)", () => {
    expect(rangeHasBlockedNight(BLOCKED, "2026-10-10", "2026-10-15")).toBe(false);
    expect(rangeHasBlockedNight(BLOCKED, "2026-10-10", "2026-10-16")).toBe(true);
    expect(rangeHasBlockedNight(BLOCKED, "2026-10-17", "2026-10-20")).toBe(false);
  });

  it("eligiendo la salida: el día de recambio se puede elegir y nada más allá", () => {
    const s = { checkIn: "2026-10-10", checkOut: "", blocked: BLOCKED, nextBlocked: "2026-10-15" };
    expect(isCalendarDayDisabled("2026-10-14", s)).toBe(false);
    expect(isCalendarDayDisabled("2026-10-15", s)).toBe(false);
    expect(isCalendarDayDisabled("2026-10-16", s)).toBe(true);
    expect(isCalendarDayDisabled("2026-10-20", s)).toBe(true);
    // El recambio no se muestra tachado mientras se elige la salida.
    expect(isCalendarDayStruck("2026-10-15", s)).toBe(false);
    expect(isCalendarDayStruck("2026-10-16", s)).toBe(true);
  });

  it("sin llegada: las noches ocupadas no se pueden elegir (sí el día que se liberan)", () => {
    const s = { checkIn: "", checkOut: "", blocked: BLOCKED, nextBlocked: null };
    expect(isCalendarDayDisabled("2026-10-15", s)).toBe(true);
    expect(isCalendarDayDisabled("2026-10-17", s)).toBe(false);
  });

  it("con rango completo, la salida elegida (aunque sea recambio) no se tacha", () => {
    const s = { checkIn: "2026-10-10", checkOut: "2026-10-15", blocked: BLOCKED, nextBlocked: "2026-10-15" };
    expect(isCalendarDayDisabled("2026-10-15", s)).toBe(false);
    expect(isCalendarDayStruck("2026-10-15", s)).toBe(false);
    expect(isCalendarDayDisabled("2026-10-16", s)).toBe(true);
  });

  it("resuelve los clicks del rango", () => {
    expect(resolveRangeSelection(null, null, BLOCKED)).toEqual({ checkIn: "", checkOut: "", complete: false });
    // Primer click: from === to → todavía no hay salida.
    expect(resolveRangeSelection("2026-10-10", "2026-10-10", BLOCKED)).toEqual({ checkIn: "2026-10-10", checkOut: "", complete: false });
    // Recambio: salida el día que entra el otro huésped.
    expect(resolveRangeSelection("2026-10-10", "2026-10-15", BLOCKED)).toEqual({ checkIn: "2026-10-10", checkOut: "2026-10-15", complete: true });
    // Cruza un bloqueo → se reinicia desde la llegada.
    expect(resolveRangeSelection("2026-10-10", "2026-10-18", BLOCKED)).toEqual({ checkIn: "2026-10-10", checkOut: "", complete: false });
    // Una noche ocupada nunca es llegada.
    expect(resolveRangeSelection("2026-10-15", "2026-10-15", BLOCKED)).toEqual({ checkIn: "", checkOut: "", complete: false });
  });
});

describe("prellenado desde la URL", () => {
  it("toma fechas y huéspedes válidos", () => {
    const s = parseStayParams("?checkin=2026-10-10&checkout=2026-10-13&huespedes=2", listing(), TODAY);
    expect(s).toEqual({ view: "noche", checkIn: "2026-10-10", checkOut: "2026-10-13", months: 1, guests: 2 });
  });

  it("descarta llegadas vencidas, fechas inválidas y huéspedes basura", () => {
    expect(parseStayParams("checkin=2026-09-20&checkout=2026-09-25", listing(), TODAY).checkIn).toBe("");
    expect(parseStayParams("checkin=2026-02-30&checkout=2026-03-02", listing(), TODAY).checkIn).toBe("");
    const s = parseStayParams("checkin=2026-10-10&checkout=2026-10-09&huespedes=abc", listing(), TODAY);
    expect(s.checkOut).toBe("");
    expect(s.guests).toBe(1);
    expect(parseStayParams("huespedes=40", listing(), TODAY).guests).toBe(3);
  });

  it("28+ noches abre la vista por mes con los meses aproximados", () => {
    const s = parseStayParams("checkin=2026-10-10&checkout=2026-12-10&huespedes=1", listing({ default_mode: "mixto" }), TODAY);
    expect(s.view).toBe("mes");
    expect(s.months).toBe(2);
    expect(s.checkOut).toBe("2026-12-10");
  });

  it("una unidad sólo mensual abre por mes", () => {
    expect(parseStayParams("", listing({ default_mode: "mensual" }), TODAY).view).toBe("mes");
  });
});

describe("cotización por noche: total, seña y resto", () => {
  it("3 noches con limpieza: seña = 1 noche sin limpieza, resto al llegar", () => {
    const e = evaluateStay(params());
    expect(e.kind).toBe("nightly");
    if (e.kind !== "nightly") return;
    expect(e.nights).toBe(3);
    expect(e.subtotal).toBe(210000);
    expect(e.cleaningFee).toBe(15000);
    expect(e.total).toBe(225000);
    expect(e.sena).toBe(70000);
    expect(e.senaRule).toBe("1 noche");
    expect(e.resto).toBe(155000);
    expect(e.cta).toEqual({ kind: "request", label: "Pedir reserva", href: "/checkout/unit-1?checkin=2026-10-10&checkout=2026-10-13&huespedes=2" });
  });

  it("seña por porcentaje y sin seña", () => {
    const pct = evaluateStay(params({ policy: { rule: "percent", percent: 30 } }));
    expect(pct.kind === "nightly" && [pct.sena, pct.resto]).toEqual([67500, 157500]);
    const none = evaluateStay(params({ policy: { rule: "none", percent: null } }));
    expect(none.kind === "nightly" && [none.sena, none.senaRule, none.resto]).toEqual([null, null, 225000]);
  });

  it("reserva inmediata → Reservar", () => {
    const e = evaluateStay(params({ listing: listing({ instant_book: true }) }));
    expect(e.cta.kind).toBe("instant");
    expect(e.cta.label).toBe("Reservar");
  });

  it("sin fechas pide elegirlas", () => {
    expect(evaluateStay(params({ checkIn: "", checkOut: "" }))).toMatchObject({ kind: "empty", cta: { kind: "choose_dates" } });
    expect(evaluateStay(params({ checkOut: "" }))).toMatchObject({ kind: "empty", hint: "Elegí la fecha de salida." });
  });
});

describe("validaciones", () => {
  it("mínimo y máximo de noches", () => {
    expect(evaluateStay(params({ checkOut: "2026-10-11" }))).toMatchObject({ kind: "invalid", issue: "min_nights", cta: { kind: "change_dates" } });
    expect(evaluateStay(params({ listing: listing({ max_nights: 2 }) }))).toMatchObject({ kind: "invalid", issue: "max_nights" });
  });

  it("la regla que gana la noche de llegada puede subir el mínimo, nunca bajarlo", () => {
    const high = listing({ pricing_rules: [rule({ min_nights_override: 5 })] });
    expect(effectiveMinNights(high, "2026-12-26")).toBe(5);
    expect(effectiveMinNights(high, "2026-10-10")).toBe(2);
    const low = listing({ min_nights: 3, pricing_rules: [rule({ min_nights_override: 1 })] });
    expect(effectiveMinNights(low, "2026-12-26")).toBe(3);
    expect(evaluateStay(params({ listing: high, checkIn: "2026-12-26", checkOut: "2026-12-29" }))).toMatchObject({ issue: "min_nights" });
  });

  it("una regla con mínimo en una noche que NO es la de llegada también manda (igual que el checkout)", () => {
    // Temporada 20/12–10/01 con mínimo 5: llegar el 18/12 y salir el 21/12
    // toca una noche de temporada (20/12). El servidor lo rechaza; el widget, también.
    const high = listing({ pricing_rules: [rule({ min_nights_override: 5 })] });
    expect(effectiveMinNights(high, "2026-12-18")).toBe(2);
    expect(evaluateStay(params({ listing: high, checkIn: "2026-12-18", checkOut: "2026-12-21" }))).toMatchObject({
      kind: "invalid",
      issue: "min_nights",
    });
    expect(evaluateStay(params({ listing: high, checkIn: "2026-12-10", checkOut: "2026-12-13" })).kind).toBe("nightly");
  });

  it("con llegada y salida, el mínimo que se muestra es el que exige el checkout", () => {
    const high = listing({ pricing_rules: [rule({ min_nights_override: 5 })] });
    // Sólo la llegada (18/12, sin regla): la pista de la noche de llegada.
    expect(effectiveMinNights(high, "2026-12-18")).toBe(2);
    // Con la salida: la temporada tarifa la noche del 20/12 → 5, como evaluateStay y el server.
    expect(effectiveMinNights(high, "2026-12-18", "2026-12-21")).toBe(5);
    // [18/12, 20/12) no toca la temporada.
    expect(effectiveMinNights(high, "2026-12-18", "2026-12-20")).toBe(2);
    // Llegada en temporada: nunca menos que la pista de llegada.
    expect(effectiveMinNights(high, "2026-12-26", "2026-12-27")).toBe(5);
    // Salida inválida (igual o anterior a la llegada, o basura): vuelve a la pista de llegada.
    expect(effectiveMinNights(high, "2026-12-18", "2026-12-18")).toBe(2);
    expect(effectiveMinNights(high, "2026-12-18", "2026-12-10")).toBe(2);
    expect(effectiveMinNights(high, "2026-12-18", "2026-02-31")).toBe(2);
    // Nunca menos que la unidad; una regla inactiva no cuenta.
    const low = listing({ min_nights: 3, pricing_rules: [rule({ min_nights_override: 1 })] });
    expect(effectiveMinNights(low, "2026-12-18", "2026-12-23")).toBe(3);
    const inactive = listing({ pricing_rules: [rule({ min_nights_override: 5, active: false })] });
    expect(effectiveMinNights(inactive, "2026-12-18", "2026-12-21")).toBe(2);
    // Varias reglas en el rango: gana la que más pide.
    const two = listing({
      pricing_rules: [
        rule({ id: "r1", min_nights_override: 3, start_date: "2026-12-19", end_date: "2026-12-19" }),
        rule({ id: "r2", min_nights_override: 4, start_date: "2026-12-21", end_date: "2026-12-22" }),
      ],
    });
    expect(effectiveMinNights(two, "2026-12-18", "2026-12-22")).toBe(4);
    expect(effectiveMinNights(two, "2026-12-18", "2026-12-20")).toBe(3);
    // Sin reglas en el catálogo (pricing_rules ausente): el de la unidad.
    expect(effectiveMinNights({ min_nights: 2, base_price: 70000 }, "2026-12-18", "2026-12-21")).toBe(2);
  });

  it("el mínimo mostrado y la validación del widget nunca se contradicen", () => {
    const high = listing({ pricing_rules: [rule({ min_nights_override: 5 })] });
    const stays: [string, string, number][] = [
      ["2026-12-18", "2026-12-21", 3],
      ["2026-12-16", "2026-12-21", 5],
      ["2026-12-18", "2026-12-20", 2],
      ["2026-12-26", "2026-12-29", 3],
      ["2026-12-26", "2026-12-31", 5],
    ];
    for (const [checkIn, checkOut, nights] of stays) {
      const tooShort = nights < effectiveMinNights(high, checkIn, checkOut);
      const ev = evaluateStay(params({ listing: high, checkIn, checkOut }));
      expect(ev.kind === "invalid" && ev.issue === "min_nights").toBe(tooShort);
    }
  });

  it("noches ocupadas, fechas pasadas y orden", () => {
    expect(evaluateStay(params({ blocked: BLOCKED, checkOut: "2026-10-16" }))).toMatchObject({ issue: "blocked" });
    // Salir el día de recambio es válido.
    expect(evaluateStay(params({ blocked: BLOCKED, checkOut: "2026-10-15" })).kind).toBe("nightly");
    expect(evaluateStay(params({ checkIn: "2026-09-28", checkOut: "2026-10-02" }))).toMatchObject({ issue: "past" });
    expect(evaluateStay(params({ checkIn: "2026-10-13", checkOut: "2026-10-10" }))).toMatchObject({ issue: "dates_order" });
  });

  it("más huéspedes que los permitidos", () => {
    expect(evaluateStay(params({ guests: 4 }))).toMatchObject({ issue: "guests_max", cta: { kind: "fix_guests" } });
  });

  it("sin precio por noche se consulta", () => {
    expect(evaluateStay(params({ listing: listing({ base_price: 0, cleaning_fee: 0 }) }))).toMatchObject({ issue: "no_price", cta: { kind: "consult" } });
  });
});

describe("estadías por mes: se consultan", () => {
  it("28+ noches por noche pasa a consulta, con estimado si hay mensual", () => {
    const e = evaluateStay(params({ listing: listing({ default_mode: "mixto", monthly_price: 900000 }), checkOut: "2026-11-09" }));
    expect(e).toMatchObject({ kind: "monthly", reason: "long_stay", nights: 30, monthlyPrice: 900000, estimatedTotal: 900000, cta: { kind: "consult", label: "Consultar por WhatsApp" } });
  });

  it("vista por mes sin fechas: precio de lista o a consultar", () => {
    const withPrice = evaluateStay(params({ view: "mes", checkIn: "", checkOut: "", listing: listing({ default_mode: "mensual", monthly_price: 800000 }) }));
    expect(withPrice).toMatchObject({ kind: "monthly", reason: "view", monthlyPrice: 800000, estimatedTotal: null, nights: null });
    const noPrice = evaluateStay(params({ view: "mes", checkIn: "", checkOut: "" }));
    expect(noPrice).toMatchObject({ kind: "monthly", monthlyPrice: null, cta: { kind: "consult" } });
  });

  it("marca si hay noches ocupadas en el período", () => {
    const e = evaluateStay(params({ view: "mes", listing: listing({ default_mode: "mixto" }), blocked: BLOCKED, checkIn: "2026-10-10", checkOut: "2026-11-10" }));
    expect(e).toMatchObject({ kind: "monthly", hasBlocked: true });
  });

  it("meses calendario y aproximación desde noches", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-10-10", 3)).toBe("2027-01-10");
    expect(monthsFromNights(61)).toBe(2);
    expect(monthsFromNights(400)).toBe(12);
  });

  it("pestañas según la vocación de la unidad", () => {
    expect(viewOptions(listing({ default_mode: "mixto" }))).toEqual(["noche", "mes"]);
    expect(viewOptions(listing({ default_mode: "temporario" }))).toEqual(["noche"]);
    expect(viewOptions(listing({ default_mode: "mensual" }))).toEqual(["mes"]);
  });
});

describe("textos de consulta y seña", () => {
  it("arma el mensaje de WhatsApp sin emojis", () => {
    expect(longDayEs("2026-10-03")).toBe("3 de octubre");
    expect(
      consultMessage({ title: "Paraná", hood: "Nueva Córdoba", view: "mes", checkIn: "2026-10-03", months: 2, guests: 2, url: "https://www.apartcba.com/u/parana" }),
    ).toBe(
      "Hola, quiero consultar por Paraná en Nueva Córdoba para una estadía por mes, desde el 3 de octubre por 2 meses, para 2 personas. ¿Me pasan el precio y las condiciones?\nhttps://www.apartcba.com/u/parana",
    );
    expect(consultMessage({ title: "Paraná", view: "noche", checkIn: "2026-10-03", checkOut: "2026-10-06", guests: 1 })).toBe(
      "Hola, quiero consultar por Paraná, del 3 de octubre al 6 de octubre, para 1 persona.",
    );
  });

  it("mailto codificado y null sin email", () => {
    expect(consultMailto("hola@apartcba.com", "Consulta: Paraná", "Hola")).toBe("mailto:hola@apartcba.com?subject=Consulta%3A%20Paran%C3%A1&body=Hola");
    expect(consultMailto(null, "a", "b")).toBeNull();
  });

  it("seña para 'Cómo se paga': monto con cotización, regla sin ella", () => {
    const nightly = evaluateStay(params());
    expect(senaStepLabel(nightly, { rule: "one_night", percent: null }, "ARS")).toMatch(/70\.000/);
    expect(senaStepLabel(null, { rule: "one_night", percent: null }, "ARS")).toBe("1 noche");
    expect(senaStepLabel(null, { rule: "none", percent: null }, "ARS")).toBeNull();
  });

  it("link al checkout sin login", () => {
    expect(checkoutHref("u", "2026-10-10", "2026-10-12", 2)).toBe("/checkout/u?checkin=2026-10-10&checkout=2026-10-12&huespedes=2");
  });
});

describe("aviso ?error=", () => {
  it("códigos, textos viejos y genérico para cualquier otra cosa", async () => {
    const { listingErrorMessage, LISTING_ERROR_CODES, LISTING_ERROR_FALLBACK } = await import("@/lib/marketplace/widget-quote");
    expect(listingErrorMessage(null)).toBeNull();
    expect(listingErrorMessage("ocupado")).toBe(LISTING_ERROR_CODES.ocupado);
    expect(listingErrorMessage("min_nights")).toBe(LISTING_ERROR_CODES.minimo);
    expect(listingErrorMessage("Esas fechas ya están reservadas")).toBe(LISTING_ERROR_CODES.ocupado);
    expect(listingErrorMessage("Llamá al 0800 para reclamar tu premio")).toBe(LISTING_ERROR_FALLBACK);
  });
});

describe("descripción: párrafos y viñetas", () => {
  it("respeta párrafos, saltos de línea y viñetas", () => {
    const blocks = descriptionBlocks(
      "Depto luminoso.\nA dos cuadras del Buen Pastor.\n\nIncluye:\n• Wifi\n- Aire acondicionado\n* Ropa de cama\n\nTe esperamos.",
    );
    expect(blocks).toEqual([
      { kind: "p", lines: ["Depto luminoso.", "A dos cuadras del Buen Pastor."] },
      { kind: "p", lines: ["Incluye:"] },
      { kind: "ul", items: ["Wifi", "Aire acondicionado", "Ropa de cama"] },
      { kind: "p", lines: ["Te esperamos."] },
    ]);
  });

  it("acepta listas numeradas y CRLF, y no confunde un guion pegado", () => {
    expect(descriptionBlocks("1. Llegás\r\n2) Te damos las llaves\r\nCheck-out 10 h")).toEqual([
      { kind: "ul", items: ["Llegás", "Te damos las llaves"] },
      { kind: "p", lines: ["Check-out 10 h"] },
    ]);
    expect(descriptionBlocks("-sin espacio")).toEqual([{ kind: "p", lines: ["-sin espacio"] }]);
  });

  it("vacío → sin bloques", () => {
    expect(descriptionBlocks(null)).toEqual([]);
    expect(descriptionBlocks("  \n\n ")).toEqual([]);
  });
});

describe("otros lugares", () => {
  const mk = (id: string, hood: string | null, bedrooms: number | null, offers_short = true, offers_monthly = false) => ({
    id,
    hood_slug: hood,
    bedrooms,
    offers_short,
    offers_monthly,
  });
  const current = mk("x", "nueva-cordoba", 1);

  it("prioriza el mismo barrio y excluye la unidad actual", () => {
    const catalog = [mk("a", "centro", 1), mk("x", "nueva-cordoba", 1), mk("b", "nueva-cordoba", 2), mk("c", "nueva-cordoba", 0), mk("d", "nueva-cordoba", 1), mk("e", "nueva-cordoba", 3)];
    const r = pickSimilarListings(catalog, current);
    expect(r.items.map((l) => l.id)).toEqual(["b", "c", "d", "e"]);
    expect(r.sameHoodOnly).toBe(true);
  });

  it("completa con parecidos (mismo modo, ±1 dormitorio) y después con el resto", () => {
    const catalog = [mk("m", "centro", 1, false, true), mk("far", "centro", 4), mk("b", "nueva-cordoba", 2), mk("near", "guemes", 2), mk("z", "alberdi", 0)];
    const r = pickSimilarListings(catalog, current);
    expect(r.items.map((l) => l.id)).toEqual(["b", "near", "z", "m"]);
    expect(r.sameHoodOnly).toBe(false);
  });

  it("sin otros lugares → vacío", () => {
    expect(pickSimilarListings([current], current)).toEqual({ items: [], sameHoodOnly: false });
  });
});

describe("SEO de la ficha", () => {
  const base = {
    display_title: "Paraná",
    hood: "Nueva Córdoba",
    summary_line: "Depto de 1 dormitorio en Nueva Córdoba",
    max_guests: 2,
    instant_book: false,
    offers_short: true,
  };
  it("título con barrio", () => {
    expect(listingMetaTitle(base)).toBe("Paraná · Nueva Córdoba");
    expect(listingMetaTitle({ ...base, hood: null })).toBe("Paraná");
  });
  it("descripción según cómo se reserva", () => {
    expect(listingMetaDescription(base)).toBe(
      "Depto de 1 dormitorio en Nueva Córdoba para hasta 2 huéspedes. Pedí tus fechas sin pagar nada.",
    );
    expect(listingMetaDescription({ ...base, instant_book: true, max_guests: 1 })).toBe(
      "Depto de 1 dormitorio en Nueva Córdoba para 1 huésped. Reservá al instante sin pagar nada por adelantado.",
    );
    expect(listingMetaDescription({ ...base, offers_short: false, max_guests: null })).toBe(
      "Depto de 1 dormitorio en Nueva Córdoba. Estadías por mes: consultá precio y condiciones.",
    );
  });
  it("og:image: la portada por el endpoint de transformación, recortada a 1200×630", () => {
    const cover = "https://abc.supabase.co/storage/v1/object/public/unit-photos/org/unit/cover.jpg";
    expect(listingOgImageUrl(cover)).toBe(
      "https://abc.supabase.co/storage/v1/render/image/public/unit-photos/org/unit/cover.jpg?width=1200&height=630&resize=cover&quality=75",
    );
    // Una query previa no rompe la URL (se agregan los parámetros).
    expect(listingOgImageUrl(`${cover}?v=2`)).toBe(
      "https://abc.supabase.co/storage/v1/render/image/public/unit-photos/org/unit/cover.jpg?v=2&width=1200&height=630&resize=cover&quality=75",
    );
    // Lo que no es un objeto público de Supabase no se transforma: va la imagen de marca.
    expect(listingOgImageUrl("https://abc.supabase.co/storage/v1/object/sign/unit-photos/x.jpg?token=t")).toBeNull();
    expect(listingOgImageUrl("/apart/og.jpg")).toBeNull();
    expect(listingOgImageUrl(null)).toBeNull();
    expect(BRAND_OG_IMAGE).toMatchObject({ url: "/apart/og.jpg", width: 1200, height: 630 });
  });
});
