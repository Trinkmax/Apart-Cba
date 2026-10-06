import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatMoney } from "@/lib/format";
import { amountToSpanishWords } from "@/lib/rentals/words";
import { formatContractNumber, formatReceiptNumber } from "@/lib/rentals/labels";
import {
  drawOrgBrandHeader,
  drawOrgFooter,
  HAIRLINE,
  loadOrgLogo,
  loadOrgLogoServer,
  TEXT_INK,
  TEXT_MUTED,
  type LoadedLogo,
  type OrgBranding,
  type RGB,
} from "./org-header";
import { pdfSafe } from "./text";
import { RECEIPT_LEGEND } from "@/components/rentals/collections/messages";
import { receiptSplitRows, type LedgerPaymentSplit } from "@/lib/rentals/payment-split-record";

/**
 * Recibo de alquiler (módulo Alquileres tradicionales).
 *
 * Builder isomorfo: `buildRentalReceiptDoc(data, {logo})` arma el documento;
 * `generateRentalReceiptPDF` lo descarga en el navegador y
 * `renderRentalReceiptPdfBuffer` lo devuelve como Buffer para adjuntarlo a un
 * mail. Lleva la constancia de deuda pendiente: por el art. 899 CCyC, un recibo
 * de un período posterior hace presumir pagados los anteriores, así que si
 * queda algo sin pagar TIENE que decirlo.
 */

export interface RentalReceiptLine {
  /** Cargo al que se imputó ("Octubre 2026 · Período 2/3"). */
  chargeLabel: string;
  /** Concepto ("Alquiler Octubre 2026", "Intereses por mora · …"). */
  description: string;
  amount: number;
}

export interface RentalReceiptPendingItem {
  label: string;
  dueDate: string;
  outstanding: number;
}

