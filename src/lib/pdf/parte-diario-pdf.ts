import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  ParteDiarioBookingRow,
  ParteDiarioCleaningRow,
  ParteDiarioConciergeRow,
  ParteDiarioMaintenanceRow,
  ParteDiarioSnapshot,
} from "@/lib/types/database";

// Paleta del parte: misma escala cromática que constants.ts → PARTE_DIARIO_SECTION_META.
// Replicada acá como tuplas RGB para no arrastrar la dep de tailwind classes.
const SECTION_RGB: Record<
  "check_outs" | "check_ins" | "sucios" | "tareas_pendientes" | "arreglos",
  [number, number, number]
> = {
  check_outs: [239, 68, 68], //  rose
  check_ins: [16, 185, 129], //  emerald
  sucios: [6, 182, 212], //  cyan
  tareas_pendientes: [100, 116, 139], //  slate
  arreglos: [245, 158, 11], //  amber
};

const BRAND_TEAL: [number, number, number] = [15, 118, 110];
const TEXT_INK: [number, number, number] = [15, 23, 42];
const TEXT_MUTED: [number, number, number] = [100, 116, 139];
const ROW_STRIPE: [number, number, number] = [248, 250, 252];

const PAGE_W = 210;
const MARGIN_X = 14;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const PRIORITY_LABEL: Record<ParteDiarioMaintenanceRow["priority"], string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

const CONCIERGE_PRIORITY_LABEL: Record<ParteDiarioConciergeRow["priority"], string> = {
  baja: "Baja",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

const CLEANING_STATUS_LABEL: Record<NonNullable<ParteDiarioCleaningRow["status"]>, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  verificada: "Verificada",
  cancelada: "Cancelada",
};

const BOOKING_MODE_LABEL: Record<ParteDiarioBookingRow["mode"], string> = {
  temporario: "Temp",
  mensual: "Mensual",
};

function describeBookingGuest(b: ParteDiarioBookingRow): string {
  if (b.is_owner_use) return "Uso propietario";
  return b.guest_name ?? "Sin huésped";
}

function drawHeader(doc: jsPDF, snapshot: ParteDiarioSnapshot) {
  // Banda superior teal (35 mm) con typo blanca
  doc.setFillColor(...BRAND_TEAL);
  doc.rect(0, 0, PAGE_W, 35, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(snapshot.organization_name.toUpperCase(), MARGIN_X, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Parte diario operativo", MARGIN_X, 21);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(snapshot.date_label, MARGIN_X, 30);

  // Resumen a la derecha (chips de conteo)
  const chips: { label: string; count: number; color: [number, number, number] }[] = [
    { label: "CH OUT", count: snapshot.check_outs.length, color: SECTION_RGB.check_outs },
    { label: "CH IN", count: snapshot.check_ins.length, color: SECTION_RGB.check_ins },
    { label: "SUCIOS", count: snapshot.sucios.length, color: SECTION_RGB.sucios },
    {
      label: "TAREAS",
      count: snapshot.tareas_pendientes.length,
      color: SECTION_RGB.tareas_pendientes,
    },
    { label: "ARREGLOS", count: snapshot.arreglos.length, color: SECTION_RGB.arreglos },
  ];

  // Render chips a la derecha del header — 5 chips horizontales
  let x = PAGE_W - MARGIN_X;
  doc.setFontSize(8);
  for (let i = chips.length - 1; i >= 0; i--) {
    const chip = chips[i];
    const text = `${chip.label}  ${chip.count}`;
    doc.setFont("helvetica", "bold");
    const w = doc.getTextWidth(text) + 6;
    x -= w + 2;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, 22, w, 8, 1.5, 1.5, "F");
    doc.setTextColor(...chip.color);
    doc.text(text, x + 3, 27.5);
  }

  doc.setTextColor(...TEXT_INK);
}

function drawSectionHeader(
  doc: jsPDF,
  y: number,
  shortLabel: string,
  fullLabel: string,
  color: [number, number, number],
  count: number,
): number {
  // Stripe vertical de 1.5mm
  doc.setFillColor(...color);
  doc.rect(MARGIN_X, y, 1.5, 7, "F");

  // Pill con short label
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...color);
  doc.text(shortLabel, MARGIN_X + 4, y + 5);

  // Etiqueta amplia
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  const shortWidth = doc.getTextWidth(shortLabel);
  doc.text(fullLabel, MARGIN_X + 4 + shortWidth + 4, y + 5);

  // Count a la derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_INK);
  doc.text(String(count), PAGE_W - MARGIN_X, y + 5, { align: "right" });

  doc.setTextColor(...TEXT_INK);
  return y + 9;
}

