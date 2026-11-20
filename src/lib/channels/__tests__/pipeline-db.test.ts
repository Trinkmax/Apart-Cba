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
    await admin.from("channel_cancellation_requests").delete().eq("organization_id", org);
    await admin.from("channel_events").delete().eq("organization_id", org);
    await admin.from("booking_external_refs").delete().eq("organization_id", org);
    await admin.from("channel_export_reads").delete().eq("organization_id", org);
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

  // Desde la 053 ninguna señal de una OTA cancela sola: la referencia exacta
  // encuentra la reserva (nunca por guest_id IS NULL) y abre una propuesta.
  it("cancelación por referencia externa exacta: encuentra la reserva y PROPONE, no cancela", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, {
      transport: "email",
      channel: "airbnb",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "HMZZTEST02",
      dedupeKey: "test:email:cancel:2",
    });
    expect(r.outcome).toBe("needs_review");
    const { data: b } = await admin
      .from("bookings")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("external_id", "HMZZTEST02")
      .single();
    expect(r.bookingId).toBe(b!.id);
    expect(b!.status).toBe("confirmada");
    const { data: request } = await admin
      .from("channel_cancellation_requests")
      .select("status, reason_code")
      .eq("booking_id", b!.id)
      .single();
    expect(request).toMatchObject({ status: "pending", reason_code: "ota_cancellation_email" });
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

  it("desaparición del VEVENT: nunca cancela sola; a las 3 lecturas + 30 min abre una PROPUESTA y la reserva queda intacta", async () => {
    const { proposeDisappearances } = await import("@/lib/channels/dispatch");
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

    const bookingStatus = async () =>
      (await admin.from("bookings").select("status").eq("id", booking!.id).single()).data!.status;

    // lectura 1 → advertencia, nada más
    let proposed = await proposeDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(proposed).toBe(0);
    let cur = await load();
    expect(cur.missing_runs).toBe(1);
    expect(await bookingStatus()).toBe("confirmada");

    // lectura 2 → sigue sin proponer
    proposed = await proposeDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(proposed).toBe(0);
    cur = await load();
    expect(cur.missing_runs).toBe(2);

    // lectura 3 pero SIN 30 min transcurridos → todavía no
    proposed = await proposeDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(proposed).toBe(0);
    cur = await load();
    expect(cur.missing_runs).toBe(3);
    expect(cur.external_status).toBe("active");

    // backdate de missing_since a 31 min → la próxima lectura PROPONE
    await admin
      .from("channel_reservations")
      .update({ missing_since: new Date(Date.now() - 31 * 60_000).toISOString() })
      .eq("id", res!.id);
    proposed = await proposeDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(proposed).toBe(1);

    // La invariante que costó tres reservas reales aprender: la propuesta NO
    // toca la reserva. Sigue confirmada y sigue ocupando el calendario hasta
    // que una persona decida.
    cur = await load();
    expect(cur.external_status).toBe("active");
    expect(await bookingStatus()).toBe("confirmada");

    const { data: request } = await admin
      .from("channel_cancellation_requests")
      .select("status, reason_code, booking_id, snapshot")
      .eq("reservation_id", res!.id)
      .single();
    expect(request!.status).toBe("pending");
    expect(request!.reason_code).toBe("missing_from_feed");
    expect(request!.booking_id).toBe(booking!.id);

    // Idempotencia: seguir leyendo no acumula propuestas duplicadas.
    proposed = await proposeDisappearances(admin, linkRow!, [await load()], seen, horizon);
    expect(proposed).toBe(0);
    const { count } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", res!.id)
      .eq("status", "pending");
    expect(count).toBe(1);
  }, 90_000);

  // Antes de la 050 este caso se EXCLUÍA del barrido, y por eso los bloqueos
  // fantasma quedaban pegados para siempre: el evento más lejano del feed ES el
  // horizonte, así que al desaparecer siempre cae "más allá". Hoy se sigue, pero
  // con la vía lenta (12 lecturas / 6 h) en vez de las 3 lecturas / 30 min.
  it("fuera del horizonte se sigue con la vía lenta, sin proponer por una lectura", async () => {
    const { proposeDisappearances } = await import("@/lib/channels/dispatch");
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
    const proposed = await proposeDisappearances(admin, linkRow!, [res!], new Set(), "2031-12-31");
    expect(proposed).toBe(0);
    const { data: after } = await admin
      .from("channel_reservations")
      .select("missing_runs, missing_since, external_status")
      .eq("id", res!.id)
      .single();
    // se empieza a contar…
    expect(after!.missing_runs).toBe(1);
    expect(after!.missing_since).not.toBeNull();
    // …pero una sola ausencia no alcanza ni de lejos para cancelar
    expect(after!.external_status).toBe("active");

    // ni siquiera con el umbral normal cumplido: fuera del horizonte hacen
    // falta 12 lecturas Y 6 h.
    await admin
      .from("channel_reservations")
      .update({
        missing_runs: 3, // el umbral de la vía normal
        missing_since: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      })
      .eq("id", res!.id);
    const { data: reloaded } = await admin
      .from("channel_reservations")
      .select("*")
      .eq("id", res!.id)
      .single();
    const again = await proposeDisappearances(
      admin,
      linkRow!,
      [reloaded!],
      new Set(),
      "2031-12-31",
    );
    expect(again).toBe(0);
    const { data: still } = await admin
      .from("channel_reservations")
      .select("external_status")
      .eq("id", res!.id)
      .single();
    expect(still!.external_status).toBe("active");
  }, 30_000);

  // ── Cancelación de Booking: el circuito completo ──────────────────────────
  // El iCal identifica por ical_uid y nunca trae número de reserva; el email de
  // cancelación trae número y nunca uid. Sin cruce, la cancelación no encontraba
  // nada y la reserva quedaba vigente en el PMS. Estos tres tests cubren las dos
  // mitades del cruce y el fallback.

  it("el aviso de Booking le pone el número a la reserva que entró por iCal", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");

    // 1) el aviso llega PRIMERO (en producción gana por ~5 min): todavía no hay
    //    a quién numerar, y eso no es un error.
    const pre = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_reference",
      organizationId: orgId,
      confirmationCode: "9911223344",
      checkIn: "2031-09-10",
      dedupeKey: "test:booking:ref-early",
    });
    expect(pre.outcome).toBe("duplicate");

    // 2) el iCal proyecta la reserva y levanta el aviso pendiente
    const r = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-bkg-ref@booking.com",
      checkIn: "2031-09-10",
      checkOut: "2031-09-13",
      isBlock: false,
      dedupeKey: "test:booking:ical-ref",
    });
    expect(r.outcome).toBe("created");

    const { data: res } = await admin
      .from("channel_reservations")
      .select("confirmation_code")
      // por organización: si una corrida anterior se cortó sin limpiar, su
      // fila con el mismo UID hacía fallar este `.single()`
      .eq("organization_id", orgId)
      .eq("ical_uid", "zzt-bkg-ref@booking.com")
      .single();
    expect(res!.confirmation_code).toBe("9911223344");

    // el número queda buscable y visible en la reserva
    const { data: b } = await admin
      .from("bookings")
      .select("external_id")
      .eq("id", r.bookingId!)
      .single();
    expect(b!.external_id).toBe("9911223344");
    const { data: refs } = await admin
      .from("booking_external_refs")
      .select("ref_value")
      .eq("booking_id", r.bookingId!)
      .eq("ref_type", "reservation_number");
    expect(refs).toHaveLength(1);
  }, 60_000);

  it("una cancelación de Booking por número encuentra la reserva importada del iCal y la propone", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const { data: before } = await admin
      .from("bookings")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("external_id", "9911223344")
      .single();
    expect(before!.status).toBe("confirmada");

    const c = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "9911223344",
      checkIn: "2031-09-10",
      dedupeKey: "test:booking:cancel-ref",
    });
    expect(c.outcome).toBe("needs_review");
    expect(c.bookingId).toBe(before!.id);

    // La reserva sigue en pie hasta que una persona lo confirme.
    const { data: after } = await admin
      .from("bookings")
      .select("status")
      .eq("id", before!.id)
      .single();
    expect(after!.status).toBe("confirmada");
    const { data: request } = await admin
      .from("channel_cancellation_requests")
      .select("status, reason_code")
      .eq("booking_id", before!.id)
      .single();
    expect(request).toMatchObject({ status: "pending", reason_code: "ota_cancellation_email" });
  }, 60_000);

  it("sin número previo, la cancelación encuentra la reserva por fecha de llegada", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-bkg-nodate@booking.com",
      checkIn: "2031-07-05",
      checkOut: "2031-07-08",
      isBlock: false,
      dedupeKey: "test:booking:ical-nodate",
    });
    expect(r.outcome).toBe("created");

    // el número que trae el email NO existe en ninguna parte del PMS
    const c = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "8877665544",
      checkIn: "2031-07-05",
      dedupeKey: "test:booking:cancel-bydate",
    });
    // La encuentra (es la única sin número que llega ese día) y la PROPONE.
    expect(c.outcome).toBe("needs_review");
    expect(c.bookingId).toBe(r.bookingId);

    const { data: after } = await admin
      .from("bookings")
      .select("status")
      .eq("id", r.bookingId!)
      .single();
    expect(after!.status).toBe("confirmada");
    const { data: request } = await admin
      .from("channel_cancellation_requests")
      .select("status")
      .eq("booking_id", r.bookingId!)
      .single();
    expect(request!.status).toBe("pending");
    // De paso queda el número puesto: la próxima vez el cruce es exacto.
    const { data: row } = await admin
      .from("channel_reservations")
      .select("confirmation_code")
      .eq("id", r.reservationId!)
      .single();
    expect(row!.confirmation_code).toBe("8877665544");
  }, 60_000);

  it("con dos reservas que llegan el mismo día no se cancela ninguna a ciegas", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const a = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-bkg-dup-a@booking.com",
      checkIn: "2031-08-01",
      checkOut: "2031-08-03",
      isBlock: false,
      dedupeKey: "test:booking:dup-a",
    });
    const b = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link2,
      unitId: unit2,
      icalUid: "zzt-bkg-dup-b@booking.com",
      checkIn: "2031-08-01",
      checkOut: "2031-08-03",
      isBlock: false,
      dedupeKey: "test:booking:dup-b",
    });
    expect(a.outcome).toBe("created");
    expect(b.outcome).toBe("created");

    const c = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "7766554433",
      checkIn: "2031-08-01",
      dedupeKey: "test:booking:cancel-ambig",
    });
    expect(c.outcome).toBe("needs_review");

    for (const id of [a.bookingId!, b.bookingId!]) {
      const { data } = await admin.from("bookings").select("status").eq("id", id).single();
      expect(data!.status).toBe("confirmada");
    }
  }, 60_000);

  // Booking arma el UID con habitación + llegada: lo que "vuelve" después de
  // una cancelación es otra persona que reservó desde el mismo día (Habitana,
  // Pampa Mora, 14/11/2026).
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const slotEvent = (uid: string, checkIn: string, checkOut: string, key: string) => ({
    transport: "ical" as const,
    channel: "booking" as const,
    eventType: "reservation_upsert" as const,
    organizationId: orgId,
    linkId: link1,
    unitId: unit1,
    icalUid: uid,
    checkIn,
    checkOut,
    isBlock: false,
    dedupeKey: key,
  });

  it("el UID de una cancelada vuelve con otra estadía: entra como reserva NUEVA y la cancelada queda intacta", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const uid = "zzt-bkg-slot-1@booking.com";

    const r1 = await ingestEvent(admin, slotEvent(uid, inDays(200), inDays(204), "test:slot1:a"));
    expect(r1.outcome).toBe("created");
    const oldBooking = r1.bookingId!;
    const oldRes = r1.reservationId!;

    // Una persona confirmó la cancelación (lo mismo que hace decideCancellation)
    // y quedaba una propuesta pendiente sobre esa fila.
    await admin
      .from("bookings")
      .update({ status: "cancelada", cancelled_at: new Date().toISOString(), cancelled_source: "channel_decision" })
      .eq("id", oldBooking);
    await admin.from("channel_reservations").update({ external_status: "cancelled" }).eq("id", oldRes);
    await admin.from("channel_cancellation_requests").insert({
      organization_id: orgId,
      link_id: link1,
      reservation_id: oldRes,
      booking_id: oldBooking,
      channel: "booking",
      reason_code: "missing_from_feed",
      detail: "test",
      status: "pending",
    });

    // Otra persona reserva desde el mismo día: mismo UID, otra salida.
    const r2 = await ingestEvent(admin, slotEvent(uid, inDays(200), inDays(202), "test:slot1:b"));
    expect(r2.outcome).toBe("created");
    expect(r2.bookingId).toBeTruthy();
    expect(r2.bookingId).not.toBe(oldBooking);

    const { data: nueva } = await admin
      .from("bookings")
      .select("status, check_in_date, check_out_date")
      .eq("id", r2.bookingId!)
      .single();
    expect(nueva).toMatchObject({ status: "confirmada", check_in_date: inDays(200), check_out_date: inDays(202) });

    const { data: vieja } = await admin.from("bookings").select("status, check_out_date").eq("id", oldBooking).single();
    expect(vieja).toMatchObject({ status: "cancelada", check_out_date: inDays(204) });

    const { data: archivada } = await admin
      .from("channel_reservations")
      .select("ical_uid, external_status, booking_id, check_out")
      .eq("id", oldRes)
      .single();
    expect(archivada!.ical_uid).not.toBe(uid);
    expect(archivada).toMatchObject({ external_status: "cancelled", booking_id: oldBooking, check_out: inDays(204) });

    const { data: viva } = await admin
      .from("channel_reservations")
      .select("external_status, booking_id")
      .eq("link_id", link1)
      .eq("ical_uid", uid)
      .single();
    expect(viva).toMatchObject({ external_status: "active", booking_id: r2.bookingId });

    const { data: ref } = await admin
      .from("booking_external_refs")
      .select("booking_id")
      .eq("organization_id", orgId)
      .eq("ref_type", "ical_uid")
      .eq("ref_value", uid)
      .single();
    expect(ref!.booking_id).toBe(r2.bookingId);

    const { data: req } = await admin
      .from("channel_cancellation_requests")
      .select("status")
      .eq("reservation_id", oldRes)
      .single();
    expect(req!.status).toBe("stale");

    // La lectura siguiente no vuelve a archivar ni duplica nada.
    const r3 = await ingestEvent(admin, slotEvent(uid, inDays(200), inDays(202), "test:slot1:c"));
    expect(r3.outcome).toBe("duplicate");
    expect(r3.bookingId).toBe(r2.bookingId);
  }, 60_000);

  it("la persona la canceló desde la ficha y el feed trae el UID con otras fechas: también entra como nueva", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const uid = "zzt-bkg-slot-2@booking.com";

    const r1 = await ingestEvent(admin, slotEvent(uid, inDays(220), inDays(224), "test:slot2:a"));
    expect(r1.outcome).toBe("created");
    // Sólo la reserva local: la fila externa sigue `active`.
    await admin.from("bookings").update({ status: "cancelada" }).eq("id", r1.bookingId!);

    const r2 = await ingestEvent(admin, slotEvent(uid, inDays(220), inDays(222), "test:slot2:b"));
    expect(r2.outcome).toBe("created");
    expect(r2.bookingId).not.toBe(r1.bookingId);

    const { data: vieja } = await admin.from("bookings").select("status, check_out_date").eq("id", r1.bookingId!).single();
    expect(vieja).toMatchObject({ status: "cancelada", check_out_date: inDays(224) });
    const { data: archivada } = await admin
      .from("channel_reservations")
      .select("external_status, check_out")
      .eq("id", r1.reservationId!)
      .single();
    expect(archivada).toMatchObject({ external_status: "cancelled", check_out: inDays(224) });
  }, 60_000);

  it("si ya la cargaron a mano con las mismas fechas, la vincula en vez de duplicarla", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const uid = "zzt-bkg-slot-3@booking.com";

    const r1 = await ingestEvent(admin, slotEvent(uid, inDays(240), inDays(244), "test:slot3:a"));
    await admin.from("bookings").update({ status: "cancelada" }).eq("id", r1.bookingId!);
    await admin.from("channel_reservations").update({ external_status: "cancelled" }).eq("id", r1.reservationId!);

    // Como Cecilia con Gabriel Sosa: la reserva nueva cargada a mano.
    const { data: aMano, error } = await admin
      .from("bookings")
      .insert({
        organization_id: orgId,
        unit_id: unit1,
        source: "booking",
        status: "confirmada",
        mode: "temporario",
        check_in_date: inDays(240),
        check_in_time: "14:00",
        check_out_date: inDays(242),
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 170000,
        guests_count: 2,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const r2 = await ingestEvent(admin, slotEvent(uid, inDays(240), inDays(242), "test:slot3:b"));
    expect(r2.bookingId).toBe(aMano!.id);

    const { data: enEsasFechas } = await admin
      .from("bookings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("unit_id", unit1)
      .eq("check_in_date", inDays(240))
      .neq("status", "cancelada");
    expect(enEsasFechas!.map((b) => b.id)).toEqual([aMano!.id]);
  }, 60_000);

  // ── 19/11/2026: los números de Booking y lo que se le pregunta a una persona ──

  const liveBooking = async (unitId: string, checkIn: string, checkOut: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin
      .from("bookings")
      .insert({
        organization_id: orgId,
        unit_id: unitId,
        source: "booking",
        status: "confirmada",
        mode: "temporario",
        check_in_date: checkIn,
        check_in_time: "14:00",
        check_out_date: checkOut,
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 0,
        guests_count: 1,
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id as string;
  };
  const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Apart CBA, 18/11/2026: el número de una reserva nueva de VEL727 fue a parar
  // a una de DIVA cargada en septiembre con la misma fecha de llegada.
  it("el número del aviso va a la reserva que nació con él, no a una vieja con la misma llegada", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const oldBooking = await liveBooking(unit2, "2033-03-04", "2033-03-07");
    const { data: old } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link2,
        unit_id: unit2,
        channel: "booking",
        booking_id: oldBooking,
        external_status: "active",
        check_in: "2033-03-04",
        check_out: "2033-03-07",
        ical_uid: "zzt-ref-old@booking.com",
        last_seen_at: new Date().toISOString(),
        created_at: monthAgo(),
      })
      .select("id")
      .single();

    const notice = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_reference",
      organizationId: orgId,
      confirmationCode: "5636700001",
      checkIn: "2033-03-04",
      dedupeKey: "test:refmatch:notice",
    });
    // Todavía no entró la reserva nueva: el número no se le pone a la vieja.
    expect(notice.outcome).toBe("duplicate");
    const codeOf = async (id: string) =>
      (await admin.from("channel_reservations").select("confirmation_code").eq("id", id).single()).data!
        .confirmation_code;
    expect(await codeOf(old!.id)).toBeNull();

    const fresh = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-ref-new@booking.com",
      checkIn: "2033-03-04",
      checkOut: "2033-03-06",
      isBlock: false,
      dedupeKey: "test:refmatch:ical",
    });
    expect(fresh.outcome).toBe("created");
    expect(await codeOf(fresh.reservationId!)).toBe("5636700001");
    expect(await codeOf(old!.id)).toBeNull();
    const { data: b } = await admin.from("bookings").select("external_id").eq("id", fresh.bookingId!).single();
    expect(b!.external_id).toBe("5636700001");
  }, 60_000);

  it("el aviso que llega DESPUÉS de la reserva también la encuentra, por cuándo nació", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const fresh = await ingestEvent(admin, {
      transport: "ical",
      channel: "booking",
      eventType: "reservation_upsert",
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      icalUid: "zzt-ref-late@booking.com",
      checkIn: "2033-04-10",
      checkOut: "2033-04-12",
      isBlock: false,
      dedupeKey: "test:reflate:ical",
    });
    expect(fresh.outcome).toBe("created");
    const notice = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_reference",
      organizationId: orgId,
      confirmationCode: "5636700002",
      checkIn: "2033-04-10",
      dedupeKey: "test:reflate:notice",
    });
    expect(notice.outcome).toBe("updated");
    expect(notice.reservationId).toBe(fresh.reservationId);
  }, 60_000);

  // DIVA, 19/11/2026: el mail de cancelación era de otra reserva.
  it("una cancelación no señala a una reserva de otra época aunque llegue el mismo día", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    // El aviso de la reserva que después se cancela: nunca entró por calendario.
    await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_reference",
      organizationId: orgId,
      confirmationCode: "5636700003",
      checkIn: "2033-05-04",
      dedupeKey: "test:cancelera:notice",
    });
    const oldBooking = await liveBooking(unit2, "2033-05-04", "2033-05-07");
    await admin.from("channel_reservations").insert({
      organization_id: orgId,
      link_id: link2,
      unit_id: unit2,
      channel: "booking",
      booking_id: oldBooking,
      external_status: "active",
      check_in: "2033-05-04",
      check_out: "2033-05-07",
      ical_uid: "zzt-cancelera-old@booking.com",
      last_seen_at: new Date().toISOString(),
      created_at: monthAgo(),
    });

    const c = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "5636700003",
      checkIn: "2033-05-04",
      dedupeKey: "test:cancelera:cancel",
    });
    expect(c.outcome).toBe("needs_review");
    expect(c.bookingId).toBeUndefined();
    const { count } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", oldBooking);
    expect(count).toBe(0);
    const { data: still } = await admin.from("bookings").select("status").eq("id", oldBooking).single();
    expect(still!.status).toBe("confirmada");
  }, 60_000);

  it("una cancelación no señala a una reserva que ya tiene OTRO número", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const numbered = await liveBooking(unit2, "2033-06-04", "2033-06-07");
    await admin.from("channel_reservations").insert({
      organization_id: orgId,
      link_id: link2,
      unit_id: unit2,
      channel: "booking",
      booking_id: numbered,
      external_status: "active",
      check_in: "2033-06-04",
      check_out: "2033-06-07",
      ical_uid: "zzt-othernum@booking.com",
      confirmation_code: "5636700004",
      last_seen_at: new Date().toISOString(),
    });
    const c = await ingestEvent(admin, {
      transport: "email",
      channel: "booking",
      eventType: "reservation_cancelled",
      organizationId: orgId,
      confirmationCode: "5636700099",
      checkIn: "2033-06-04",
      dedupeKey: "test:othernum:cancel",
    });
    expect(c.outcome).toBe("needs_review");
    const { count } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", numbered);
    expect(count).toBe(0);
  }, 60_000);

  const vanish = async (reservationId: string) => {
    const { proposeDisappearances } = await import("@/lib/channels/dispatch");
    const { data: linkRow } = await admin.from("channel_links").select("*").eq("id", link1).single();
    const load = async () =>
      (
        await admin
          .from("channel_reservations")
          .select("*, local:bookings!channel_reservations_booking_id_fkey(status, cancelled_at)")
          .eq("id", reservationId)
          .single()
      ).data!;
    let proposed = 0;
    for (let i = 0; i < 3; i++) {
      proposed += await proposeDisappearances(admin, linkRow!, [await load()], new Set(), "2040-12-31");
    }
    await admin
      .from("channel_reservations")
      .update({ missing_since: new Date(Date.now() - 31 * 60_000).toISOString() })
      .eq("id", reservationId);
    proposed += await proposeDisappearances(admin, linkRow!, [await load()], new Set(), "2040-12-31");
    return proposed;
  };

  // El barrido lee las reservas conocidas con su reserva local embebida: si ese
  // select fallara, cada conexión vería [] y dejaría de seguir las ausencias.
  it("la lectura de reservas conocidas trae la reserva local embebida", async () => {
    const { data, error } = await admin
      .from("channel_reservations")
      .select("*, local:bookings!channel_reservations_booking_id_fkey(status, cancelled_at)")
      .eq("organization_id", orgId)
      .not("booking_id", "is", null)
      .limit(1);
    expect(error).toBeNull();
    expect((data![0] as { local: { status: string } }).local.status).toBeTruthy();
  }, 30_000);

  // BRASIL, Apart CBA (14/11/2026): una reserva DIRECTA con $300.000 cobrados
  // se canceló porque Booking dejó de mostrar cerradas esas fechas.
  it("una reserva directa cargada a mano no recibe una propuesta de cancelación de la OTA", async () => {
    const { data: someone } = await admin.from("user_profiles").select("user_id").limit(1).single();
    const direct = await liveBooking(unit1, "2033-07-21", "2033-07-24", {
      source: "directo",
      created_by: someone!.user_id,
      total_amount: 300000,
    });
    const { data: res } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link1,
        unit_id: unit1,
        channel: "airbnb",
        booking_id: direct,
        external_status: "active",
        check_in: "2033-07-21",
        check_out: "2033-07-24",
        ical_uid: "zzt-foreign@airbnb.com",
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    expect(await vanish(res!.id)).toBe(0);

    const { data: booking } = await admin.from("bookings").select("status").eq("id", direct).single();
    expect(booking!.status).toBe("confirmada");
    const { count } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", direct);
    expect(count).toBe(0);
    // La fila se suelta: si el evento vuelve, se vincula de nuevo.
    const { data: row } = await admin
      .from("channel_reservations")
      .select("external_status, booking_id")
      .eq("id", res!.id)
      .single();
    expect(row).toMatchObject({ external_status: "cancelled", booking_id: null });
    // Queda una novedad, sin botón de cancelar.
    const { data: note } = await admin
      .from("notifications")
      .select("severity, ref_id")
      .eq("organization_id", orgId)
      .eq("dedup_key", `ota_released:${res!.id}`)
      .single();
    expect(note).toMatchObject({ severity: "info", ref_id: direct });
  }, 90_000);

  it("la misma reserva cargada a mano CON el origen del canal sí se pregunta", async () => {
    const { data: someone } = await admin.from("user_profiles").select("user_id").limit(1).single();
    const own = await liveBooking(unit1, "2033-08-21", "2033-08-24", {
      source: "airbnb",
      created_by: someone!.user_id,
    });
    const { data: res } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link1,
        unit_id: unit1,
        channel: "airbnb",
        booking_id: own,
        external_status: "active",
        check_in: "2033-08-21",
        check_out: "2033-08-24",
        ical_uid: "zzt-own-hand@airbnb.com",
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(await vanish(res!.id)).toBe(1);
    const { data: booking } = await admin.from("bookings").select("status").eq("id", own).single();
    expect(booking!.status).toBe("confirmada");
  }, 90_000);

  // Cofico Ideal, Habitana (17 y 18/11/2026): «Confirmá si se cancela una
  // reserva de Booking», sin unidad, sin huésped y sin reserva detrás.
  it("una estadía de la OTA que nunca se cargó y deja de publicarse se cierra sola, con su conflicto", async () => {
    const { data: res } = await admin
      .from("channel_reservations")
      .insert({
        organization_id: orgId,
        link_id: link1,
        unit_id: unit1,
        channel: "airbnb",
        external_status: "active",
        check_in: "2033-09-22",
        check_out: "2033-09-25",
        ical_uid: "zzt-unprojected@airbnb.com",
        last_seen_at: new Date().toISOString(),
        // una persona ya había contestado «mantener»: sin reserva, no aplica
        cancellation_locked_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    await admin.from("channel_issues").insert({
      organization_id: orgId,
      link_id: link1,
      reservation_id: res!.id,
      issue_type: "conflict",
      severity: "critical",
      title: "Conflicto de prueba",
      dedupe_key: `conflict:${res!.id}`,
    });

    expect(await vanish(res!.id)).toBe(0);

    const { data: row } = await admin
      .from("channel_reservations")
      .select("external_status")
      .eq("id", res!.id)
      .single();
    expect(row!.external_status).toBe("cancelled");
    const { count } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", res!.id);
    expect(count).toBe(0);
    const { data: issue } = await admin
      .from("channel_issues")
      .select("status")
      .eq("dedupe_key", `conflict:${res!.id}`)
      .single();
    expect(issue!.status).toBe("resolved");
  }, 90_000);

  // ── Un calendario que vuelve a un estado anterior ─────────────────────────
  // La clave de un VEVENT sale de su contenido, así que la tercera lectura de
  // A → B → A trae la clave de la primera. Se descartaba por repetida y la fila
  // quedaba en B para siempre. GAMA, Viaggiato (19/11/2026): 26→30/11, después
  // 26→27 y de nuevo 26→30; acá figuraba 26→27 y Booking lo tenía cerrado
  // hasta el 30.
  const feedRead = async (uid: string, checkIn: string, checkOut: string) => {
    const { toReservationEvent } = await import("@/lib/channels/ical-adapter");
    return toReservationEvent({
      event: { uid, checkIn, checkOut, summary: "CLOSED - Not available", isBlock: false },
      organizationId: orgId,
      linkId: link1,
      unitId: unit1,
      channel: "booking",
    });
  };
  const eventsOf = async (uid: string) => {
    const { count } = await admin
      .from("channel_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("payload->>ical_uid", uid);
    return count ?? 0;
  };
  const checkOutOf = async (bookingId: string) => {
    const { data } = await admin.from("bookings").select("check_out_date").eq("id", bookingId).single();
    return data!.check_out_date as string;
  };

  it("A → B → A: el calendario vuelve a un estado anterior y la reserva lo sigue", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const uid = "zzt-bkg-flip-1@booking.com";
    const A = [inDays(400), inDays(404)] as const;
    const B = [inDays(400), inDays(401)] as const;

    const r1 = await ingestEvent(admin, await feedRead(uid, ...A));
    expect(r1.outcome).toBe("created");
    const bookingId = r1.bookingId!;

    expect((await ingestEvent(admin, await feedRead(uid, ...B))).outcome).toBe("updated");
    expect(await checkOutOf(bookingId)).toBe(B[1]);
    // la misma lectura otra vez sigue siendo un repetido
    expect((await ingestEvent(admin, await feedRead(uid, ...B))).outcome).toBe("duplicate");

    // vuelve a A: antes esto era «duplicate» y la reserva se quedaba en B
    const back = await ingestEvent(admin, await feedRead(uid, ...A));
    expect(back.outcome).toBe("updated");
    expect(back.bookingId).toBe(bookingId);
    expect(await checkOutOf(bookingId)).toBe(A[1]);
    expect(await eventsOf(uid)).toBe(3);

    // y deja de ser novedad en la lectura siguiente
    expect((await ingestEvent(admin, await feedRead(uid, ...A))).outcome).toBe("duplicate");
    expect(await eventsOf(uid)).toBe(3);

    // ir y venir otra vez entre los mismos dos estados tampoco se traba
    expect((await ingestEvent(admin, await feedRead(uid, ...B))).outcome).toBe("updated");
    expect(await checkOutOf(bookingId)).toBe(B[1]);
    expect((await ingestEvent(admin, await feedRead(uid, ...A))).outcome).toBe("updated");
    expect(await checkOutOf(bookingId)).toBe(A[1]);
    expect((await ingestEvent(admin, await feedRead(uid, ...A))).outcome).toBe("duplicate");
    expect(await eventsOf(uid)).toBe(5);
  }, 120_000);

  it("vuelve al estado anterior sobre una reserva que una persona canceló: entra como estadía nueva", async () => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const uid = "zzt-bkg-flip-2@booking.com";
    const A = [inDays(420), inDays(424)] as const;
    const B = [inDays(420), inDays(421)] as const;

    const r1 = await ingestEvent(admin, await feedRead(uid, ...A));
    expect(r1.outcome).toBe("created");
    expect((await ingestEvent(admin, await feedRead(uid, ...B))).outcome).toBe("updated");
    // la cancelan desde la ficha: la fila externa sigue `active`
    await admin
      .from("bookings")
      .update({ status: "cancelada", cancelled_at: new Date().toISOString() })
      .eq("id", r1.bookingId!);

    const back = await ingestEvent(admin, await feedRead(uid, ...A));
    expect(back.outcome).toBe("created");
    expect(back.bookingId).not.toBe(r1.bookingId);

    const { data: nueva } = await admin
      .from("bookings")
      .select("status, check_in_date, check_out_date")
      .eq("id", back.bookingId!)
      .single();
    expect(nueva).toMatchObject({ status: "confirmada", check_in_date: A[0], check_out_date: A[1] });
    // la cancelada queda como estaba, con sus fechas
    const { data: vieja } = await admin
      .from("bookings")
      .select("status, check_out_date")
      .eq("id", r1.bookingId!)
      .single();
    expect(vieja).toMatchObject({ status: "cancelada", check_out_date: B[1] });
  }, 120_000);

  // ── Un cierre que Booking deja de mostrar al leer nuestro calendario ───────
  // Cofico Ideal, Habitana: cada entrada del calendario de Booking desaparecía
  // minutos después de que Booking se bajara el nuestro. No es una cancelación
  // (absorbed-closure.ts) y no se pregunta.
  const vanishFromBooking = async (reservationId: string) => {
    const { proposeDisappearances } = await import("@/lib/channels/dispatch");
    const { data: linkRow } = await admin.from("channel_links").select("*").eq("id", link1).single();
    // la conexión de prueba es de Airbnb; la regla sólo mira Booking
    const bookingLink = { ...linkRow!, channel: "booking" as const };
    const { data: row } = await admin
      .from("channel_reservations")
      .select("*, local:bookings!channel_reservations_booking_id_fkey(status, cancelled_at)")
      .eq("id", reservationId)
      .single();
    return proposeDisappearances(admin, bookingLink, [row!], new Set(), "2040-12-31");
  };
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const closedInBooking = async (uid: string, from: number, readMinutesAgo: number) => {
    const { ingestEvent } = await import("@/lib/channels/ingest");
    const r = await ingestEvent(admin, await feedRead(uid, inDays(from), inDays(from + 3)));
    expect(r.outcome).toBe("created");
    // la reserva nació hace una hora y media; Booking leyó nuestro calendario
    // después y la entrada falta desde hace 31 minutos
    await admin.from("bookings").update({ created_at: minutesAgo(90) }).eq("id", r.bookingId!);
    await admin.from("channel_export_reads").insert({
      organization_id: orgId,
      unit_id: unit1,
      link_id: link1,
      reader: "booking",
      via: "link",
      http_status: 200,
      etag: "test",
      read_at: minutesAgo(readMinutesAgo),
    });
    await admin
      .from("channel_reservations")
      .update({ missing_since: minutesAgo(31), missing_runs: 5 })
      .eq("id", r.reservationId!);
    return r;
  };

  it("deja de publicarse justo después de que Booking lee nuestro calendario: no se pregunta y la reserva queda", async () => {
    await admin.from("channel_export_reads").delete().eq("organization_id", orgId);
    const r = await closedInBooking("zzt-bkg-absorbed-1@booking.com", 440, 34);

    expect(await vanishFromBooking(r.reservationId!)).toBe(0);

    const { data: row } = await admin
      .from("channel_reservations")
      .select("external_status, cancellation_locked_at, cancellation_locked_by, missing_since, missing_runs")
      .eq("id", r.reservationId!)
      .single();
    expect(row!.external_status).toBe("active");
    expect(row!.cancellation_locked_at).not.toBeNull();
    expect(row!.cancellation_locked_by).toBeNull();
    expect(row).toMatchObject({ missing_since: null, missing_runs: 0 });
    const { data: booking } = await admin.from("bookings").select("status").eq("id", r.bookingId!).single();
    expect(booking!.status).toBe("confirmada");
    const { count: asked } = await admin
      .from("channel_cancellation_requests")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", r.reservationId!);
    expect(asked).toBe(0);
    const { data: note } = await admin
      .from("notifications")
      .select("severity, title")
      .eq("organization_id", orgId)
      .eq("dedup_key", `ota_absorbed:${r.reservationId}`)
      .single();
    expect(note!.severity).toBe("info");
    expect(note!.title).toContain("Booking");
    // ya no se vuelve a mirar como ausente
    expect(await vanishFromBooking(r.reservationId!)).toBe(0);
  }, 120_000);

  it("si falta horas después de esa lectura, se pregunta como siempre", async () => {
    await admin.from("channel_export_reads").delete().eq("organization_id", orgId);
    // Booking leyó hace 75 minutos y la entrada siguió publicada 44 minutos más
    const r = await closedInBooking("zzt-bkg-absorbed-2@booking.com", 460, 75);

    expect(await vanishFromBooking(r.reservationId!)).toBe(1);

    const { data: req } = await admin
      .from("channel_cancellation_requests")
      .select("status, reason_code")
      .eq("reservation_id", r.reservationId!)
      .single();
    expect(req).toMatchObject({ status: "pending", reason_code: "missing_from_feed" });
    const { data: row } = await admin
      .from("channel_reservations")
      .select("cancellation_locked_at")
      .eq("id", r.reservationId!)
      .single();
    expect(row!.cancellation_locked_at).toBeNull();
  }, 120_000);
});
