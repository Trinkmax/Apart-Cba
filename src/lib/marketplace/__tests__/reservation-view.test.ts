import { describe, expect, it } from "vitest";
import {
  buildReservationView,
  effectiveMinNights,
  firstNameOf,
  isOverlapError,
  isValidIsoDate,
  normalizeEmail,
  normalizeWhatsapp,
  reservationCode,
  sniffReceiptMime,
  sortReservationItems,
  toReservationListItem,
  type BuildReservationViewInput,
  type ViewBookingRow,
  type ViewReportRow,
  type ViewRequestRow,
  type ViewUnitRow,
} from "@/lib/marketplace/reservation-view";
import { resolveWebSettings, type ResolvedWebSettings } from "@/lib/marketplace/web-settings";
import type { ReservationListItem } from "@/lib/marketplace/contracts";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const FUTURE = "2026-10-02T12:00:00.000Z";
const PAST = "2026-09-30T12:00:00.000Z";
const REQ_ID = "7f3a2c10-1111-4222-8333-944455556666";
const BK_ID = "b0b0c0c0-aaaa-4bbb-8ccc-dddddddddddd";

const SETTINGS: ResolvedWebSettings = resolveWebSettings(
  {
    whatsapp_number: "5493515639985",
    public_email: "reservas@apartcba.com",
    instagram_handle: "@apartcba",
    response_hours: 12,
    deposit_rule: "one_night",
    deposit_due_hours: 24,
    transfer_holder: "Apart CBA SRL",
    transfer_alias: "apart.cba.reservas",
    transfer_cbu: "0000003100012345678901",
  },
);

// 3 noches a $70.000 + $15.000 de limpieza = $225.000; seña de 1 noche = $70.000.
function req(over: Partial<ViewRequestRow> = {}): ViewRequestRow {
  return {
    id: REQ_ID,
    status: "pendiente",
    created_at: "2026-10-01T10:00:00.000Z",
    expires_at: FUTURE,
    approved_at: null,
    approved_by: null,
    rejection_reason: null,
    guest_full_name: "maría José Pérez",
    guest_email: "maria@example.com",
    guest_phone: "+5493515551234",
    check_in_date: "2026-10-10",
    check_out_date: "2026-10-13",
    guests_count: 2,
    currency: "ARS",
    total_amount: 225_000,
    cleaning_fee: 15_000,
    deposit_estimate: 70_000,
    ...over,
  };
}

function bk(over: Partial<ViewBookingRow> = {}): ViewBookingRow {
  return {
    id: BK_ID,
    status: "confirmada",
    created_at: "2026-10-01T11:00:00.000Z",
    check_in_date: "2026-10-10",
    check_out_date: "2026-10-13",
    guests_count: 2,
    currency: "ARS",
    total_amount: 225_000,
    paid_amount: 0,
    cleaning_fee: 15_000,
    deposit_amount: 70_000,
    ...over,
  };
}

const UNIT: ViewUnitRow = {
  id: "u1",
  slug: "parana-nueva-cordoba",
  name: "PARANA -Nueva Córdoba ",
  marketplace_title: null,
  neighborhood: "NUEVA CORDBA",
  bedrooms: 1,
  address: "Paraná 450, 5° B",
  cover_url: "https://x.supabase.co/cover.jpg",
  check_in_window_start: "14:00:00",
  check_in_window_end: "22:00:00",
  cancellation_policy: "moderada",
};

function report(over: Partial<ViewReportRow> = {}): ViewReportRow {
  return {
    id: "r1",
    created_at: "2026-10-01T11:30:00.000Z",
    amount: 70_000,
    status: "pendiente",
    receipt_path: "org/bk/file.jpg",
    ...over,
  };
}

function view(over: Partial<BuildReservationViewInput> = {}) {
  return buildReservationView({
    request: req(),
    booking: null,
    unit: UNIT,
    reports: [],
    settings: SETTINGS,
    statusPath: "/reserva/tok",
    now: NOW,
    ...over,
  });
}

