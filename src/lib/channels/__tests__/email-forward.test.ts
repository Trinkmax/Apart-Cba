import { describe, expect, it } from "vitest";
import { unwrapForwardedEmail } from "@/lib/channels/email-forward";
import { normalizeInboundEmail } from "@/lib/channels/email-adapter";

// Reenvío manual desde Gmail (español) de una confirmación de Airbnb: el caso
// de Viaggiato del 12/11/2026, con el cuerpo de la confirmación de los tests
// del parser.
const FORWARDED = {
  from: "Viaggiato <viaggiatos@gmail.com>",
  to: "ota-abc123@inbound.apartcba.com",
  subject: "Fwd: Reserva confirmada: Kevin Randle Adkins llega el 12 nov.",
  html: "",
  text: [
    "---------- Forwarded message ---------",
    "De: Airbnb <automated@airbnb.com>",
    "Date: jue, 12 nov 2026 a las 09:05",
    "Subject: Reserva confirmada: Kevin Randle Adkins llega el 12 nov.",
    "To: <viaggiatos@gmail.com>",
    "",
    "New reservation confirmed!",
    "Guest: Kevin Randle Adkins",
    "Check-in: 2026-11-12",
    "Check-out: 2026-11-15",
    "Confirmation code: HMX2RWK4SA",
  ].join("\n"),
};

describe("unwrapForwardedEmail", () => {
  it("toma el remitente original y saca el prefijo del asunto", () => {
    const u = unwrapForwardedEmail(FORWARDED);
    expect(u.from).toBe("automated@airbnb.com");
    expect(u.subject).toBe("Reserva confirmada: Kevin Randle Adkins llega el 12 nov.");
    expect(u.text).toBe(FORWARDED.text);
  });

  it("acepta prefijos repetidos y el reenvío de Outlook en español", () => {
    const u = unwrapForwardedEmail({ ...FORWARDED, subject: "RV: Fwd: ¡Reserva cancelada! (123)" });
    expect(u.subject).toBe("¡Reserva cancelada! (123)");
  });

  it("no toca un mail que no es reenvío", () => {
    const direct = { ...FORWARDED, subject: "Reserva confirmada: Ana llega el 3 dic." };
    expect(unwrapForwardedEmail(direct)).toBe(direct);
  });

  it("no toca un reenvío que no viene de una OTA", () => {
    const other = {
      ...FORWARDED,
      text: "---------- Forwarded message ---------\nDe: Juan <juan@gmail.com>\nHola",
    };
    expect(unwrapForwardedEmail(other)).toBe(other);
  });
});

describe("normalizeInboundEmail con un reenvío manual", () => {
  it("la confirmación reenviada a mano se lee como la original", () => {
    const n = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-fwd",
      email: FORWARDED,
    });
    expect(n.parserUsed).toBe("airbnb");
    expect(n.event?.eventType).toBe("reservation_upsert");
    expect(n.event?.confirmationCode).toBe("HMX2RWK4SA");
    expect(n.event?.checkIn).toBe("2026-11-12");
    expect(n.event?.checkOut).toBe("2026-11-15");
    expect(n.event?.guest?.name).toBe("Kevin Randle Adkins");
  });
});
