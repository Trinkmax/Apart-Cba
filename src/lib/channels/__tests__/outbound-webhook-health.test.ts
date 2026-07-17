import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { buildUnitCalendar } from "@/lib/channels/outbound-ics";
import { verifySvixSignature } from "@/lib/channels/email-webhook";
import { computeLinkHealth } from "@/lib/channels/health";

// ─── fake supabase query builder (encadenable, thenable) ─────────────────────
type Row = Record<string, unknown>;
function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(data: Row[]) {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["select", "eq", "in", "gte", "gt", "lt", "not", "order", "limit"]) {
      b[m] = chain;
    }
    (b as { then: (cb: (r: { data: Row[] }) => unknown) => unknown }).then = (cb) =>
      Promise.resolve(cb({ data }));
    return b;
  }
  return {
    from: (table: string) => builder(tables[table] ?? []),
  } as unknown as Parameters<typeof buildUnitCalendar>[0];
}

const UNIT = { id: "u1", code: "A101", name: "Depto céntrico", organization_id: "org1" };

describe("buildUnitCalendar (export ICS)", () => {
  const bookings = [
    {
      id: "b1",
      source: "directo",
      check_in_date: "2026-08-15",
      check_out_date: "2026-08-18",
      is_block: false,
      updated_at: "2026-07-01T10:00:00Z",
    },
    {
      id: "b2",
      source: "airbnb",
      check_in_date: "2026-09-01",
      check_out_date: "2026-09-03",
      is_block: true,
      updated_at: "2026-07-02T10:00:00Z",
    },
  ];
  const requests = [
    {
      id: "r1",
      check_in_date: "2026-10-01",
      check_out_date: "2026-10-04",
      created_at: "2026-07-03T10:00:00Z",
    },
  ];

  it("incluye bookings, bloqueos y solicitudes vigentes con DTEND exclusivo", async () => {
    const { ics } = await buildUnitCalendar(
      fakeAdmin({ bookings, booking_requests: requests }),
      UNIT,
    );
    expect(ics).toContain("UID:apartcba-b1@apartcba.app");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260815");
    expect(ics).toContain("DTEND;VALUE=DATE:20260818"); // half-open
    expect(ics).toContain("SUMMARY:Bloqueado");
    expect(ics).toContain("UID:apartcba-req-r1@apartcba.app");
    expect(ics).toContain("SUMMARY:Reservado (solicitud pendiente)");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("el ETag es determinista: mismo estado → mismo ETag; cambio → distinto", async () => {
    const a = await buildUnitCalendar(fakeAdmin({ bookings, booking_requests: requests }), UNIT);
    const b = await buildUnitCalendar(fakeAdmin({ bookings, booking_requests: requests }), UNIT);
    expect(a.etag).toBe(b.etag);
    const c = await buildUnitCalendar(
      fakeAdmin({
        bookings: [{ ...bookings[0], check_out_date: "2026-08-19" }],
        booking_requests: requests,
      }),
      UNIT,
    );
    expect(c.etag).not.toBe(a.etag);
  });

  it("calendario vacío sigue siendo un VCALENDAR válido", async () => {
    const { ics } = await buildUnitCalendar(fakeAdmin({}), UNIT);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("verifySvixSignature (webhook Resend)", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key-32-bytes-long!!").toString("base64");
  function sign(id: string, ts: string, body: string): string {
    const secretBytes = Buffer.from(secret.replace("whsec_", ""), "base64");
    const sig = crypto
      .createHmac("sha256", secretBytes)
      .update(`${id}.${ts}.${body}`)
      .digest("base64");
    return `v1,${sig}`;
  }

  it("acepta una firma válida dentro de la ventana", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.received"}';
    expect(
      verifySvixSignature(
        { svixId: "msg_1", svixTimestamp: ts, svixSignature: sign("msg_1", ts, body) },
        body,
        secret,
      ),
    ).toBe(true);
  });

  it("rechaza replay (timestamp fuera de la ventana de 5 min)", () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const body = "{}";
    expect(
      verifySvixSignature(
        { svixId: "msg_1", svixTimestamp: old, svixSignature: sign("msg_1", old, body) },
        body,
        secret,
      ),
    ).toBe(false);
  });

  it("rechaza firmas inválidas y headers ausentes", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySvixSignature(
        { svixId: "msg_1", svixTimestamp: ts, svixSignature: "v1,AAAA" },
        "{}",
        secret,
      ),
    ).toBe(false);
    expect(
      verifySvixSignature({ svixId: null, svixTimestamp: ts, svixSignature: "x" }, "{}", secret),
    ).toBe(false);
  });

  it("rechaza si el body fue alterado (firma sobre el body correcto)", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.received"}';
    expect(
      verifySvixSignature(
        { svixId: "msg_1", svixTimestamp: ts, svixSignature: sign("msg_1", ts, body) },
        '{"type":"email.received","x":1}',
        secret,
      ),
    ).toBe(false);
  });
});

describe("computeLinkHealth", () => {
  const now = new Date().toISOString();
  const base = {
    status: "active" as const,
    last_success_at: now,
    consecutive_failures: 0,
    last_export_access_at: now,
  };

  it("healthy: poll OK reciente sin fallos", () => {
    expect(computeLinkHealth(base)).toBe("healthy");
  });
  it("verifying: activa pero la OTA nunca consultó el export", () => {
    expect(computeLinkHealth({ ...base, last_export_access_at: null })).toBe("verifying");
  });
  it("degraded: 1-2 fallos o >10 min sin éxito", () => {
    expect(computeLinkHealth({ ...base, consecutive_failures: 1 })).toBe("degraded");
    const min15 = new Date(Date.now() - 15 * 60_000).toISOString();
    expect(computeLinkHealth({ ...base, last_success_at: min15 })).toBe("degraded");
  });
  it("critical: ≥3 fallos, >30 min sin éxito, o incidencia crítica", () => {
    expect(computeLinkHealth({ ...base, consecutive_failures: 3 })).toBe("critical");
    const min45 = new Date(Date.now() - 45 * 60_000).toISOString();
    expect(computeLinkHealth({ ...base, last_success_at: min45 })).toBe("critical");
    expect(computeLinkHealth(base, { hasCriticalIssue: true })).toBe("critical");
  });
  it("paused y draft son estados explícitos", () => {
    expect(computeLinkHealth({ ...base, status: "paused" })).toBe("paused");
    expect(computeLinkHealth({ ...base, status: "draft" })).toBe("draft");
  });
});
