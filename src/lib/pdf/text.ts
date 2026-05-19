/**
 * Saneo de texto para jsPDF.
 *
 * Los fonts estándar de jsPDF (Helvetica/Times/Courier) usan encoding WinAnsi
 * (cp1252). El MINUS SIGN tipográfico U+2212 ("−") que usábamos como signo
 * negativo NO está en ese set: se renderiza como basura (`"`), rompe el kerning
 * y descuadra el ancho de celda en jspdf-autotable. Eso es exactamente el
 * "$ 1 2 0 . 0 0 0" cortado de la liquidación. `formatMoney` además mete un
 * NBSP/figure-space entre símbolo y número que conviene normalizar para que el
 * cálculo de ancho de autoTable sea predecible.
 *
 * En/em dash (– —) SÍ están en WinAnsi y se renderizan bien: se conservan
 * porque son el marcador intencional de celda vacía.
 *
 * Pasá por acá CUALQUIER string dinámico antes de dibujarlo (doc.text y celdas
 * de autoTable).
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[−―]/g, "-"], // − MINUS SIGN, ― horizontal bar → hyphen-minus
  [/[‘’‛′]/g, "'"], // ' ' ‛ ′ → apóstrofo
  [/[“”„″]/g, '"'], // " " „ ″ → comillas
  [/…/g, "..."], // … → ...
  [/[           ]/g, " "], // espacios raros → espacio normal
  [/[​‌‍﻿]/g, ""], // zero-width / BOM → nada
];

export function pdfSafe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  return s;
}

/** Importe negativo para PDF: guion ASCII, nunca el U+2212. */
export function pdfNeg(formatted: string): string {
  return `-${pdfSafe(formatted)}`;
}

/** Importe con signo explícito ('+' suma, '-' resta) saneado para PDF. */
export function pdfSigned(formatted: string, sign: "+" | "-"): string {
  return `${sign === "+" ? "+" : "-"}${pdfSafe(formatted)}`;
}
