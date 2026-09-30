import { describe, expect, it } from "vitest";
import {
  canReportPayment,
  deriveGuestStage,
  isActiveStage,
  STAGE_COPY,
  stageTimeline,
  type GuestStage,
} from "@/lib/marketplace/guest-stage";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const FUTURE = "2026-10-02T12:00:00.000Z";
const PAST = "2026-09-30T12:00:00.000Z";

describe("deriveGuestStage — solicitudes", () => {
  const base = { sena: null, hasPendingPaymentReport: false, now: NOW };
  it("pendiente vigente → pedido enviado", () => {
    expect(deriveGuestStage({ ...base, request: { status: "pendiente", expires_at: FUTURE } })).toBe("pedido_enviado");
  });
  it("pendiente con el plazo cumplido (el barrido todavía no pasó) → vencido", () => {
    expect(deriveGuestStage({ ...base, request: { status: "pendiente", expires_at: PAST } })).toBe("pedido_vencido");
  });
  it("expirada / rechazada / cancelada", () => {
    expect(deriveGuestStage({ ...base, request: { status: "expirada", expires_at: PAST } })).toBe("pedido_vencido");
    expect(deriveGuestStage({ ...base, request: { status: "rechazada", expires_at: FUTURE } })).toBe("pedido_rechazado");
    expect(deriveGuestStage({ ...base, request: { status: "cancelada", expires_at: FUTURE } })).toBe("pedido_cancelado");
  });
  it("aprobada sin reserva a la vista → no está activa", () => {
    expect(deriveGuestStage({ ...base, request: { status: "aprobada", expires_at: FUTURE } })).toBe("reserva_cancelada");
  });
});

describe("deriveGuestStage — reservas", () => {
  it("confirmada con seña sin cubrir → falta la seña; con aviso → verificando", () => {
    const booking = { status: "confirmada" as const, paid_amount: 0 };
    expect(deriveGuestStage({ booking, sena: 70_000, hasPendingPaymentReport: false, now: NOW })).toBe("sena_pendiente");
    expect(deriveGuestStage({ booking, sena: 70_000, hasPendingPaymentReport: true, now: NOW })).toBe("sena_informada");
  });
  it("seña cubierta o sin seña → asegurada", () => {
    expect(
      deriveGuestStage({ booking: { status: "confirmada", paid_amount: 70_000 }, sena: 70_000, hasPendingPaymentReport: false }),
    ).toBe("reserva_asegurada");
    expect(
      deriveGuestStage({ booking: { status: "confirmada", paid_amount: 0 }, sena: null, hasPendingPaymentReport: false }),
    ).toBe("reserva_asegurada");
  });
  it("la reserva manda sobre la solicitud", () => {
    expect(
      deriveGuestStage({
        request: { status: "aprobada", expires_at: PAST },
        booking: { status: "check_in", paid_amount: 10 },
        sena: 70_000,
        hasPendingPaymentReport: false,
      }),
    ).toBe("estadia_en_curso");
  });
  it("finalizada / cancelada / no show", () => {
    const s = (status: "check_out" | "cancelada" | "no_show") =>
      deriveGuestStage({ booking: { status, paid_amount: 0 }, sena: null, hasPendingPaymentReport: false });
    expect(s("check_out")).toBe("estadia_finalizada");
    expect(s("cancelada")).toBe("reserva_cancelada");
    expect(s("no_show")).toBe("reserva_cancelada");
  });
});

