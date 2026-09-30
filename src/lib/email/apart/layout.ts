import { absoluteUrl } from "@/lib/app-url";

/**
 * Layout de los mails de marca de apart.
 *
 * Pieza pura (sin DB ni server-only): la usan las plantillas de reservas y
 * cualquier otro aviso de la web (p. ej. el formulario de propietarios).
 *
 * A prueba de clientes de correo: todo en <table> con estilos inline, ancho
 * máximo 600 px, sin flex/grid, preheader oculto y `color-scheme: light` (la
 * paleta crema no se invierte en modo oscuro). Manrope si el cliente la carga
 * (Apple Mail, iOS); si no, Helvetica/Arial. Acentos en Georgia itálica.
 *
 *   canvas crema  #F6F0E4
 *   ┌──────────────────────────────┐
 *   │ banda forest + logo crema    │
 *   ├──────────────────────────────┤
 *   │ titular forest + punto coral │  tarjeta papel #FFFDF8
 *   │ bajada · cuerpo · botón      │
 *   └──────────────────────────────┘
 *   contacto · "Buenas estancias, mejores historias."
 */

/** Paleta de la marca (mismos valores que los tokens de globals.css). */
export const C = {
  canvas: "#F6F0E4", // cream-100
  canvasDeep: "#EFE7D8", // cream-200
  paper: "#FFFDF8",
  hair: "#E4D9C6", // cream-300
  hairStrong: "#D3C5AD", // cream-400
  forest: "#145447", // forest-700
  forestDeep: "#0F4238", // forest-800
  forestSoft: "#EEF5F2", // forest-50
  leaf: "#C9DCBD", // leaf-300
  leafSoft: "#EAF2E4", // leaf-100
  coral: "#ED7059", // coral-500 (decorativo)
  coralText: "#A63D2A", // coral-800 (texto coral legible sobre claro)
  coralSoft: "#FEF3F0", // coral-50
  ink: "#1F2D29", // ink-900
  body: "#3B4A45", // ink-700
  muted: "#56645F", // ink-500
  cream: "#F6F0E4",
} as const;

export const FONT = "'Manrope','Helvetica Neue',Helvetica,Arial,sans-serif";
export const SERIF = "Georgia,'Times New Roman',Times,serif";
export const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

/** Logo crema sobre la banda forest (PNG 239×72 @2x, se muestra a 120×36). */
export const LOGO_PATH = "/apart/email/apart-lockup-cream@2x.png";

