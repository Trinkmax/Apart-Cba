import { describe, expect, it } from "vitest";
import {
  emailChannelView,
  forwardingRequestFromEvent,
  GMAIL_FORWARDING_LABEL,
  isGmailForwardingConfirmation,
  parseGmailForwardingConfirmation,
  safeGmailConfirmUrl,
  type ForwardingRequest,
} from "@/lib/channels/gmail-forwarding";

const VF =
  "https://mail-settings.google.com/mail/vf-%5BANGjdJ9xK2-7Qm4Lr0bZp1sTuV8wYc3dEfGhIjKl%5D-AbCdEfGhIjKlMnOpQr";
const UF = VF.replace("/vf-", "/uf-");

// Asunto real del mail que le llegó a Viaggiato el 09/11/2026 (el cuerpo no se
// guardaba: es el formato que manda Gmail en español).
const GMAIL_ES = {
  from: "forwarding-noreply@google.com",
  subject: "Confirmación de reenvío de Gmail: recibir correo de viaggiatos@gmail.com",
  html: "",
  text: [
    "viaggiatos@gmail.com ha solicitado reenviar automáticamente los correos a tu dirección",
    "de correo electrónico ota-5cda441e7a174404b33b93837e827b04@apartcba.com.",
    "Código de confirmación: 123456789",
    "",
    "Para permitir que viaggiatos@gmail.com reenvíe correos automáticamente a tu dirección,",
    "haz clic en el siguiente enlace para confirmar la solicitud:",
    "",
    VF,
    "",
    "Si no puedes acceder al enlace, puedes enviar el código de confirmación",
    "123456789 a viaggiatos@gmail.com.",
    "",
    "Si hiciste clic en el enlace por accidente, haz clic en este enlace para cancelar esta verificación:",
    UF,
  ].join("\n"),
};

const GMAIL_EN = {
  from: "Gmail Team <forwarding-noreply@google.com>",
  subject: "(#987654321) Gmail Forwarding Confirmation - Receive Mail from host.ar@gmail.com",
  html: "",
  text: [
    "host.ar@gmail.com has requested to automatically forward mail to your email",
    "address ota-abc@apartcba.com.",
    "",
    "To allow host.ar@gmail.com to automatically forward mail to your address,",
    "please click the link below to confirm the request:",
    "",
    VF.replace("mail-settings.google.com", "isolated.mail.google.com"),
  ].join("\n"),
};

describe("isGmailForwardingConfirmation", () => {
  it("reconoce el remitente de Gmail, con o sin nombre", () => {
    expect(isGmailForwardingConfirmation(GMAIL_ES.from, GMAIL_ES.subject)).toBe(true);
    expect(isGmailForwardingConfirmation(GMAIL_EN.from, "cualquier asunto")).toBe(true);
  });

  it("reconoce la confirmación por el asunto si Google cambia el remitente", () => {
    expect(
      isGmailForwardingConfirmation("noreply@mail-settings.google.com", GMAIL_ES.subject),
    ).toBe(true);
  });

  it("no confunde otros mails de Google ni de las OTAs", () => {
    expect(
      isGmailForwardingConfirmation("no-reply@accounts.google.com", "Alerta de seguridad"),
    ).toBe(false);
    expect(isGmailForwardingConfirmation("automated@airbnb.com", "Reserva confirmada")).toBe(false);
    // un asunto parecido desde otro dominio no alcanza
    expect(isGmailForwardingConfirmation("phish@evil.com", GMAIL_ES.subject)).toBe(false);
    expect(
      isGmailForwardingConfirmation("forwarding-noreply@google.com.evil.com", GMAIL_ES.subject),
    ).toBe(false);
    expect(
      isGmailForwardingConfirmation("Gmail <noreply@google.com.evil.com>", GMAIL_ES.subject),
    ).toBe(false);
  });
});

describe("parseGmailForwardingConfirmation", () => {
  it("saca código, enlace de confirmar y cuenta del mail en español", () => {
    expect(parseGmailForwardingConfirmation(GMAIL_ES)).toEqual({
      code: "123456789",
      confirmUrl: VF,
      requester: "viaggiatos@gmail.com",
    });
  });

  it("toma el código del asunto en la versión en inglés", () => {
    const parsed = parseGmailForwardingConfirmation(GMAIL_EN);
    expect(parsed?.code).toBe("987654321");
    expect(parsed?.requester).toBe("host.ar@gmail.com");
    expect(parsed?.confirmUrl).toContain("https://isolated.mail.google.com/mail/vf-");
  });

  it("lee el HTML cuando no hay texto plano (href con &amp;)", () => {
    const parsed = parseGmailForwardingConfirmation({
      from: GMAIL_ES.from,
      subject: GMAIL_ES.subject,
      text: "",
      html: `<p>Código de confirmación: <b>555444333</b></p><a href="${VF}?x=1&amp;y=2">${VF}?x=1&amp;y=2</a>`,
    });
    expect(parsed?.code).toBe("555444333");
    expect(parsed?.confirmUrl).toBe(`${VF}?x=1&y=2`);
  });

  it("si no hay etiqueta, usa el único número de 9 dígitos fuera de los enlaces", () => {
    const parsed = parseGmailForwardingConfirmation({
      from: GMAIL_ES.from,
      subject: "Confirmación de reenvío de Gmail",
      text: `Tu código es 111222333.\n${VF.replace("AbCd", "123456789")}`,
    });
    expect(parsed?.code).toBe("111222333");
  });

  it("nunca devuelve el enlace de cancelar ni uno que no sea de Gmail", () => {
    const parsed = parseGmailForwardingConfirmation({
      from: GMAIL_ES.from,
      subject: GMAIL_ES.subject,
      text: `Código de confirmación: 123456789\n${UF}\nhttps://mail-settings.google.com.evil.com/mail/vf-x`,
    });
    expect(parsed?.code).toBe("123456789");
    expect(parsed?.confirmUrl).toBeNull();
  });

  it("devuelve null si no es una confirmación de Gmail", () => {
    expect(
      parseGmailForwardingConfirmation({ from: "automated@airbnb.com", subject: "Reserva", text: "" }),
    ).toBeNull();
  });

  it("es confirmación aunque no se pueda leer nada del cuerpo", () => {
    expect(
      parseGmailForwardingConfirmation({ from: GMAIL_ES.from, subject: "", text: "", html: "" }),
    ).toEqual({ code: null, confirmUrl: null, requester: null });
  });
});