function drawEmptyState(doc: jsPDF, y: number, message: string): number {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(message, MARGIN_X + 4, y + 4);
  doc.setTextColor(...TEXT_INK);
  return y + 9;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > 280) {
    doc.addPage();
    return 20;
  }
  return y;
}

function tableAfterSection(
  doc: jsPDF,
  startY: number,
  head: string[][],
  body: (string | number)[][],
  color: [number, number, number],
  columnStyles?: Record<number, { halign?: "left" | "right" | "center"; cellWidth?: number }>,
): number {
  autoTable(doc, {
    startY,
    head,
    body,
    theme: "plain",
    margin: { left: MARGIN_X + 2, right: MARGIN_X },
    tableWidth: CONTENT_W - 2,
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: TEXT_MUTED,
      fontSize: 8,
      fontStyle: "bold",
      cellPadding: { top: 1, bottom: 2, left: 2, right: 2 },
      lineWidth: { bottom: 0.2, top: 0, left: 0, right: 0 },
      lineColor: color,
    },
    bodyStyles: {
      fontSize: 10,
      cellPadding: 2.5,
      textColor: TEXT_INK,
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: ROW_STRIPE },
    columnStyles,
  });
  // @ts-expect-error - jspdf-autotable adds lastAutoTable
  return doc.lastAutoTable.finalY + 4;
}

// ─── Secciones ──────────────────────────────────────────────────────────────

function renderBookingsSection(
  doc: jsPDF,
  y: number,
  short: string,
  full: string,
  color: [number, number, number],
  rows: ParteDiarioBookingRow[],
  emptyMessage: string,
  timeKey: "check_in_time" | "check_out_time",
): number {
  y = ensureSpace(doc, y, 24);
  y = drawSectionHeader(doc, y, short, full, color, rows.length);
  if (rows.length === 0) return drawEmptyState(doc, y, emptyMessage);
  return tableAfterSection(
    doc,
    y,
    [["Hora", "Unidad", "Huésped / detalle", "Modo"]],
    rows.map((r) => [
      r[timeKey] ? r[timeKey]!.slice(0, 5) : "—",
      `${r.unit_code}  ${r.unit_name}`,
      describeBookingGuest(r),
      BOOKING_MODE_LABEL[r.mode],
    ]),
    color,
    {
      0: { cellWidth: 18, halign: "center" },
      1: { cellWidth: 56 },
      3: { cellWidth: 22, halign: "right" },
    },
  );
}

function renderSuciosSection(
  doc: jsPDF,
  y: number,
  rows: ParteDiarioCleaningRow[],
): number {
  const color = SECTION_RGB.sucios;
  y = ensureSpace(doc, y, 24);
  y = drawSectionHeader(doc, y, "SUCIOS", "Unidades a limpiar", color, rows.length);
  if (rows.length === 0) return drawEmptyState(doc, y, "Sin unidades a limpiar mañana.");

  return tableAfterSection(
    doc,
    y,
    [["Unidad", "Asignado", "Estado", "CH-out"]],
    rows.map((r) => [
      `${r.unit_code}  ${r.unit_name}`,
      r.assigned_to_name ?? (r.task_id ? "— Sin asignar" : "Crear tarea"),
      r.status ? CLEANING_STATUS_LABEL[r.status] : "Pendiente de creación",
      r.check_out_time ? r.check_out_time.slice(0, 5) : "—",
    ]),
    color,
    {
      0: { cellWidth: 56 },
      3: { cellWidth: 22, halign: "right" },
    },
  );
}