/** Escapa texto para interpolarlo en HTML (nombres, mensajes, motivos…). */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escapa y conserva los saltos de línea (mensajes del huésped, notas). */
export function escapeMultiline(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

/**
 * URL segura para un href: sólo http(s), mailto y tel. Cualquier otra cosa
 * (javascript:, data:) se descarta. Devuelve el valor ya escapado.
 */
export function safeHref(url: string | null | undefined): string {
  const u = String(url ?? "").trim();
  if (!/^(https?:|mailto:|tel:)/i.test(u)) return "#";
  return escapeHtml(u);
}

/**
 * Titular con el punto coral de la marca. Si el título termina en punto, ese
 * punto se pinta coral; si termina en "!", "?" o "…" se deja como está; si no
 * termina en signo, se agrega el punto.
 */
export function headlineHtml(title: string): string {
  const t = String(title ?? "").trim();
  const dot = `<span style="color:${C.coral};">.</span>`;
  if (/[!?…]$/.test(t)) return escapeHtml(t);
  if (t.endsWith(".")) return `${escapeHtml(t.slice(0, -1))}${dot}`;
  return `${escapeHtml(t)}${dot}`;
}

/**
 * Botón "a prueba de balas" (tabla + ancla con padding; Outlook toma el
 * padding de la celda). `tone` = forest (principal) o coral.
 */
export function ctaButtonHtml(p: { label: string; url: string; tone?: "forest" | "coral" }): string {
  const bg = p.tone === "coral" ? "#C94D36" : C.forest; // coral-700: texto blanco legible
  const label = escapeHtml(p.label);
  const href = safeHref(p.url);
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:separate;">
<tr><td align="center" bgcolor="${bg}" style="background:${bg};border-radius:999px;mso-padding-alt:16px 34px;">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;mso-padding-alt:0;">${label}&nbsp;&rarr;</a>
</td></tr></table>`;
}

/** Link secundario (texto forest subrayado). */
export function textLinkHtml(p: { label: string; url: string }): string {
  return `<a href="${safeHref(p.url)}" target="_blank" rel="noopener" style="color:${C.forest};font-weight:700;text-decoration:underline;text-underline-offset:3px;">${escapeHtml(p.label)}</a>`;
}

/** Texto invisible que los clientes muestran como vista previa del mail. */
function preheaderHtml(text: string): string {
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.canvas};">${escapeHtml(text)}${filler}</div>`;
}

export interface ApartEmailInput {
  /** Vista previa en la bandeja (texto plano). */
  preheader: string;
  /** Titular (texto plano; se le agrega el punto coral). */
  title: string;
  /** Bajada debajo del titular (texto plano). */
  intro?: string;
  /** Cuerpo ya armado en HTML (con los bloques de blocks.ts). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  secondary?: { label: string; url: string };
  /** HTML extra arriba del pie de marca (p. ej. el bloque de contacto). */
  footerHtml?: string;
}

const HEAD_STYLE = `<style>
:root{color-scheme:light;supported-color-schemes:light;}
body{margin:0;padding:0;width:100%!important;background:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a{color:${C.forest};}
@media (max-width:620px){
.ap-pad{padding-left:22px!important;padding-right:22px!important;}
.ap-title{font-size:26px!important;line-height:31px!important;}
.ap-hide-sm{display:none!important;}
.ap-stack{display:block!important;width:100%!important;text-align:left!important;}
.ap-cbu{font-size:17px!important;letter-spacing:0.4px!important;}
.ap-dl{padding-bottom:2px!important;}
.ap-dv{border-top:0!important;padding-top:0!important;}
}
</style>`;

/**
 * Arma el mail completo. Todo lo que llega como texto (title, intro,
 * preheader, cta.label) se escapa acá; `bodyHtml` y `footerHtml` ya vienen
 * armados con los bloques (que escapan lo suyo).
 */
export function renderApartEmail(p: ApartEmailInput): { html: string } {
  const logoUrl = escapeHtml(absoluteUrl(LOGO_PATH));
  const homeUrl = safeHref(absoluteUrl("/"));
  const intro = p.intro
    ? `<p style="margin:14px 0 0;font-family:${FONT};font-size:16px;line-height:26px;color:${C.body};">${escapeMultiline(p.intro)}</p>`
    : "";
  const cta = p.cta
    ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="left" style="padding:30px 0 4px;">${ctaButtonHtml(p.cta)}</td></tr></table>`
    : "";
  const secondary = p.secondary
    ? `<p style="margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${textLinkHtml(p.secondary)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(p.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&amp;display=swap" rel="stylesheet"><!--<![endif]-->
${HEAD_STYLE}
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
${preheaderHtml(p.preheader)}
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
<tr><td align="center" style="padding:28px 12px 40px;">
<!--[if mso]><table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;">
<tr><td>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${C.paper};border:1px solid ${C.hair};border-radius:24px;">
<tr><td bgcolor="${C.forest}" class="ap-pad" style="background:${C.forest};padding:22px 40px;border-radius:23px 23px 0 0;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
<td align="left" valign="middle"><a href="${homeUrl}" target="_blank" rel="noopener" style="text-decoration:none;"><img src="${logoUrl}" width="120" height="36" alt="apart" style="display:block;width:120px;height:36px;border:0;color:${C.cream};font-family:${FONT};font-size:22px;font-weight:800;"></a></td>
<td align="right" valign="middle" class="ap-hide-sm" style="font-family:${SERIF};font-style:italic;font-size:15px;line-height:20px;color:${C.leaf};">Tu estadía en Córdoba.</td>
</tr></table>
</td></tr>
<tr><td class="ap-pad" style="padding:38px 40px 38px;">
<h1 class="ap-title" style="margin:0;font-family:${FONT};font-size:30px;line-height:35px;font-weight:800;letter-spacing:-0.6px;color:${C.forest};">${headlineHtml(p.title)}</h1>
${intro}
${p.bodyHtml}
${cta}
${secondary}
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:30px 20px 0;">
${p.footerHtml ?? ""}
<p style="margin:22px 0 0;font-family:${SERIF};font-style:italic;font-size:18px;line-height:26px;color:${C.forest};">Buenas estancias, mejores historias.</p>
<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};"><a href="${homeUrl}" target="_blank" rel="noopener" style="color:${C.muted};text-decoration:none;font-weight:700;">apart</a> &middot; Alquileres temporarios en Córdoba</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  return { html };
}