export interface RentalReceiptData {
  org: OrgBranding & { address: string | null; contact_phone: string | null; contact_email: string | null };
  broker: { name: string | null; license: string | null };
  receipt: {
    id: string;
    number: number | null;
    paidAt: string;
    amount: number;
    currency: string;
    methodLabel: string;
    reference: string | null;
    accountName: string | null;
    /** Cobró el propietario directo (no entró a Caja de la inmobiliaria). */
    collectedByOwner: boolean;
    payerName: string | null;
    voided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    issuedBy: string | null;
  };
  contract: { id: string; number: number; address: string; city: string | null };
  tenant: {
    name: string;
    docType: string | null;
    docNumber: string | null;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    isCompany: boolean;
  };
  lines: RentalReceiptLine[];
  /**
   * Cobro con reparto (cobra el propietario, migración 070): cuánto le
   * transfirió el inquilino directo al propietario y cuánto a la inmobiliaria.
   */
  split?: LedgerPaymentSplit | null;
  /** Lo que este pago dejó como saldo a favor del inquilino. */
  creditLeft: number;
  /** Deuda que sigue abierta al día en que se emite el documento. */
  pending: { asOf: string; total: number; items: RentalReceiptPendingItem[] };
  /** Leyenda libre de la org (Configuración → Alquileres). */
  footer: string | null;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 34;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const FOOTER_RESERVED = 36;

const SOFT_BG: RGB = [248, 250, 252];
const EMERALD: RGB = [4, 120, 87];
const EMERALD_BG: RGB = [236, 253, 245];
const AMBER: RGB = [146, 64, 14];
const AMBER_BG: RGB = [255, 251, 235];
const ROSE: RGB = [190, 18, 60];
const ROSE_BG: RGB = [255, 241, 242];


function money(n: number, currency: string): string {
  return pdfSafe(formatMoney(n, currency));
}

function ink(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

/** Agrega página si no entra `needed` mm antes del pie. Devuelve el nuevo y. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_H - FOOTER_RESERVED) return y;
  doc.addPage();
  return 20;
}

function tenantDocLine(t: RentalReceiptData["tenant"]): string {
  if (t.docNumber) return `${t.docType ?? "DNI"} ${t.docNumber}`;
  if (t.taxId) return `CUIT ${t.taxId}`;
  return "";
}

export function receiptFilename(data: Pick<RentalReceiptData, "receipt" | "tenant">): string {
  const slug = data.tenant.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `recibo-${formatReceiptNumber(data.receipt.number)}${slug ? `-${slug}` : ""}.pdf`;
}

function drawHeaderTitle(doc: jsPDF, data: RentalReceiptData) {
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("R E C I B O", PAGE_W - MARGIN_X, 12, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(pdfSafe(`N° ${formatReceiptNumber(data.receipt.number)}`), PAGE_W - MARGIN_X, 21.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(pdfSafe(`Fecha: ${formatDate(data.receipt.paidAt)}`), PAGE_W - MARGIN_X, 28, { align: "right" });
}

/** Emisor (izquierda) y corredor responsable (derecha). Devuelve el y siguiente. */
function drawIssuer(doc: jsPDF, data: RentalReceiptData, y: number): number {
  const { org, broker } = data;
  ink(doc, TEXT_INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(pdfSafe(org.legal_name || org.name), MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  ink(doc, TEXT_MUTED);
  const contact = [org.contact_phone, org.contact_email].filter(Boolean).join(" · ");
  const issuer = [org.tax_id ? `CUIT ${org.tax_id}` : null, org.address, contact || null].filter((l): l is string => !!l);
  issuer.forEach((l, i) => doc.text(pdfSafe(l), MARGIN_X, y + 4.6 + i * 4.1));
  if (broker.name || broker.license) {
    doc.setFontSize(7.5);
    doc.text("CORREDOR RESPONSABLE", PAGE_W - MARGIN_X, y - 0.5, { align: "right" });
    ink(doc, TEXT_INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    if (broker.name) doc.text(pdfSafe(broker.name), PAGE_W - MARGIN_X, y + 4.4, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    ink(doc, TEXT_MUTED);
    if (broker.license) doc.text(pdfSafe(`Matrícula CPI N° ${broker.license}`), PAGE_W - MARGIN_X, y + (broker.name ? 8.6 : 4.4), { align: "right" });
  }
  const end = y + 4.6 + Math.max(issuer.length, 2) * 4.1 + 1.5;
  doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, end, PAGE_W - MARGIN_X, end);
  return end + 6;
}

function drawVoidedNotice(doc: jsPDF, data: RentalReceiptData, y: number): number {
  const text = `RECIBO ANULADO${data.receipt.voidedAt ? ` el ${formatDate(data.receipt.voidedAt)}` : ""}${data.receipt.voidReason ? ` · Motivo: ${data.receipt.voidReason}` : ""}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(pdfSafe(text), CONTENT_W - 8) as string[];
  const h = 5 + lines.length * 4.4;
  doc.setFillColor(ROSE_BG[0], ROSE_BG[1], ROSE_BG[2]);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 2, 2, "F");
  ink(doc, ROSE);
  lines.forEach((l, i) => doc.text(l, MARGIN_X + 4, y + 5.6 + i * 4.4));
  return y + h + 5;
}

/** "Recibí de … la suma de … Son …" — el corazón del recibo. */
function drawStatement(doc: jsPDF, data: RentalReceiptData, brand: RGB, y: number): number {
  const { receipt, tenant, contract } = data;
  const innerX = MARGIN_X + 7;
  const innerW = CONTENT_W - 12;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  const words = doc.splitTextToSize(pdfSafe(`Son ${amountToSpanishWords(receipt.amount, receipt.currency)}.`), innerW) as string[];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const about = doc.splitTextToSize(
    pdfSafe(`En concepto de alquiler de ${contract.address}${contract.city ? `, ${contract.city}` : ""} · Contrato ${formatContractNumber(contract.number)}.`),
    innerW,
  ) as string[];
  const h = 7 + 6 + 9 + words.length * 4.6 + 2 + about.length * 4.3 + 4;
  y = ensureSpace(doc, y, h + 4);
  doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 2.5, 2.5, "F");
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(MARGIN_X, y, 1.4, h, "F");

  let cy = y + 7.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  ink(doc, TEXT_MUTED);
  doc.text("Recibí de", innerX, cy);
  const lead = doc.getTextWidth("Recibí de ") + 0.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  ink(doc, TEXT_INK);
  const who = pdfSafe(tenant.name.toUpperCase());
  doc.text(who, innerX + lead, cy);
  const idLine = tenantDocLine(tenant);
  if (idLine) {
    const whoW = doc.getTextWidth(`${who} `);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(doc, TEXT_MUTED);
    doc.text(pdfSafe(`(${idLine})`), innerX + lead + whoW, cy);
  }
  cy += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  ink(doc, TEXT_MUTED);
  doc.text("la suma de", innerX, cy + 1.5);
  const lead2 = doc.getTextWidth("la suma de ") + 0.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  ink(doc, TEXT_INK);
  doc.text(money(receipt.amount, receipt.currency), innerX + lead2, cy + 2);
  cy += 9;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  words.forEach((l, i) => doc.text(l, innerX, cy + i * 4.6));
  cy += words.length * 4.6 + 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  ink(doc, TEXT_MUTED);
  about.forEach((l, i) => doc.text(l, innerX, cy + i * 4.3));
  return y + h + 6;
}

function drawDetail(doc: jsPDF, data: RentalReceiptData, brand: RGB, y: number): number {
  const { currency, amount } = data.receipt;
  const body: string[][] = data.lines.map((l) => [pdfSafe(l.description), pdfSafe(l.chargeLabel), money(l.amount, currency)]);
  if (data.creditLeft > 0.004) body.push(["A cuenta: queda como saldo a favor del inquilino", "-", money(data.creditLeft, currency)]);
  autoTable(doc, {
    startY: ensureSpace(doc, y, 30),
    head: [["Concepto", "Cargo", { content: "Importe", styles: { halign: "right" } }]],
    body,
    foot: [
      [
        { content: "Total recibido", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
        { content: money(amount, currency), styles: { halign: "right", fontStyle: "bold" } },
      ],
    ],
    theme: "plain",
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: FOOTER_RESERVED },
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, cellPadding: 2.2 },
    bodyStyles: { fontSize: 8.5, textColor: TEXT_INK, cellPadding: 2.2 },
    alternateRowStyles: { fillColor: SOFT_BG },
    footStyles: { fillColor: [241, 245, 249], textColor: TEXT_INK, fontSize: 9, cellPadding: 2.4 },
    columnStyles: { 1: { cellWidth: 52, textColor: TEXT_MUTED }, 2: { cellWidth: 36, halign: "right" } },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
}

/**
 * Cobro con reparto (cobra el propietario): qué parte se le pagó directo al
 * propietario y qué parte a la inmobiliaria, o a quién le pagó todo
 * (`receiptSplitRows`). Sólo si hubo reparto.
 */
function drawSplit(doc: jsPDF, data: RentalReceiptData, y: number): number {
  const split = data.split;
  if (!split) return y;
  const currency = data.receipt.currency;
  const labelW = CONTENT_W - 8 - 42;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rows = receiptSplitRows(split, data.org.name).map((r) => ({
    lines: doc.splitTextToSize(pdfSafe(r.label), labelW) as string[],
    amount: r.amount,
  }));
  const rowH = (r: { lines: string[] }) => r.lines.length * 4.4 + 0.8;
  const h = 9 + rows.reduce((s, r) => s + rowH(r), 0) + 2;
  y = ensureSpace(doc, y, h + 2);
  doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 2, 2, "F");
  ink(doc, TEXT_MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(pdfSafe("CÓMO SE PAGÓ"), MARGIN_X + 4, y + 6, { charSpace: 0.3 });
  let cy = y + 11.5;
  doc.setFontSize(9);
  ink(doc, TEXT_INK);
  for (const r of rows) {
    doc.setFont("helvetica", "normal");
    r.lines.forEach((l, i) => doc.text(l, MARGIN_X + 4, cy + i * 4.4));
    doc.setFont("helvetica", "bold");
    doc.text(money(r.amount, currency), PAGE_W - MARGIN_X - 4, cy, { align: "right" });
    cy += rowH(r);
  }
  return y + h + 5;
}

function drawPaymentInfo(doc: jsPDF, data: RentalReceiptData, y: number): number {
  const r = data.receipt;
  const parts = [
    `Medio de pago: ${r.methodLabel}`,
    r.reference ? `Referencia: ${r.reference}` : null,
    // Con reparto, el bloque "Cómo se pagó" ya dice a quién fue cada parte.
    r.collectedByOwner ? (data.split ? null : "Lo cobró directamente el propietario") : r.accountName ? `Ingresó en: ${r.accountName}` : null,
    r.payerName ? `Pagó: ${r.payerName}` : null,
  ].filter((p): p is string => !!p);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  ink(doc, TEXT_MUTED);
  const lines = doc.splitTextToSize(pdfSafe(parts.join("   ·   ")), CONTENT_W) as string[];
  y = ensureSpace(doc, y, lines.length * 4.2 + 2);
  lines.forEach((l, i) => doc.text(l, MARGIN_X, y + i * 4.2));
  return y + lines.length * 4.2 + 4;
}

const MAX_PENDING_ROWS = 8;

/** Constancia de deuda pendiente (art. 899 CCyC). */
function drawPending(doc: jsPDF, data: RentalReceiptData, y: number): number {
  const { pending } = data;
  const currency = data.receipt.currency;
  const has = pending.total > 0.004;
  const rows = pending.items.slice(0, MAX_PENDING_ROWS);
  const hidden = pending.items.length - rows.length;
  const h = 9 + (has ? rows.length * 5 + (hidden > 0 ? 5 : 0) + 7 : 5) + 2;
  y = ensureSpace(doc, y, h + 2);
  const [fg, bg] = has ? [AMBER, AMBER_BG] : [EMERALD, EMERALD_BG];
  doc.setFillColor(bg[0], bg[1], bg[2]);
  doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 2, 2, "F");
  ink(doc, fg);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(
    pdfSafe(`${has ? "CONSTANCIA DE DEUDA PENDIENTE" : "SIN DEUDA PENDIENTE"} AL ${formatDate(pending.asOf)}`),
    MARGIN_X + 4,
    y + 6,
    { charSpace: 0.3 },
  );
  let cy = y + 11.5;
  doc.setFontSize(9);
  if (!has) {
    doc.setFont("helvetica", "normal");
    doc.text("Al día de la fecha no registra deuda pendiente.", MARGIN_X + 4, cy);
    return y + h + 5;
  }
  doc.setFont("helvetica", "normal");
  for (const it of rows) {
    doc.text(pdfSafe(`${it.label} · vence ${formatDate(it.dueDate)}`), MARGIN_X + 4, cy);
    doc.text(money(it.outstanding, currency), PAGE_W - MARGIN_X - 4, cy, { align: "right" });
    cy += 5;
  }
  if (hidden > 0) {
    doc.text(pdfSafe(`y ${hidden} ${hidden === 1 ? "cargo más" : "cargos más"}`), MARGIN_X + 4, cy);
    cy += 5;
  }
  doc.setFont("helvetica", "bold");
  doc.text("Queda pendiente", MARGIN_X + 4, cy + 1);
  doc.text(money(pending.total, currency), PAGE_W - MARGIN_X - 4, cy + 1, { align: "right" });
  return y + h + 5;
}

function drawLegendAndSignature(doc: jsPDF, data: RentalReceiptData, y: number): number {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  ink(doc, TEXT_MUTED);
  const legend = doc.splitTextToSize(RECEIPT_LEGEND, CONTENT_W) as string[];
  y = ensureSpace(doc, y, legend.length * 3.8 + 26);
  legend.forEach((l, i) => doc.text(l, MARGIN_X, y + i * 3.8));
  const sy = y + legend.length * 3.8 + 18;
  const x1 = PAGE_W - MARGIN_X - 72;
  doc.setDrawColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
  doc.setLineWidth(0.25);
  doc.line(x1, sy, PAGE_W - MARGIN_X, sy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Firma y aclaración", x1 + 36, sy + 4, { align: "center" });
  const signer = data.broker.name || data.org.legal_name || data.org.name;
  doc.setFont("helvetica", "bold");
  ink(doc, TEXT_INK);
  doc.text(pdfSafe(signer), x1 + 36, sy + 8.2, { align: "center" });
  return sy + 12;
}

function drawWatermark(doc: jsPDF) {
  type GStateCtor = new (o: { opacity: number }) => unknown;
  const GState = (doc as unknown as { GState: GStateCtor }).GState;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: 0.08 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(96);
    doc.setTextColor(ROSE[0], ROSE[1], ROSE[2]);
    doc.text("ANULADO", PAGE_W / 2, PAGE_H / 2 + 10, { align: "center", angle: 32 });
    doc.restoreGraphicsState();
  }
  doc.setPage(pages);
}

/** Arma el documento (no lo guarda). Mismo resultado en el navegador y en el servidor. */
export async function buildRentalReceiptDoc(data: RentalReceiptData, opts: { logo?: LoadedLogo | null } = {}): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const { brand } = await drawOrgBrandHeader(doc, data.org, {
    pageWidth: PAGE_W,
    headerHeight: HEADER_H,
    marginX: MARGIN_X,
    logo: opts.logo ?? null,
  });
  drawHeaderTitle(doc, data);
  let y = drawIssuer(doc, data, HEADER_H + 11);
  if (data.receipt.voided) y = drawVoidedNotice(doc, data, y);
  y = drawStatement(doc, data, brand, y);
  y = drawDetail(doc, data, brand, y);
  y = drawSplit(doc, data, y);
  y = drawPaymentInfo(doc, data, y);
  y = drawPending(doc, data, y);
  drawLegendAndSignature(doc, data, y);
  if (data.receipt.voided) drawWatermark(doc);

  const extra: string[] = [];
  const custom = data.footer?.trim();
  if (custom) {
    doc.setFontSize(7.5);
    extra.push(...(doc.splitTextToSize(pdfSafe(custom), CONTENT_W) as string[]).slice(0, 3));
  }
  extra.push(pdfSafe(`Recibo N° ${formatReceiptNumber(data.receipt.number)} · Contrato ${formatContractNumber(data.contract.number)}`));
  drawOrgFooter(doc, data.org, {
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    marginX: MARGIN_X,
    issuedByName: data.receipt.issuedBy ? pdfSafe(data.receipt.issuedBy) : null,
    extraLines: extra,
  });
  return doc;
}

/** Navegador: arma y descarga el PDF. */
export async function generateRentalReceiptPDF(data: RentalReceiptData): Promise<void> {
  const logo = await loadOrgLogo(data.org.logo_url);
  const doc = await buildRentalReceiptDoc(data, { logo });
  doc.save(receiptFilename(data));
}

/** Servidor: el PDF como Buffer (para adjuntarlo a un mail). */
export async function renderRentalReceiptPdfBuffer(data: RentalReceiptData): Promise<{ buffer: Buffer; filename: string }> {
  const logo = await loadOrgLogoServer(data.org.logo_url);
  const doc = await buildRentalReceiptDoc(data, { logo });
  const ab = doc.output("arraybuffer");
  return { buffer: Buffer.from(ab), filename: receiptFilename(data) };
}
