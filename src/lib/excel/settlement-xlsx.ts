import ExcelJS from "exceljs";
import {
  buildStatementModel,
  type StatementInput,
  type StatementModel,
} from "@/lib/settlements/statement-model";
import { formatDate } from "@/lib/format";

export type XlsxBranding = {
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  primary_color: string | null;
};

const INK = "FF0F172A";
const MUTED = "FF64748B";
const HAIRLINE = "FFE2E8F0";
const ZEBRA = "FFF8FAFC";
const WHITE = "FFFFFFFF";

function hexToArgb(hex: string | null | undefined, fallback = "FF0F766E"): string {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? `FF${m[1].toUpperCase()}` : fallback;
}

/** Mezcla un argb con blanco (0..1) para tintes suaves de encabezado. */
function tint(argb: string, ratio: number): string {
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  return (
    "FF" +
    [mix(r), mix(g), mix(b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function moneyFmt(currency: string): string {
  const crypto = ["USDT", "USDC", "BTC"].includes(currency);
  if (crypto) return `#,##0.00 "${currency}";-#,##0.00 "${currency}"`;
  const sym = currency === "USD" ? "US$" : currency === "EUR" ? "€" : "$";
  return `"${sym}" #,##0.00;"${sym}" -#,##0.00`;
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Construye la planilla clásica por unidad como workbook de ExcelJS:
 * bloque por unidad → fila por reserva → subtotal con fórmulas → otros
 * cargos → totales → datos bancarios. Números reales (editable), estilo de
 * marca, panel congelado.
 */
export function buildSettlementWorkbook(
  model: StatementModel,
  branding: XlsxBranding,
): ExcelJS.Workbook {
  const brand = hexToArgb(branding.primary_color);
  const brandSoft = tint(brand, 0.86);
  const fmt = moneyFmt(model.currency);

  const wb = new ExcelJS.Workbook();
  wb.creator = branding.name;
  wb.created = new Date();

  const ws = wb.addWorksheet("Liquidación", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: "portrait", margins: {
      left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2,
    } },
  });

  const COLS = [12, 12, 28, 8, 15, 15, 15, 16];
  COLS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  let r = 1;

  const mergeRow = (text: string, opts: Partial<ExcelJS.Style> & { height?: number } = {}) => {
    ws.mergeCells(r, 1, r, 8);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.font = opts.font ?? { color: { argb: INK } };
    if (opts.fill) cell.fill = opts.fill;
    cell.alignment = opts.alignment ?? { vertical: "middle", horizontal: "left" };
    ws.getRow(r).height = opts.height ?? 18;
    r++;
    return cell;
  };

  // ── Encabezado ──
  mergeRow(branding.name.toUpperCase(), {
    font: { bold: true, size: 16, color: { argb: WHITE } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: brand } },
    alignment: { vertical: "middle", horizontal: "left", indent: 1 },
    height: 30,
  });
  mergeRow(`LIQUIDACIÓN A PROPIETARIO · ${model.periodLabel} · ${model.currency}`, {
    font: { bold: true, size: 11, color: { argb: INK } },
    height: 20,
  });
  mergeRow(
    `${model.number}   ·   Propietario: ${model.owner.full_name}   ·   Estado: ${model.statusLabel}`,
    { font: { size: 10, color: { argb: MUTED } }, height: 18 },
  );
  r++; // spacer (fila 4, límite del freeze)

  const headers = [
    "Ingreso",
    "Egreso",
    "Huésped",
    "Noches",
    "Bruto",
    "Comisión",
    "Gastos",
    "Neto",
  ];

  const drawColumnHeader = () => {
    const row = ws.getRow(r);
    headers.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 9, color: { argb: INK } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brandSoft } };
      c.alignment = {
        vertical: "middle",
        horizontal: i >= 4 ? "right" : i === 3 ? "center" : "left",
      };
      c.border = { bottom: { style: "thin", color: { argb: brand } } };
    });
    row.height = 18;
    r++;
  };

  const moneyCell = (
    rowIdx: number,
    col: number,
    value: number | { formula: string; result?: number },
    bold = false,
  ) => {
    const c = ws.getCell(rowIdx, col);
    c.value = value as ExcelJS.CellValue;
    c.numFmt = fmt;
    c.alignment = { horizontal: "right" };
    c.font = { size: 9, bold, color: { argb: INK } };
    return c;
  };

  // ── Bloques por unidad ──
  for (const u of model.units) {
    mergeRow(`▌  ${u.code} — ${u.name}`, {
      font: { bold: true, size: 10, color: { argb: brand } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } },
      alignment: { vertical: "middle", horizontal: "left", indent: 1 },
      height: 20,
    });
    drawColumnHeader();

    const firstRow = r;
    u.rows.forEach((b, idx) => {
      const row = ws.getRow(r);
      row.getCell(1).value = b.check_in ? formatDate(b.check_in) : "—";
      row.getCell(2).value = b.check_out ? formatDate(b.check_out) : "—";
      row.getCell(3).value =
        b.guest + (b.mode === "mensual" ? "  (mensual)" : "");
      row.getCell(4).value = b.nights ?? "—";
      row.getCell(4).alignment = { horizontal: "center" };
      moneyCell(r, 5, b.gross);
      moneyCell(r, 6, b.commission ? -b.commission : 0);
      moneyCell(r, 7, b.expenses ? -b.expenses : 0);
      moneyCell(r, 8, {
        formula: `E${r}+F${r}+G${r}`,
        result: b.net,
      });
      for (let col = 1; col <= 4; col++) {
        row.getCell(col).font = { size: 9, color: { argb: INK } };
      }
      if (idx % 2 === 1) {
        for (let col = 1; col <= 8; col++) {
          row.getCell(col).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ZEBRA },
          };
        }
      }
      row.height = 16;
      r++;
    });
    const lastRow = r - 1;

    // Subtotal con fórmulas
    const sub = ws.getRow(r);
    sub.getCell(3).value = `Subtotal ${u.code}`;
    sub.getCell(3).font = { bold: true, size: 9, color: { argb: INK } };
    sub.getCell(3).alignment = { horizontal: "right" };
    if (u.rows.length > 0) {
      moneyCell(r, 5, { formula: `SUM(E${firstRow}:E${lastRow})`, result: u.subtotal.gross }, true);
      moneyCell(r, 6, { formula: `SUM(F${firstRow}:F${lastRow})`, result: -u.subtotal.commission }, true);
      moneyCell(r, 7, { formula: `SUM(G${firstRow}:G${lastRow})`, result: -u.subtotal.expenses }, true);
      moneyCell(r, 8, { formula: `SUM(H${firstRow}:H${lastRow})`, result: u.subtotal.net }, true);
    }
    for (let col = 1; col <= 8; col++) {
      sub.getCell(col).border = { top: { style: "thin", color: { argb: HAIRLINE } } };
    }
    sub.height = 18;
    r += 2; // subtotal + spacer
  }

  // ── Otros cargos ──
  if (model.otros.length > 0) {
    mergeRow("▌  Otros cargos", {
      font: { bold: true, size: 10, color: { argb: brand } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } },
      alignment: { vertical: "middle", horizontal: "left", indent: 1 },
      height: 20,
    });
    for (const o of model.otros) {
      ws.mergeCells(r, 1, r, 7);
      const d = ws.getCell(r, 1);
      d.value = o.unitCode ? `${o.description}  (${o.unitCode})` : o.description;
      d.font = { size: 9, color: { argb: INK } };
      d.alignment = { vertical: "middle", horizontal: "left" };
      moneyCell(r, 8, o.sign === "+" ? o.amount : -o.amount);
      ws.getRow(r).height = 16;
      r++;
    }
    r++;
  }

  // ── Totales ──
  const totalLine = (label: string, value: number, strong = false) => {
    ws.mergeCells(r, 5, r, 7);
    const l = ws.getCell(r, 5);
    l.value = label;
    l.alignment = { horizontal: "right" };
    l.font = strong
      ? { bold: true, size: 12, color: { argb: brand } }
      : { size: 10, color: { argb: MUTED } };
    moneyCell(r, 8, value, strong);
    if (strong) {
      ws.getCell(r, 8).font = { bold: true, size: 12, color: { argb: brand } };
      for (let col = 5; col <= 8; col++) {
        ws.getCell(r, col).border = { top: { style: "double", color: { argb: brand } } };
      }
    }
    ws.getRow(r).height = strong ? 24 : 18;
    r++;
  };
  totalLine("Bruto", model.totals.gross);
  totalLine("− Comisión", -model.totals.commission);
  totalLine("− Gastos", -model.totals.deductions);
  totalLine("NETO A TRANSFERIR", model.totals.net, true);
  r++;

  // ── Datos bancarios ──
  const bankParts = [
    model.owner.bank_name,
    model.owner.cbu ? `CBU ${model.owner.cbu}` : null,
    model.owner.alias_cbu ? `alias ${model.owner.alias_cbu}` : null,
  ].filter(Boolean);
  if (bankParts.length > 0) {
    mergeRow(`Transferir a:  ${bankParts.join("  ·  ")}`, {
      font: { bold: true, size: 10, color: { argb: INK } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } },
      alignment: { vertical: "middle", horizontal: "left", indent: 1 },
      height: 22,
    });
  }
  r++;
  mergeRow(
    `${model.number}  ·  Generada ${formatDate(model.generated_at, "dd/MM/yyyy")}  ·  Documento informativo emitido digitalmente${branding.legal_name ? " por " + branding.legal_name : ""}.`,
    { font: { size: 8, italic: true, color: { argb: MUTED } }, height: 16 },
  );

  return wb;
}

function filenameFor(model: StatementModel): string {
  return `liquidacion-${slug(model.owner.full_name)}-${model.number}.xlsx`;
}

/** Cliente: genera y dispara la descarga del .xlsx. */
export async function downloadSettlementXlsx(
  input: StatementInput,
  branding: XlsxBranding,
): Promise<void> {
  const model = buildStatementModel(input);
  const wb = buildSettlementWorkbook(model, branding);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFor(model);
  a.click();
  URL.revokeObjectURL(url);
}

/** Server: devuelve el .xlsx como Buffer para adjuntar a un email. */
export async function renderSettlementXlsxBuffer(
  input: StatementInput,
  branding: XlsxBranding,
): Promise<{ buffer: Buffer; filename: string }> {
  const model = buildStatementModel(input);
  const wb = buildSettlementWorkbook(model, branding);
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf as ArrayBuffer), filename: filenameFor(model) };
}
