/**
 * Tests de integración del pipeline canónico contra la base REAL (schema
 * apartcba), usando una organización descartable creada y borrada por el test.
 *
 * Corren solo con RUN_DB_TESTS=1 (necesitan .env.local con service key):
 *   RUN_DB_TESTS=1 npx vitest run src/lib/channels/__tests__/pipeline-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: SupabaseClient<any, any, any>;
let orgId = "";
let org2Id = "";
let unit1 = "";
let unit2 = "";
let link1 = "";
let link2 = "";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../../../../.env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function cleanup() {
  if (!admin) return;
  for (const org of [orgId, org2Id].filter(Boolean)) {
    await admin.from("channel_issues").delete().eq("organization_id", org);
    await admin.from("channel_events").delete().eq("organization_id", org);
    await admin.from("booking_external_refs").delete().eq("organization_id", org);
    await admin.from("channel_reservations").delete().eq("organization_id", org);
    await admin.from("channel_links").delete().eq("organization_id", org);
    await admin.from("channel_settings").delete().eq("organization_id", org);
    await admin.from("notifications").delete().eq("organization_id", org);
    await admin.from("cleaning_tasks").delete().eq("organization_id", org);
    await admin.from("bookings").delete().eq("organization_id", org);
    await admin.from("guests").delete().eq("organization_id", org);
    await admin.from("units").delete().eq("organization_id", org);
    await admin.from("organizations").delete().eq("id", org);
  }
}

d("pipeline canónico (integración DB, org descartable)", () => {
  beforeAll(async () => {
    loadEnv();
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: "apartcba" }, auth: { persistSession: false } },
    );
    const rand = Math.random().toString(36).slice(2, 8);
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: "ZZ Test Canales (borrar)", slug: `zz-test-canales-${rand}` })
      .select("id")
      .single();
    if (orgErr) throw new Error(orgErr.message);
    orgId = org.id;
    const { data: org2 } = await admin
      .from("organizations")
      .insert({ name: "ZZ Test Canales 2 (borrar)", slug: `zz-test-canales2-${rand}` })
      .select("id")
      .single();
    org2Id = org2!.id;

    const { data: units, error: unitsErr } = await admin
      .from("units")
      .insert([
        { organization_id: orgId, code: "ZZT1", name: "Test Uno" },
        { organization_id: orgId, code: "ZZT2", name: "Test Dos" },
      ])
      .select("id, code");
    if (unitsErr) throw new Error(unitsErr.message);
    unit1 = units!.find((u) => u.code === "ZZT1")!.id;
    unit2 = units!.find((u) => u.code === "ZZT2")!.id;

    const { data: links, error: linksErr } = await admin
      .from("channel_links")
      .insert([
        { organization_id: orgId, unit_id: unit1, channel: "airbnb", status: "active" },
        {
          organization_id: orgId,
          unit_id: unit2,
          channel: "airbnb",
          status: "active",
          external_listing_id: "99887766",
        },
      ])
      .select("id, unit_id");
    if (linksErr) throw new Error(linksErr.message);
    link1 = links!.find((l) => l.unit_id === unit1)!.id;
    link2 = links!.find((l) => l.unit_id === unit2)!.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 60_000);

  it("iCal primero → email después convergen en el MISMO booking, con huésped enlazado por UPDATE", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");

    const r1 = await ingestEvent(admin, {
      transport: "ical",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-uid-1@airbnb.com",
      confirmationCode: "HMZZTEST01",
      checkIn: "2031-01-10",
      checkOut: "2031-01-14",
      isBlock: false,
      dedupeKey: "test:ical:1",
    });
    expect(r1.outcome).toBe("created");
    expect(r1.bookingId).toBeTruthy();

    // sin datos del huésped todavía → booking sin guest (no se inventa)
    const { data: b1 } = await admin
      .from("bookings")
      .select("guest_id, status, external_id, total_amount, paid_amount")
      .eq("id", r1.bookingId!)
      .single();
    expect(b1!.guest_id).toBeNull();
    expect(b1!.status).toBe("confirmada");

    // llega el email con el mismo código → mismo booking + huésped
    const r2 = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      confirmationCode: "HMZZTEST01",
      checkIn: "2031-01-10",
      checkOut: "2031-01-14",
      isBlock: false,
      guest: { name: "María Convergencia", email: "Maria.Conv@Example.com" },
      amounts: { total: 999999, currency: "ARS" },
      dedupeKey: "test:email:1",
    });
    expect(r2.bookingId).toBe(r1.bookingId); // UUID conservado
    expect(["updated", "duplicate"]).toContain(r2.outcome);

    const { data: b2 } = await admin
      .from("bookings")
      .select("guest_id, total_amount, paid_amount")
      .eq("id", r1.bookingId!)
      .single();
    expect(b2!.guest_id).not.toBeNull();
    // los importes de la OTA NO tocan finanzas
    expect(Number(b2!.total_amount)).toBe(0);
    expect(Number(b2!.paid_amount)).toBe(0);

    const { data: guest } = await admin
      .from("guests")
      .select("full_name, email, total_bookings")
      .eq("id", b2!.guest_id)
      .single();
    expect(guest!.email).toBe("maria.conv@example.com"); // lowercase
    expect(guest!.total_bookings).toBe(1); // trigger por UPDATE de guest_id

    // solo UNA channel_reservation para ambos transportes
    const { data: reservations } = await admin
      .from("channel_reservations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("confirmation_code", "HMZZTEST01");
    expect(reservations).toHaveLength(1);
  }, 60_000);

  it("reintento del mismo evento no duplica nada", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const before = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      confirmationCode: "HMZZTEST01",
      checkIn: "2031-01-10",
      checkOut: "2031-01-14",
      isBlock: false,
      guest: { name: "María Convergencia" },
      dedupeKey: "test:email:1", // misma clave → duplicado puro
    });
    expect(r.outcome).toBe("duplicate");
    const after = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    expect(after.count).toBe(before.count);
  }, 30_000);

  it("email primero → iCal después convergen (mapping determinista por listing)", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r1 = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      confirmationCode: "HMZZTEST02",
      checkIn: "2031-02-01",
      checkOut: "2031-02-05",
      isBlock: false,
      listingId: "99887766", // → link2/unit2 determinista
      guest: { name: "Pedro EmailPrimero" },
      dedupeKey: "test:email:2",
    });
    expect(r1.outcome).toBe("created");

    const r2 = await ingestEvent(admin, {
      transport: "ical",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link2,
      unitId: unit2,
      icalUid: "zzt-uid-2@airbnb.com",
      confirmationCode: "HMZZTEST02",
      checkIn: "2031-02-01",
      checkOut: "2031-02-05",
      isBlock: false,
      dedupeKey: "test:ical:2",
    });
    expect(r2.bookingId).toBe(r1.bookingId);

    // la reserva canónica quedó con ambas referencias
    const { data: res } = await admin
      .from("channel_reservations")
      .select("ical_uid, confirmation_code, unit_id")
      .eq("organization_id", orgId)
      .eq("confirmation_code", "HMZZTEST02")
      .single();
    expect(res!.ical_uid).toBe("zzt-uid-2@airbnb.com");
    expect(res!.unit_id).toBe(unit2);
  }, 60_000);

  it("modificación de fechas conserva el UUID del booking", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const { data: before } = await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("external_id", "HMZZTEST02")
      .single();

    const r = await ingestEvent(admin, {
      transport: "ical",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link2,
      unitId: unit2,
      icalUid: "zzt-uid-2@airbnb.com",
      confirmationCode: "HMZZTEST02",
      checkIn: "2031-02-01",
      checkOut: "2031-02-07", // extensión
      isBlock: false,
      dedupeKey: "test:ical:2-mod",
    });
    expect(r.outcome).toBe("updated");
    expect(r.bookingId).toBe(before!.id);
    const { data: after } = await admin
      .from("bookings")
      .select("id, check_out_date")
      .eq("id", before!.id)
      .single();
    expect(after!.check_out_date).toBe("2031-02-07");
  }, 30_000);

  it("cancelación exacta por referencia externa (nunca guest_id IS NULL)", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "HMZZTEST02",
      dedupeKey: "test:email:cancel:2",
    });
    expect(r.outcome).toBe("cancelled");
    const { data: b } = await admin
      .from("bookings")
      .select("status")
      .eq("organization_id", orgId)
      .eq("external_id", "HMZZTEST02")
      .single();
    expect(b!.status).toBe("cancelada");
  }, 30_000);

  it("conflicto externo: conserva la reserva externa, NO toca la local, crea incidencia crítica", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    // reserva local directa preexistente
    const { data: local, error: localErr } = await admin
      .from("bookings")
      .insert({
        organization_id: orgId,
        unit_id: unit1,
        source: "directo",
        status: "confirmada",
        mode: "temporario",
        check_in_date: "2031-03-10",
        check_in_time: "14:00",
        check_out_date: "2031-03-15",
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 100000,
        guests_count: 2,
      })
      .select("id, updated_at")
      .single();
    expect(localErr).toBeNull();

    const r = await ingestEvent(admin, {
      transport: "ical",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-uid-conflict@airbnb.com",
      confirmationCode: "HMZZCONF01",
      checkIn: "2031-03-12",
      checkOut: "2031-03-16",
      isBlock: false,
      dedupeKey: "test:ical:conflict",
    });
    expect(r.outcome).toBe("conflict");

    // reserva externa conservada sin booking
    const { data: res } = await admin
      .from("channel_reservations")
      .select("booking_id, external_status")
      .eq("organization_id", orgId)
      .eq("confirmation_code", "HMZZCONF01")
      .single();
    expect(res!.booking_id).toBeNull();
    expect(res!.external_status).toBe("active");

    // local intacta
    const { data: localAfter } = await admin
      .from("bookings")
      .select("status, check_in_date, check_out_date")
      .eq("id", local!.id)
      .single();
    expect(localAfter!.status).toBe("confirmada");
    expect(localAfter!.check_in_date).toBe("2031-03-10");

    // incidencia crítica abierta
    const { data: issues } = await admin
      .from("channel_issues")
      .select("issue_type, severity, status")
      .eq("organization_id", orgId)
      .eq("issue_type", "conflict")
      .eq("status", "open");
    expect(issues!.length).toBeGreaterThan(0);
    expect(issues![0].severity).toBe("critical");
  }, 60_000);

  it("unidad ambigua: crea incidencia, NO asigna por fuzzy, NO crea huésped huérfano", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const guestsBefore = await admin
      .from("guests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);

    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      confirmationCode: "HMZZAMBIG1",
      checkIn: "2031-04-01",
      checkOut: "2031-04-04",
      isBlock: false,
      listingHint: "Depto",
      guest: { name: "Huérfano Potencial", email: "orphan@example.com" },
      dedupeKey: "test:email:ambig",
    });
    expect(r.outcome).toBe("needs_review");
    expect(r.bookingId).toBeUndefined();

    // no se creó ningún huésped (solo después de proyectar)
    const guestsAfter = await admin
      .from("guests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    expect(guestsAfter.count).toBe(guestsBefore.count);

    const { data: issues } = await admin
      .from("channel_issues")
      .select("issue_type")
      .eq("organization_id", orgId)
      .in("issue_type", ["unmapped_unit", "ambiguous_unit"])
      .eq("status", "open");
    expect(issues!.length).toBeGreaterThan(0);
  }, 30_000);

  it("nombre genérico sin contacto no crea guest; el booking se proyecta igual", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_upsert",
      organizationId: orgId,
      unitId: unit1,
      confirmationCode: "HMZZGEN001",
      checkIn: "2031-05-01",
      checkOut: "2031-05-03",
      isBlock: false,
      guest: { name: "Huésped Airbnb" },
      dedupeKey: "test:email:generic",
    });
    expect(r.outcome).toBe("created");
    const { data: b } = await admin
      .from("bookings")
      .select("guest_id")
      .eq("id", r.bookingId!)
      .single();
    expect(b!.guest_id).toBeNull();
  }, 30_000);

  it("aislamiento multi-tenant: una cancelación en otra org no toca reservas ajenas", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_cancelled",
      organizationId: org2Id, // otra org, mismo código que existe en org1
      confirmationCode: "HMZZTEST01",
      dedupeKey: "test:email:crossorg",
    });
    expect(r.outcome).toBe("needs_review"); // no encontrada EN SU org
    const { data: b } = await admin
      .from("bookings")
      .select("status")
      .eq("organization_id", orgId)
      .eq("external_id", "HMZZTEST01")
      .single();
    expect(b!.status).toBe("confirmada"); // intacta
  }, 30_000);

  it("desaparición del VEVENT: 1ª y 2ª ausencia solo advierten; cancela recién con 3 lecturas + 30 min", async () => {
    const { handleDisappearances } = await import("@/lib/channels/dispatch");
    const { data: linkRow } = await admin
      .from("channel_links")
      .select("*")
      .eq("id", link1)
      .single();

    // reserva futura observada previamente
    const { data: booking } = await admin
      .from("bookings")
      .insert({
        organization_id: orgId,
        unit_id: unit1,
        source: "airbnb",
        external_id: "HMZZGONE01",
        status: "confirmada",
        mode: "temporario",
        check_in_date: "2031-06-10",
        check_in_time: "14:00",
        check_out_date: "2031-06-14",
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 0,
        guests_count: 1,
      })
      .select("id")
      .single();
    const { data: res } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link1,
        unit_id: unit1,
        channel: "airbnb",
        booking_id: booking!.id,
        external_status: "active",
        check_in: "2031-06-10",
        check_out: "2031-06-14",
        ical_uid: "zzt-gone@airbnb.com",
        confirmation_code: "HMZZGONE01",
        last_seen_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    const load = async () =>
      (await admin.from("channel_reservations").select("*").eq("id", res!.id).single()).data!;
    const seen = new Set<string>(); // el uid NO está en el feed
    const horizon = "2031-12-31";

    // lectura 1 → advertencia, sin cancelar
    let cancelled = await handleDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(cancelled).toBe(0);
    let cur = await load();
    expect(cur.missing_runs).toBe(1);
    expect((await admin.from("bookings").select("status").eq("id", booking!.id).single()).data!.status).toBe("confirmada");

    // lectura 2 → sigue sin cancelar
    cancelled = await handleDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(cancelled).toBe(0);
    cur = await load();
    expect(cur.missing_runs).toBe(2);

    // lectura 3 pero SIN 30 min transcurridos → sigue sin cancelar
    cancelled = await handleDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(cancelled).toBe(0);
    cur = await load();
    expect(cur.missing_runs).toBe(3);
    expect(cur.external_status).toBe("active");

    // backdate de missing_since a 31 min → la próxima lectura cancela
    await admin
      .from("channel_reservations")
      .update({ missing_since: new Date(Date.now() - 31 * 60_000).toISOString() })
      .eq("id", res!.id);
    cancelled = await handleDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(cancelled).toBe(1);
    cur = await load();
    expect(cur.external_status).toBe("cancelled");
    expect(
      (await admin.from("bookings").select("status").eq("id", booking!.id).single()).data!.status,
    ).toBe("cancelada");
  }, 90_000);

  it("reserva fuera del horizonte del feed no entra al tracking de desaparición", async () => {
    const { handleDisappearances } = await import("@/lib/channels/dispatch");
    const { data: linkRow } = await admin.from("channel_links").select("*").eq("id", link1).single();
    const { data: res } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link1,
        unit_id: unit1,
        channel: "airbnb",
        external_status: "active",
        check_in: "2032-01-10",
        check_out: "2032-01-14",
        ical_uid: "zzt-horizon@airbnb.com",
        last_seen_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    // horizonte del feed termina ANTES del check_out de esta reserva
    const cancelled = await handleDisappearances(admin, linkRow!, [res!], new Set(), "2031-12-31");
    expect(cancelled).toBe(0);
    const { data: after } = await admin
      .from("channel_reservations")
      .select("missing_runs, external_status")
      .eq("id", res!.id)
      .single();
    expect(after!.missing_runs).toBe(0);
    expect(after!.external_status).toBe("active");
  }, 30_000);
});
