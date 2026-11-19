import { describe, expect, it } from "vitest";
import {
  bornNearNotice,
  pickNoticeForReservation,
  pickReservationForNotice,
  type NoticeCandidate,
} from "../reference-match";

const row = (over: Partial<NoticeCandidate>): NoticeCandidate => ({
  id: "r",
  check_in: "2026-12-04",
  confirmation_code: null,
  external_status: "active",
  created_at: "2026-11-18T00:14:06Z",
  ...over,
});

describe("bornNearNotice", () => {
  it("la fila nace unos minutos después del aviso", () => {
    expect(bornNearNotice("2026-11-18T00:14:06Z", "2026-11-18T00:12:37Z")).toBe(true);
  });

  it("o unos segundos antes, si el mail llegó con demora", () => {
    expect(bornNearNotice("2026-10-28T22:20:04Z", "2026-10-28T22:20:14Z")).toBe(true);
  });

  it("una fila de hace semanas no es la reserva nueva", () => {
    expect(bornNearNotice("2026-09-24T22:38:02Z", "2026-11-18T00:12:37Z")).toBe(false);
  });

  it("ni una que aparece tres horas después", () => {
    expect(bornNearNotice("2026-11-18T03:32:07Z", "2026-11-18T00:12:37Z")).toBe(false);
  });

  it("fechas ilegibles no cruzan nada", () => {
    expect(bornNearNotice("", "2026-11-18T00:12:37Z")).toBe(false);
  });
});

describe("pickReservationForNotice", () => {
  const notice = { checkIn: "2026-12-04", receivedAt: "2026-11-18T00:12:37Z" };

  // Apart CBA, 18/11/2026: el número de la reserva nueva de VEL727 fue a parar
  // a la de DIVA, que estaba cargada desde septiembre con la misma llegada.
  it("elige la que nació con el aviso, no la vieja con la misma llegada", () => {
    const diva = row({ id: "diva", created_at: "2026-09-24T22:38:02Z" });
    const vel727 = row({ id: "vel727", created_at: "2026-11-18T00:14:06Z" });
    expect(pickReservationForNotice([diva, vel727], notice)?.id).toBe("vel727");
  });

  it("si la reserva todavía no entró por el calendario, no le pone el número a nadie", () => {
    const diva = row({ id: "diva", created_at: "2026-09-24T22:38:02Z" });
    expect(pickReservationForNotice([diva], notice)).toBeNull();
  });

  it("no toca una reserva que ya tiene número", () => {
    const con = row({ id: "con", confirmation_code: "5699275507" });
    expect(pickReservationForNotice([con], notice)).toBeNull();
  });

  it("ni una que llega otro día", () => {
    expect(pickReservationForNotice([row({ check_in: "2026-12-05" })], notice)).toBeNull();
  });

  it("ni una cancelada", () => {
    expect(pickReservationForNotice([row({ external_status: "cancelled" })], notice)).toBeNull();
  });

  it("dos nacidas con el aviso: no adivina", () => {
    const a = row({ id: "a", created_at: "2026-11-18T00:14:06Z" });
    const b = row({ id: "b", created_at: "2026-11-18T00:16:02Z" });
    expect(pickReservationForNotice([a, b], notice)).toBeNull();
  });

  it("…salvo que una ya esté descartada", () => {
    const viva = row({ id: "viva", external_status: "pending" });
    const caida = row({ id: "caida", external_status: "expired", created_at: "2026-11-18T00:16:02Z" });
    expect(pickReservationForNotice([viva, caida], notice)?.id).toBe("viva");
  });

  it("una sola, aunque esté descartada: el aviso es la confirmación", () => {
    const caida = row({ id: "caida", external_status: "expired" });
    expect(pickReservationForNotice([caida], notice)?.id).toBe("caida");
  });
});

describe("pickNoticeForReservation", () => {
  const born = { created_at: "2026-11-18T03:32:07Z" };

  it("toma el aviso que llegó cuando nació la reserva", () => {
    const notices = [
      { code: "5636765091", receivedAt: "2026-11-18T00:12:37Z" }, // el de VEL727, tres horas antes
      { code: "5699275507", receivedAt: "2026-11-18T03:31:08Z" },
    ];
    expect(pickNoticeForReservation(notices, born, new Set())).toBe("5699275507");
  });

  it("ignora los avisos de hace semanas para la misma llegada", () => {
    const notices = [{ code: "5465034739", receivedAt: "2026-09-24T22:32:52Z" }];
    expect(pickNoticeForReservation(notices, born, new Set())).toBeNull();
  });

  it("un número que ya está en otra reserva no se repite", () => {
    const notices = [{ code: "5699275507", receivedAt: "2026-11-18T03:31:08Z" }];
    expect(pickNoticeForReservation(notices, born, new Set(["5699275507"]))).toBeNull();
  });

  it("el mismo aviso recibido dos veces cuenta una", () => {
    const notices = [
      { code: "5699275507", receivedAt: "2026-11-18T03:31:08Z" },
      { code: "5699275507", receivedAt: "2026-11-18T03:31:40Z" },
    ];
    expect(pickNoticeForReservation(notices, born, new Set())).toBe("5699275507");
  });

  it("dos avisos distintos en la ventana: no adivina", () => {
    const notices = [
      { code: "1111111111", receivedAt: "2026-11-18T03:31:08Z" },
      { code: "2222222222", receivedAt: "2026-11-18T03:29:00Z" },
    ];
    expect(pickNoticeForReservation(notices, born, new Set())).toBeNull();
  });
});