describe("safeGmailConfirmUrl", () => {
  it("acepta los hosts de Gmail con ruta vf-", () => {
    expect(safeGmailConfirmUrl(VF)).toBe(VF);
    expect(safeGmailConfirmUrl("https://mail.google.com/mail/vf-abc")).toBe(
      "https://mail.google.com/mail/vf-abc",
    );
    expect(safeGmailConfirmUrl("https://mail.google.com/mail/u/0/vf-abc")).not.toBeNull();
  });

  it("rechaza todo lo demás", () => {
    for (const bad of [
      "http://mail.google.com/mail/vf-abc",
      "https://evil.com/mail/vf-abc",
      "https://mail.google.com.evil.com/mail/vf-abc",
      "https://user@mail.google.com/mail/vf-abc",
      "https://mail.google.com:8443/mail/vf-abc",
      "https://sites.google.com/mail/vf-abc",
      "https://mail.google.com/mail/uf-abc",
      "javascript:alert(1)",
      "no es una url",
      null,
    ]) {
      expect(safeGmailConfirmUrl(bad)).toBeNull();
    }
  });
});

describe("forwardingRequestFromEvent", () => {
  it("revalida lo guardado", () => {
    const req = forwardingRequestFromEvent({
      created_at: "2026-11-12T10:00:00Z",
      payload: {
        ignored: GMAIL_FORWARDING_LABEL,
        subject: GMAIL_ES.subject,
        gmail_forwarding: { code: "123456789", confirm_url: VF, requester: "viaggiatos@gmail.com" },
      },
    });
    expect(req).toEqual({
      receivedAt: "2026-11-12T10:00:00Z",
      code: "123456789",
      confirmUrl: VF,
      requester: "viaggiatos@gmail.com",
    });
  });

  it("descarta un enlace o un código que no pasan la validación", () => {
    const req = forwardingRequestFromEvent({
      created_at: "2026-11-12T10:00:00Z",
      payload: {
        ignored: GMAIL_FORWARDING_LABEL,
        gmail_forwarding: { code: "12<b>", confirm_url: "https://evil.com/mail/vf-x" },
      },
    });
    expect(req?.code).toBeNull();
    expect(req?.confirmUrl).toBeNull();
  });

  it("en las filas viejas (sin detalle) saca la cuenta del asunto", () => {
    const req = forwardingRequestFromEvent({
      created_at: "2026-11-09T18:01:24Z",
      payload: { ignored: GMAIL_FORWARDING_LABEL, subject: GMAIL_ES.subject, from_domain: "google.com" },
    });
    expect(req).toEqual({
      receivedAt: "2026-11-09T18:01:24Z",
      code: null,
      confirmUrl: null,
      requester: "viaggiatos@gmail.com",
    });
  });

  it("ignora otros eventos", () => {
    expect(forwardingRequestFromEvent(null)).toBeNull();
    expect(
      forwardingRequestFromEvent({ created_at: "2026-11-09T18:01:24Z", payload: { ignored: "resena" } }),
    ).toBeNull();
  });
});

describe("emailChannelView", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const request = (receivedAt: string): ForwardingRequest => ({
    receivedAt,
    code: "123456789",
    confirmUrl: VF,
    requester: "viaggiatos@gmail.com",
  });

  it("sin nada: esperando", () => {
    expect(emailChannelView({ verifiedAt: null, request: null, now })).toEqual({ state: "waiting" });
  });

  it("la confirmación de Gmail sola NO es Funcionando", () => {
    const r = request("2026-11-09T18:01:24Z");
    expect(emailChannelView({ verifiedAt: null, request: r, now })).toEqual({
      state: "confirm",
      request: r,
    });
  });

  it("con un mail reenviado después de la confirmación: Funcionando, sin aviso", () => {
    expect(
      emailChannelView({
        verifiedAt: "2026-11-10T09:00:00Z",
        request: request("2026-11-09T18:01:24Z"),
        now,
      }),
    ).toEqual({ state: "working", newRequest: null });
  });

  it("otra cuenta que pide confirmar con el canal andando se muestra aparte", () => {
    const r = request("2026-11-19T08:00:00Z");
    expect(emailChannelView({ verifiedAt: "2026-07-24T17:05:51Z", request: r, now })).toEqual({
      state: "working",
      newRequest: r,
    });
  });

  it("ese aviso aparte vence a las dos semanas", () => {
    expect(
      emailChannelView({
        verifiedAt: "2026-07-24T17:05:51Z",
        request: request("2026-11-01T08:00:00Z"),
        now,
      }),
    ).toEqual({ state: "working", newRequest: null });
  });
});
