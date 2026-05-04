type CsvCell = string | number | boolean | null | undefined;

export type CsvOptions = {
  separator?: "," | ";";
};

export function toCsv(rows: CsvCell[][], options?: CsvOptions): string {
  const sep = options?.separator ?? ";";
  return rows.map((row) => row.map((cell) => escapeCell(cell, sep)).join(sep)).join("\r\n");
}

function escapeCell(cell: CsvCell, sep: string): string {
  if (cell === null || cell === undefined) return "";
  const s = typeof cell === "number" ? String(cell) : String(cell);
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename: string, content: string): void {
  // BOM UTF-8 para que Excel-AR abra acentos y separador correctamente.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
