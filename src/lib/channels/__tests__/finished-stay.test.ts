import { describe, expect, it } from "vitest";
import {
  canAdoptWithoutIdentity,
  decideInsertOverLocalStays,
  stayHasEnded,
} from "../finished-stay";

// Habitana, AT4B: Florencia 14→15/11, cargada a mano, cobrada; el reconcile corrió el 16.
const at4b = { checkIn: "2026-11-14", checkOut: "2026-11-15" };
const florencia = { id: "flor", status: "check_out", ...at4b };

describe("stayHasEnded", () => {
  it("el día de la salida la estadía ya terminó", () => {
    expect(stayHasEnded(at4b, "2026-11-15")).toBe(true);
    expect(stayHasEnded(at4b, "2026-11-16")).toBe(true);
  });

  it("la última noche todavía no pasó", () => {
    expect(stayHasEnded(at4b, "2026-11-14")).toBe(false);
  });
});

describe("canAdoptWithoutIdentity", () => {
  it("una local con la salida hecha y las mismas fechas es la misma estadía", () => {
    expect(canAdoptWithoutIdentity("check_out", at4b, "2026-11-14")).toBe(true);
  });

  it("cuando las fechas ya pasaron, aunque nadie haya marcado la salida", () => {
    expect(canAdoptWithoutIdentity("check_in", at4b, "2026-11-16")).toBe(true);
    expect(canAdoptWithoutIdentity("confirmada", at4b, "2026-11-15")).toBe(true);
  });

  it("una reserva viva con plata sigue pidiendo número o nombre", () => {
    expect(canAdoptWithoutIdentity("check_in", at4b, "2026-11-14")).toBe(false);
    expect(canAdoptWithoutIdentity("confirmada", { checkIn: "2026-11-20", checkOut: "2026-11-22" }, "2026-11-16")).toBe(false);
  });
});

describe("decideInsertOverLocalStays", () => {
  it("AT4B: no crea una copia encima de una estadía ya vivida", () => {
    expect(decideInsertOverLocalStays(at4b, [florencia], "2026-11-16")).toEqual({
      action: "skip",
      with: florencia,
    });
  });

  it("sin nada local en esas fechas, se carga", () => {
    expect(decideInsertOverLocalStays(at4b, [], "2026-11-16")).toEqual({ action: "insert" });
  });

  it("las canceladas no cuentan", () => {
    const cancelada = { ...florencia, id: "x", status: "cancelada" };
    const noShow = { ...florencia, id: "y", status: "no_show" };
    expect(decideInsertOverLocalStays(at4b, [cancelada, noShow], "2026-11-16")).toEqual({ action: "insert" });
  });

  it("una estadía pasada que choca con una reserva viva tampoco se carga (y no reabre el conflicto cada noche)", () => {
    const sinSalida = { ...florencia, status: "check_in" };
    expect(decideInsertOverLocalStays(at4b, [sinSalida], "2026-11-16").action).toBe("skip");
  });

  it("sigue en curso y pisa noches que alguien ya durmió: conflicto", () => {
    // La local se fue el 13 (salida hecha) y la OTA informa 12→16 con hoy 14.
    const local = { id: "loc", status: "check_out", checkIn: "2026-11-10", checkOut: "2026-11-13" };
    const ota = { checkIn: "2026-11-12", checkOut: "2026-11-16" };
    expect(decideInsertOverLocalStays(ota, [local], "2026-11-14")).toEqual({ action: "conflict", with: local });
  });

  it("salida anticipada: las noches que liberó se pueden vender", () => {
    // Reservada 10→20, se fue antes; la OTA vende 16→18 y hoy es 16.
    const local = { id: "loc", status: "check_out", checkIn: "2026-11-10", checkOut: "2026-11-20" };
    const ota = { checkIn: "2026-11-16", checkOut: "2026-11-18" };
    expect(decideInsertOverLocalStays(ota, [local], "2026-11-16")).toEqual({ action: "insert" });
  });

  it("lo que pisa una reserva viva en noches que vienen lo sigue frenando la base", () => {
    const viva = { id: "v", status: "confirmada", checkIn: "2026-11-20", checkOut: "2026-11-22" };
    expect(
      decideInsertOverLocalStays({ checkIn: "2026-11-21", checkOut: "2026-11-23" }, [viva], "2026-11-16"),
    ).toEqual({ action: "insert" });
  });

  it("un recambio el mismo día no es un choque", () => {
    const antes = { id: "a", status: "check_out", checkIn: "2026-11-12", checkOut: "2026-11-14" };
    expect(decideInsertOverLocalStays(at4b, [antes], "2026-11-16")).toEqual({ action: "insert" });
  });
});
