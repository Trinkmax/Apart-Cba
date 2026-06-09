import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";
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
import { pdfSafe, pdfNeg } from "@/lib/pdf/text";

/** Marcador de celda vacía (en-dash, válido en WinAnsi). */
const EMPTY = "–";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 42;
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
  return pdfSafe(formatMoney(n, currency));
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

/** amber-700 / amber-100 — para avisos de TC faltante (no computa al neto). */
const AMBER: RGB = [180, 83, 9];

/**
 * Franja de advertencia (ámbar). La usamos cuando hay líneas en una moneda
 * distinta a la base SIN tipo de cambio cargado: esas líneas suman 0 al neto,
 * así que el documento DEBE avisarlo (la pantalla web ya lo hace; el PDF no lo
 * hacía y por eso un cargo podía "desaparecer" sin dejar rastro).
 */
function warningStrip(doc: jsPDF, y: number, text: string): number {
  const w = PAGE_W - MARGIN_X * 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const lines = doc.splitTextToSize(pdfSafe(text), w - 8) as string[];
  const h = 5 + lines.length * 3.9;
  doc.setFillColor(254, 243, 199); // amber-100
  doc.rect(MARGIN_X, y, w, h, "F");
  doc.setFillColor(AMBER[0], AMBER[1], AMBER[2]);
  doc.rect(MARGIN_X, y, 1.4, h, "F");
  doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
  doc.text(lines, MARGIN_X + 5, y + 4.3);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "normal");
  return y + h + 4;
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
  doc.text(pdfSafe(model.number), PAGE_W - MARGIN_X, 19, { align: "right" });
  doc.text(pdfSafe(model.periodLabel), PAGE_W - MARGIN_X, 24, {
    align: "right",
  });

  // Bloque de datos
  doc.setTextColor(INK[0], INK[1], INK[2]);
  let y = HEADER_H + 12;

  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(pdfSafe(label.toUpperCase()), x, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(pdfSafe(value), x, yy + 5);
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

  // Aviso global: cargos/reservas en moneda sin TC → no suman al neto.
  if (model.missingRates.length > 0) {
    y = ensureSpace(doc, y, 16);
    y = warningStrip(
      doc,
      y,
      `Atención: hay importes en ${model.missingRates.join(
        ", ",
      )} sin tipo de cambio cargado. NO están sumados al neto. Cargá el TC en la liquidación para incluirlos.`,
    );
  }

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
        b.check_in ? formatDate(b.check_in) : EMPTY,
        b.check_out ? formatDate(b.check_out) : EMPTY,
        pdfSafe(b.guest + (b.mode === "mensual" ? " (mensual)" : "")),
        b.nights ?? EMPTY,
        money(b.gross, model.currency),
        b.commission ? pdfNeg(money(b.commission, model.currency)) : EMPTY,
        b.expenses ? pdfNeg(money(b.expenses, model.currency)) : EMPTY,
        money(b.net, model.currency),
      ]),
      // Reserva en moneda sin TC → no suma al neto: la marcamos en ámbar y
      // reemplazamos el neto por "sin TC" (no engañar con un importe que no cuenta).
      didParseCell: (data: CellHookData) => {
        if (data.section !== "body") return;
        const b = u.rows[data.row.index];
        if (b?.missingRate) {
          data.cell.styles.textColor = AMBER;
          if (data.column.index === 7) data.cell.text = [`sin TC ${b.currency}`];
        }
      },
      foot: [
        [
          { content: pdfSafe(`Subtotal ${u.code}`), colSpan: 4, styles: { halign: "right", fontStyle: "bold" } },
          { content: money(u.subtotal.gross, model.currency), styles: { halign: "right", fontStyle: "bold" } },
          { content: pdfNeg(money(u.subtotal.commission, model.currency)), styles: { halign: "right", fontStyle: "bold" } },
          { content: pdfNeg(money(u.subtotal.expenses, model.currency)), styles: { halign: "right", fontStyle: "bold" } },
          { content: money(u.subtotal.net, model.currency), styles: { halign: "right", fontStyle: "bold" } },
        ],
      ],
      theme: "striped",
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      footStyles: { fillColor: [241, 245, 249], textColor: INK, fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5 },
      // Anchos fijos: la suma de columnas fijas (150) + huésped 'auto' (32) =
      // 182mm = ancho imprimible exacto. Los importes nunca se salen del margen.
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 18 },
        2: { cellWidth: "auto", overflow: "ellipsize" },
        3: { halign: "center", cellWidth: 13 },
        4: { halign: "right", cellWidth: 26 },
        5: { halign: "right", cellWidth: 26 },
        6: { halign: "right", cellWidth: 23 },
        7: { halign: "right", cellWidth: 26 },
      },
      styles: {
        cellPadding: 1.6,
        fontSize: 7.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        overflow: "linebreak",
      },
      tableWidth: PAGE_W - MARGIN_X * 2,
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
        pdfSafe(
          o.unitCode ? `${o.description}  (${o.unitCode})` : o.description,
        ),
        o.missingRate
          ? `${o.sign === "+" ? "+" : "-"}${money(o.amount, o.currency)} · sin TC`
          : o.needsConversion
            ? `${o.sign === "+" ? "+" : "-"}${money(o.amount, o.currency)}  (≈ ${money(o.amountInBase, model.currency)})`
            : `${o.sign === "+" ? "+" : "-"}${money(o.amount, model.currency)}`,
      ]),
      // Cargo en moneda sin TC → no computa al neto: lo mostramos en ámbar y en
      // su moneda nativa con "· sin TC" (antes mostraba "+$X" como si sumara).
      didParseCell: (data: CellHookData) => {
        if (data.section === "body" && model.otros[data.row.index]?.missingRate) {
          data.cell.styles.textColor = AMBER;
        }
      },
      theme: "striped",
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: "auto", overflow: "linebreak" },
        1: { halign: "right", cellWidth: 42 },
      },
      styles: {
        cellPadding: 1.6,
        fontSize: 7.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      tableWidth: PAGE_W - MARGIN_X * 2,
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
    doc.text(pdfSafe(label), boxX + 4, yy);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(pdfSafe(value), boxX + 82, yy, { align: "right" });
  };
  line("Bruto", money(model.totals.gross, model.currency), y + 7);
  line("- Comisión", pdfNeg(money(model.totals.commission, model.currency)), y + 13);
  line("- Gastos", pdfNeg(money(model.totals.deductions, model.currency)), y + 19);
  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.setLineWidth(0.4);
  doc.line(boxX + 4, y + 24, boxX + 82, y + 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(brand[0], brand[1], brand[2]);
  doc.text("NETO A TRANSFERIR", boxX + 4, y + 33);
  doc.text(money(model.totals.net, model.currency), boxX + 82, y + 33, {
    align: "right",
  });
  doc.setTextColor(INK[0], INK[1], INK[2]);
  if (model.missingRates.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
    doc.text(
      pdfSafe(`* No incluye importes en ${model.missingRates.join(", ")} (falta TC).`),
      boxX + 82,
      y + 44,
      { align: "right" },
    );
    doc.setTextColor(INK[0], INK[1], INK[2]);
  }

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
    bankParts.forEach((p, i) =>
      doc.text(pdfSafe(p), MARGIN_X, y + 13 + i * 5.5),
    );
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
