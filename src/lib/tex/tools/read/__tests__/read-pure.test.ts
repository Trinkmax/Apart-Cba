import { describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/types/database";
import type { ToolContext } from "../../../tool";
import { bookingStatusTone, isDeadBooking, num, stayLabel, tzRangeIso, unitLabel } from "../_shared";
import { abrirPantalla } from "../navegar";

const ctx = (role: UserRole): ToolContext => ({
  org: { id: "org", name: "Org", timezone: "America/Argentina/Cordoba", currency: "ARS", rentalsEnabled: true },
  user: { id: "u1", name: "Ana Paz", firstName: "Ana" },
  role,
  today: "2026-11-14",
  tomorrow: "2026-11-15",
  conversationId: "c1",
});

async function open(role: UserRole, pantalla: string) {
  const r = await abrirPantalla.run({ pantalla }, ctx(role));
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("ayudas de lectura", () => {
  it("el rango de días va en la zona de la organización, con los dos días incluidos", () => {
    expect(tzRangeIso("2026-11-01", "2026-11-14", "America/Argentina/Cordoba")).toEqual({
      fromIso: "2026-11-01T03:00:00.000Z",
      toIso: "2026-11-15T02:59:59.999Z",
    });
  });
  it("las fechas de una estadía llevan el año sólo si no es el de hoy", () => {
    expect(stayLabel("2026-11-14", "2026-11-18", "2026-11-14")).toBe("14 al 18 nov");
    expect(stayLabel("2026-12-28", "2027-01-03", "2026-11-14")).toBe("28 dic al 3 ene 2027");
  });
  it("números tolerantes y etiquetas", () => {
    expect(num("1250.5")).toBe(1250.5);
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
    expect(unitLabel({ code: "SAL525", name: "Salta 525" })).toBe("SAL525 · Salta 525");
    expect(unitLabel(null)).toBe("Sin unidad");
    expect(isDeadBooking("no_show")).toBe(true);
    expect(isDeadBooking("pendiente")).toBe(false);
    expect(bookingStatusTone("cancelada")).toBe("bad");
  });
});

describe("abrir_pantalla", () => {
  it("lleva a la pantalla nombrada", async () => {
    expect((await open("admin", "lista de reservas")).navigate?.href).toBe("/dashboard/reservas");
    expect((await open("admin", "reservas")).navigate?.href).toBe("/dashboard/unidades/kanban");
    expect((await open("admin", "liquidaciones de octubre")).navigate?.href).toBe("/dashboard/liquidaciones");
    expect((await open("admin", "dueños")).navigate?.href).toBe("/dashboard/propietarios");
    expect((await open("recepcion", "configuración")).navigate?.href).toBe("/dashboard/configuracion");
  });
  it("sólo ofrece lo que el rol puede abrir", async () => {
    const owner = await open("owner_view", "caja");
    expect(owner.navigate).toBeUndefined();
    expect((owner.data as { pantallas_disponibles: string[] }).pantallas_disponibles).not.toContain("Caja");
    expect((await open("limpieza", "limpieza")).navigate?.href).toBe("/m/limpieza");
    expect((await open("mantenimiento", "arreglos")).navigate?.href).toBe("/m/mantenimiento");
  });
});
