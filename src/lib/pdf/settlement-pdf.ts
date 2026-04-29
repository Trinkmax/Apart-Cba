import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate } from "@/lib/format";
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

export function generateSettlementPDF(settlement: SettlementDetail) {
  const doc = new jsPDF();

  // Header
  doc.setFillColor(15, 118, 110); // brand teal
  doc.rect(0, 0, 210, 35, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("APART CBA", 14, 15);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Departamentos temporales · Córdoba, Argentina", 14, 21);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("LIQUIDACIÓN A PROPIETARIO", 14, 30);

  // Reset color
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);

  // Datos owner
  let y = 45;
  doc.setFont("helvetica", "bold");
  doc.text("Propietario:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(settlement.owner.full_name, 45, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Período:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${MONTHS[settlement.period_month - 1]} ${settlement.period_year}`, 45, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Generada:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(formatDate(settlement.generated_at, "dd/MM/yyyy HH:mm"), 45, y);

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Moneda:", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(settlement.currency, 45, y);

  if (settlement.owner.cbu) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("CBU:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(settlement.owner.cbu, 45, y);
  }
  if (settlement.owner.alias_cbu) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Alias:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(settlement.owner.alias_cbu, 45, y);
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
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: "bold" },
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

  doc.setDrawColor(15, 118, 110);
  doc.line(114, finalY + 22, 192, finalY + 22);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 118, 110);
  doc.text("NETO A TRANSFERIR", 114, finalY + 30);
  doc.text(formatMoney(settlement.net_payable, settlement.currency), 192, finalY + 30, { align: "right" });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "italic");
  doc.text(
    "Documento generado automáticamente por Apart Cba PMS",
    105,
    285,
    { align: "center" }
  );

  doc.save(`liquidacion-${settlement.owner.full_name.replace(/\s+/g, "_")}-${settlement.period_year}-${String(settlement.period_month).padStart(2, "0")}.pdf`);
}
