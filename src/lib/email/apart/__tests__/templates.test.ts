import { beforeAll, describe, expect, it } from "vitest";
import { escapeHtml, headlineHtml, renderApartEmail, safeHref } from "../layout";
import { firstName, fmtDateTimeAR, fmtDayLong, fmtDayShort, fmtStayRange, money, nightsLabel, reservationCode } from "../format";
import {
  renderDepositRegisteredEmail,
  renderPaymentReportedGuestEmail,
  renderRequestExpiredEmail,
  renderRequestReceivedEmail,
  renderRequestRejectedEmail,
  renderReservationConfirmedEmail,
  renderStaffNewRequestEmail,
  renderStaffPaymentReportedEmail,
  renderStaffRequestReminderEmail,
  type GuestEmailBase,
  type RenderedEmail,
  type StaffEmailBase,
} from "../templates";

const STATUS_URL = "https://www.apartcba.com/reserva/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const PANEL_URL = "https://www.apartcba.com/dashboard/reservas-pendientes/2f9c1d0e-aaaa-bbbb-cccc-111122223333";
const EVIL = `<script>alert("x")</script>`;

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://www.apartcba.com\n";
});

function guestBase(overrides: Partial<GuestEmailBase> = {}): GuestEmailBase {
  return {
    guestFirstName: "Lucía",
    code: "AP-2F9C1D",
    statusUrl: STATUS_URL,
    stay: {
      unitTitle: "Paraná",
      hood: "Nueva Córdoba",
      checkIn: "2026-10-02",
      checkOut: "2026-10-05",
      nights: 3,
      guests: 2,
    },
    money: { currency: "ARS", total: 210000, sena: 70000, resto: 140000 },
    contact: {
      whatsappUrl: "https://wa.me/5493515639985?text=Hola",
      whatsappLabel: "+54 9 351 563-9985",
      email: "hola@apartcba.com",
      instagram: "apart.cba",
    },
    ...overrides,
  };
}

function staffBase(overrides: Partial<StaffEmailBase> = {}): StaffEmailBase {
  return {
    guest: {
      fullName: "Lucía Gómez",
      email: "lucia@example.com",
      phone: "+54 9 351 555-1234",
      phoneWaUrl: "https://wa.me/5493515551234?text=Hola%20Luc%C3%ADa",
      document: "30111222",
      message: "Llegamos tarde\n¿se puede?",
    },
    code: "AP-2F9C1D",
    stay: guestBase().stay,
    money: { currency: "ARS", total: 210000, sena: 70000, resto: 140000 },
    panelUrl: PANEL_URL,
    statusUrl: STATUS_URL,
    ...overrides,
  };
}

/** Chequeos que valen para todos los mails. */
function expectBrandBasics(mail: RenderedEmail, opts?: { userMarkupInText?: boolean }) {
  expect(mail.subject.length).toBeGreaterThan(5);
  expect(mail.html).toContain("<!doctype html>");
  expect(mail.html).toContain(
    `src="https://www.apartcba.com/apart/email/apart-lockup-cream@2x.png" width="120" height="36"`,
  );
  expect(mail.html).toContain("#F6F0E4");
  expect(mail.html).toContain("#145447");
  expect(mail.html).toContain("Buenas estancias, mejores historias.");
  for (const s of [mail.subject, mail.html, mail.text]) {
    expect(s).not.toMatch(/anfitri/i);
    expect(s).not.toContain("ApartCBA");
    expect(s).not.toContain("rentOS");
    expect(s).not.toContain("undefined");
    expect(s).not.toContain("NaN");
    expect(s).not.toContain("null");
  }
  // El texto plano no lleva HTML (salvo que el dato del huésped lo traiga).
  if (!opts?.userMarkupInText) expect(mail.text).not.toMatch(/<[a-z][^>]*>/i);
}