describe("helpers", () => {
  it("reservationCode: AP- + 6 caracteres en mayúsculas", () => {
    expect(reservationCode(REQ_ID)).toBe("AP-7F3A2C");
  });
  it("firstNameOf capitaliza el primer nombre", () => {
    expect(firstNameOf("  maría José Pérez ")).toBe("María");
    expect(firstNameOf("")).toBe("");
  });
  it("isValidIsoDate rechaza fechas imposibles", () => {
    expect(isValidIsoDate("2026-10-10")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("10/10/2026")).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });
  it("normalizeEmail", () => {
    expect(normalizeEmail("  Maria@Example.COM ")).toBe("maria@example.com");
  });
  it("isOverlapError reconoce los dos constraints", () => {
    expect(isOverlapError('conflicting key value violates exclusion constraint "bookings_no_overlap"')).toBe(true);
    expect(isOverlapError("booking_requests_no_overlap")).toBe(true);
    expect(isOverlapError("otra cosa")).toBe(false);
    expect(isOverlapError(null)).toBe(false);
  });
});

describe("normalizeWhatsapp", () => {
  it("número de Córdoba sin código de país → +549", () => {
    expect(normalizeWhatsapp("351 555-1234")).toBe("+5493515551234");
    expect(normalizeWhatsapp("0351 5551234")).toBe("+5493515551234");
  });
  it("con +54 sin el 9 → agrega el 9 de celular", () => {
    expect(normalizeWhatsapp("+54 351 555 1234")).toBe("+5493515551234");
    expect(normalizeWhatsapp("54 351 5551234")).toBe("+5493515551234");
  });
  it("ya completo o de otro país → se respeta", () => {
    expect(normalizeWhatsapp("+54 9 351 555-1234")).toBe("+5493515551234");
    expect(normalizeWhatsapp("+598 99 123 456")).toBe("+59899123456");
    expect(normalizeWhatsapp("0034 612 345 678")).toBe("+34612345678");
  });
  it("basura o muy corto → null", () => {
    expect(normalizeWhatsapp("")).toBeNull();
    expect(normalizeWhatsapp("hola")).toBeNull();
    expect(normalizeWhatsapp("12345")).toBeNull();
    expect(normalizeWhatsapp("+1234567890123456")).toBeNull();
  });
});

describe("effectiveMinNights", () => {
  const rules = [
    { id: "fin-de-anio", min_nights_override: 5 },
    { id: "finde", min_nights_override: 2 },
    { id: "sin-minimo", min_nights_override: null },
  ];
  it("sin reglas usadas → el mínimo de la unidad", () => {
    expect(effectiveMinNights({ unitMinNights: 2, rules, pricedNights: [{ rule_id: null }] })).toBe(2);
  });
  it("una regla que tarifa alguna noche sube el mínimo", () => {
    const priced = [{ rule_id: null }, { rule_id: "fin-de-anio" }];
    expect(effectiveMinNights({ unitMinNights: 2, rules, pricedNights: priced })).toBe(5);
  });
  it("una regla con mínimo menor no lo baja", () => {
    expect(effectiveMinNights({ unitMinNights: 3, rules, pricedNights: [{ rule_id: "finde" }] })).toBe(3);
  });
  it("mínimo nulo o inválido → 1", () => {
    expect(effectiveMinNights({ unitMinNights: null, rules: [], pricedNights: [] })).toBe(1);
    expect(effectiveMinNights({ unitMinNights: 0, rules: [], pricedNights: [] })).toBe(1);
  });
});

