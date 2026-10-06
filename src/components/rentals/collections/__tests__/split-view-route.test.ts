import { describe, expect, it } from "vitest";
import { splitDirectPayment, type SplitLine, type SplitOwner } from "@/lib/rentals/payment-split";
import {
  ownerPartNote,
  routeNoteText,
  routeReady,
  successOwnerLines,
  withRouteNote,
} from "@/components/rentals/collections/split-view";
import { plainMoney } from "@/components/rentals/collections/messages";

const rent = (amount: number): SplitLine => ({ kind: "alquiler", payee: "propietario", amount });
const solo: SplitOwner[] = [{ ownerId: "o1", name: "Ulises Rojas", pct: 100, isPrimary: true }];
const split = splitDirectPayment({ total: 1_000_000, lines: [rent(1_000_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });

describe("cómo pagó el inquilino", () => {
  it("sin elegir no se registra; «todo al propietario» sólo cuando ya le pasó la parte a la inmobiliaria", () => {
    expect(routeReady(null, true)).toBe(false);
    expect(routeReady("cada_uno", false)).toBe(true);
    expect(routeReady("todo_inmobiliaria", false)).toBe(true);
    expect(routeReady("todo_propietario", false)).toBe(false);
    expect(routeReady("todo_propietario", true)).toBe(true);
  });

  it("la nota de la parte del propietario no dice «transfiere» si pagó en efectivo, y sigue al camino elegido", () => {
    expect(ownerPartNote(null, "transferencia", "Apart CBA")).toBe("Lo transfiere el inquilino directo a su cuenta: no entra a la Caja de Apart CBA.");
    expect(ownerPartNote("cada_uno", "efectivo", "Apart CBA")).toBe("Lo paga el inquilino directo: no entra a la Caja de Apart CBA.");
    expect(ownerPartNote("todo_propietario", "transferencia", "Apart CBA")).toBe("Lo recibió el propietario: no entra a la Caja de Apart CBA.");
    expect(ownerPartNote("todo_inmobiliaria", "mp", "Apart CBA")).toBe("Entró a Apart CBA, pero es del propietario: no se carga en Caja.");
  });

  it("deja una línea en la nota interna sólo si no le pagó a cada uno su parte", () => {
    expect(split.owner.total).toBe(920_000);
    expect(split.agency.total).toBe(80_000);
    expect(routeNoteText("cada_uno", split, "Apart CBA", "ARS")).toBe("");
    expect(routeNoteText(null, split, "Apart CBA", "ARS")).toBe("");
    expect(routeNoteText("todo_propietario", split, "Apart CBA", "ARS")).toBe(
      `El inquilino le pagó todo al propietario y él le pasó ${plainMoney(80_000, "ARS")} a Apart CBA.`,
    );
    expect(routeNoteText("todo_inmobiliaria", split, "Apart CBA", "ARS")).toBe(
      `El inquilino le pagó todo a Apart CBA: hay que pasarle ${plainMoney(920_000, "ARS")} al propietario (no se cargan en Caja).`,
    );
  });
});

describe("nota interna con el camino", () => {
  it("suma la línea a lo que escribió la persona", () => {
    expect(withRouteNote("", "")).toBeNull();
    expect(withRouteNote("  ", "")).toBeNull();
    expect(withRouteNote(null, "Pagó todo.")).toBe("Pagó todo.");
    expect(withRouteNote(" Trajo el comprobante ", "")).toBe("Trajo el comprobante");
    expect(withRouteNote("Trajo el comprobante", "Pagó todo.")).toBe("Trajo el comprobante · Pagó todo.");
  });

  it("nunca pasa del máximo que acepta el servidor: recorta lo escrito, no la línea del camino", () => {
    const route = "El inquilino le pagó todo al propietario.";
    const out = withRouteNote("x".repeat(500), route) ?? "";
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith(` · ${route}`)).toBe(true);
    expect(out).toContain("…");
    expect(withRouteNote("hola", "y".repeat(600))?.length).toBe(500);
  });
});

describe("resumen del cobro registrado", () => {
  it("si entró todo a la inmobiliaria, avisa que hay que pasarle su parte al propietario", () => {
    expect(successOwnerLines("todo_inmobiliaria", "Ulises Rojas", "Apart CBA")).toEqual({
      title: "Para Ulises Rojas",
      note: "Entró a Apart CBA: pasáselo al propietario. No se carga en Caja.",
      warn: true,
    });
    expect(successOwnerLines("cada_uno", "Ulises Rojas", "Apart CBA").title).toBe("Directo a Ulises Rojas");
    expect(successOwnerLines(null, "", "Apart CBA").title).toBe("Directo al propietario");
    expect(successOwnerLines("todo_inmobiliaria", "  ", "Apart CBA").title).toBe("Para el propietario");
    expect(successOwnerLines("todo_propietario", "Ulises Rojas", "Apart CBA").warn).toBe(false);
  });
});