describe("format", () => {
  it("fechas es-AR sin depender del huso del servidor", () => {
    expect(fmtDayShort("2026-10-02")).toBe("vie 2 oct");
    expect(fmtDayLong("2026-10-05")).toBe("lunes 5 de octubre");
    expect(fmtStayRange("2026-10-02", "2026-10-05")).toBe("2 al 5 de octubre");
    expect(fmtStayRange("2026-09-30", "2026-10-03")).toBe("30 de septiembre al 3 de octubre");
    expect(fmtStayRange("2026-12-30", "2027-01-02")).toBe("30 de diciembre de 2026 al 2 de enero de 2027");
  });

  it("hora de Córdoba (UTC−3) para vencimientos", () => {
    expect(fmtDateTimeAR("2026-10-01T17:30:00.000Z")).toBe("jue 1 oct, 14:30 h");
    expect(fmtDateTimeAR("2026-10-02T01:05:00.000Z")).toBe("jue 1 oct, 22:05 h");
  });

  it("montos, noches y código", () => {
    expect(money(70000)).toMatch(/^\$\s70\.000$/);
    expect(nightsLabel(1)).toBe("1 noche");
    expect(nightsLabel(3)).toBe("3 noches");
    expect(reservationCode("2f9c1d0e-aaaa-bbbb-cccc-111122223333")).toBe("AP-2F9C1D");
  });

  it("primer nombre para saludar", () => {
    expect(firstName("María José Pérez")).toBe("María");
    expect(firstName("LUCÍA GÓMEZ")).toBe("Lucía");
    expect(firstName("  lucía  ")).toBe("Lucía");
    expect(firstName("McArthur")).toBe("McArthur");
    expect(firstName("")).toBe("");
    expect(firstName(null)).toBe("");
  });
});

describe("layout", () => {
  it("escapa HTML y descarta hrefs peligrosos", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;");
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("https://wa.me/549?text=a&b")).toBe("https://wa.me/549?text=a&amp;b");
  });

  it("punto coral al final del titular", () => {
    expect(headlineHtml("Recibimos tu pedido")).toContain('Recibimos tu pedido<span style="color:#ED7059;">.</span>');
    expect(headlineHtml("Todo listo. Dale, pasá.")).toMatch(/Dale, pasá<span style="color:#ED7059;">\.<\/span>$/);
    expect(headlineHtml("¡Confirmado! Falta la seña")).toContain("Falta la seña<span");
    expect(headlineHtml("¿Todo bien?")).toBe("¿Todo bien?");
  });

  it("arma el mail con preheader, botón y pie; escapa lo que recibe como texto", () => {
    const { html } = renderApartEmail({
      preheader: `Hola ${EVIL}`,
      title: `Pedido de ${EVIL}`,
      intro: "Línea 1\nLínea 2",
      bodyHtml: "<p>cuerpo</p>",
      cta: { label: "Ver mi reserva", url: STATUS_URL },
      secondary: { label: "Otra cosa", url: "javascript:alert(1)" },
      footerHtml: "<p>pie</p>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Línea 1<br>Línea 2");
    expect(html).toContain(`href="${STATUS_URL}"`);
    expect(html).toContain("Ver mi reserva");
    expect(html).toContain('href="#"');
    expect(html).toContain("<p>cuerpo</p>");
    expect(html).toContain("<p>pie</p>");
    // El env con "\n" al final no parte las URLs.
    expect(html).toContain('href="https://www.apartcba.com/"');
    expect(html).not.toContain("apartcba.com\n");
  });
});

