import { describe, expect, it } from "vitest";
import { activeRentalsSection, RENTALS_SECTIONS } from "../nav";

describe("activeRentalsSection", () => {
  it("marca el Resumen sólo en la portada del módulo", () => {
    expect(activeRentalsSection("/dashboard/alquileres")).toBe("resumen");
    expect(activeRentalsSection("/dashboard/alquileres/")).toBe("resumen");
  });

  it("las fichas y formularios marcan su sección", () => {
    expect(activeRentalsSection("/dashboard/alquileres/contratos")).toBe("contratos");
    expect(activeRentalsSection("/dashboard/alquileres/contratos/nuevo")).toBe("contratos");
    expect(activeRentalsSection("/dashboard/alquileres/contratos/2f1c/editar")).toBe("contratos");
    expect(activeRentalsSection("/dashboard/alquileres/rendiciones/abc")).toBe("rendiciones");
    expect(activeRentalsSection("/dashboard/alquileres/propiedades/abc")).toBe("propiedades");
    expect(activeRentalsSection("/dashboard/alquileres/personas/abc")).toBe("personas");
  });

  it("fuera del módulo no marca nada", () => {
    expect(activeRentalsSection("/dashboard")).toBeNull();
    expect(activeRentalsSection("/dashboard/caja")).toBeNull();
    // Un prefijo parecido no es el módulo.
    expect(activeRentalsSection("/dashboard/alquileres-viejos")).toBeNull();
    expect(activeRentalsSection("/dashboard/alquileres/otra-cosa")).toBeNull();
  });

  it("no confunde secciones que empiezan igual", () => {
    expect(activeRentalsSection("/dashboard/alquileres/contratosx")).toBeNull();
  });

  it("cada sección tiene una ruta distinta y la portada va primero", () => {
    const hrefs = RENTALS_SECTIONS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(RENTALS_SECTIONS[0].key).toBe("resumen");
  });
});
