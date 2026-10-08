/**
 * Buscador de Caja (migración 071): "pongo el depto o el nombre de la persona
 * y me trae los movimientos".
 *
 * La base expone `v_cash_movements_search.search_text`: descripción + depto +
 * huésped / propietario / inquilino + deptos de la liquidación, ya en
 * minúsculas y sin tildes (`apartcba.search_fold`). Este módulo arma, del
 * otro lado, los tokens que se buscan ahí — con la MISMA normalización — y
 * resalta en pantalla lo que coincidió. Puro: lo usan el server action y los
 * componentes.
 */
import { parseAmountInput } from "@/lib/format";

/** Más tokens que esto no afinan nada y alargan la URL de PostgREST. */
export const CASH_SEARCH_MAX_TOKENS = 6;
/** Debajo de esto la búsqueda no arranca (una letra sola trae todo). */
export const CASH_SEARCH_MIN_CHARS = 2;
const MAX_QUERY_LENGTH = 120;

export type CashSearchToken = {
  /** Texto normalizado (foldSearch) que se busca dentro de search_text. */
  text: string;
  /** Si el token se lee como importe ("15.000", "$15000", "1500,50"), su valor. */
  amount: number | null;
};

/**
 * Minúsculas y sin tildes, diéresis, ñ ni ç. Espejo de `apartcba.search_fold`
 * (071): lo que tipea la persona y lo que guarda la base se comparan con la
 * misma forma, así "velez" encuentra "Vélez" y "pena" encuentra "Peña".
 */
export function foldSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Fuera: los comodines de LIKE (% _), el de PostgREST (*), las comillas y la
// barra (cerrarían o escaparían el valor entre comillas) y los paréntesis y
// los dos puntos (sintaxis de los árboles or/and). Queda texto que se puede
// poner tal cual entre comillas dobles en un filtro `or`.
const UNSAFE_CHARS = /[%_*"\\():]/g;
const AMOUNT_SHAPE = /^\$?\d[\d.,]*$/;

/**
 * Parte lo tipeado en tokens: cada uno tiene que aparecer (AND), en cualquier
 * orden — "juan reintegro" y "reintegro juan" traen lo mismo. Un token que se
 * lee como importe además matchea el importe exacto del movimiento.
 */
export function parseCashSearch(raw: string | null | undefined): CashSearchToken[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tokens: CashSearchToken[] = [];
  for (const piece of raw.slice(0, MAX_QUERY_LENGTH).split(/\s+/)) {
    if (!piece) continue;
    const text = foldSearch(piece).replace(UNSAFE_CHARS, "").replace(/^\$/, "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    let amount: number | null = null;
    if (AMOUNT_SHAPE.test(piece)) {
      const n = parseAmountInput(piece.replace(/^\$/, ""));
      if (n !== null && n > 0) amount = n;
    }
    tokens.push({ text, amount });
    if (tokens.length === CASH_SEARCH_MAX_TOKENS) break;
  }
  return tokens;
}

/** ¿Hay algo para buscar? (evita disparar con una sola letra). */
export function isCashSearchActive(raw: string | null | undefined): boolean {
  const tokens = parseCashSearch(raw);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => t.amount !== null)) return true;
  return tokens.reduce((n, t) => n + t.text.length, 0) >= CASH_SEARCH_MIN_CHARS;
}

/**
 * Filtro de PostgREST para UN token, para pasarle a `.or()`. Varios `.or()`
 * encadenados se combinan con AND — exactamente "todos los tokens".
 */
export function cashSearchTokenFilter(t: CashSearchToken): string {
  const like = `search_text.ilike."%${t.text}%"`;
  return t.amount !== null ? `${like},amount.eq."${t.amount}"` : like;
}

export type HighlightSegment = { text: string; match: boolean };

/**
 * Corta `text` en tramos marcando lo que coincide con algún token, sin
 * importar tildes ni mayúsculas ("Vélez" se resalta buscando "velez"). Los
 * tokens tienen que venir ya normalizados (`CashSearchToken.text`).
 */
export function highlightSegments(text: string, tokens: string[]): HighlightSegment[] {
  const needles = tokens.filter(Boolean);
  if (!text || needles.length === 0) return [{ text, match: false }];

  // Versión normalizada + mapa índice-normalizado → índice-original. Las
  // marcas combinantes normalizan a "" y no ocupan lugar: quedan pegadas a su
  // letra y se resaltan con ella.
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = foldSearch(ch);
    for (let k = 0; k < f.length; k++) origin.push(i);
    folded += f;
    i += ch.length;
  }
  origin.push(text.length);

  const marked = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(needle, from);
      if (at === -1) break;
      const start = origin[at];
      const end = origin[at + needle.length];
      for (let i = start; i < end; i++) marked[i] = true;
      from = at + 1;
    }
  }

  const out: HighlightSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else out.push({ text: text[i], match: marked[i] });
  }
  return out;
}