describe("mails al huésped", () => {
  it("Recibimos tu pedido: montos, pasos, fechas y link", () => {
    const mail = renderRequestReceivedEmail({ ...guestBase(), responseHours: 24, senaRuleLabel: "1 noche" });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Recibimos tu pedido: Paraná, 2 al 5 de octubre");
    for (const s of [mail.html, mail.text]) {
      expect(s).toMatch(/\$\s210\.000/);
      expect(s).toMatch(/\$\s70\.000/);
      expect(s).toMatch(/\$\s140\.000/);
      expect(s).toContain("vie 2 oct");
      expect(s).toContain("lun 5 oct");
      expect(s).toContain("2 al 5 de octubre");
      expect(s).toContain("3 noches");
      expect(s).toContain("24 horas");
      expect(s).toContain("Todavía no pagás nada");
      expect(s).toContain("AP-2F9C1D");
      expect(s).toContain(STATUS_URL);
    }
    expect(mail.html).toContain("Seña (1 noche)");
    expect(mail.html).toContain("Al llegar");
    expect(mail.html).toContain("Recibimos tu pedido<span");
    expect(mail.html).toContain("https://wa.me/5493515639985?text=Hola");
    expect(mail.html).toContain("@apart.cba");
  });

  it("Recibimos tu pedido sin seña: no muestra el paso de la seña", () => {
    const mail = renderRequestReceivedEmail({
      ...guestBase({ money: { currency: "ARS", total: 210000, sena: null, resto: 210000 } }),
      responseHours: 48,
      senaRuleLabel: null,
    });
    expectBrandBasics(mail);
    expect(mail.html).not.toContain("Señás");
    expect(mail.text).toContain("2 días");
  });

  it("escapa el nombre, la unidad y el motivo", () => {
    const mail = renderRequestRejectedEmail({
      ...guestBase({ guestFirstName: EVIL, stay: { ...guestBase().stay, unitTitle: `Depto ${EVIL}` } }),
      reason: `Motivo ${EVIL}`,
      searchUrl: "https://www.apartcba.com/buscar?checkin=2026-10-02&checkout=2026-10-05&huespedes=2",
    });
    expectBrandBasics(mail, { userMarkupInText: true });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // El texto plano va sin escapar (no es HTML).
    expect(mail.text).toContain(`Motivo ${EVIL}`);
    expect(mail.html).toContain("buscar?checkin=2026-10-02&amp;checkout=2026-10-05&amp;huespedes=2");
    expect(mail.html).toContain(STATUS_URL);
    expect(mail.text).toContain(STATUS_URL);
    expect(mail.text).toContain("No se te cobró nada");
  });
});

