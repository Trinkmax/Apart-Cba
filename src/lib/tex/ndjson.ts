/**
 * El stream de Tex: NDJSON, un evento por línea (nov-2026). Puro.
 * El servidor escribe con `encodeEvent`; el navegador lee con `NdjsonReader`.
 */
import type { TexEvent } from "./types";

const encoder = new TextEncoder();

export function encodeEvent(ev: TexEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(ev)}\n`);
}

/** Junta pedazos de texto y devuelve los eventos completos (las líneas cerradas). */
export class NdjsonReader {
  private buf = "";

  push(chunk: string): TexEvent[] {
    this.buf += chunk;
    const out: TexEvent[] = [];
    let nl = this.buf.indexOf("\n");
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) {
        try {
          out.push(JSON.parse(line) as TexEvent);
        } catch {
          /* una línea rota no tumba el resto */
        }
      }
      nl = this.buf.indexOf("\n");
    }
    return out;
  }

  /** Lo que quedó sin salto de línea al cerrar el stream. */
  flush(): TexEvent[] {
    const rest = this.buf.trim();
    this.buf = "";
    if (!rest) return [];
    try {
      return [JSON.parse(rest) as TexEvent];
    } catch {
      return [];
    }
  }
}
