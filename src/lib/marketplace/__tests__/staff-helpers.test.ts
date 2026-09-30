import { describe, expect, it } from "vitest";
import {
  aliasError,
  buildConfirmationMessage,
  buildSenaOptions,
  cbuChecksumOk,
  cbuError,
  clampSena,
  cuitChecksumOk,
  cuitError,
  dateTimeLabel,
  expiryInfo,
  firstName,
  formatCuit,
  normalizeInstagram,
  senaExample,
  senaStatus,
  shortDayLabel,
  staysOverlap,
  stayRangeLabel,
  suggestedSena,
  toWhatsappDigits,
  validateWebSettingsInput,
  type WebSettingsInput,
} from "@/lib/marketplace/staff-helpers";

// Mensaje al huésped: "$ 70.000" sin centavos (como la web y los mails).
const plain = (n: number) => `$ ${n.toLocaleString("es-AR")}`;

describe("opciones de seña del modal de confirmación", () => {
  // 3 noches de 70.000 + 15.000 de limpieza
  const stay = { nights: 3, total: 225_000, cleaningFee: 15_000, currency: "ARS" };

  it("1 noche primero (sin limpieza), 2 noches, 50 % y Sin seña", () => {
    expect(buildSenaOptions(stay)).toEqual([
      { label: "1 noche", amount: 70_000 },
      { label: "2 noches", amount: 140_000 },
      { label: "50 %", amount: 112_500 },
      { label: "Sin seña", amount: 0 },
    ]);
  });

  it("una sola noche: no ofrece 2 noches; montos repetidos se quedan con la primera etiqueta", () => {
    const opts = buildSenaOptions({ nights: 2, total: 140_000, cleaningFee: 0 });
    // 1 noche = 70.000 = 50 % → queda "1 noche"
    expect(opts.map((o) => o.label)).toEqual(["1 noche", "2 noches", "Sin seña"]);
    expect(buildSenaOptions({ nights: 1, total: 80_000, cleaningFee: 10_000 }).map((o) => o.label)).toEqual([
      "1 noche",
      "50 %",
      "Sin seña",
    ]);
  });

  it("suma el % de la política si no es 50", () => {
    const opts = buildSenaOptions({ ...stay, policy: { rule: "percent", percent: 30 } });
    expect(opts.find((o) => o.label === "30 %")?.amount).toBe(67_500);
  });

  it("propone la estimada que vio el huésped; si no hay, la de la política", () => {
    const policy = { rule: "one_night" as const, percent: null };
    expect(suggestedSena({ ...stay, estimate: 65_000, policy })).toBe(65_000);
    expect(suggestedSena({ ...stay, estimate: null, policy })).toBe(70_000);
    expect(suggestedSena({ ...stay, estimate: null, policy: { rule: "none", percent: null } })).toBeNull();
  });

  it("clampSena: vacío → 0, nunca más que el total, NaN inválido", () => {
    expect(clampSena(null, 100)).toBe(0);
    expect(clampSena(-5, 100)).toBe(0);
    expect(clampSena(500, 100)).toBe(100);
    expect(clampSena(Number.NaN, 100)).toBeNull();
    expect(clampSena(70_000.4, 225_000)).toBe(70_000);
  });

  it("ejemplo vivo de la configuración", () => {
    expect(senaExample({ rule: "one_night", percent: null })).toMatchObject({ sena: 70_000, resto: 140_000 });
    expect(senaExample({ rule: "percent", percent: 30 })).toMatchObject({ sena: 63_000, resto: 147_000 });
    expect(senaExample({ rule: "none", percent: null })).toMatchObject({ sena: null, resto: 210_000 });
  });
});

