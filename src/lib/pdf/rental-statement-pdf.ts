import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatMoney } from "@/lib/format";
import {
  drawOrgBrandHeader,
  drawOrgFooter,
  loadOrgLogo,
  loadOrgLogoServer,
  resolveBrandColor,
  type LoadedLogo,
  type OrgBranding,
  type RGB,
} from "@/lib/pdf/org-header";
import { pdfNeg, pdfSafe } from "@/lib/pdf/text";
import { statementClosedWithoutPayout } from "@/lib/rentals/labels";
import type { StatementDocModel } from "@/components/rentals/statements/statement-model";

/**
 * PDF de la rendición al propietario (alquileres tradicionales). Mismo modelo
 * que el detalle del panel, el link público y el mail (`buildStatementDoc`):
 * banda con la marca de la org, KPIs, renglones agrupados por propiedad con
 * subtotales, totales y datos para transferir. Isomorfo: `generate…` descarga
 * en el navegador y `render…Buffer` arma el adjunto del mail en el server.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 42;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const GREEN: RGB = [4, 120, 87];
const ROSE: RGB = [190, 18, 60];
const EMPTY = "–";

function money(n: number, currency: string): string {
  return pdfSafe(formatMoney(n, currency));
}

function signedMoney(n: number, currency: string): string {
  return n < 0 ? pdfNeg(money(-n, currency)) : money(n, currency);
}

function tint(c: RGB, amount: number): RGB {
  return [Math.round(c[0] + (255 - c[0]) * amount), Math.round(c[1] + (255 - c[1]) * amount), Math.round(c[2] + (255 - c[2]) * amount)];
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - 34) {
    doc.addPage();
    return 20;
  }
  return y;
}

function setText(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

function sectionBar(doc: jsPDF, y: number, title: string, right: string | null, brand: RGB): number {
  doc.setFillColor(248, 250, 252);
  doc.rect(MARGIN_X, y, CONTENT_W, 8, "F");
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(MARGIN_X, y, 1.4, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setText(doc, brand);
  doc.text(pdfSafe(title), MARGIN_X + 4, y + 5.4);
  if (right) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(pdfSafe(right), PAGE_W - MARGIN_X - 2, y + 5.4, { align: "right" });
  }
  setText(doc, INK);
  doc.setFont("helvetica", "normal");
  return y + 10;
}

/** Neto con el nombre correcto: una rendición cerrada con saldo a cuenta no "transfirió" nada. */
function netLabelOf(model: StatementDocModel): string {
  // Corto a propósito: entra en el casillero de los KPIs igual que "Neto a transferir".
  if (model.totals.net < 0) return "Saldo a descontar";
  if (statementClosedWithoutPayout(model.status, model.totals.net)) return "Neto";
  return model.status === "pagada" ? "Neto transferido" : "Neto a transferir";
}

function drawKpis(doc: jsPDF, y: number, model: StatementDocModel, brand: RGB): number {
  const c = model.currency;
  const items: { label: string; value: string; highlight?: boolean }[] = [
    { label: "Cobrado", value: money(model.totals.collected, c) },
    { label: "Honorarios", value: model.totals.fees ? pdfNeg(money(model.totals.fees, c)) : EMPTY },
    { label: "IVA", value: model.totals.vat ? pdfNeg(money(model.totals.vat, c)) : EMPTY },
    { label: "Gastos", value: model.totals.expenses ? pdfNeg(money(model.totals.expenses, c)) : EMPTY },
    ...(model.totals.other ? [{ label: "Otros", value: signedMoney(model.totals.other, c) }] : []),
    { label: netLabelOf(model), value: signedMoney(model.totals.net, c), highlight: true },
  ];
  const gap = 2;
  const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
  const h = 17;
  items.forEach((it, i) => {
    const x = MARGIN_X + i * (w + gap);
    const fill = it.highlight ? tint(brand, 0.88) : ([248, 250, 252] as RGB);
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    setText(doc, MUTED);
    doc.text(pdfSafe(it.label.toUpperCase()), x + 3, y + 5.5);
    doc.setFont("helvetica", "bold");
    // Achica la letra hasta que el importe entre en el casillero (montos de 8+ cifras).
    let size = it.highlight ? 10.5 : 9.5;
    doc.setFontSize(size);
    while (size > 6.5 && doc.getTextWidth(it.value) > w - 5) {
      size -= 0.5;
      doc.setFontSize(size);
    }
    setText(doc, it.highlight ? (model.totals.net < 0 ? ROSE : brand) : INK);
    doc.text(it.value, x + 3, y + 12.5);
  });
  setText(doc, INK);
  doc.setFont("helvetica", "normal");
  return y + h + 7;
}

