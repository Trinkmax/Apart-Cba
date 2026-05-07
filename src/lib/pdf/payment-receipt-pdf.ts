import { jsPDF } from "jspdf";
import { formatMoney, formatDate, formatDateTime } from "@/lib/format";
import type { PaymentReceiptData } from "@/lib/actions/cash";

type RGB = [number, number, number];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;

const TEAL: RGB = [15, 118, 110];
const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const SUBTLE: RGB = [148, 163, 184];
const HAIRLINE: RGB = [226, 232, 240];
const SOFT_BG: RGB = [248, 250, 252];
const SUCCESS: RGB = [21, 128, 61];
const SUCCESS_BG: RGB = [220, 252, 231];
const ROSE: RGB = [185, 28, 28];
const ROSE_BG: RGB = [254, 226, 226];
const WATERMARK: RGB = [16, 185, 129];

const CATEGORY_LABEL: Record<string, string> = {
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

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  banco: "Transferencia bancaria",
  mp: "Mercado Pago",
  crypto: "Criptomoneda",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

const PAYER_KIND_LABEL: Record<"guest" | "owner" | "organization", string> = {
  guest: "Huésped",
  owner: "Propietario",
  organization: "Organización",
};

function hexToRgb(hex: string | null | undefined): RGB | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function loadImageAsDataURL(
  url: string
): Promise<{ dataUrl: string; format: "PNG" | "JPEG"; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const isJpeg = /\.jpe?g(\?|$)/i.test(url);
        const fmt = isJpeg ? "image/jpeg" : "image/png";
        const dataUrl = canvas.toDataURL(fmt);
        resolve({
          dataUrl,
          format: isJpeg ? "JPEG" : "PNG",
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function setFill(doc: jsPDF, rgb: RGB) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function setStroke(doc: jsPDF, rgb: RGB) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
function setText(doc: jsPDF, rgb: RGB) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function drawRoundedRect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  style: "F" | "S" | "FD" = "F"
) {
  doc.roundedRect(x, y, w, h, r, r, style);
}

export async function generatePaymentReceiptPDF(data: PaymentReceiptData): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const brand = hexToRgb(data.organization.primary_color) ?? TEAL;
  const isIn = data.movement.direction === "in";
  const accentBg: RGB = isIn ? SUCCESS_BG : ROSE_BG;
  const accentInk: RGB = isIn ? SUCCESS : ROSE;

  // Pre-cargar logo si lo hay (con CORS / fallback graceful)
  let logo: Awaited<ReturnType<typeof loadImageAsDataURL>> = null;
  if (data.organization.logo_url) {
    logo = await loadImageAsDataURL(data.organization.logo_url);
  }

  // ─── Header band ───────────────────────────────────────────────────────────
  const HEADER_H = 50;
  setFill(doc, brand);
  doc.rect(0, 0, PAGE_W, HEADER_H, "F");

  // Curva sutil de acento abajo del header
  setFill(doc, [brand[0], brand[1], brand[2]]);
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.18 }));
  doc.rect(0, HEADER_H, PAGE_W, 4, "F");
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 1 }));

  // Logo (cuadrado de 22x22, alineado a la izquierda)
  let titleX = MARGIN_X;
  if (logo) {
    const maxSide = 22;
    const ratio = logo.w / logo.h;
    let w = maxSide;
    let h = maxSide;
    if (ratio > 1) h = maxSide / ratio;
    else w = maxSide * ratio;
    // Fondo blanco redondeado para el logo (mejora visibilidad sobre brand color)
    setFill(doc, [255, 255, 255]);
    drawRoundedRect(doc, MARGIN_X, 12, 26, 26, 4, "F");
    doc.addImage(
      logo.dataUrl,
      logo.format,
      MARGIN_X + (26 - w) / 2,
      12 + (26 - h) / 2,
      w,
      h
    );
    titleX = MARGIN_X + 32;
  }

  setText(doc, [255, 255, 255]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(data.organization.name.toUpperCase(), titleX, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (data.organization.legal_name) {
    doc.text(data.organization.legal_name, titleX, 28);
  }
  if (data.organization.tax_id) {
    doc.text(`CUIT/Tax ID: ${data.organization.tax_id}`, titleX, 33);
  }

  // Right block: receipt number + issue date
  const rightX = PAGE_W - MARGIN_X;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("COMPROBANTE DE PAGO", rightX, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${data.receipt_number}`, rightX, 24, { align: "right" });
  doc.text(`Emitido: ${formatDateTime(data.issued_at)}`, rightX, 29, { align: "right" });

  // ─── Status pill (PAGADO / DEVOLUCIÓN) ─────────────────────────────────────
  const pillLabel = isIn ? "PAGO RECIBIDO" : "DEVOLUCIÓN / EGRESO";
  setFill(doc, [255, 255, 255]);
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.16 }));
  drawRoundedRect(doc, rightX - 60, 32, 60, 9, 4.5, "F");
  doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 1 }));
  setText(doc, [255, 255, 255]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(pillLabel, rightX - 30, 38, { align: "center" });

  // ─── Big amount block ──────────────────────────────────────────────────────
  let y = HEADER_H + 12;
  setFill(doc, accentBg);
  drawRoundedRect(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 32, 6, "F");
  setStroke(doc, accentInk);
  doc.setLineWidth(0.4);
  drawRoundedRect(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, 32, 6, "S");

  setText(doc, MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("MONTO ABONADO", MARGIN_X + 6, y + 8);

  setText(doc, accentInk);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  const amountText = `${isIn ? "" : "− "}${formatMoney(data.movement.amount, data.movement.currency)}`;
  doc.text(amountText, MARGIN_X + 6, y + 22);

  // Fecha grande a la derecha
  setText(doc, INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  doc.text("FECHA DEL PAGO", PAGE_W - MARGIN_X - 6, y + 8, { align: "right" });
  setText(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(formatDate(data.movement.occurred_at, "dd 'de' MMMM, yyyy"), PAGE_W - MARGIN_X - 6, y + 16, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  doc.text(formatDate(data.movement.occurred_at, "HH:mm 'hs'"), PAGE_W - MARGIN_X - 6, y + 22, {
    align: "right",
  });

  y += 38;

  // ─── Section: Pagador & Método ─────────────────────────────────────────────
  const colW = (PAGE_W - MARGIN_X * 2 - 6) / 2;
  const cardH = 42;

  drawCard(doc, MARGIN_X, y, colW, cardH);
  drawCardLabel(doc, "PAGADOR", MARGIN_X + 5, y + 7, brand);
  setText(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(truncate(data.payer.name, 32), MARGIN_X + 5, y + 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  doc.text(`(${PAYER_KIND_LABEL[data.payer.kind]})`, MARGIN_X + 5, y + 20);

  let yLine = y + 26;
  if (data.payer.document) {
    setText(doc, INK);
    doc.setFontSize(9);
    doc.text(data.payer.document, MARGIN_X + 5, yLine);
    yLine += 5;
  }
  if (data.payer.email) {
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(truncate(data.payer.email, 38), MARGIN_X + 5, yLine);
    yLine += 4.5;
  }
  if (data.payer.phone) {
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(data.payer.phone, MARGIN_X + 5, yLine);
  }

  // Método (cuenta + tipo)
  const cx2 = MARGIN_X + colW + 6;
  drawCard(doc, cx2, y, colW, cardH);
  drawCardLabel(doc, "MÉTODO DE PAGO", cx2 + 5, y + 7, brand);
  setText(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const methodLabel =
    (data.account?.type && ACCOUNT_TYPE_LABEL[data.account.type]) ??
    CATEGORY_LABEL[data.movement.category] ??
    "—";
  doc.text(methodLabel, cx2 + 5, y + 15);
  if (data.account?.name) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(`Cuenta: ${truncate(data.account.name, 32)}`, cx2 + 5, y + 21);
  }

  setText(doc, MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("CONCEPTO", cx2 + 5, y + 28);
  setText(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(CATEGORY_LABEL[data.movement.category] ?? data.movement.category, cx2 + 5, y + 33);

  if (data.schedule) {
    setText(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `Cuota ${data.schedule.sequence_number} de ${data.schedule.total_count}`,
      cx2 + 5,
      y + 38
    );
  }

  y += cardH + 8;

  // ─── Section: Detalle de la operación (Reserva / Descripción) ─────────────
  if (data.booking || data.unit || data.movement.description) {
    const detailH = computeDetailHeight(data);
    drawCard(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, detailH);
    drawCardLabel(doc, "DETALLE DE LA OPERACIÓN", MARGIN_X + 5, y + 7, brand);

    let dy = y + 14;
    if (data.booking && data.unit) {
      setText(doc, INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${data.unit.code} · ${truncate(data.unit.name, 38)}`, MARGIN_X + 5, dy);
      dy += 5;
      if (data.unit.address) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        setText(doc, MUTED);
        doc.text(truncate(data.unit.address, 80), MARGIN_X + 5, dy);
        dy += 5;
      }

      // Mini grid: check-in / check-out / nights / guests
      dy += 2;
      const cellW = (PAGE_W - MARGIN_X * 2 - 10) / 4;
      const cells: Array<[string, string]> = [
        ["CHECK-IN", formatDate(data.booking.check_in_date, "dd MMM yyyy")],
        ["CHECK-OUT", formatDate(data.booking.check_out_date, "dd MMM yyyy")],
        ["NOCHES", String(data.booking.nights)],
        ["HUÉSPEDES", String(data.booking.guests_count)],
      ];
      cells.forEach(([label, val], i) => {
        const cx = MARGIN_X + 5 + cellW * i;
        setText(doc, MUTED);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(label, cx, dy);
        setText(doc, INK);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(val, cx, dy + 5);
      });
      dy += 12;

      // Saldo de la reserva
      const remaining = Math.max(0, data.booking.total_amount - data.booking.paid_amount);
      setStroke(doc, HAIRLINE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN_X + 5, dy, PAGE_W - MARGIN_X - 5, dy);
      dy += 5;

      drawRow(doc, MARGIN_X + 5, dy, PAGE_W - MARGIN_X - 5, "Total de la reserva", formatMoney(data.booking.total_amount, data.booking.currency));
      dy += 5;
      drawRow(doc, MARGIN_X + 5, dy, PAGE_W - MARGIN_X - 5, "Cobrado al día de hoy", formatMoney(data.booking.paid_amount, data.booking.currency), SUCCESS);
      dy += 5;
      drawRow(
        doc,
        MARGIN_X + 5,
        dy,
        PAGE_W - MARGIN_X - 5,
        "Saldo pendiente",
        formatMoney(remaining, data.booking.currency),
        remaining > 0 ? ROSE : SUCCESS,
        true
      );
      dy += 6;
    } else if (data.unit) {
      setText(doc, INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${data.unit.code} · ${truncate(data.unit.name, 38)}`, MARGIN_X + 5, dy);
      dy += 6;
    }

    if (data.movement.description) {
      setText(doc, MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("OBSERVACIONES", MARGIN_X + 5, dy);
      dy += 4;
      setText(doc, INK);
      doc.setFontSize(9.5);
      const wrapped = doc.splitTextToSize(
        data.movement.description,
        PAGE_W - MARGIN_X * 2 - 10
      );
      doc.text(wrapped, MARGIN_X + 5, dy);
    }

    y += detailH + 8;
  }

  // ─── Watermark sello "PAGADO" diagonal ─────────────────────────────────────
  if (isIn) {
    doc.saveGraphicsState();
    doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.07 }));
    setText(doc, WATERMARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(110);
    // Rotamos -25° centrado en la página
    doc.text("PAGADO", PAGE_W / 2, PAGE_H / 2 + 20, {
      align: "center",
      angle: 25,
    });
    doc.restoreGraphicsState();
  }

  // ─── Footer ────────────────────────────────────────────────────────────────
  const footerY = PAGE_H - 28;
  setStroke(doc, HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, footerY, PAGE_W - MARGIN_X, footerY);

  setText(doc, MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const footerLines: string[] = [];
  if (data.organization.legal_name) footerLines.push(data.organization.legal_name);
  if (data.organization.tax_id) footerLines.push(`CUIT/Tax ID: ${data.organization.tax_id}`);
  footerLines.push("Documento informativo emitido digitalmente.");

  let fy = footerY + 5;
  for (const line of footerLines) {
    doc.text(line, MARGIN_X, fy);
    fy += 3.5;
  }

  if (data.issued_by_name) {
    doc.text(`Emitido por: ${data.issued_by_name}`, PAGE_W - MARGIN_X, footerY + 5, {
      align: "right",
    });
  }
  setText(doc, SUBTLE);
  doc.setFontSize(7);
  doc.text(
    `Identificador interno: ${data.movement.id}`,
    PAGE_W - MARGIN_X,
    PAGE_H - 8,
    { align: "right" }
  );

  // Guardar
  const dateSlug = formatDate(data.movement.occurred_at, "yyyy-MM-dd");
  const payerSlug = data.payer.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 30);
  doc.save(`comprobante_${data.receipt_number}_${dateSlug}_${payerSlug}.pdf`);
}

function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number) {
  setFill(doc, SOFT_BG);
  drawRoundedRect(doc, x, y, w, h, 4, "F");
  setStroke(doc, HAIRLINE);
  doc.setLineWidth(0.3);
  drawRoundedRect(doc, x, y, w, h, 4, "S");
}

function drawCardLabel(doc: jsPDF, label: string, x: number, y: number, brand: RGB) {
  setText(doc, brand);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(label, x, y);
}

function drawRow(
  doc: jsPDF,
  x: number,
  y: number,
  rightEdge: number,
  label: string,
  value: string,
  valueColor: RGB = INK,
  bold: boolean = false
) {
  setText(doc, MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(label, x, y);
  setText(doc, valueColor);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(bold ? 10 : 9);
  doc.text(value, rightEdge, y, { align: "right" });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function computeDetailHeight(data: PaymentReceiptData): number {
  let h = 14; // padding + label
  if (data.booking && data.unit) {
    h += 10; // unit title + (address)
    if (data.unit.address) h += 5;
    h += 12; // grid
    h += 16; // 3 rows totals + separator
  } else if (data.unit) {
    h += 6;
  }
  if (data.movement.description) {
    const lines = Math.min(4, Math.ceil(data.movement.description.length / 90));
    h += 6 + lines * 4;
  }
  return Math.max(h, 30);
}
