import type { TransferDetails } from "@/lib/marketplace/web-settings";
import { C, FONT, MONO, SERIF, escapeHtml, escapeMultiline, safeHref } from "./layout";
import { fmtDayShort, fmtStayRange, guestsCountLabel, nightsLabel } from "./format";

/**
 * Bloques del cuerpo de los mails de apart (HTML en tablas, estilos inline).
 * Cada bloque escapa lo que recibe como texto; los parámetros `*Html` ya
 * vienen armados. Al lado de cada bloque HTML vive su versión en texto plano.
 */

// ─── Texto ───────────────────────────────────────────────────────────────────

/** Párrafo de cuerpo (texto plano → escapado). */
export function paragraphHtml(text: string, opts?: { muted?: boolean; small?: boolean }): string {
  const size = opts?.small ? "14px" : "16px";
  const lh = opts?.small ? "22px" : "26px";
  const color = opts?.muted ? C.muted : C.body;
  return `<p style="margin:16px 0 0;font-family:${FONT};font-size:${size};line-height:${lh};color:${color};">${escapeMultiline(text)}</p>`;
}

/** Párrafo con HTML ya armado (links, negritas). */
export function richParagraphHtml(html: string, opts?: { muted?: boolean; small?: boolean }): string {
  const size = opts?.small ? "14px" : "16px";
  const lh = opts?.small ? "22px" : "26px";
  const color = opts?.muted ? C.muted : C.body;
  return `<p style="margin:16px 0 0;font-family:${FONT};font-size:${size};line-height:${lh};color:${color};">${html}</p>`;
}

/** Negrita en tinta (para usar dentro de richParagraphHtml). */
export function strong(text: string): string {
  return `<strong style="color:${C.ink};font-weight:700;">${escapeHtml(text)}</strong>`;
}

/** Eyebrow: mayúsculas chicas con tracking, forest. */
export function eyebrowHtml(text: string): string {
  return `<p style="margin:30px 0 10px;font-family:${FONT};font-size:11px;line-height:16px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#1B6153;">${escapeHtml(text)}</p>`;
}

/** Frase de marca en serif itálica. */
export function brandLineHtml(text: string): string {
  return `<p style="margin:22px 0 0;font-family:${SERIF};font-style:italic;font-size:18px;line-height:27px;color:${C.forest};">${escapeHtml(text)}</p>`;
}

// ─── Caja suave ──────────────────────────────────────────────────────────────

type BoxTone = "leaf" | "coral" | "cream" | "forest";

const BOX: Record<BoxTone, { bg: string; border: string; title: string }> = {
  leaf: { bg: C.leafSoft, border: C.leaf, title: C.forest },
  coral: { bg: C.coralSoft, border: "#F9C7BB", title: C.coralText },
  cream: { bg: C.canvas, border: C.hair, title: C.forest },
  forest: { bg: C.forestSoft, border: "#D6E7E0", title: C.forest },
};

