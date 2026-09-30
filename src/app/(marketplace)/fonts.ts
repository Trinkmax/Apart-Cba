import { Manrope, Source_Serif_4 } from "next/font/google";

/**
 * Tipografías de la marca apart (manual de RONDA): Manrope para todo el
 * sistema y Source Serif 4 itálica para los acentos ("Llegar debe sentirse
 * simple.", "Dale, pasá."). Se cargan SÓLO en el route group (marketplace):
 * el panel sigue con Geist y no descarga nada de esto.
 *
 * Las variables (--ff-manrope / --ff-source-serif) se publican además en :root
 * desde el layout (ver ApartFontVars) para que los popovers, diálogos y toasts
 * —que Radix/Sonner montan en <body>, fuera del árbol— también las tengan.
 */
export const manrope = Manrope({
  subsets: ["latin"],
  variable: "--ff-manrope",
  display: "swap",
});

// Sólo la itálica: todos los usos de `font-apart-serif` son itálicos, y cargar
// la recta sumaba un archivo precargado que nadie pintaba.
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["italic"],
  axes: ["opsz"],
  variable: "--ff-source-serif",
  display: "swap",
});
