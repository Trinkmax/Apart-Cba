import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDateTime } from "@/lib/format";
import { drawOrgBrandHeader, drawOrgFooter, type OrgBranding } from "@/lib/pdf/org-header";
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

const PAGE_W = 297; // landscape A4
const PAGE_H = 210;
const MARGIN_X = 14;
const HEADER_H = 32;

export interface CashMovementsPdfMeta {
  fromLabel: string;
  toLabel: string;
  rangeSummary: string;
  filenameSuffix: string;
}

export async function generateCashMovementsPDF(
  rows: ExportMovementRow[],
  meta: CashMovementsPdfMeta,
  org: OrgBranding,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const { brand } = await drawOrgBrandHeader(doc, org, {
    pageWidth: PAGE_W,
    headerHeight: HEADER_H,
    marginX: MARGIN_X,
    showFiscalInfo: true,
    nameFontSize: 16,
    logoSize: 18,
  });

  // Right side: title + range + count
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("MOVIMIENTOS DE CAJA", PAGE_W - MARGIN_X, 12, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(meta.rangeSummary, PAGE_W - MARGIN_X, 18, { align: "right" });
  doc.text(
    `Total: ${rows.length.toLocaleString("es-AR")} movimientos`,
    PAGE_W - MARGIN_X,
    23,
    { align: "right" },
  );

  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: HEADER_H + 8,
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
      fillColor: brand,
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
  const finalY = (doc.lastAutoTable?.finalY as number) ?? HEADER_H + 8;

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
        fillColor: brand,
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
      margin: { left: MARGIN_X },
      tableWidth: 182,
    });
  }

  // Footer + paginación
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawOrgFooter(doc, org, {
      pageWidth: PAGE_W,
      pageHeight: PAGE_H,
      marginX: MARGIN_X,
      extraLines:
        pageCount > 1 ? [`Página ${i} de ${pageCount}`] : ["Reporte de movimientos de caja"],
    });
  }

  doc.save(
    `movimientos_${meta.filenameSuffix}_${meta.fromLabel}_a_${meta.toLabel}.pdf`,
  );
}
