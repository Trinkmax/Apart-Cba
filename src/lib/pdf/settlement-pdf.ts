import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate } from "@/lib/format";
import { drawOrgBrandHeader, drawOrgFooter, type OrgBranding } from "@/lib/pdf/org-header";
import type { OwnerSettlement, Owner, SettlementLine, Unit } from "@/lib/types/database";

type SettlementDetail = OwnerSettlement & {
  owner: Owner;
  lines: (SettlementLine & { unit: Pick<Unit, "id" | "code" | "name"> | null })[];
};

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const LINE_TYPE_LABELS: Record<SettlementLine["line_type"], string> = {
  booking_revenue: "Reserva",
  commission: "Comisión",
  cleaning_charge: "Limpieza",
  maintenance_charge: "Mantenimiento",
  adjustment: "Ajuste",
  monthly_rent_fraction: "Renta mensual",
  expenses_fraction: "Expensas",
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const HEADER_H = 38;

export async function generateSettlementPDF(
  settlement: SettlementDetail,
  org: OrgBranding,
) {
  const doc = new jsPDF();

  const { brand } = await drawOrgBrandHeader(doc, org, {
    pageWidth: PAGE_W,
    headerHeight: HEADER_H,
    marginX: MARGIN_X,
    showFiscalInfo: true,
    nameFontSize: 16,
  });

  // Right side: title + período
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("LIQUIDACIÓN A PROPIETARIO", PAGE_W - MARGIN_X, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${MONTHS[settlement.period_month - 1]} ${settlement.period_year}`,
    PAGE_W - MARGIN_X,
    19,
    { align: "right" },
  );

  // Reset color
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);

  // Datos owner
  let y = HEADER_H + 12;
  doc.setFont("helvetica", "bold");
  doc.text("Propietario:", MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.text(settlement.owner.full_name, MARGIN_X + 31, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Generada:", MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.text(formatDate(settlement.generated_at, "dd/MM/yyyy HH:mm"), MARGIN_X + 31, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Moneda:", MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.text(settlement.currency, MARGIN_X + 31, y);

  if (settlement.owner.cbu) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("CBU:", MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    doc.text(settlement.owner.cbu, MARGIN_X + 31, y);
  }
  if (settlement.owner.alias_cbu) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Alias:", MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    doc.text(settlement.owner.alias_cbu, MARGIN_X + 31, y);
  }

  // Tabla de líneas
  y += 12;
  autoTable(doc, {
    startY: y,
    head: [["Tipo", "Descripción", "Unidad", "Importe"]],
    body: settlement.lines.map((l) => [
      LINE_TYPE_LABELS[l.line_type] ?? l.line_type,
      l.description,
      l.unit?.code ?? "—",
      `${l.sign === "+" ? "+" : "−"} ${formatMoney(l.amount, settlement.currency)}`,
    ]),
    theme: "striped",
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      3: { halign: "right", cellWidth: 35 },
      0: { cellWidth: 30 },
      2: { cellWidth: 25 },
    },
    styles: { fontSize: 9, cellPadding: 3 },
  });

  // Totales
  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  const finalY = doc.lastAutoTable.finalY + 10;

  doc.setFillColor(245, 245, 245);
  doc.rect(110, finalY, 86, 38, "F");

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Bruto", 114, finalY + 6);
  doc.text(formatMoney(settlement.gross_revenue, settlement.currency), 192, finalY + 6, { align: "right" });

  doc.text("− Comisión", 114, finalY + 12);
  doc.text(formatMoney(settlement.commission_amount, settlement.currency), 192, finalY + 12, { align: "right" });

  doc.text("− Gastos", 114, finalY + 18);
  doc.text(formatMoney(settlement.deductions_amount, settlement.currency), 192, finalY + 18, { align: "right" });

  doc.setDrawColor(brand[0], brand[1], brand[2]);
  doc.line(114, finalY + 22, 192, finalY + 22);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(brand[0], brand[1], brand[2]);
  doc.text("NETO A TRANSFERIR", 114, finalY + 30);
  doc.text(formatMoney(settlement.net_payable, settlement.currency), 192, finalY + 30, { align: "right" });

  // Footer compartido
  drawOrgFooter(doc, org, {
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    marginX: MARGIN_X,
    extraLines: ["Documento generado automáticamente."],
  });

  doc.save(
    `liquidacion-${settlement.owner.full_name.replace(/\s+/g, "_")}-${settlement.period_year}-${String(settlement.period_month).padStart(2, "0")}.pdf`,
  );
}