function renderMaintenanceSection(
  doc: jsPDF,
  y: number,
  short: string,
  full: string,
  color: [number, number, number],
  rows: ParteDiarioMaintenanceRow[],
  emptyMessage: string,
): number {
  y = ensureSpace(doc, y, 24);
  y = drawSectionHeader(doc, y, short, full, color, rows.length);
  if (rows.length === 0) return drawEmptyState(doc, y, emptyMessage);

  return tableAfterSection(
    doc,
    y,
    [["Unidad", "Tarea", "Prioridad", "Asignado"]],
    rows.map((r) => [
      r.unit_code,
      r.title,
      PRIORITY_LABEL[r.priority],
      r.assigned_to_name ?? "—",
    ]),
    color,
    {
      0: { cellWidth: 28 },
      2: { cellWidth: 24 },
      3: { cellWidth: 38 },
    },
  );
}

function renderTareasSection(
  doc: jsPDF,
  y: number,
  rows: ParteDiarioConciergeRow[],
): number {
  const color = SECTION_RGB.tareas_pendientes;
  y = ensureSpace(doc, y, 24);
  y = drawSectionHeader(doc, y, "TAREAS", "Tareas pendientes", color, rows.length);
  if (rows.length === 0)
    return drawEmptyState(doc, y, "Sin tareas pendientes desde el módulo Tareas.");

  return tableAfterSection(
    doc,
    y,
    [["Unidad", "Tarea", "Prioridad", "Asignado"]],
    rows.map((r) => [
      r.unit_code ?? "—",
      r.description,
      CONCIERGE_PRIORITY_LABEL[r.priority],
      r.assigned_to_name ?? "—",
    ]),
    color,
    {
      0: { cellWidth: 28 },
      2: { cellWidth: 24 },
      3: { cellWidth: 38 },
    },
  );
}

function drawFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont("helvetica", "italic");
    const ts = new Date().toLocaleString("es-AR", {
      timeZone: "America/Argentina/Cordoba",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    doc.text(`Generado automáticamente · ${ts}`, PAGE_W / 2, 290, { align: "center" });
    if (pageCount > 1) {
      doc.text(`Pág. ${i} / ${pageCount}`, PAGE_W - MARGIN_X, 290, { align: "right" });
    }
  }
}

// ─── Builder + outputs ──────────────────────────────────────────────────────

export function generateParteDiarioPDFDoc(snapshot: ParteDiarioSnapshot): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  drawHeader(doc, snapshot);

  let y = 45;
  // CH IN primero (matches dashboard layout: izquierda = ingresos del día).
  y = renderBookingsSection(
    doc,
    y,
    "CH IN",
    "Llegadas del día",
    SECTION_RGB.check_ins,
    snapshot.check_ins,
    "Sin check-ins hoy.",
    "check_in_time",
  );
  y = renderBookingsSection(
    doc,
    y,
    "CH OUT",
    "Salidas del día",
    SECTION_RGB.check_outs,
    snapshot.check_outs,
    "Sin check-outs hoy. Día tranquilo.",
    "check_out_time",
  );
  y = renderSuciosSection(doc, y, snapshot.sucios);
  y = renderTareasSection(doc, y, snapshot.tareas_pendientes);
  renderMaintenanceSection(
    doc,
    y,
    "ARREGLOS",
    "Mantenimiento",
    SECTION_RGB.arreglos,
    snapshot.arreglos,
    "Sin arreglos pendientes.",
  );

  drawFooter(doc);
  return doc;
}

/** Para descargar desde el browser. */
export function generateParteDiarioPDF(snapshot: ParteDiarioSnapshot, filename?: string) {
  const doc = generateParteDiarioPDFDoc(snapshot);
  doc.save(filename ?? `parte-diario-${snapshot.date}.pdf`);
}

/** Para subir a storage desde el server (sendParteDiario). */
export function generateParteDiarioPDFBytes(snapshot: ParteDiarioSnapshot): Uint8Array {
  const doc = generateParteDiarioPDFDoc(snapshot);
  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(buffer);
}
