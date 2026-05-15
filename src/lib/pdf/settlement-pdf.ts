import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate } from "@/lib/format";
import {
  drawOrgBrandHeader,
  drawOrgFooter,
  loadOrgLogo,
  loadOrgLogoServer,
  resolveBrandColor,
  type OrgBranding,
  type LoadedLogo,
  type RGB,
} from "@/lib/pdf/org-header";
import {
  buildStatementModel,
  type StatementInput,
  type StatementModel,
} from "@/lib/settlements/statement-model";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 38;
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function money(n: number, currency: string): string {
  return formatMoney(n, currency);
}

/** Asegura espacio vertical; si no entra, agrega página y vuelve arriba. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - 32) {
    doc.addPage();
    return 22;
  }
  return y;
}

function sectionBar(doc: jsPDF, y: number, text: string, brand: RGB): number {
  doc.setFillColor(248, 250, 252);
  doc.rect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, 8, "F");
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(MARGIN_X, y, 1.4, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(brand[0], brand[1], brand[2]);
  doc.text(text, MARGIN_X + 4, y + 5.4);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  return y + 11;
}

export async function buildSettlementDoc(
  model: StatementModel,
  org: OrgBranding,
  opts: { logo?: LoadedLogo | null } = {},
): Promise<jsPDF> {
  const doc = new jsPDF();
  const brand = resolveBrandColor(org);

  // Logo precargado por los wrappers (browser o server). Await correcto:
  // garantiza que el header se dibuje antes de seguir.
  await drawOrgBrandHeader(doc, org, {
    pageWidth: PAGE_W,
    headerHeight: HEADER_H,
    marginX: MARGIN_X,
    showFiscalInfo: true,
    nameFontSize: 15,
    logo: opts.logo ?? null,
  });

  // Título a la derecha del header
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ESTADO DE LIQUIDACIÓN", PAGE_W - MARGIN_X, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(model.number, PAGE_W - MARGIN_X, 19, { align: "right" });
  doc.text(model.periodLabel, PAGE_W - MARGIN_X, 24, { align: "right" });

  // Bloque de datos
  doc.setTextColor(INK[0], INK[1], INK[2]);
  let y = HEADER_H + 12;

  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(label.toUpperCase(), x, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(value, x, yy + 5);
  };

  field("Propietario", model.owner.full_name, MARGIN_X, y);
  field("Período", model.periodLabel, MARGIN_X + 96, y);
  field("Moneda", model.currency, MARGIN_X + 96 + 34, y);
  y += 13;
  field("Generada", formatDate(model.generated_at, "dd/MM/yyyy HH:mm"), MARGIN_X, y);
  // Estado con punto de color
  const sc = resolveBrandColor({ primary_color: model.statusColor });
  doc.setFillColor(sc[0], sc[1], sc[2]);
  doc.circle(MARGIN_X + 96 + 1.5, y - 1, 1.5, "F");
  field("Estado", model.statusLabel, MARGIN_X + 96 + 6, y);
  y += 14;

  const tableCols = [
    { header: "Ingreso", dataKey: "ci" },
    { header: "Egreso", dataKey: "co" },
    { header: "Huésped", dataKey: "guest" },
    { header: "Noches", dataKey: "nights" },
    { header: "Bruto", dataKey: "gross" },
    { header: "Comisión", dataKey: "commission" },
    { header: "Gastos", dataKey: "expenses" },
    { header: "Neto", dataKey: "net" },
  ];

  for (const u of model.units) {
    y = ensureSpace(doc, y, 30);
    y = sectionBar(doc, y, `${u.code} · ${u.name}`, brand);

    autoTable(doc, {
      startY: y,
      head: [tableCols.map((c) => c.header)],
      body: u.rows.map((b) => [
        b.check_in ? formatDate(b.check_in) : "—",
        b.check_out ? formatDate(b.check_out) : "—",
        b.guest + (b.mode === "mensual" ? " (mensual)" : ""),
        b.nights ?? "—",
        money(b.gross, model.currency),
        b.commission ? `−${money(b.commission, model.currency)}` : "—",
        b.expenses ? `−${money(b.expenses, model.currency)}` : "—",
        money(b.net, model.currency),
      ]),
      foot: [
        [
          { content: `Subtotal ${u.code}`, colSpan: 4, styles: { halign: "right", fontStyle: "bold" } },
          { content: money(u.subtotal.gross, model.currency), styles: { halign: "right", fontStyle: "bold" } },
          { content: `−${money(u.subtotal.commission, model.currency)}`, styles: { halign: "right", fontStyle: "bold" } },
          { content: `−${money(u.subtotal.expenses, model.currency)}`, styles: { halign: "right", fontStyle: "bold" } },
          { content: money(u.subtotal.net, model.currency), styles: { halign: "right", fontStyle: "bold" } },
        ],
      ],
      theme: "striped",
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: [241, 245, 249], textColor: INK },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        3: { halign: "center", cellWidth: 14 },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
      },
      styles: { cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    // @ts-expect-error - jspdf-autotable agrega lastAutoTable
    y = doc.lastAutoTable.finalY + 8;
  }

  if (model.otros.length > 0) {
    y = ensureSpace(doc, y, 24);
    y = sectionBar(doc, y, "Otros cargos", brand);
    autoTable(doc, {
      startY: y,
      head: [["Concepto", "Importe"]],
      body: model.otros.map((o) => [
        o.unitCode ? `${o.description}  (${o.unitCode})` : o.description,
        `${o.sign === "+" ? "" : "−"}${money(o.amount, model.currency)}`,
      ]),
      theme: "striped",
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 1: { halign: "right", cellWidth: 40 } },
      styles: { cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });
    // @ts-expect-error - jspdf-autotable agrega lastAutoTable
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── Totales ──
  y = ensureSpace(doc, y, 46);
  const boxX = PAGE_W - MARGIN_X - 86;
  doc.setFillColor(248, 250, 252);
  doc.rect(boxX, y, 86, 40, "F");
  const line = (label: string, value: string, yy: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(label, boxX + 4, yy);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(value, boxX + 82, yy, { align: "right" });
  };
  line("Bruto", money(model.totals.gross, model.currency), y + 7);
  line("− Comisión", `−${money(model.totals.commission, model.currency)}`, y + 13);
  line("− Gastos", `−${money(model.totals.deductions, model.currency)}`, y + 19);
  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.setLineWidth(0.4);
  doc.line(boxX + 4, y + 24, boxX + 82, y + 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(brand[0], brand[1], brand[2]);
  doc.text("NETO A TRANSFERIR", boxX + 4, y + 33);
  doc.text(money(model.totals.net, model.currency), boxX + 82, y + 33, { align: "right" });
  doc.setTextColor(INK[0], INK[1], INK[2]);

  // ── Datos bancarios (izquierda, alineado con el box de totales) ──
  const bankParts = [
    model.owner.bank_name ? `Banco: ${model.owner.bank_name}` : null,
    model.owner.cbu ? `CBU: ${model.owner.cbu}` : null,
    model.owner.alias_cbu ? `Alias: ${model.owner.alias_cbu}` : null,
  ].filter(Boolean) as string[];
  if (bankParts.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text("PAGAR A", MARGIN_X, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    bankParts.forEach((p, i) => doc.text(p, MARGIN_X, y + 13 + i * 5.5));
  }

  // ── Watermark de estado ──
  if (model.status === "borrador" || model.status === "anulada") {
    doc.saveGraphicsState();
    type GStateCtor = new (o: { opacity: number }) => unknown;
    const GState = (doc as unknown as { GState: GStateCtor }).GState;
    doc.setGState(new GState({ opacity: 0.06 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(96);
    doc.setTextColor(model.status === "anulada" ? 239 : 100, model.status === "anulada" ? 68 : 116, model.status === "anulada" ? 68 : 139);
    doc.text(model.status.toUpperCase(), PAGE_W / 2, PAGE_H / 2, {
      align: "center",
      angle: 32,
    });
    doc.restoreGraphicsState();
  }

  drawOrgFooter(doc, org, {
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    marginX: MARGIN_X,
    extraLines: [`${model.number} · Documento generado automáticamente.`],
  });

  return doc;
}

function filenameFor(model: StatementModel): string {
  return `liquidacion-${slug(model.owner.full_name)}-${model.number}.pdf`;
}

/**
 * Cliente: genera y descarga el PDF. Firma retro-compatible con el
 * llamador actual (settlement-actions.tsx).
 */
export async function generateSettlementPDF(
  settlement: StatementInput,
  org: OrgBranding,
): Promise<void> {
  const model = buildStatementModel(settlement);
  const logo = await loadOrgLogo(org.logo_url);
  const doc = await buildSettlementDoc(model, org, { logo });
  doc.save(filenameFor(model));
}

/** Server: PDF como Buffer para adjuntar a un email. */
export async function renderSettlementPdfBuffer(
  settlement: StatementInput,
  org: OrgBranding,
): Promise<{ buffer: Buffer; filename: string }> {
  const model = buildStatementModel(settlement);
  const logo = await loadOrgLogoServer(org.logo_url);
  const doc = await buildSettlementDoc(model, org, { logo });
  const ab = doc.output("arraybuffer");
  return { buffer: Buffer.from(ab), filename: filenameFor(model) };
}
