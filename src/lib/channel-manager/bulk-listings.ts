import type { OtaProvider } from "@/lib/types/database";

// ════════════════════════════════════════════════════════════════════════════
// Importador masivo de mapeos OTA — parseo de texto pegado + fuzzy match a unidad.
// Módulo puro (sin React, sin Supabase): se usa client-side desde el diálogo de
// importación. La lógica de match replica la de src/lib/inbound/matcher.ts para
// que el preview coincida con cómo el sistema resuelve reservas entrantes.
// ════════════════════════════════════════════════════════════════════════════

/** Proveedores cuyo ID externo es numérico (Airbnb: nº de /rooms/<id>). */
const NUMERIC_PROVIDERS: OtaProvider[] = ["airbnb", "expedia", "vrbo"];

export type UnitForMatch = {
  id: string;
  code: string;
  name: string;
  marketplace_title?: string | null;
};

export type ParsedLine = {
  raw: string;
  /** Texto a emparejar contra una unidad ("" si la línea trae solo el ID). */
  unitHint: string;
  /** ID externo extraído ("" si no se pudo detectar). */
  externalId: string;
  /** URL del listing si se pegó una completa (http/https). */
  externalUrl: string | null;
};

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export type FuzzyMatch = { unitId: string; ambiguous: boolean };

/**
 * Empareja un hint (código / nombre / título) contra la lista de unidades.
 * Mismo criterio que el matcher de inbound: substring exacto (score 0) o
 * Levenshtein ≤ 3 para hints de ≥ 5 caracteres. El substring "hint contiene
 * campo" se limita a campos de ≥ 3 chars para evitar matches espurios con
 * códigos muy cortos. Devuelve null si no hay match.
 */
export function fuzzyMatchUnit(hint: string, units: UnitForMatch[]): FuzzyMatch | null {
  const nh = normalize(hint);
  if (!nh) return null;

  const candidates: { id: string; score: number }[] = [];
  for (const u of units) {
    const fields = [u.code, u.name, u.marketplace_title]
      .filter(Boolean)
      .map((f) => normalize(f as string));

    if (fields.some((f) => f.includes(nh) || (f.length >= 3 && nh.includes(f)))) {
      candidates.push({ id: u.id, score: 0 });
      continue;
    }
    if (nh.length >= 5) {
      const minDist = Math.min(...fields.map((f) => levenshtein(f, nh)));
      if (minDist <= 3) candidates.push({ id: u.id, score: minDist });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  const ambiguous = candidates.filter((c) => c.score === best.score).length > 1;
  return { unitId: best.id, ambiguous };
}

function extractUrl(s: string): string | null {
  return s.match(/https?:\/\/[^\s,;]+/i)?.[0] ?? null;
}

function extractId(source: string, provider: OtaProvider): string {
  const s = source.trim();
  if (NUMERIC_PROVIDERS.includes(provider)) {
    // URL airbnb.com/rooms/<id> (con o sin esquema)
    const room = s.match(/rooms\/(\d{4,14})/i)?.[1];
    if (room) return room;
    // Si no, la corrida de dígitos más larga (≥4) — el ID de listing es largo,
    // así no choca con números cortos que pueda tener un código de unidad.
    const runs = s.match(/\d{4,14}/g);
    if (runs?.length) return [...runs].sort((a, b) => b.length - a.length)[0];
    return "";
  }
  if (provider === "booking") {
    const slug = s.match(/hotel\/[a-z]{2}\/([^/.\s]+)/i)?.[1];
    if (slug) return slug;
    return s
      .replace(/^https?:\/\/\S+?\//i, "")
      .replace(/\.html.*$/i, "")
      .trim();
  }
  // "otro": identificador libre, se usa tal cual
  return s;
}

/**
 * Parsea el texto pegado (una unidad por línea). Acepta:
 *  - "unidad <TAB | , | ;> ID/URL"  → empareja unidad por la 1ª columna
 *  - "ID/URL"                       → unidad sin asignar (se elige en el preview)
 * Para proveedores numéricos sin separador explícito, intenta separar el texto
 * de la unidad de la corrida de dígitos del ID (ej. "JARDIN-ITU 50432101").
 */
export function parseBulkListingLines(text: string, provider: OtaProvider): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => parseOneLine(line, provider));
}

function parseOneLine(line: string, provider: OtaProvider): ParsedLine {
  let unitHint = "";
  let idSource = line;

  const sep = line.match(/[\t,;]/);
  if (sep) {
    const idx = line.indexOf(sep[0]);
    unitHint = line.slice(0, idx).trim();
    idSource = line.slice(idx + 1).trim();
  }

  const externalUrl = extractUrl(idSource) ?? extractUrl(line);
  const externalId = extractId(idSource, provider);

  // Sin separador pero con texto + dígitos (proveedor numérico): rescatar el hint.
  // Si la línea es una URL pelada, no hay hint de unidad (evita matches espurios).
  if (!sep && externalId && !externalUrl && NUMERIC_PROVIDERS.includes(provider)) {
    const before = line.slice(0, line.indexOf(externalId)).replace(/[\t,;]+$/, "").trim();
    if (/[a-zA-ZÀ-ÿ]/.test(before)) unitHint = before;
  }

  return { raw: line, unitHint, externalId, externalUrl };
}