/** Caja con fondo suave para avisos (vencimientos, pasos, notas). */
export function calloutHtml(p: { tone?: BoxTone; title?: string; bodyHtml: string }): string {
  const t = BOX[p.tone ?? "leaf"];
  const title = p.title
    ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:800;color:${t.title};">${escapeHtml(p.title)}</p>`
    : "";
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:24px 0 0;border-collapse:separate;">
<tr><td style="background:${t.bg};border:1px solid ${t.border};border-radius:16px;padding:18px 20px;">
${title}<div style="font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">${p.bodyHtml}</div>
</td></tr></table>`;
}

// ─── Estadía ─────────────────────────────────────────────────────────────────

export interface StayBlock {
  unitTitle: string;
  hood?: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /** "de 14 a 22 h" (sólo con reserva confirmada). */
  checkInWindow?: string | null;
  /** Dirección exacta (sólo con reserva confirmada). */
  address?: string | null;
}

function dateCell(label: string, iso: string, align: "left" | "right"): string {
  return `<td class="ap-stack" width="50%" valign="top" align="${align}" style="padding:14px 0 0;text-align:${align};">
<p style="margin:0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${C.muted};">${escapeHtml(label)}</p>
<p style="margin:4px 0 0;font-family:${FONT};font-size:20px;line-height:26px;font-weight:800;color:${C.ink};">${escapeHtml(fmtDayShort(iso))}</p>
</td>`;
}

/** Tarjeta de la estadía: unidad, barrio, llegada/salida, noches y huéspedes. */
export function stayCardHtml(s: StayBlock): string {
  const hood = s.hood
    ? `<p style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${escapeHtml(s.hood)}, Córdoba</p>`
    : "";
  const extra: string[] = [];
  if (s.address) extra.push(`<strong style="color:${C.ink};">Dirección:</strong> ${escapeHtml(s.address)}`);
  if (s.checkInWindow) extra.push(`<strong style="color:${C.ink};">Check-in:</strong> ${escapeHtml(s.checkInWindow)}`);
  const extraHtml = extra.length
    ? `<p style="margin:14px 0 0;padding-top:12px;border-top:1px solid ${C.hair};font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${extra.join("<br>")}</p>`
    : "";
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:26px 0 0;border-collapse:separate;">
<tr><td style="background:${C.canvas};border:1px solid ${C.hair};border-radius:18px;padding:20px 22px;">
<p style="margin:0;font-family:${FONT};font-size:19px;line-height:25px;font-weight:800;letter-spacing:-0.2px;color:${C.forest};">${escapeHtml(s.unitTitle)}</p>
${hood}
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
${dateCell("Llegada", s.checkIn, "left")}
${dateCell("Salida", s.checkOut, "right")}
</tr></table>
<p style="margin:12px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${escapeHtml(fmtStayRange(s.checkIn, s.checkOut))} &middot; ${escapeHtml(nightsLabel(s.nights))} &middot; ${escapeHtml(guestsCountLabel(s.guests))}</p>
${extraHtml}
</td></tr></table>`;
}

export function stayText(s: StayBlock): string {
  const lines = [
    `${s.unitTitle}${s.hood ? ` (${s.hood}, Córdoba)` : ""}`,
    `Llegada: ${fmtDayShort(s.checkIn)} · Salida: ${fmtDayShort(s.checkOut)}`,
    `${fmtStayRange(s.checkIn, s.checkOut)} · ${nightsLabel(s.nights)} · ${guestsCountLabel(s.guests)}`,
  ];
  if (s.address) lines.push(`Dirección: ${s.address}`);
  if (s.checkInWindow) lines.push(`Check-in: ${s.checkInWindow}`);
  return lines.join("\n");
}

// ─── Montos ──────────────────────────────────────────────────────────────────

export interface MoneyRow {
  label: string;
  /** Monto ya formateado ("$ 70.000") o texto ("A coordinar"). */
  value: string;
  /** Aclaración chica debajo del label. */
  note?: string | null;
  /** Resalta la fila en coral (la seña a transferir). */
  highlight?: boolean;
  /** Fila de total: tipografía más fuerte. */
  strong?: boolean;
}

/** Tabla de montos: Total / Seña / Al llegar. */
export function moneyTableHtml(rows: MoneyRow[]): string {
  const body = rows
    .map((r, i) => {
      const border = i === 0 ? "" : `border-top:1px solid ${C.hair};`;
      const bg = r.highlight ? `background:${C.coralSoft};` : "";
      const labelColor = r.highlight ? C.coralText : C.ink;
      const valueColor = r.highlight ? C.coralText : r.strong ? C.forest : C.ink;
      const valueSize = r.highlight || r.strong ? "19px" : "16px";
      const note = r.note
        ? `<br><span style="font-size:13px;line-height:19px;font-weight:400;color:${C.muted};">${escapeHtml(r.note)}</span>`
        : "";
      return `<tr>
<td style="${border}${bg}padding:14px 18px;font-family:${FONT};font-size:15px;line-height:21px;font-weight:${r.highlight || r.strong ? 800 : 600};color:${labelColor};">${escapeHtml(r.label)}${note}</td>
<td align="right" valign="top" style="${border}${bg}padding:14px 18px;font-family:${FONT};font-size:${valueSize};line-height:24px;font-weight:800;color:${valueColor};white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(r.value)}</td>
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:18px 0 0;border-collapse:separate;border:1px solid ${C.hair};border-radius:16px;overflow:hidden;">
${body}
</table>`;
}

export function moneyText(rows: MoneyRow[]): string {
  return rows.map((r) => `${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`).join("\n");
}

// ─── Datos para transferir ───────────────────────────────────────────────────

function transferField(label: string, value: string, opts?: { mono?: boolean; big?: boolean }): string {
  const font = opts?.mono ? MONO : FONT;
  const size = opts?.big ? "19px" : "16px";
  const cls = opts?.big ? ` class="ap-cbu"` : "";
  const spacing = opts?.big ? "letter-spacing:1px;" : "";
  return `<tr><td style="padding:10px 0 0;">
<p style="margin:0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${C.muted};">${escapeHtml(label)}</p>
<p${cls} style="margin:3px 0 0;font-family:${font};font-size:${size};line-height:26px;font-weight:700;${spacing}color:${C.ink};word-break:break-all;">${escapeHtml(value)}</p>
</td></tr>`;
}

/**
 * Bloque "Datos para transferir": alias, CBU (grande y monoespaciado, fácil
 * de dictar o copiar), titular, banco, CUIT y notas.
 */
export function transferBlockHtml(t: TransferDetails): string {
  const rows: string[] = [];
  if (t.alias) rows.push(transferField("Alias", t.alias, { mono: true, big: true }));
  if (t.cbu) rows.push(transferField("CBU / CVU", t.cbu, { mono: true, big: true }));
  if (t.holder) rows.push(transferField("Titular", t.holder));
  if (t.bank) rows.push(transferField("Banco", t.bank));
  if (t.cuit) rows.push(transferField("CUIT", t.cuit, { mono: true }));
  const notes = t.notes
    ? `<p style="margin:14px 0 0;padding-top:12px;border-top:1px solid ${C.hair};font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${escapeMultiline(t.notes)}</p>`
    : "";
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:14px 0 0;border-collapse:separate;">
<tr><td style="background:${C.paper};border:2px solid ${C.forest};border-radius:18px;padding:12px 22px 20px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
${rows.join("\n")}
</table>
${notes}
</td></tr></table>`;
}

export function transferText(t: TransferDetails): string {
  const lines: string[] = [];
  if (t.alias) lines.push(`Alias: ${t.alias}`);
  if (t.cbu) lines.push(`CBU / CVU: ${t.cbu}`);
  if (t.holder) lines.push(`Titular: ${t.holder}`);
  if (t.bank) lines.push(`Banco: ${t.bank}`);
  if (t.cuit) lines.push(`CUIT: ${t.cuit}`);
  if (t.notes) lines.push(t.notes);
  return lines.join("\n");
}

// ─── Filas de detalle (mails al equipo) ──────────────────────────────────────

export interface DetailRow {
  label: string;
  /** Texto plano (se escapa). */
  value?: string | null;
  /** HTML ya armado (gana sobre value). */
  valueHtml?: string | null;
}

export function detailRowsHtml(rows: DetailRow[]): string {
  const body = rows
    .filter((r) => (r.valueHtml ?? r.value ?? "").toString().trim() !== "")
    .map(
      (r, i) => `<tr>
<td class="ap-stack ap-dl" width="34%" valign="top" style="${i ? `border-top:1px solid ${C.hair};` : ""}padding:11px 12px 11px 0;font-family:${FONT};font-size:13px;line-height:20px;font-weight:700;color:${C.muted};">${escapeHtml(r.label)}</td>
<td class="ap-stack ap-dv" valign="top" style="${i ? `border-top:1px solid ${C.hair};` : ""}padding:11px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};">${r.valueHtml ?? escapeMultiline(r.value ?? "")}</td>
</tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:18px 0 0;">
${body}
</table>`;
}

export function detailRowsText(rows: DetailRow[]): string {
  return rows
    .filter((r) => (r.value ?? "").toString().trim() !== "")
    .map((r) => `${r.label}: ${r.value}`)
    .join("\n");
}

// ─── Pasos ("Qué sigue") ─────────────────────────────────────────────────────

export interface StepItem {
  title: string;
  body: string;
  /** Paso ya cumplido: número en forest; pendiente: en coral. */
  done?: boolean;
}

/** Lista numerada con los números en serif itálica (como en la web). */
export function stepsHtml(steps: StepItem[]): string {
  const rows = steps
    .map(
      (s, i) => `<tr>
<td width="40" valign="top" style="padding:12px 0 0;font-family:${SERIF};font-style:italic;font-size:26px;line-height:28px;color:${s.done ? C.forest : C.coral};">${i + 1}</td>
<td valign="top" style="padding:12px 0 0;">
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:22px;font-weight:800;color:${C.ink};">${escapeHtml(s.title)}</p>
<p style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${escapeHtml(s.body)}</p>
</td></tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 0;">
${rows}
</table>`;
}

export function stepsText(steps: StepItem[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.title}: ${s.body}`).join("\n");
}