export async function buildRentalStatementDoc(model: StatementDocModel, org: OrgBranding, opts: { logo?: LoadedLogo | null } = {}): Promise<jsPDF> {
  const doc = new jsPDF();
  const brand = resolveBrandColor(org);
  const c = model.currency;

  await drawOrgBrandHeader(doc, org, { pageWidth: PAGE_W, headerHeight: HEADER_H, marginX: MARGIN_X, showFiscalInfo: true, nameFontSize: 15, logo: opts.logo ?? null });
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("RENDICIÓN AL PROPIETARIO", PAGE_W - MARGIN_X, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(pdfSafe(`N° ${model.number}`), PAGE_W - MARGIN_X, 19, { align: "right" });
  doc.text(pdfSafe(model.periodLabel), PAGE_W - MARGIN_X, 24, { align: "right" });
  doc.text(pdfSafe(`Cobros hasta el ${formatDate(model.cutoffDate)}`), PAGE_W - MARGIN_X, 29, { align: "right" });

  // Datos
  let y = HEADER_H + 12;
  const field = (label: string, value: string, x: number, maxWidth = 88) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setText(doc, MUTED);
    doc.text(pdfSafe(label.toUpperCase()), x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(doc, INK);
    doc.text(pdfSafe(value), x, y + 5, { maxWidth });
  };
  field("Propietario", model.owner.full_name, MARGIN_X);
  field("Generada", formatDate(model.generatedAt), MARGIN_X + 96, 40);
  const sc = resolveBrandColor({ primary_color: model.statusColor });
  doc.setFillColor(sc[0], sc[1], sc[2]);
  doc.circle(MARGIN_X + 140 + 1.5, y - 1, 1.5, "F");
  const closed = statementClosedWithoutPayout(model.status, model.totals.net);
  field(
    "Estado",
    model.status === "pagada" && model.paidAt ? `${closed ? "Cerrada" : "Pagada"} el ${formatDate(model.paidAt)}${closed ? " (sin transferencia)" : ""}` : model.statusLabel,
    MARGIN_X + 145,
    CONTENT_W - 145,
  );
  y += 13;
  // El PDF del link público llega sin motivo (es interno): igual queda marcada como anulada.
  if (model.status === "anulada") {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setText(doc, ROSE);
    const when = model.voidedAt ? ` el ${formatDate(model.voidedAt)}` : "";
    doc.text(pdfSafe(model.voidReason ? `Anulada${when}: ${model.voidReason}` : `Anulada${when}: ya no vale.`), MARGIN_X, y, { maxWidth: CONTENT_W });
    setText(doc, INK);
    y += 6;
  }

  y = drawKpis(doc, y, model, brand);

  if (!model.groups.length) {
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text("La rendición no tiene renglones.", MARGIN_X, y + 4);
    setText(doc, INK);
    y += 12;
  }

  for (const g of model.groups) {
    y = ensureSpace(doc, y, 34);
    const right = g.sharePct ? `Tu parte: ${g.sharePct.toLocaleString("es-AR")} %` : g.code ? g.code : null;
    y = sectionBar(doc, y, g.label, right, brand);
    if (g.contracts.length) {
      doc.setFontSize(7.5);
      setText(doc, MUTED);
      const txt = g.contracts.map((k) => (k.tenantName ? `${k.number} · Inquilino: ${k.tenantName}` : k.number)).join("   ");
      doc.text(pdfSafe(txt), MARGIN_X + 2, y + 1.5, { maxWidth: CONTENT_W - 4 });
      setText(doc, INK);
      y += 5;
    }
    autoTable(doc, {
      startY: y,
      head: [["Concepto", "Tipo", "Importe"]],
      body: g.lines.map((l) => [pdfSafe(l.description), pdfSafe(l.kindLabel), l.sign < 0 ? pdfNeg(money(l.amount, c)) : money(l.amount, c)]),
      foot: [[{ content: "Subtotal", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } }, { content: signedMoney(g.subtotal.net, c), styles: { halign: "right", fontStyle: "bold" } }]],
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const line = g.lines[data.row.index];
          data.cell.styles.textColor = line && line.sign < 0 ? ROSE : GREEN;
        }
      },
      theme: "striped",
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      footStyles: { fillColor: [241, 245, 249], textColor: INK, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: "auto", overflow: "linebreak" }, 1: { cellWidth: 44, textColor: MUTED }, 2: { cellWidth: 34, halign: "right" } },
      styles: { cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.1 },
      tableWidth: CONTENT_W,
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    y = lastY(doc) + 8;
  }

  // Totales (derecha) + datos para transferir (izquierda)
  const rows: [string, string][] = [["Cobrado", money(model.totals.collected, c)]];
  if (model.totals.fees) rows.push(["- Honorarios de administración", pdfNeg(money(model.totals.fees, c))]);
  if (model.totals.vat) rows.push(["- IVA sobre honorarios", pdfNeg(money(model.totals.vat, c))]);
  if (model.totals.expenses) rows.push(["- Gastos", pdfNeg(money(model.totals.expenses, c))]);
  if (model.totals.other) rows.push([model.totals.other < 0 ? "- Otros descuentos" : "Otros conceptos", signedMoney(model.totals.other, c)]);
  const boxH = 12 + rows.length * 6 + 12;
  y = ensureSpace(doc, y, boxH + 6);
  const boxX = PAGE_W - MARGIN_X - 90;
  doc.setFillColor(248, 250, 252);
  doc.rect(boxX, y, 90, boxH, "F");
  rows.forEach(([label, value], i) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(pdfSafe(label), boxX + 4, y + 8 + i * 6);
    setText(doc, INK);
    doc.text(value, boxX + 86, y + 8 + i * 6, { align: "right" });
  });
  const lineY = y + 8 + rows.length * 6 - 2;
  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.setLineWidth(0.4);
  doc.line(boxX + 4, lineY, boxX + 86, lineY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, model.totals.net < 0 ? ROSE : brand);
  doc.text(pdfSafe(netLabelOf(model).toUpperCase()), boxX + 4, lineY + 8);
  doc.text(signedMoney(model.totals.net, c), boxX + 86, lineY + 8, { align: "right" });
  setText(doc, INK);

  const bank = [
    model.owner.bank_name ? `Banco: ${model.owner.bank_name}` : null,
    model.owner.cbu ? `CBU: ${model.owner.cbu}` : null,
    model.owner.alias_cbu ? `Alias: ${model.owner.alias_cbu}` : null,
  ].filter((x): x is string => !!x);
  if (bank.length && model.totals.net > 0 && model.status !== "anulada") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(model.status === "pagada" ? "TRANSFERIDO A" : "TRANSFERIR A", MARGIN_X, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, INK);
    bank.forEach((b, i) => doc.text(pdfSafe(b), MARGIN_X, y + 13 + i * 5.5, { maxWidth: CONTENT_W - 96 }));
  }
  y += boxH + 8;

  if (model.totals.net < 0 && model.status !== "anulada") {
    y = ensureSpace(doc, y, 10);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(
      pdfSafe(`Los gastos superaron lo cobrado: el saldo de ${money(Math.abs(model.totals.net), c)} a cargo del propietario se descuenta en la próxima rendición.`),
      MARGIN_X,
      y,
      { maxWidth: CONTENT_W },
    );
    setText(doc, INK);
    y += 9;
  }

  if (model.notes) {
    y = ensureSpace(doc, y, 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text("NOTAS", MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(doc, INK);
    const lines = doc.splitTextToSize(pdfSafe(model.notes), CONTENT_W) as string[];
    doc.text(lines, MARGIN_X, y + 5);
    y += 5 + lines.length * 4;
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  setText(doc, MUTED);
  y = ensureSpace(doc, y, 10);
  doc.text("Se rinde lo cobrado, no lo facturado: cada cobro del inquilino entra una sola vez.", MARGIN_X, y + 2);
  setText(doc, INK);

  // Marca de agua en borradores y anuladas, en todas las páginas.
  const pages = doc.getNumberOfPages();
  if (model.status === "borrador" || model.status === "anulada") {
    type GStateCtor = new (o: { opacity: number }) => unknown;
    const GState = (doc as unknown as { GState: GStateCtor }).GState;
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.07 }));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(90);
      if (model.status === "anulada") doc.setTextColor(239, 68, 68);
      else doc.setTextColor(100, 116, 139);
      doc.text(model.status === "anulada" ? "ANULADA" : "BORRADOR", PAGE_W / 2, PAGE_H / 2, { align: "center", angle: 32 });
      doc.restoreGraphicsState();
    }
  }
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawOrgFooter(doc, org, {
      pageWidth: PAGE_W,
      pageHeight: PAGE_H,
      marginX: MARGIN_X,
      extraLines: [pdfSafe(`Rendición N° ${model.number} · Página ${p} de ${pages} · Documento generado automáticamente.`)],
    });
  }
  return doc;
}

function filenameFor(model: StatementDocModel): string {
  return `rendicion-${slug(model.owner.full_name) || "propietario"}-${model.number}.pdf`;
}

/** Navegador: arma y descarga el PDF. */
export async function generateRentalStatementPDF(model: StatementDocModel, org: OrgBranding): Promise<void> {
  const logo = await loadOrgLogo(org.logo_url);
  const doc = await buildRentalStatementDoc(model, org, { logo });
  doc.save(filenameFor(model));
}

/** Server: PDF como Buffer para adjuntar al mail. */
export async function renderRentalStatementPdfBuffer(model: StatementDocModel, org: OrgBranding): Promise<{ buffer: Buffer; filename: string }> {
  const logo = await loadOrgLogoServer(org.logo_url);
  const doc = await buildRentalStatementDoc(model, org, { logo });
  return { buffer: Buffer.from(doc.output("arraybuffer")), filename: filenameFor(model) };
}