describe("buildReservationView — pedido enviado", () => {
  const v = view();
  it("etapa, código, copy y línea de tiempo", () => {
    expect(v.stage).toBe("pedido_enviado");
    expect(v.code).toBe("AP-7F3A2C");
    expect(v.copy.pill).toBe("Esperando confirmación");
    expect(v.timeline.map((s) => s.state)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(v.request_id).toBe(REQ_ID);
    expect(v.booking_id).toBeNull();
    expect(v.status_path).toBe("/reserva/tok");
    expect(v.instant).toBe(false);
  });
  it("vencimiento visible, se puede cancelar, no se puede avisar pago", () => {
    expect(v.expires_at).toBe(FUTURE);
    expect(v.can_cancel).toBe(true);
    expect(v.can_report_payment).toBe(false);
  });
  it("seña estimada, sin datos de transferencia ni dirección", () => {
    expect(v.money).toMatchObject({
      total: 225_000,
      sena: 70_000,
      sena_is_estimate: true,
      resto: 155_000,
      paid: 0,
      sena_due_at: null,
      sena_covered: false,
    });
    expect(v.transfer).toBeNull();
    expect(v.unit.address).toBeNull();
  });
  it("datos de la unidad para mostrar", () => {
    expect(v.unit).toMatchObject({
      title: "Paraná",
      tagline: null,
      hood: "Nueva Córdoba",
      summary_line: "Depto de 1 dormitorio en Nueva Córdoba",
      check_in_window: "de 14 a 22 h",
      slug: "parana-nueva-cordoba",
    });
    expect(v.stay).toEqual({ check_in: "2026-10-10", check_out: "2026-10-13", nights: 3, guests: 2 });
  });
  it("contacto con WhatsApp precargado (sin emojis) y huésped", () => {
    expect(v.contact.whatsapp_url).toBe(
      "https://wa.me/5493515639985?text=" +
        encodeURIComponent("Hola, soy maría José Pérez. Te escribo por mi reserva AP-7F3A2C en Paraná."),
    );
    expect(v.contact.email).toBe("reservas@apartcba.com");
    expect(v.contact.instagram).toBe("apartcba");
    expect(v.response_hours).toBe(12);
    expect(v.guest).toEqual({ first_name: "María", email: "maria@example.com", phone: "+5493515551234" });
    expect(v.cancellation?.title).toBe("Cancelación moderada");
    expect(v.cancellation?.body).toContain("lo cancelás sin costo desde este link");
  });
});

describe("buildReservationView — política de cancelación según la etapa", () => {
  it("confirmada: la regla de la política y cómo cancelar, sin 'antes de pedirla'", () => {
    const v = view({ request: req({ status: "aprobada", approved_at: "2026-10-01T11:00:00.000Z", approved_by: "staff-1" }), booking: bk() });
    expect(v.stage).toBe("sena_pendiente");
    expect(v.cancellation?.body).toContain("Para cancelar, escribinos.");
    expect(v.cancellation?.body).not.toContain("antes de pedirla");
  });
  it("cerrada: no se muestra", () => {
    const v = view({ request: req({ status: "cancelada" }) });
    expect(v.stage).toBe("pedido_cancelado");
    expect(v.cancellation).toBeNull();
  });
});

describe("buildReservationView — confirmada por el equipo", () => {
  const approved = req({ status: "aprobada", approved_at: "2026-10-01T11:00:00.000Z", approved_by: "staff-1" });

  it("seña pendiente: datos de transferencia, vencimiento, avisar pago, dirección", () => {
    const v = view({ request: approved, booking: bk() });
    expect(v.stage).toBe("sena_pendiente");
    expect(v.instant).toBe(false);
    expect(v.timeline.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(v.transfer).toEqual(SETTINGS.transfer);
    expect(v.transfer?.alias).toBe("apart.cba.reservas");
    expect(v.money.sena).toBe(70_000);
    expect(v.money.sena_is_estimate).toBe(false);
    expect(v.money.sena_due_at).toBe("2026-10-02T11:00:00.000Z");
    expect(v.can_report_payment).toBe(true);
    expect(v.can_cancel).toBe(false);
    expect(v.expires_at).toBeNull();
    expect(v.unit.address).toBe("Paraná 450, 5° B");
  });

  it("sin datos de transferencia cargados → transfer null (se pasan por WhatsApp)", () => {
    const settings = { ...SETTINGS, transfer: null };
    const v = view({ request: approved, booking: bk(), settings });
    expect(v.stage).toBe("sena_pendiente");
    expect(v.transfer).toBeNull();
  });

  it("el monto que fija el equipo manda sobre la estimación", () => {
    const v = view({ request: approved, booking: bk({ deposit_amount: 100_000 }) });
    expect(v.money.sena).toBe(100_000);
    expect(v.money.resto).toBe(125_000);
  });

  it("aviso de pago pendiente → sena_informada, sigue mostrando transferencia", () => {
    const v = view({ request: approved, booking: bk(), reports: [report()] });
    expect(v.stage).toBe("sena_informada");
    expect(v.transfer).not.toBeNull();
    expect(v.can_report_payment).toBe(true);
    expect(v.payment_reports).toEqual([
      { id: "r1", created_at: "2026-10-01T11:30:00.000Z", amount: 70_000, status: "pendiente", has_receipt: true },
    ]);
  });

  it("con 5 avisos pendientes ya no se puede avisar otro", () => {
    const reports = [1, 2, 3, 4, 5].map((i) => report({ id: `r${i}`, created_at: `2026-10-01T11:3${i}:00.000Z` }));
    const v = view({ request: approved, booking: bk(), reports });
    expect(v.can_report_payment).toBe(false);
    expect(v.payment_reports.map((r) => r.id)).toEqual(["r5", "r4", "r3", "r2", "r1"]);
  });

  it("seña cobrada en Caja → asegurada, sin transferencia, con dirección y resto", () => {
    const v = view({ request: approved, booking: bk({ paid_amount: 70_000 }), reports: [report({ status: "registrado" })] });
    expect(v.stage).toBe("reserva_asegurada");
    expect(v.money.sena_covered).toBe(true);
    expect(v.money.resto).toBe(155_000);
    expect(v.transfer).toBeNull();
    expect(v.can_report_payment).toBe(false);
    expect(v.unit.address).toBe("Paraná 450, 5° B");
  });

  it("si pagó más que la seña, al llegar paga lo que falta", () => {
    const v = view({ request: approved, booking: bk({ paid_amount: 200_000 }) });
    expect(v.money.resto).toBe(25_000);
    expect(v.money.paid).toBe(200_000);
  });

  it("sin seña (0 explícito del equipo) → asegurada y el paso de la seña se saltea", () => {
    const v = view({ request: approved, booking: bk({ deposit_amount: 0 }) });
    expect(v.stage).toBe("reserva_asegurada");
    expect(v.money.sena).toBeNull();
    expect(v.money.sena_due_at).toBeNull();
    expect(v.money.resto).toBe(225_000);
    expect(v.timeline.find((s) => s.key === "sena")?.state).toBe("skipped");
  });

  it("la reserva editada por el equipo manda en fechas y total", () => {
    const v = view({
      request: approved,
      booking: bk({ check_out_date: "2026-10-14", total_amount: 295_000, deposit_amount: 70_000 }),
    });
    expect(v.stay.nights).toBe(4);
    expect(v.money.total).toBe(295_000);
  });

  it("en curso / finalizada / cancelada", () => {
    expect(view({ request: approved, booking: bk({ status: "check_in", paid_amount: 70_000 }) }).stage).toBe(
      "estadia_en_curso",
    );
    const done = view({ request: approved, booking: bk({ status: "check_out", paid_amount: 225_000 }) });
    expect(done.stage).toBe("estadia_finalizada");
    expect(done.unit.address).toBeNull();
    const cancelled = view({ request: approved, booking: bk({ status: "cancelada" }) });
    expect(cancelled.stage).toBe("reserva_cancelada");
    expect(cancelled.unit.address).toBeNull();
    expect(cancelled.transfer).toBeNull();
    expect(cancelled.can_report_payment).toBe(false);
  });

  it("aprobada pero la reserva ya no existe → cancelada", () => {
    const v = view({ request: approved, booking: null });
    expect(v.stage).toBe("reserva_cancelada");
    expect(v.money.sena_due_at).toBeNull();
    expect(v.unit.address).toBeNull();
  });
});

describe("buildReservationView — reserva inmediata y reservas viejas", () => {
  it("inmediata: solicitud aprobada sin persona + reserva → instant, seña pendiente", () => {
    const instantReq = req({ status: "aprobada", approved_at: "2026-10-01T10:00:00.000Z", approved_by: null });
    const v = view({ request: instantReq, booking: bk() });
    expect(v.instant).toBe(true);
    expect(v.stage).toBe("sena_pendiente");
    expect(v.money.sena_due_at).toBe("2026-10-02T10:00:00.000Z");
  });

  it("reserva vieja sin solicitud: sin link de seguimiento, código del booking, seña por política", () => {
    const v = view({
      request: null,
      booking: bk({ deposit_amount: null }),
      statusPath: "/reserva/no-deberia-usarse",
      guestFallback: { full_name: "Juan Gómez", email: "juan@example.com", phone: null },
    });
    expect(v.request_id).toBeNull();
    expect(v.status_path).toBeNull();
    expect(v.booking_id).toBe(BK_ID);
    expect(v.code).toBe("AP-B0B0C0");
    expect(v.instant).toBe(true);
    // Sin monto del equipo ni estimación: la regla (1 noche = subtotal ÷ noches).
    expect(v.money.sena).toBe(70_000);
    expect(v.money.sena_is_estimate).toBe(true);
    expect(v.money.sena_due_at).toBe("2026-10-02T11:00:00.000Z");
    expect(v.guest).toEqual({ first_name: "Juan", email: "juan@example.com", phone: null });
    expect(v.created_at).toBe("2026-10-01T11:00:00.000Z");
  });

  it("sin solicitud ni reserva → error de programación", () => {
    expect(() => view({ request: null, booking: null })).toThrow();
  });
});

describe("buildReservationView — pedidos que no siguieron", () => {
  it("vencido por plazo (sin barrer todavía): sin vencimiento ni cancelar", () => {
    const v = view({ request: req({ expires_at: PAST }) });
    expect(v.stage).toBe("pedido_vencido");
    expect(v.expires_at).toBeNull();
    expect(v.can_cancel).toBe(false);
    expect(v.timeline.map((s) => s.state)).toEqual(["done", "failed", "skipped", "skipped"]);
  });

  it("rechazado muestra el motivo; los otros estados no", () => {
    const v = view({ request: req({ status: "rechazada", rejection_reason: "  Unidad en mantenimiento " }) });
    expect(v.stage).toBe("pedido_rechazado");
    expect(v.rejection_reason).toBe("Unidad en mantenimiento");
    expect(v.can_cancel).toBe(false);
    const cancelled = view({ request: req({ status: "cancelada", rejection_reason: "x" }) });
    expect(cancelled.stage).toBe("pedido_cancelado");
    expect(cancelled.rejection_reason).toBeNull();
    expect(view({ request: req({ status: "expirada" }) }).stage).toBe("pedido_vencido");
  });

  it("política sin seña: el pedido no promete seña", () => {
    const settings = resolveWebSettings({ deposit_rule: "none" });
    const v = view({ request: req({ deposit_estimate: null }), settings });
    expect(v.money.sena).toBeNull();
    expect(v.money.resto).toBe(225_000);
    expect(v.timeline.find((s) => s.key === "sena")?.state).toBe("skipped");
    expect(v.contact.whatsapp_url).toBeNull();
  });
});

describe("Mis reservas", () => {
  function item(over: Partial<ReservationListItem>): ReservationListItem {
    return {
      key: "k",
      href: "/reserva/x",
      title: "Paraná",
      hood: null,
      cover_url: null,
      check_in: "2026-10-10",
      check_out: "2026-10-12",
      nights: 2,
      guests: 2,
      total: 1,
      currency: "ARS",
      stage: "pedido_enviado",
      pill: "",
      tone: "info",
      created_at: "2026-10-01T10:00:00.000Z",
      ...over,
    };
  }

  it("toReservationListItem: link de seguimiento o detalle en mi cuenta", () => {
    const withToken = toReservationListItem(view());
    expect(withToken).toMatchObject({
      key: REQ_ID,
      href: "/reserva/tok",
      title: "Paraná",
      hood: "Nueva Córdoba",
      nights: 3,
      total: 225_000,
      stage: "pedido_enviado",
      pill: "Esperando confirmación",
      tone: "info",
    });
    const old = toReservationListItem(view({ request: null, booking: bk() }));
    expect(old.key).toBe(BK_ID);
    expect(old.href).toBe(`/mi-cuenta/reservas/${BK_ID}`);
  });

  it("orden: vivas por llegada más próxima, después el historial más reciente", () => {
    const sorted = sortReservationItems([
      item({ key: "old-done", stage: "estadia_finalizada", check_in: "2026-01-05" }),
      item({ key: "later", stage: "reserva_asegurada", check_in: "2026-12-01" }),
      item({ key: "cancel-recent", stage: "pedido_cancelado", check_in: "2026-11-01" }),
      item({ key: "sooner", stage: "pedido_enviado", check_in: "2026-10-10" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["sooner", "later", "cancel-recent", "old-done"]);
  });
});

describe("sniffReceiptMime", () => {
  const bytes = (...parts: (number[] | string)[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
  it("reconoce imágenes y PDF por su firma", () => {
    expect(sniffReceiptMime(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF"))).toBe("image/jpeg");
    expect(sniffReceiptMime(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffReceiptMime(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffReceiptMime(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0]))).toBe("image/heic");
    expect(sniffReceiptMime(bytes([0, 0, 0, 0x18], "ftypmif1", [0, 0, 0, 0]))).toBe("image/heif");
    expect(sniffReceiptMime(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffReceiptMime(bytes([0xef, 0xbb, 0xbf], "%PDF-1.4"))).toBe("application/pdf");
  });
  it("rechaza lo demás", () => {
    expect(sniffReceiptMime(bytes("<html><script>"))).toBeNull();
    expect(sniffReceiptMime(bytes([0, 0, 0, 0x18], "ftypavif", [0, 0, 0, 0]))).toBeNull();
    expect(sniffReceiptMime(new Uint8Array())).toBeNull();
  });
});