describe("validación de Web y cobros", () => {
  it("WhatsApp argentino en cualquier formato → 549 + 10 cifras", () => {
    expect(toWhatsappDigits("+54 9 351 563-9985")).toBe("5493515639985");
    expect(toWhatsappDigits("0351 15 563-9985")).toBe("5493515639985");
    expect(toWhatsappDigits("351 5639985")).toBe("5493515639985");
    expect(toWhatsappDigits("+54 351 563 9985")).toBe("5493515639985");
    expect(toWhatsappDigits("11 15 1234 5678")).toBe("5491112345678");
    expect(toWhatsappDigits("+1 305 555 0100")).toBe("13055550100");
    expect(toWhatsappDigits("")).toBe("");
  });

  it("CBU: 22 números y dígitos verificadores", () => {
    expect(cbuError("123")).toMatch(/22 números/);
    expect(cbuError("2850590940090418135201")).toBeNull();
    expect(cbuChecksumOk("2850590940090418135201")).toBe(true);
    expect(cbuChecksumOk("2850590940090418135202")).toBe(false);
  });

  it("CUIT: 11 números, verificador y formato", () => {
    expect(cuitError("2017254359")).toMatch(/11 números/);
    expect(cuitChecksumOk("20172543597")).toBe(true);
    expect(cuitChecksumOk("20172543598")).toBe(false);
    expect(formatCuit("20172543597")).toBe("20-17254359-7");
  });

  it("alias e Instagram", () => {
    expect(aliasError("apart.cba")).toBeNull();
    expect(aliasError("corto")).toMatch(/entre 6 y 20/);
    expect(aliasError("con_guion_bajo")).toMatch(/letras, números/);
    expect(normalizeInstagram("@apart.cba")).toBe("apart.cba");
    expect(normalizeInstagram("https://www.instagram.com/apart.cba/")).toBe("apart.cba");
  });

  const base: WebSettingsInput = {
    whatsapp_number: "351 563-9985",
    public_email: " Hola@Apartcba.com ",
    instagram_handle: "@apart.cba",
    response_hours: "24",
    deposit_rule: "one_night",
    deposit_percent: null,
    deposit_due_hours: 24,
    transfer_holder: " Apart SRL ",
    transfer_cuit: "20172543597",
    transfer_bank: "",
    transfer_cbu: "2850 5909 4009 0418 1352 01",
    transfer_alias: "Apart.CBA",
    transfer_notes: "",
    cancellation_text: "",
  };

  it("normaliza lo que se guarda", () => {
    const r = validateWebSettingsInput(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      whatsapp_number: "5493515639985",
      public_email: "hola@apartcba.com",
      instagram_handle: "apart.cba",
      response_hours: 24,
      deposit_percent: null,
      transfer_holder: "Apart SRL",
      transfer_cuit: "20-17254359-7",
      transfer_bank: null,
      transfer_cbu: "2850590940090418135201",
      transfer_alias: "apart.cba",
    });
  });

  it("devuelve el campo con error", () => {
    expect(validateWebSettingsInput({ ...base, response_hours: 72 })).toMatchObject({ ok: false, field: "response_hours" });
    expect(validateWebSettingsInput({ ...base, deposit_rule: "percent", deposit_percent: "" })).toMatchObject({
      ok: false,
      field: "deposit_percent",
    });
    expect(validateWebSettingsInput({ ...base, deposit_due_hours: 200 })).toMatchObject({ ok: false, field: "deposit_due_hours" });
    expect(validateWebSettingsInput({ ...base, transfer_cbu: "123" })).toMatchObject({ ok: false, field: "transfer_cbu" });
    expect(validateWebSettingsInput({ ...base, whatsapp_number: "12" })).toMatchObject({ ok: false, field: "whatsapp_number" });
  });
});

