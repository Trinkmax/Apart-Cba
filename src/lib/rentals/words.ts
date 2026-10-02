/**
 * Importe en letras para recibos ("Son pesos quinientos cuarenta y tres mil
 * quinientos con 00/100").
 *
 * Reglas del castellano que suelen salir mal:
 *   - 1 delante de sustantivo masculino se apocopa: "un millón", "veintiún mil",
 *     "treinta y un mil" — pero al final queda "uno" ("ciento uno").
 *   - 100 solo es "cien"; con algo detrás, "ciento" ("ciento uno").
 *   - 1.000 es "mil", nunca "un mil".
 *   - 1.000.000 es "un millón"; 2.000.000, "dos millones".
 */

const UNITS = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0..999. `apocope` = va delante de "mil"/"millón(es)": "un", "veintiún". */
function belowThousand(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    let words: string;
    if (rest < 30) {
      words = UNITS[rest];
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      words = u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t];
    }
    if (apocope) {
      if (words.endsWith("veintiuno")) words = words.replace(/veintiuno$/, "veintiún");
      else if (words.endsWith("uno")) words = words.replace(/uno$/, "un");
    }
    parts.push(words);
  }
  return parts.join(" ");
}

/** 0..999.999 (sin millones). */
function belowMillion(n: number, apocope: boolean): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (thousands === 1) parts.push("mil");
  else if (thousands > 1) parts.push(`${belowThousand(thousands, true)} mil`);
  if (rest) parts.push(belowThousand(rest, apocope));
  return parts.join(" ");
}

/** Entero no negativo en letras (hasta 999.999.999.999). */
export function integerToSpanishWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const parts: string[] = [];
  if (millions === 1) parts.push("un millón");
  else if (millions > 1) parts.push(`${belowMillion(millions, true)} millones`);
  if (rest) parts.push(belowMillion(rest, false));
  return parts.join(" ");
}

/** En un recibo la moneda va adelante y en plural: "Son pesos uno con 00/100". */
const CURRENCY_WORDS: Record<string, string> = {
  ARS: "pesos",
  USD: "dólares estadounidenses",
  EUR: "euros",
};

/**
 * "pesos quinientos cuarenta y tres mil quinientos con 00/100" — el documento
 * le antepone "Son". Con la moneda adelante no va "de" después de millón
 * ("Son pesos un millón con 00/100").
 */
export function amountToSpanishWords(amount: number, currency = "ARS"): string {
  const abs = Math.abs(amount);
  let integer = Math.floor(abs);
  let cents = Math.round((abs - integer) * 100);
  if (cents === 100) {
    integer += 1;
    cents = 0;
  }
  const name = CURRENCY_WORDS[currency] ?? currency;
  return `${name} ${integerToSpanishWords(integer)} con ${String(cents).padStart(2, "0")}/100`;
}