describe("confirmación", () => {
  const transfer = {
    holder: "Apart CBA SRL",
    cuit: "30-71234567-8",
    bank: "Banco de Córdoba",
    cbu: "0200302211000012345678",
    alias: "APART.CBA.SENA",
    notes: "Mandanos el comprobante <por favor>",
  };

  it("con seña y datos para transferir", () => {
    const mail = renderReservationConfirmedEmail({
      ...guestBase(),
      instant: false,
      senaDueAt: "2026-10-01T17:30:00.000Z",
      transfer,
      cancellation: { title: "Cancelación flexible", body: "Podés cancelar sin cargo hasta 24 horas antes del check-in." },
    });
    expectBrandBasics(mail, { userMarkupInText: true });
    expect(mail.subject).toBe("Confirmado: Paraná, 2 al 5 de octubre. Falta la seña");
    for (const s of [mail.html, mail.text]) {
      expect(s).toMatch(/\$\s70\.000/);
      expect(s).toMatch(/\$\s140\.000/);
      expect(s).toMatch(/\$\s210\.000/);
      expect(s).toContain("jue 1 oct, 14:30 h");
      expect(s).toContain("0200302211000012345678");
      expect(s).toContain("APART.CBA.SENA");
      expect(s).toContain("30-71234567-8");
      expect(s).toContain("Banco de Córdoba");
      expect(s).toContain("Cancelación flexible");
      expect(s).toContain(STATUS_URL);
    }
    expect(mail.html).toContain("¡Confirmado! Falta la seña");
    expect(mail.html).toContain("Datos para transferir");
    expect(mail.html).toContain("Mandanos el comprobante &lt;por favor&gt;");
    // El CBU va grande y monoespaciado.
    expect(mail.html).toMatch(/class="ap-cbu" style="[^"]*Menlo[^"]*">0200302211000012345678/);
    expect(mail.html).toContain("Avisar que transferí");
    // Botón "Avisar que transferí" al lado de los datos + botón final: los dos al seguimiento.
    expect(mail.html.split(`href="${STATUS_URL}"`).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("con seña pero sin datos cargados: se los pasamos por WhatsApp", () => {
    const mail = renderReservationConfirmedEmail({
      ...guestBase(),
      instant: true,
      senaDueAt: "2026-10-01T17:30:00.000Z",
      transfer: null,
      cancellation: null,
    });
    expectBrandBasics(mail);
    expect(mail.html).toContain("¡Reservado! Falta la seña");
    expect(mail.html).toContain("Te pasamos los datos por WhatsApp");
    expect(mail.text).toContain("te los pasamos por WhatsApp");
    expect(mail.html).not.toContain("CBU / CVU");
  });

  it("sin seña: queda asegurada y muestra dirección", () => {
    const mail = renderReservationConfirmedEmail({
      ...guestBase({
        money: { currency: "ARS", total: 210000, sena: null, resto: 210000 },
        stay: { ...guestBase().stay, address: "Paraná 450, 5° B", checkInWindow: "de 14 a 22 h" },
      }),
      instant: false,
      senaDueAt: null,
      transfer,
      cancellation: null,
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Reserva confirmada: Paraná, 2 al 5 de octubre");
    expect(mail.html).toContain("Todo listo. Dale, pasá<span");
    expect(mail.html).not.toContain("Datos para transferir");
    expect(mail.html).not.toContain("0200302211000012345678");
    expect(mail.html).toContain("Paraná 450, 5° B");
    expect(mail.text).toContain("Check-in: de 14 a 22 h");
    expect(mail.text).toContain("No hace falta seña");
  });

  it("la seña ya estaba pagada al confirmar: asegurada, con lo pagado y el saldo", () => {
    const mail = renderReservationConfirmedEmail({
      ...guestBase({ money: { currency: "ARS", total: 210000, sena: null, resto: 140000 } }),
      instant: false,
      senaDueAt: null,
      transfer: null,
      cancellation: null,
      paid: 70000,
    });
    expectBrandBasics(mail);
    expect(mail.text).not.toContain("No hace falta seña");
    expect(mail.text).toContain("confirmada y asegurada");
    expect(mail.text).toMatch(/Ya pagaste: \$\s70\.000/);
    expect(mail.text).toMatch(/Al llegar: \$\s140\.000/);
    expect(mail.html).not.toContain("Datos para transferir");
  });
});

describe("otros mails al huésped", () => {
  it("pedido vencido", () => {
    const mail = renderRequestExpiredEmail({
      ...guestBase(),
      searchUrl: "https://www.apartcba.com/buscar?huespedes=2",
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Tu pedido para Paraná venció");
    expect(mail.html).toContain("Tu pedido venció sin respuesta");
    expect(mail.html).toContain("Escribinos por WhatsApp");
    expect(mail.html).toContain(STATUS_URL);
    expect(mail.text).toContain("No se te cobró nada");
  });

  it("acuse del aviso de pago", () => {
    const mail = renderPaymentReportedGuestEmail({ ...guestBase(), reportedAmount: 70000, hasReceipt: true });
    expectBrandBasics(mail);
    expect(mail.html).toContain("Recibimos tu aviso de pago");
    expect(mail.text).toMatch(/que transferiste \$\s70\.000/);
    expect(mail.html).toContain("Con comprobante adjunto.");
    expect(mail.text).toContain(STATUS_URL);
  });

  it("reserva asegurada", () => {
    const mail = renderDepositRegisteredEmail({
      ...guestBase({
        money: { currency: "ARS", total: 210000, sena: 70000, resto: 140000 },
        stay: { ...guestBase().stay, address: "Paraná 450", checkInWindow: "de 14 a 22 h" },
      }),
      paid: 70000,
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Tu reserva está asegurada: Paraná, 2 al 5 de octubre");
    expect(mail.text).toMatch(/Ya pagaste: \$\s70\.000/);
    expect(mail.text).toMatch(/Al llegar: \$\s140\.000/);
    expect(mail.html).toContain("Paraná 450");
    expect(mail.html).toContain("Este lugar es tuyo por unos días.");
  });
});

describe("mails al equipo", () => {
  it("nuevo pedido web: datos para responder sin abrir el panel", () => {
    const mail = renderStaffNewRequestEmail({
      ...staffBase(),
      instant: false,
      expiresAt: "2026-10-01T17:30:00.000Z",
      responseHours: 24,
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Nuevo pedido web: Paraná, 2 al 5 de octubre · Lucía Gómez");
    for (const s of [mail.html, mail.text]) {
      expect(s).toContain("Lucía Gómez");
      expect(s).toContain("+54 9 351 555-1234");
      expect(s).toContain("lucia@example.com");
      expect(s).toContain("30111222");
      expect(s).toContain("2 al 5 de octubre · 3 noches");
      expect(s).toContain("2 huéspedes");
      expect(s).toMatch(/\$\s210\.000/);
      expect(s).toMatch(/\$\s70\.000/);
      expect(s).toContain("jue 1 oct, 14:30 h");
      expect(s).toContain(PANEL_URL);
      expect(s).toContain(STATUS_URL);
    }
    expect(mail.html).toContain('href="https://wa.me/5493515551234?text=Hola%20Luc%C3%ADa"');
    expect(mail.html).toContain("Llegamos tarde<br>¿se puede?");
    expect(mail.html).toContain("Revisar y confirmar");
  });

  it("reserva inmediata y escape del mensaje", () => {
    const mail = renderStaffNewRequestEmail({
      ...staffBase({ guest: { ...staffBase().guest, fullName: `Ana ${EVIL}`, message: EVIL } }),
      instant: true,
      expiresAt: null,
      responseHours: 24,
    });
    expectBrandBasics(mail, { userMarkupInText: true });
    expect(mail.html).toContain("Nueva reserva web");
    expect(mail.html).toContain("Ver la reserva");
    expect(mail.html).not.toContain("<script>");
  });

  it("aviso de pago: recordatorio de registrar en Caja", () => {
    const mail = renderStaffPaymentReportedEmail({
      ...staffBase({ panelUrl: "https://www.apartcba.com/dashboard/reservas/b-1" }),
      reportedAmount: 70000,
      note: "Transferí desde la cuenta de mi pareja",
      hasReceipt: true,
      paid: 0,
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Aviso de pago: Lucía Gómez · Paraná, 2 al 5 de octubre");
    expect(mail.html).toContain("Primero registrá el cobro en Caja");
    expect(mail.text).toMatch(/Monto informado: \$\s70\.000/);
    expect(mail.text).toContain("Comprobante: Adjunto");
    expect(mail.text).toContain("Transferí desde la cuenta de mi pareja");
    expect(mail.text).toMatch(/Seña pedida: \$\s70\.000/);
    expect(mail.html).toContain("https://www.apartcba.com/dashboard/reservas/b-1");
  });

  it("recordatorio de pedido sin responder", () => {
    const mail = renderStaffRequestReminderEmail({
      ...staffBase(),
      createdAt: "2026-09-29T12:00:00.000Z",
      expiresAt: "2026-10-01T12:00:00.000Z",
      responseHours: 24,
    });
    expectBrandBasics(mail);
    expect(mail.subject).toBe("Pedido sin responder: Lucía Gómez · Paraná, 2 al 5 de octubre");
    expect(mail.text).toContain("mar 29 sep, 09:00 h");
    expect(mail.text).toContain("jue 1 oct, 09:00 h");
    expect(mail.text).toContain("24 horas");
    expect(mail.html).toContain("Responder el pedido");
    expect(mail.html).toContain(PANEL_URL);
  });
});