describe("fechas, vencimientos y seña de una reserva", () => {
  it("etiquetas es-AR armadas desde ISO", () => {
    expect(shortDayLabel("2026-10-03")).toBe("sáb 3 oct");
    expect(stayRangeLabel("2026-10-02", "2026-10-04")).toBe("vie 2 oct → dom 4 oct · 2 noches");
    expect(stayRangeLabel("2026-10-02", "2026-10-03")).toBe("vie 2 oct → sáb 3 oct · 1 noche");
  });

  it("vencimiento: urgente con menos de 6 h", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(expiryInfo("2026-10-01T17:20:00Z", now)).toEqual({ expired: false, urgent: true, label: "Vence en 5 h 20 min" });
    expect(expiryInfo("2026-10-02T12:00:00Z", now)).toEqual({ expired: false, urgent: false, label: "Vence en 24 h" });
    expect(expiryInfo("2026-10-01T12:30:00Z", now).label).toBe("Vence en 30 min");
    expect(expiryInfo("2026-10-01T11:00:00Z", now)).toMatchObject({ expired: true, label: "Venció" });
  });

  it("superposición con el día de salida libre", () => {
    expect(staysOverlap("2026-10-01", "2026-10-03", "2026-10-03", "2026-10-05")).toBe(false);
    expect(staysOverlap("2026-10-01", "2026-10-04", "2026-10-03", "2026-10-05")).toBe(true);
  });

  it("seña cubierta, faltante y vencida", () => {
    const now = Date.parse("2026-10-02T00:00:00Z");
    expect(senaStatus({ sena: 70_000, paid: 70_000, dueAt: null, nowMs: now })).toMatchObject({ covered: true, missing: 0 });
    expect(senaStatus({ sena: 70_000, paid: 20_000, dueAt: "2026-10-01T00:00:00Z", nowMs: now })).toMatchObject({
      covered: false,
      missing: 50_000,
      overdue: true,
    });
    expect(senaStatus({ sena: null, paid: 0, dueAt: null, nowMs: now })).toMatchObject({ covered: true, overdue: false });
  });
});

describe("mensaje para WhatsApp", () => {
  const input = {
    guestName: "maría josé pérez",
    unitTitle: "Paraná",
    checkIn: "2026-10-02",
    checkOut: "2026-10-05",
    nights: 3,
    guests: 2,
    total: 225_000,
    currency: "ARS",
    sena: 70_000,
    dueHours: 24,
    transfer: { holder: "Apart SRL", cuit: null, bank: "Galicia", cbu: null, alias: "apart.cba", notes: null },
    trackingUrl: "https://www.apartcba.com/reserva/abc",
  };

  it("incluye seña, datos, plazo, resto y link, sin emojis", () => {
    const text = buildConfirmationMessage(input);
    expect(text).toContain("Hola María, te confirmamos la reserva en Paraná.");
    expect(text).toContain(`transferí la seña de ${plain(70_000)} dentro de las próximas 24 horas`);
    expect(text).toContain("Alias: apart.cba");
    expect(text).toContain(`El resto (${plain(155_000)}) lo pagás al llegar`);
    expect(text).toContain("https://www.apartcba.com/reserva/abc");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("sin datos cargados avisa que van por WhatsApp; sin seña, todo al llegar", () => {
    expect(buildConfirmationMessage({ ...input, transfer: null })).toContain("Te pasamos los datos para transferir por acá.");
    expect(buildConfirmationMessage({ ...input, sena: 0 })).toContain("No hace falta seña");
  });

  it("primer nombre con mayúscula", () => {
    expect(firstName("  ana  lópez")).toBe("Ana");
    expect(firstName("")).toBe("");
  });
});

describe("fecha y hora para el panel", () => {
  it("muestra día y hora en la zona de Córdoba (UTC-3)", () => {
    expect(dateTimeLabel("2026-10-02T17:30:00Z")).toBe("vie 2 oct · 14:30");
    // 01:15 UTC del 3 es todavía el 2 a la noche en Argentina.
    expect(dateTimeLabel("2026-10-03T01:15:00Z")).toBe("vie 2 oct · 22:15");
  });
  it("vacío o inválido → texto vacío", () => {
    expect(dateTimeLabel(null)).toBe("");
    expect(dateTimeLabel("no-es-fecha")).toBe("");
  });
});