// ─── Código de la reserva ────────────────────────────────────────────────────

/** "Código de tu reserva: AP-7F3K2Q" (para hablar con el equipo). */
export function codeLineHtml(code: string, label: string = "Código de tu reserva"): string {
  return `<p style="margin:18px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(label)}: <span style="font-family:${MONO};font-size:15px;font-weight:700;letter-spacing:1px;color:${C.ink};">${escapeHtml(code)}</span></p>`;
}

// ─── Contacto (pie) ──────────────────────────────────────────────────────────

export interface ContactInfo {
  /** Link wa.me (con mensaje precargado si corresponde). */
  whatsappUrl: string | null;
  /** Número para mostrar ("+54 9 351 563-9985"). */
  whatsappLabel: string | null;
  email: string | null;
  /** Usuario de Instagram sin @. */
  instagram: string | null;
}

function contactLink(label: string, url: string): string {
  return `<a href="${safeHref(url)}" target="_blank" rel="noopener" style="color:${C.forest};font-weight:700;text-decoration:underline;text-underline-offset:3px;">${escapeHtml(label)}</a>`;
}

/** Bloque de contacto para el pie: WhatsApp, mail e Instagram (los que haya). */
export function contactFooterHtml(c: ContactInfo, heading: string = "¿Dudas? Escribinos"): string {
  const links: string[] = [];
  if (c.whatsappUrl) links.push(contactLink(c.whatsappLabel ? `WhatsApp ${c.whatsappLabel}` : "WhatsApp", c.whatsappUrl));
  if (c.email) links.push(contactLink(c.email, `mailto:${c.email}`));
  if (c.instagram) links.push(contactLink(`@${c.instagram}`, `https://instagram.com/${encodeURIComponent(c.instagram)}`));
  if (!links.length) return "";
  return `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:22px;font-weight:800;color:${C.ink};">${escapeHtml(heading)}</p>
<p style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:24px;color:${C.body};">${links.join(` <span style="color:${C.hairStrong};">&middot;</span> `)}</p>`;
}

export function contactText(c: ContactInfo, heading: string = "¿Dudas? Escribinos"): string {
  const lines: string[] = [];
  if (c.whatsappUrl) lines.push(`WhatsApp${c.whatsappLabel ? ` ${c.whatsappLabel}` : ""}: ${c.whatsappUrl}`);
  if (c.email) lines.push(`Mail: ${c.email}`);
  if (c.instagram) lines.push(`Instagram: @${c.instagram}`);
  if (!lines.length) return "";
  return `${heading}\n${lines.join("\n")}`;
}

/** Cierre de todos los textos planos. */
export const TEXT_SIGNATURE = "Buenas estancias, mejores historias.\nEl equipo de apart";
