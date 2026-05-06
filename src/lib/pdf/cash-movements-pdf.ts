import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDateTime } from "@/lib/format";
import type { ExportMovementRow } from "@/lib/actions/cash";
import type { MovementCategory } from "@/lib/types/database";

const CATEGORY_LABELS: Record<MovementCategory, string> = {
  booking_payment: "Pago de reserva",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación a propietario",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  salary: "Sueldo",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  refund: "Reintegro",
  other: "Otro",
};

const DIRECTION_LABEL: Record<"in" | "out", string> = {
  in: "Ingreso",
  out: "Egreso",
};

const BILLABLE_LABEL: Record<"apartcba" | "owner" | "guest", string> = {
  apartcba: "Apart Cba",
  owner: "Propietario",
  guest: "Huésped",
};

export interface CashMovementsPdfMeta {
  fromLabel: string;
  toLabel: string;
  rangeSummary: string;
  filenameSuffix: string;
}

export function generateCashMovementsPDF(
  rows: ExportMovementRow[],
  meta: CashMovementsPdfMeta
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 297, 28, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("APART CBA", 14, 13);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Departamentos temporales · Córdoba, Argentina", 14, 18);

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("MOVIMIENTOS DE CAJA", 14, 24);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(meta.rangeSummary, 200, 13);
  doc.text(`Total: ${rows.length.toLocaleString("es-AR")} movimientos`, 200, 18);

  autoTable(doc, {
    startY: 34,
    head: [
      [
        "Fecha",
        "Cuenta",
        "Mon.",
        "Tipo",
        "Categoría",
        "Monto",
        "Saldo",
        "Unidad",
        "Propietario",
        "Descripción",
        "Fact. a",
      ],
    ],
    body: rows.map((r) => [
      formatDateTime(r.occurred_at),
      r.account_name,
      r.currency,
      DIRECTION_LABEL[r.direction],
      CATEGORY_LABELS[r.category],
      `${r.direction === "out" ? "−" : ""}${formatMoney(r.amount, r.currency)}`,
      formatMoney(r.running_balance, r.currency),
      r.unit_code ?? "—",
      r.owner_name ?? "—",
      r.description ?? "",
      BILLABLE_LABEL[r.billable_to],
    ]),
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    styles: { fontSize: 7.5, cellPadding: 1.5, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 30 },
      2: { cellWidth: 10, halign: "center" },
      3: { cellWidth: 16 },
      4: { cellWidth: 28 },
      5: { cellWidth: 26, halign: "right" },
      6: { cellWidth: 26, halign: "right" },
      7: { cellWidth: 18 },
      8: { cellWidth: 30 },
      9: { cellWidth: "auto" },
      10: { cellWidth: 18 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        const row = rows[data.row.index];
        if (row?.direction === "out") {
          data.cell.styles.textColor = [185, 28, 28];
        } else if (row?.direction === "in") {
          data.cell.styles.textColor = [21, 128, 61];
        }
      }
    },
  });

  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  const finalY = (doc.lastAutoTable?.finalY as number) ?? 34;

  const byCurrency = new Map<
    string,
    { in: number; out: number; count: number }
  >();
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { in: 0, out: 0, count: 0 };
    if (r.direction === "in") t.in += r.amount;
    else t.out += r.amount;
    t.count += 1;
    byCurrency.set(r.currency, t);
  }

  const summaryRows = Array.from(byCurrency.entries()).map(([currency, t]) => [
    currency,
    t.count.toLocaleString("es-AR"),
    formatMoney(t.in, currency),
    formatMoney(t.out, currency),
    formatMoney(t.in - t.out, currency),
  ]);

  if (summaryRows.length > 0) {
    autoTable(doc, {
      startY: finalY + 8,
      head: [
        ["Moneda", "Movimientos", "Total ingresos", "Total egresos", "Neto"],
      ],
      body: summaryRows,
      theme: "grid",
      headStyles: {
        fillColor: [15, 118, 110],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 9,
      },
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 32, halign: "right" },
        2: { cellWidth: 40, halign: "right", textColor: [21, 128, 61] },
        3: { cellWidth: 40, halign: "right", textColor: [185, 28, 28] },
        4: { cellWidth: 40, halign: "right", fontStyle: "bold" },
      },
      margin: { left: 14 },
      tableWidth: 182,
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.setFont("helvetica", "italic");
    doc.text(
      `Apart Cba PMS · Página ${i} de ${pageCount}`,
      148.5,
      205,
      { align: "center" }
    );
  }

  doc.save(
    `movimientos_${meta.filenameSuffix}_${meta.fromLabel}_a_${meta.toLabel}.pdf`
  );
}
