import { formatMoney } from "@/lib/format";

/**
 * Render del email de CONFIRMACIÓN de reserva del marketplace.
 *
 * Pieza pura (sin DB, sin server-only) para que sea fácil de testear/previsualizar.
 * El HTML está hecho a prueba de clientes de correo: layout con <table>, estilos
 * inline, sin flex/grid, fuentes web-safe, contenedor 600px, preheader oculto y
 * `color-scheme: light`. Se brandea con el logo + color primario de la org, pero
 * el color primario solo se usa para acentos (no como fondo del logo) para que
 * cualquier color de cualquier org se vea bien.
 *
 * `deposit` (seña):
 *   - número  → muestra "Seña" y "Restante" (total − seña).
 *   - null    → reservas instantáneas: "Seña: a coordinar con el anfitrión".
 */

export interface BookingConfirmationEmailParams {
  guestName: string;
  unitTitle: string;
  checkInIso: string; // YYYY-MM-DD
  checkOutIso: string; // YYYY-MM-DD
  guestsCount: number;
  currency: string;
  total: number;
  deposit: number | null;
  listingUrl: string | null;
  org: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  };
}

const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Viernes 4 de julio" */
function fmtLong(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/** "vie 04 jul · 2026" — compacto para el badge de rango */
function fmtBadge(iso: string): { day: string; date: string } {
  const d = new Date(iso + "T12:00:00");
  return {
    day: cap(DIAS[d.getDay()].slice(0, 3)),
    date: `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`,
  };
}

function nightsBetween(ciIso: string, coIso: string): number {
  const ci = new Date(ciIso + "T12:00:00").getTime();
  const co = new Date(coIso + "T12:00:00").getTime();
  return Math.max(1, Math.round((co - ci) / 86_400_000));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_PRIMARY = "#6b8772";

function safePrimary(hex: string | null): string {
  return hex && HEX_RE.test(hex) ? hex : DEFAULT_PRIMARY;
}

/** Negro o blanco según la luminancia del fondo, para texto legible sobre el primary. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? "#1c1c1a" : "#ffffff";
}

// Paleta neutra cálida (canvas/tarjeta) — el primary solo entra como acento.
const C = {
  canvas: "#F4F2EE",
  card: "#FFFFFF",
  ink: "#1F1E1B",
  body: "#46443E",
  muted: "#86837A",
  hair: "#ECE9E2",
  softBox: "#FAF9F6",
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderBookingConfirmationEmail(
  params: BookingConfirmationEmailParams
): { subject: string; html: string; text: string } {
  const {
    guestName,
    unitTitle,
    checkInIso,
    checkOutIso,
    guestsCount,
    currency,
    total,
    deposit,
    listingUrl,
    org,
  } = params;

  const primary = safePrimary(org.primaryColor);
  const onPrimary = readableOn(primary);
  const nights = nightsBetween(checkInIso, checkOutIso);

  const totalFmt = formatMoney(total, currency);
  const hasDeposit = deposit !== null && deposit > 0;
  const depositFmt = hasDeposit ? formatMoney(deposit as number, currency) : null;
  const remaining = hasDeposit ? Math.max(0, total - (deposit as number)) : null;
  const remainingFmt = remaining !== null ? formatMoney(remaining, currency) : null;

  const ci = fmtBadge(checkInIso);
  const co = fmtBadge(checkOutIso);

  const safeGuest = escapeHtml(guestName || "");
  const safeUnit = escapeHtml(unitTitle || "tu departamento");
  const safeOrg = escapeHtml(org.name || "");

  const subject = `¡Tu reserva está confirmada! — ${unitTitle || "Tu estadía"}`;
  const preheader = `Te esperamos del ${fmtLong(checkInIso)} al ${fmtLong(
    checkOutIso
  )}. Acá están todos los detalles de tu reserva.`;

  // --- Masthead: logo (o nombre) sobre el color de marca ---
  // Banda en `primary` para que cualquier logo —incluidos los claros/blancos,
  // como el de Apart CBA— resalte nítido. El logo de una marca casi siempre
  // está diseñado para sentarse sobre su propio color.
  const brandMast = org.logoUrl
    ? `<img src="${escapeHtml(org.logoUrl)}" alt="${safeOrg}" height="40" style="height:40px;width:auto;max-width:240px;display:block;margin:0 auto;border:0;outline:none;text-decoration:none;" />`
    : `<div style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.01em;color:${onPrimary};text-align:center;">${safeOrg}</div>`;

  // --- Money rows ---
  function moneyRow(
    label: string,
    value: string,
    opts: { strong?: boolean; accent?: boolean; muted?: boolean } = {}
  ): string {
    const valColor = opts.accent ? primary : opts.muted ? C.muted : C.ink;
    const valWeight = opts.strong || opts.accent ? "700" : "600";
    const valSize = opts.accent ? "20px" : "15px";
    return `
      <tr>
        <td style="padding:9px 0;font-family:${FONT};font-size:14px;color:${C.body};">${label}</td>
        <td align="right" style="padding:9px 0;font-family:${FONT};font-size:${valSize};font-weight:${valWeight};color:${valColor};white-space:nowrap;">${value}</td>
      </tr>`;
  }

  const moneyRows = hasDeposit
    ? `
      ${moneyRow("Monto total", totalFmt, { strong: true })}
      <tr><td colspan="2" style="border-top:1px solid ${C.hair};font-size:0;line-height:0;">&nbsp;</td></tr>
      ${moneyRow("Seña", depositFmt as string, { strong: true })}
      ${moneyRow("Restante al ingresar", remainingFmt as string, { accent: true })}
    `
    : `
      ${moneyRow("Monto total", totalFmt, { strong: true })}
      <tr><td colspan="2" style="border-top:1px solid ${C.hair};font-size:0;line-height:0;">&nbsp;</td></tr>
      ${moneyRow("Seña", "A coordinar con el anfitrión", { muted: true })}
    `;

  const payNote = hasDeposit
    ? "El restante se abona el día que te entregamos las llaves, en efectivo o por transferencia."
    : "Coordinás la seña y la forma de pago directamente con el anfitrión. El saldo se abona al ingresar, en efectivo o por transferencia.";

  // --- CTA "cómo llegar" ---
  const ctaBlock = listingUrl
    ? `
      <tr>
        <td align="center" style="padding:8px 0 4px;">
          <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(
            listingUrl
          )}" style="height:48px;v-text-anchor:middle;width:320px;" arcsize="14%" strokecolor="${primary}" fillcolor="${primary}"><w:anchorlock/><center style="color:${onPrimary};font-family:${FONT};font-size:15px;font-weight:700;">Ver el depto y cómo llegar →</center></v:roundrect><![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${escapeHtml(
            listingUrl
          )}" target="_blank" style="display:inline-block;background:${primary};color:${onPrimary};font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:12px;">Ver el depto y cómo llegar&nbsp;→</a>
          <!--<![endif]-->
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0 4px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};text-align:center;">
          🚗&nbsp;🧭&nbsp;🗺️&nbsp; En el enlace del departamento vas a encontrar el mapa que te lleva directo al destino.
        </td>
      </tr>`
    : `
      <tr>
        <td style="padding:10px 0 4px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};text-align:center;">
          🚗&nbsp;🧭&nbsp;🗺️&nbsp; Te vamos a pasar la ubicación exacta y cómo llegar cuando coordinemos tu llegada.
        </td>
      </tr>`;

  // --- Footer contacto ---
  const footerBits: string[] = [];
  if (org.contactEmail)
    footerBits.push(
      `<a href="mailto:${escapeHtml(org.contactEmail)}" style="color:${C.muted};text-decoration:underline;">${escapeHtml(
        org.contactEmail
      )}</a>`
    );
  if (org.contactPhone) footerBits.push(escapeHtml(org.contactPhone));

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width:600px){
      .container{width:100% !important;}
      .px{padding-left:22px !important;padding-right:22px !important;}
      .h1{font-size:22px !important;}
      .range-cell{display:block !important;width:100% !important;}
      .range-arrow{display:none !important;}
    }
    a{color:${primary};}
  </style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${escapeHtml(
    preheader
  )}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

          <!-- Card -->
          <tr>
            <td style="background:${C.card};border:1px solid ${C.hair};border-radius:18px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <!-- Masthead -->
                <tr><td align="center" style="background:${primary};padding:26px 24px;">${brandMast}</td></tr>

                <!-- Hero -->
                <tr>
                  <td class="px" style="padding:34px 40px 8px;">
                    <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${primary};">Reserva confirmada</div>
                    <h1 class="h1" style="margin:12px 0 0;font-family:${FONT};font-size:26px;line-height:1.22;font-weight:800;letter-spacing:-0.02em;color:${C.ink};">¡Nos pone muy contentos de tenerte como huésped! 🎉</h1>
                    <p style="margin:12px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.body};">${
                      safeGuest ? `Hola ${safeGuest}, ` : ""
                    }te dejamos todos los detalles de tu estadía 👇</p>
                  </td>
                </tr>

                <!-- Stay card -->
                <tr>
                  <td class="px" style="padding:24px 40px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.softBox};border:1px solid ${C.hair};border-radius:14px;">
                      <tr>
                        <td style="padding:20px 22px 6px;">
                          <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.muted};">🏡 Tu departamento</div>
                          <div style="font-family:${FONT};font-size:19px;font-weight:800;letter-spacing:-0.01em;color:${C.ink};margin-top:3px;">${safeUnit}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 22px 4px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td class="range-cell" width="44%" valign="top" style="font-family:${FONT};">
                                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">Check-in</div>
                                <div style="font-size:16px;font-weight:700;color:${C.ink};margin-top:4px;">${ci.day} ${ci.date}</div>
                              </td>
                              <td class="range-arrow" width="12%" align="center" valign="middle" style="font-family:${FONT};font-size:18px;color:${primary};">→</td>
                              <td class="range-cell" width="44%" valign="top" style="font-family:${FONT};">
                                <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">Check-out</div>
                                <div style="font-size:16px;font-weight:700;color:${C.ink};margin-top:4px;">${co.day} ${co.date}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 22px 20px;">
                          <span style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;color:${C.body};background:#FFFFFF;border:1px solid ${C.hair};border-radius:999px;padding:6px 12px;margin:3px 6px 3px 0;">👥&nbsp; ${guestsCount} ${
                            guestsCount === 1 ? "persona" : "personas"
                          }</span>
                          <span style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;color:${C.body};background:#FFFFFF;border:1px solid ${C.hair};border-radius:999px;padding:6px 12px;margin:3px 6px 3px 0;">🌙&nbsp; ${nights} ${
                            nights === 1 ? "noche" : "noches"
                          }</span>
                          ${
                            safeGuest
                              ? `<span style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;color:${C.body};background:#FFFFFF;border:1px solid ${C.hair};border-radius:999px;padding:6px 12px;margin:3px 6px 3px 0;">🪪&nbsp; A nombre de ${safeGuest}</span>`
                              : ""
                          }
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Money -->
                <tr>
                  <td class="px" style="padding:22px 40px 0;">
                    <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.muted};margin-bottom:6px;">💰 Detalle de pago</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${moneyRows}
                    </table>
                    <p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">${payNote}</p>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td class="px" style="padding:24px 40px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${ctaBlock}
                    </table>
                  </td>
                </tr>

                <!-- Pre-arrival -->
                <tr>
                  <td class="px" style="padding:22px 40px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.softBox};border:1px solid ${C.hair};border-radius:12px;">
                      <tr>
                        <td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.body};">
                          📅 <strong style="color:${C.ink};">Uno o dos días antes de tu ingreso</strong> te vamos a contactar para coordinar los últimos detalles: horario de check-in, entrega de llaves, etc.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Sign-off -->
                <tr>
                  <td class="px" style="padding:22px 40px 34px;">
                    <p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">Si ves algún error en este mensaje, avisanos así lo corregimos enseguida.</p>
                    <p style="margin:0;font-family:${FONT};font-size:16px;font-weight:700;color:${C.ink};">👋 ¡Gracias y nos vemos pronto!</p>
                    ${
                      safeOrg
                        ? `<p style="margin:4px 0 0;font-family:${FONT};font-size:14px;color:${C.body};">— Equipo de ${safeOrg}</p>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 24px 0;text-align:center;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted};">
              ${safeOrg ? `${safeOrg}<br/>` : ""}
              ${footerBits.length ? `${footerBits.join("&nbsp;&nbsp;·&nbsp;&nbsp;")}<br/>` : ""}
              <span style="color:#B8B5AC;">Este mail es por tu reserva. Si no la hiciste vos, escribinos.</span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // --- Plain-text fallback (fiel al copy original) ---
  const textLines: string[] = [
    "¡Nos pone muy contentos de tenerte como huésped!",
    "",
    `🏡 Tu reserva es del ${fmtLong(checkInIso)} hasta el ${fmtLong(
      checkOutIso
    )} en el departamento "${unitTitle}", para ${guestsCount} ${
      guestsCount === 1 ? "persona" : "personas"
    } (${nights} ${nights === 1 ? "noche" : "noches"}).`,
  ];
  if (guestName) textLines.push(`A nombre de: ${guestName}`);
  textLines.push("");
  textLines.push(`💰 Monto total: ${totalFmt}`);
  if (hasDeposit) {
    textLines.push(`Seña: ${depositFmt}`);
    textLines.push(`Restante: ${remainingFmt}`);
  } else {
    textLines.push("Seña: a coordinar con el anfitrión");
  }
  textLines.push("");
  textLines.push(payNote);
  textLines.push("");
  if (listingUrl) {
    textLines.push(
      `🚗 🧭 🗺️ Para facilitar la llegada, en el enlace del departamento vas a encontrar el mapa que te lleva directo al destino: ${listingUrl}`
    );
  } else {
    textLines.push(
      "🚗 🧭 🗺️ Te vamos a pasar la ubicación exacta y cómo llegar cuando coordinemos tu llegada."
    );
  }
  textLines.push("");
  textLines.push(
    "📅 Uno o dos días antes de tu ingreso te vamos a contactar para coordinar los últimos detalles (horario de check-in, entrega de llaves, etc.)."
  );
  textLines.push("Si ves algún error en este mensaje, avisanos.");
  textLines.push("");
  textLines.push("👋 ¡Gracias y nos vemos pronto!");
  if (org.name) textLines.push(`— Equipo de ${org.name}`);

  return { subject, html, text: textLines.join("\n") };
}