describe("deriveGuestStage — las fechas mandan (el PMS no avanza estados solo)", () => {
  // NOW = 2026-10-01 12:00 UTC → hoy en Argentina = 2026-10-01.
  const confirmada = { status: "confirmada" as const, paid_amount: 0 };
  it("confirmada sin seña cubierta, pero la llegada ya llegó → en curso (no se pide más la seña)", () => {
    expect(
      deriveGuestStage({ booking: confirmada, sena: 70_000, hasPendingPaymentReport: false, stay: { checkIn: "2026-10-01", checkOut: "2026-10-04" }, now: NOW }),
    ).toBe("estadia_en_curso");
  });
  it("el día de salida sigue en curso; desde el día siguiente, finalizada", () => {
    const booking = { status: "check_in" as const, paid_amount: 0 };
    expect(deriveGuestStage({ booking, sena: null, hasPendingPaymentReport: false, stay: { checkIn: "2026-09-28", checkOut: "2026-10-01" }, now: NOW })).toBe("estadia_en_curso");
    expect(deriveGuestStage({ booking, sena: null, hasPendingPaymentReport: false, stay: { checkIn: "2026-09-25", checkOut: "2026-09-30" }, now: NOW })).toBe("estadia_finalizada");
    expect(deriveGuestStage({ booking: confirmada, sena: 70_000, hasPendingPaymentReport: false, stay: { checkIn: "2026-09-25", checkOut: "2026-09-30" }, now: NOW })).toBe("estadia_finalizada");
  });
  it("antes de llegar sigue la lógica de la seña", () => {
    expect(deriveGuestStage({ booking: confirmada, sena: 70_000, hasPendingPaymentReport: false, stay: { checkIn: "2026-10-10", checkOut: "2026-10-13" }, now: NOW })).toBe("sena_pendiente");
  });
  it("pedido pendiente cuya llegada ya pasó → vencido aunque no haya vencido el plazo", () => {
    expect(deriveGuestStage({ request: { status: "pendiente", expires_at: FUTURE }, sena: null, hasPendingPaymentReport: false, stay: { checkIn: "2026-10-01", checkOut: "2026-10-03" }, now: NOW })).toBe("pedido_vencido");
  });
  it("hoy en Argentina, no en UTC: 2026-10-02 01:00 UTC todavía es 1/10 en Córdoba", () => {
    const late = new Date("2026-10-02T01:00:00.000Z");
    expect(deriveGuestStage({ booking: confirmada, sena: 70_000, hasPendingPaymentReport: false, stay: { checkIn: "2026-10-02", checkOut: "2026-10-05" }, now: late })).toBe("sena_pendiente");
  });
});

describe("stageTimeline", () => {
  const states = (stage: GuestStage, sena = true) => stageTimeline(stage, sena).map((s) => s.state);
  it("marca el paso actual", () => {
    expect(states("pedido_enviado")).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(states("sena_pendiente")).toEqual(["done", "done", "current", "upcoming"]);
    expect(states("reserva_asegurada")).toEqual(["done", "done", "done", "current"]);
    expect(states("estadia_finalizada")).toEqual(["done", "done", "done", "done"]);
  });
  it("un pedido que no prosperó corta en la confirmación", () => {
    expect(states("pedido_rechazado")).toEqual(["done", "failed", "skipped", "skipped"]);
  });
  it("sin seña, el paso se saltea", () => {
    expect(states("reserva_asegurada", false)).toEqual(["done", "done", "skipped", "current"]);
  });
  it("las etiquetas son las del proceso real", () => {
    expect(stageTimeline("pedido_enviado", true).map((s) => s.label)).toEqual(["Pedido", "Confirmación", "Seña", "Llegada"]);
  });
});

describe("copys y banderas", () => {
  it("toda etapa tiene copy completo", () => {
    for (const [stage, copy] of Object.entries(STAGE_COPY)) {
      expect(copy.title, stage).toBeTruthy();
      expect(copy.body, stage).toBeTruthy();
      expect(copy.pill, stage).toBeTruthy();
    }
  });
  it("activas y avisar pago", () => {
    expect(isActiveStage("pedido_enviado")).toBe(true);
    expect(isActiveStage("pedido_vencido")).toBe(false);
    expect(canReportPayment("sena_pendiente")).toBe(true);
    expect(canReportPayment("reserva_asegurada")).toBe(false);
  });
});
