import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, formatMoney } from "@/lib/format";
import { ADJUSTMENT_STATUS_META, CONTRACT_STATE_META, GUARANTEE_TYPE_LABEL, formatContractNumber } from "@/lib/rentals/labels";
import { drawOrgBrandHeader, drawOrgFooter, loadOrgLogo, type LoadedLogo, type OrgBranding, type RGB } from "@/lib/pdf/org-header";
import { pdfSafe } from "@/lib/pdf/text";
import { termGroups } from "@/components/rentals/contracts/contract-terms";
import { pctLabel } from "@/components/rentals/contracts/adjustment-view";
import type { ContractDetailData } from "@/components/rentals/contracts/types";

/**
 * Ficha del contrato en PDF: partes, condiciones y cronograma de ajustes.
 * Isomorfo (jsPDF): el cliente lo descarga con `generateContractSheetPDF`.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 38;
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];

function lastY(doc: jsPDF, fallback: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_H - 34) return y;
  doc.addPage();
  return 20;
}

function sectionTitle(doc: jsPDF, y: number, title: string, brand: RGB): number {
  doc.setFillColor(brand[0], brand[1], brand[2]);
  doc.rect(MARGIN_X, y - 3.2, 1.2, 4.4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(pdfSafe(title.toUpperCase()), MARGIN_X + 3.5, y);
  return y + 3;
}

export async function buildContractSheetDoc(detail: ContractDetailData, org: OrgBranding, opts: { logo?: LoadedLogo | null } = {}): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c = detail.contract;
  const { brand } = await drawOrgBrandHeader(doc, org, { pageWidth: PAGE_W, headerHeight: HEADER_H, logo: opts.logo });

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("FICHA DE CONTRATO", PAGE_W - MARGIN_X, 14, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(pdfSafe(formatContractNumber(c.number)), PAGE_W - MARGIN_X, 22, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(pdfSafe(CONTRACT_STATE_META[detail.displayState].label), PAGE_W - MARGIN_X, 28, { align: "right" });

  let y = HEADER_H + 12;
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(pdfSafe(detail.property.address), MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(pdfSafe(`${detail.property.city} · Código ${detail.property.code} · Del ${formatDate(c.start_date)} al ${formatDate(c.end_date)}`), MARGIN_X, y + 5);
  y += 13;

  y = sectionTitle(doc, y, "Partes", brand);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Rol", "Nombre", "Documento", "Contacto"]],
    body: [
      ...detail.parties.map((p) => [
        p.role === "inquilino" ? (p.isPrimary ? "Inquilino (titular)" : "Inquilino") : `Garante${p.guaranteeType ? ` · ${GUARANTEE_TYPE_LABEL[p.guaranteeType]}` : ""}`,
        p.name,
        p.docLabel ?? "",
        [p.phone, p.email].filter(Boolean).join(" · "),
      ]),
      ...detail.owners.map((o) => [`Propietario (${o.pct.toLocaleString("es-AR")} %)`, o.name, "", [o.phone, o.email].filter(Boolean).join(" · ")]),
    ].map((r) => r.map((v) => pdfSafe(v))),
    styles: { fontSize: 8.5, cellPadding: 2, textColor: INK },
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  y = lastY(doc, y) + 9;

  for (const g of termGroups(c)) {
    y = ensureSpace(doc, y, 24);
    y = sectionTitle(doc, y, g.title, brand);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_X, right: MARGIN_X },
      body: g.rows.map((r) => [pdfSafe(r.label), pdfSafe(r.hint ? `${r.value}\n${r.hint}` : r.value)]),
      styles: { fontSize: 8.5, cellPadding: 1.8, textColor: INK },
      columnStyles: { 0: { cellWidth: 52, textColor: MUTED }, 1: { cellWidth: "auto" } },
      theme: "plain",
    });
    y = lastY(doc, y) + 7;
  }

  if (detail.adjustments.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionTitle(doc, y, "Cronograma de ajustes", brand);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_X, right: MARGIN_X },
      head: [["#", "Rige desde", "Período", "Alquiler", "Variación", "Estado"]],
      body: [
        ["-", formatDate(c.start_date), "1", formatMoney(c.initial_rent, c.currency), "", "Precio inicial"],
        ...detail.adjustments.map((a) => [
          String(a.sequence),
          formatDate(a.effectiveDate),
          String(a.periodIndex),
          a.amount != null ? formatMoney(a.amount, c.currency) : "A calcular",
          a.variationPct != null && a.amount != null ? pctLabel(a.variationPct) : "",
          ADJUSTMENT_STATUS_META[a.status].label,
        ]),
      ].map((r) => r.map((v) => pdfSafe(v))),
      styles: { fontSize: 8.5, cellPadding: 2, textColor: INK },
      headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    drawOrgFooter(doc, org, {
      pageWidth: PAGE_W,
      pageHeight: PAGE_H,
      extraLines: [pdfSafe(`Ficha generada el ${formatDate(detail.today)} · página ${i} de ${pages}`)],
    });
  }
  return doc;
}

/** Cliente: arma y descarga la ficha. */
export async function generateContractSheetPDF(detail: ContractDetailData, org: OrgBranding): Promise<void> {
  const logo = await loadOrgLogo(org.logo_url);
  const doc = await buildContractSheetDoc(detail, org, { logo });
  const slug = detail.property.code.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  doc.save(`contrato-${formatContractNumber(detail.contract.number).toLowerCase()}-${slug}.pdf`);
}
