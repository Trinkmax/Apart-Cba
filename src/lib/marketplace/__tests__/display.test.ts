import { describe, expect, it } from "vitest";
import {
  bedroomsLabel,
  canonicalNeighborhood,
  cancellationCopy,
  cancellationFollowUpCopy,
  checkInWindowLabel,
  digitsOnly,
  displayTitle,
  formatHour,
  formatPhoneAR,
  guestsLabel,
  listingSummaryLine,
  neighborhoodSlug,
  titleCaseEs,
  whatsappLink,
} from "@/lib/marketplace/display";

/** Casos tomados de las 45 unidades publicadas de Apart CBA (28/09/2026). */
describe("displayTitle", () => {
  it.each([
    ["PASO DE LOS ANDES 2", "Paso de los Andes 2", null],
    ["PARANA -Nueva Córdoba ", "Paraná", null],
    ["DUOMO -Nueva Cordoba-", "Duomo", null],
    ["GARZON -Nueva Cordoba", "Garzón", null],
    ["ARTIGAS -Alberdi-", "Artigas", null],
    ["ROMA - General Paz", "Roma", null],
    ["SARACHAGA - Alta Cordoba", "Sarachaga", null],
    ["QUIROS -Pleno Centro-", "Quirós", null],
    ["PERON 2 -Futura Pilay", "Perón 2", "Futura Pilay"],
    ["DIVA -Complejo-", "Diva", "Complejo"],
    ["CAÑADA -Nueva Cordoba-", "Cañada", null],
    ["RONDEAU II", "Rondeau II", null],
    ["VELEZ 1 -Nueva Cordoba", "Vélez 1", null],
    ["DEAN FUNES 925 7-A", "Deán Funes 925 7-A", null],
    ["SANTIAGO DEL ESTERO PB", "Santiago del Estero PB", null],
    ["JACINTO RIOS ", "Jacinto Ríos", null],
    ["24 DE SEPTIEMBRE", "24 de Septiembre", null],
    ["BUENOS AIRES 412 -Nueva Cordoba", "Buenos Aires 412", null],
    ["ARTURO M BAS", "Arturo M Bas", null],
  ])("%s → %s", (raw, title, tagline) => {
    expect(displayTitle(raw)).toEqual({ title, tagline });
  });

  it("respeta los títulos escritos a mano (sólo corrige lo que viene en mayúsculas)", () => {
    expect(displayTitle("1 dormitorio amoblado en Villa Belgrano")).toEqual({
      title: "1 dormitorio amoblado en Villa Belgrano",
      tagline: null,
    });
    expect(displayTitle("penthouse con terraza y parrilla propia")).toEqual({
      title: "Penthouse con terraza y parrilla propia",
      tagline: null,
    });
    expect(displayTitle("Loft luminoso - Nueva Córdoba")).toEqual({ title: "Loft luminoso", tagline: null });
  });

  it("vacío → Departamento", () => {
    expect(displayTitle("   ")).toEqual({ title: "Departamento", tagline: null });
    expect(displayTitle(null)).toEqual({ title: "Departamento", tagline: null });
  });
});

describe("canonicalNeighborhood", () => {
  it.each([
    ["NUEVA CORDOBA", "Nueva Córdoba"],
    ["Nueva Córdoba", "Nueva Córdoba"],
    ["NUEVA CORDBA", "Nueva Córdoba"],
    ["Centro ", "Centro"],
    ["CENTRO", "Centro"],
    ["ALBERDI", "Alberdi"],
    ["ALTO ALBERDI", "Alto Alberdi"],
    ["Alta Cordoba", "Alta Córdoba"],
    ["GUEMES", "Güemes"],
    ["GENERAL PAZ", "General Paz"],
    ["CRISOL", "Crisol"],
    ["Cofico", "Cofico"],
    ["barrio desconocido", "Barrio Desconocido"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalNeighborhood(raw)).toBe(expected);
  });
  it("vacío → null; slug estable", () => {
    expect(canonicalNeighborhood("  ")).toBeNull();
    expect(neighborhoodSlug("NUEVA CORDBA")).toBe("nueva-cordoba");
    expect(neighborhoodSlug("Güemes")).toBe("guemes");
  });
});

describe("titleCaseEs", () => {
  it("minúsculas para conectores salvo al inicio", () => {
    expect(titleCaseEs("DE LOS ANDES")).toBe("De los Andes");
  });
});

