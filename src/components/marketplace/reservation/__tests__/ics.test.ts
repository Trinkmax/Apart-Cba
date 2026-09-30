import { describe, expect, it } from "vitest";
import { buildStayIcs, escapeIcsText, foldIcsLine, icsFileName } from "../ics";

describe("buildStayIcs", () => {
  const ics = buildStayIcs({
    uid: "req-123",
    title: "Estadía en Paraná, apart",
    checkIn: "2026-10-30",
    checkOut: "2026-11-02",
    location: "Paraná 123; Nueva Córdoba",
    description: "Check-in de 14 a 22 h\nCódigo AP-7F3K2Q",
    url: "https://www.apartcba.com/reserva/abc",
    now: new Date("2026-09-29T12:34:56.789Z"),
  });

  it("evento de día completo que incluye el día de salida", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261030");
    expect(ics).toContain("DTEND;VALUE=DATE:20261103");
    expect(ics).toContain("DTSTAMP:20260929T123456Z");
    expect(ics).toContain("UID:req-123@apartcba.com");
  });

  it("escapa texto y usa CRLF", () => {
    expect(ics).toContain("SUMMARY:Estadía en Paraná\\, apart");
    expect(ics).toContain("LOCATION:Paraná 123\; Nueva Córdoba");
    expect(ics).toContain("DESCRIPTION:Check-in de 14 a 22 h\\nCódigo AP-7F3K2Q");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("cruza fin de año", () => {
    const x = buildStayIcs({ uid: "u", title: "t", checkIn: "2026-12-29", checkOut: "2026-12-31" });
    expect(x).toContain("DTEND;VALUE=DATE:20270101");
  });
});

describe("helpers", () => {
  it("escapeIcsText", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\;c\\,d\\ne");
  });

  it("foldIcsLine corta a 75 octetos sin partir caracteres", () => {
    const long = "DESCRIPTION:" + "ñ".repeat(80);
    const folded = foldIcsLine(long);
    const enc = new TextEncoder();
    for (const part of folded.split("\r\n")) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replaceAll("\r\n ", "")).toBe(long);
  });

  it("icsFileName", () => {
    expect(icsFileName("AP-7F3K2Q")).toBe("apart-AP-7F3K2Q.ics");
    expect(icsFileName("///")).toBe("apart-reserva.ics");
  });
});