describe("etiquetas de capacidad", () => {
  it("dormitorios y huéspedes", () => {
    expect(bedroomsLabel(0)).toBe("Monoambiente");
    expect(bedroomsLabel(1)).toBe("1 dormitorio");
    expect(bedroomsLabel(3)).toBe("3 dormitorios");
    expect(bedroomsLabel(null)).toBeNull();
    expect(guestsLabel(4)).toBe("Hasta 4 huéspedes");
    expect(guestsLabel(0)).toBeNull();
  });
  it("frase descriptiva", () => {
    expect(listingSummaryLine({ bedrooms: 0, neighborhood: "CENTRO" })).toBe("Monoambiente en Centro");
    expect(listingSummaryLine({ bedrooms: 2, neighborhood: "NUEVA CORDBA" })).toBe("Depto de 2 dormitorios en Nueva Córdoba");
    expect(listingSummaryLine({ bedrooms: null, neighborhood: null })).toBe("Departamento");
  });
});

describe("horarios", () => {
  it("formatHour", () => {
    expect(formatHour("14:00:00")).toBe("14 h");
    expect(formatHour("14:30")).toBe("14:30 h");
    expect(formatHour("00:00:00")).toBe("medianoche");
    expect(formatHour("12:00")).toBe("mediodía");
    expect(formatHour(null)).toBeNull();
    expect(formatHour("bla")).toBeNull();
  });
  it("ventana de check-in", () => {
    expect(checkInWindowLabel("14:00:00", "22:00:00")).toBe("de 14 a 22 h");
    expect(checkInWindowLabel("14:00:00", "00:00:00")).toBe("desde las 14 h hasta la medianoche");
    expect(checkInWindowLabel("15:00:00", null)).toBe("desde las 15 h");
    expect(checkInWindowLabel(null, "22:00")).toBeNull();
  });
});

describe("cancelación", () => {
  it("respeta la política elegida en el editor de la unidad", () => {
    expect(cancellationCopy("flexible").body).toContain("24 horas");
    expect(cancellationCopy("moderada").body).toContain("50 %");
    expect(cancellationCopy("estricta").title).toBe("Cancelación estricta");
  });
  it("el texto propio de la organización reemplaza todo", () => {
    expect(cancellationCopy("estricta", "  La seña no se devuelve.  ")).toEqual({
      title: "Política de cancelación",
      body: "La seña no se devuelve.",
    });
  });
});

describe("cancellationFollowUpCopy", () => {
  it("con el pedido pendiente: se cancela gratis desde el link y anticipa la regla", () => {
    const c = cancellationFollowUpCopy("estricta", null, "pending");
    expect(c.title).toBe("Cancelación estricta");
    expect(c.body).toContain("lo cancelás sin costo desde este link");
    expect(c.body).toContain("Una vez confirmada: si cancelás, la seña no tiene reintegro.");
    expect(c.body).not.toContain("antes de pedirla");
  });
  it("ya confirmada: la regla de la política y cómo cancelar", () => {
    expect(cancellationFollowUpCopy("estricta", null, "confirmed").body).toBe(
      "Si cancelás, la seña no tiene reintegro. Si necesitás cambiar algo, escribinos y vemos cómo ayudarte.",
    );
    expect(cancellationFollowUpCopy("flexible", null, "confirmed").body).toBe(
      "Podés cancelar sin cargo hasta 24 horas antes del check-in. Para cancelar, escribinos.",
    );
    expect(cancellationFollowUpCopy("moderada", undefined, "confirmed").body).toContain("50 %");
  });
  it("sin política cargada se trata como estricta", () => {
    expect(cancellationFollowUpCopy(null, null, "confirmed").title).toBe("Cancelación estricta");
  });
  it("el texto propio de la organización manda en los dos momentos", () => {
    expect(cancellationFollowUpCopy("flexible", " La seña no se devuelve. ", "confirmed")).toEqual({
      title: "Política de cancelación",
      body: "La seña no se devuelve.\nPara cancelar, escribinos.",
    });
    expect(cancellationFollowUpCopy("flexible", "La seña no se devuelve.", "pending").body).toContain(
      "Una vez confirmada: La seña no se devuelve.",
    );
  });
});

describe("contacto", () => {
  it("whatsapp", () => {
    expect(digitsOnly("+54 9 351 563-9985")).toBe("5493515639985");
    expect(whatsappLink("+54 9 351 563-9985")).toBe("https://wa.me/5493515639985");
    expect(whatsappLink("5493515639985", "Hola, quiero consultar")).toBe(
      "https://wa.me/5493515639985?text=Hola%2C%20quiero%20consultar",
    );
    expect(whatsappLink("123")).toBeNull();
    expect(formatPhoneAR("5493515639985")).toBe("+54 9 351 563-9985");
  });
});
