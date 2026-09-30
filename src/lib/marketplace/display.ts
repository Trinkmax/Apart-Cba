import type { CancellationPolicy } from "@/lib/types/database";

/**
 * Cómo se muestran en la web los datos que se cargan en el PMS.
 *
 * El PMS guarda nombres operativos ("PARANA -Nueva Córdoba ", "RONDEAU II",
 * "DUOMO -Nueva Cordoba-") y barrios tipeados a mano ("NUEVA CORDBA",
 * "Centro ", "GUEMES"). Esos datos no se tocan —el equipo los usa así todos
 * los días—: se normalizan al mostrarlos. Todo es puro y testeado.
 */

// ─── Texto base ──────────────────────────────────────────────────────────────

/** Clave de comparación: sin tildes, minúsculas, espacios colapsados. */
export function foldKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Barrios ─────────────────────────────────────────────────────────────────

/** Barrios de Córdoba capital con su grafía correcta. */
const NEIGHBORHOODS: Record<string, string> = {
  "nueva cordoba": "Nueva Córdoba",
  "nueva cordba": "Nueva Córdoba",
  "nva cordoba": "Nueva Córdoba",
  centro: "Centro",
  "pleno centro": "Centro",
  "barrio centro": "Centro",
  alberdi: "Alberdi",
  "alto alberdi": "Alto Alberdi",
  "alta cordoba": "Alta Córdoba",
  guemes: "Güemes",
  "general paz": "General Paz",
  "gral paz": "General Paz",
  "gral. paz": "General Paz",
  cofico: "Cofico",
  crisol: "Crisol",
  "crisol norte": "Crisol",
  "crisol sur": "Crisol",
  "cerro de las rosas": "Cerro de las Rosas",
  "villa belgrano": "Villa Belgrano",
  "barrio jardin": "Barrio Jardín",
  "san vicente": "San Vicente",
  observatorio: "Observatorio",
  "villa carlos paz": "Villa Carlos Paz",
};

/** Barrio canónico para mostrar y agrupar. Desconocido → Título en español. */
export function canonicalNeighborhood(raw: string | null | undefined): string | null {
  const key = foldKey(raw);
  if (!key) return null;
  if (NEIGHBORHOODS[key]) return NEIGHBORHOODS[key];
  return titleCaseEs(key);
}

/** Slug estable de un barrio para URLs y filtros ("Nueva Córdoba" → "nueva-cordoba"). */
export function neighborhoodSlug(raw: string | null | undefined): string | null {
  const canonical = canonicalNeighborhood(raw);
  return canonical ? foldKey(canonical).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
}

// ─── Títulos ─────────────────────────────────────────────────────────────────

/** Palabras que en español van en minúscula dentro de un título. */
const LOWER_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "al"]);

/** Nombres de calles y lugares de Córdoba con tildes que el PMS escribe sin ellas. */
const ACCENTED_WORDS: Record<string, string> = {
  parana: "Paraná",
  quiros: "Quirós",
  velez: "Vélez",
  dean: "Deán",
  tucuman: "Tucumán",
  ituzaingo: "Ituzaingó",
  rios: "Ríos",
  rio: "Río",
  peron: "Perón",
  cordoba: "Córdoba",
  guemes: "Güemes",
  bolivar: "Bolívar",
  garzon: "Garzón",
  canada: "Cañada",
  cañada: "Cañada",
  sarsfield: "Sarsfield",
  independencia: "Independencia",
  simon: "Simón",
  jose: "José",
  angelo: "Ángelo",
  transito: "Tránsito",
  caceres: "Cáceres",
  maria: "María",
  martin: "Martín",
};

const ROMAN = /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/i;

function titleCaseWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && LOWER_WORDS.has(lower)) return lower;
  if (ROMAN.test(word) && word.length <= 4 && word === word.toUpperCase()) return word.toUpperCase();
  if (/^pb$/i.test(word)) return "PB";
  if (/^\d/.test(word)) return word.toUpperCase();
  const folded = foldKey(word);
  if (ACCENTED_WORDS[folded]) return ACCENTED_WORDS[folded];
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "PASO DE LOS ANDES 2" → "Paso de los Andes 2". */
export function titleCaseEs(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => w.split("-").map((part, j) => titleCaseWord(part, i + j)).join("-"))
    .join(" ");
}

export interface DisplayTitle {
  /** Nombre para mostrar ("Paraná", "Rondeau II", "Perón 2"). */
  title: string;
  /**
   * Lo que el PMS puso entre guiones y NO es el barrio ("Complejo",
   * "Futura Pilay"). null si no había nada o era el barrio.
   */
  tagline: string | null;
}

/**
 * Nombre de una unidad para la web. Separa el sufijo entre guiones
 * ("DUOMO -Nueva Cordoba-", "ROMA - General Paz") y, si es un barrio, lo
 * descarta (el barrio ya se muestra aparte).
 */
export function displayTitle(raw: string | null | undefined): DisplayTitle {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { title: "Departamento", tagline: null };

  // Sufijo: " -X-", " -X", " - X" al final.
  const match = text.match(/^(.*?)\s+-\s*([^-]+?)\s*-?\s*$/);
  let base = text;
  let suffix: string | null = null;
  if (match && match[1].trim().length > 0) {
    base = match[1].trim();
    suffix = match[2].trim();
  }
  const title = normalizeCase(base.replace(/[-\s]+$/, ""));
  if (!suffix) return { title, tagline: null };

  const suffixKey = foldKey(suffix);
  const isNeighborhood = Boolean(NEIGHBORHOODS[suffixKey]);
  return { title, tagline: isNeighborhood ? null : normalizeCase(suffix) };
}

/**
 * Sólo se "arregla" lo que viene gritado del PMS ("RONDEAU II"). Un título ya
 * escrito a mano ("1 dormitorio amoblado en Villa Belgrano") se respeta tal
 * cual, con la primera letra en mayúscula.
 */
function normalizeCase(text: string): string {
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const isShouting = letters.length > 0 && letters === letters.toUpperCase();
  if (isShouting) return titleCaseEs(text);
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ─── Capacidad y ambientes ───────────────────────────────────────────────────

/** 0 → "Monoambiente", 1 → "1 dormitorio", n → "n dormitorios". */
export function bedroomsLabel(bedrooms: number | null | undefined): string | null {
  if (bedrooms == null || !Number.isFinite(Number(bedrooms))) return null;
  const n = Number(bedrooms);
  if (n <= 0) return "Monoambiente";
  return n === 1 ? "1 dormitorio" : `${n} dormitorios`;
}

export function guestsLabel(max: number | null | undefined): string | null {
  if (max == null || !Number.isFinite(Number(max)) || Number(max) <= 0) return null;
  const n = Number(max);
  return n === 1 ? "1 huésped" : `Hasta ${n} huéspedes`;
}

export function bathroomsLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return null;
  return Number(n) === 1 ? "1 baño" : `${Number(n)} baños`;
}

/**
 * Frase descriptiva de la unidad: "Monoambiente en Centro",
 * "Depto de 2 dormitorios en Nueva Córdoba".
 */
export function listingSummaryLine(params: {
  bedrooms: number | null | undefined;
  neighborhood: string | null | undefined;
}): string {
  const hood = canonicalNeighborhood(params.neighborhood);
  const b = params.bedrooms == null ? null : Number(params.bedrooms);
  let kind: string;
  if (b == null || !Number.isFinite(b)) kind = "Departamento";
  else if (b <= 0) kind = "Monoambiente";
  else kind = `Depto de ${b === 1 ? "1 dormitorio" : `${b} dormitorios`}`;
  return hood ? `${kind} en ${hood}` : kind;
}

// ─── Horarios ────────────────────────────────────────────────────────────────

/** "14:00:00" → "14 h", "14:30" → "14:30 h", "00:00" → "medianoche". */
export function formatHour(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 0 && min === 0) return "medianoche";
  if (h === 12 && min === 0) return "mediodía";
  return min === 0 ? `${h} h` : `${h}:${String(min).padStart(2, "0")} h`;
}

/** Ventana de check-in: "de 14 a 22 h", "desde las 14 h hasta la medianoche". */
export function checkInWindowLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  const s = formatHour(start);
  const e = formatHour(end);
  if (!s) return null;
  if (!e) return `desde las ${s}`;
  if (e === "medianoche") return `desde las ${s} hasta la medianoche`;
  const sNum = s.replace(" h", "");
  return `de ${sNum} a ${e}`;
}

// ─── Política de cancelación ─────────────────────────────────────────────────

/**
 * Texto de la política de cancelación para el huésped. Respeta la definición
 * que el equipo eligió en el editor de la unidad (listing-manager-client):
 * flexible = gratis hasta 24 h antes, moderada = gratis hasta 5 días antes y
 * después 50 %, estricta = cargo total al cancelar.
 * `customText` (Configuración → Web y cobros) reemplaza todo si está cargado.
 */
export function cancellationCopy(
  policy: CancellationPolicy | null | undefined,
  customText?: string | null,
): { title: string; body: string } {
  const custom = customText?.trim();
  if (custom) return { title: "Política de cancelación", body: custom };
  switch (policy) {
    case "flexible":
      return {
        title: "Cancelación flexible",
        body: "Podés cancelar sin cargo hasta 24 horas antes del check-in.",
      };
    case "moderada":
      return {
        title: "Cancelación moderada",
        body: "Sin cargo hasta 5 días antes del check-in. Después, se cobra el 50 % de la estadía.",
      };
    case "estricta":
    default:
      return {
        title: "Cancelación estricta",
        body: "Una vez confirmada, la reserva no tiene reintegro si cancelás. Elegí tus fechas con tranquilidad antes de pedirla.",
      };
  }
}

/** La regla de cada política dicha para una reserva que ya está confirmada. */
const CONFIRMED_RULE: Record<CancellationPolicy, string> = {
  flexible: "Podés cancelar sin cargo hasta 24 horas antes del check-in.",
  moderada: "Sin cargo hasta 5 días antes del check-in; después, se cobra el 50 % de la estadía.",
  estricta: "Si cancelás, la seña no tiene reintegro.",
};

/**
 * La política de cancelación en el SEGUIMIENTO de una reserva y en el mail de
 * confirmación (la ficha y el checkout usan `cancellationCopy`, que habla de
 * antes de pedir). Dos momentos:
 *
 * - `pending`: el pedido todavía no se confirmó → se cancela sin costo desde
 *   el link, y se anticipa qué rige una vez confirmada.
 * - `confirmed`: rige la política del alojamiento y se cancela escribiéndonos
 *   (el link sólo cancela pedidos pendientes).
 */
export function cancellationFollowUpCopy(
  policy: CancellationPolicy | null | undefined,
  customText: string | null | undefined,
  phase: "pending" | "confirmed",
): { title: string; body: string } {
  const custom = customText?.trim() || null;
  const key: CancellationPolicy = policy === "flexible" || policy === "moderada" ? policy : "estricta";
  const { title } = cancellationCopy(policy, customText);
  if (phase === "pending") {
    // Después de los dos puntos va en minúscula; el texto propio, tal cual.
    const builtIn = CONFIRMED_RULE[key];
    const rule = custom ?? builtIn.charAt(0).toLowerCase() + builtIn.slice(1);
    return {
      title,
      body: `Mientras tu pedido esté pendiente, lo cancelás sin costo desde este link.\nUna vez confirmada: ${rule}`,
    };
  }
  if (custom) return { title, body: `${custom}\nPara cancelar, escribinos.` };
  const tail =
    key === "estricta" ? "Si necesitás cambiar algo, escribinos y vemos cómo ayudarte." : "Para cancelar, escribinos.";
  return { title, body: `${CONFIRMED_RULE[key]} ${tail}` };
}

// ─── Contacto ────────────────────────────────────────────────────────────────

/** Deja sólo dígitos. "+54 9 351 563-9985" → "5493515639985". */
export function digitsOnly(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D+/g, "");
}

/** Link de WhatsApp con mensaje precargado (el texto va codificado). */
export function whatsappLink(number: string | null | undefined, text?: string): string | null {
  const digits = digitsOnly(number);
  if (digits.length < 8) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

/** "+54 9 351 563-9985" para mostrar un número argentino guardado como dígitos. */
export function formatPhoneAR(raw: string | null | undefined): string | null {
  const d = digitsOnly(raw);
  if (!d) return null;
  // 54 9 AAA NNN-NNNN (móvil con código de área de 3 dígitos, como Córdoba 351)
  const m = d.match(/^54(9?)(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+54 ${m[1] ? "9 " : ""}${m[2]} ${m[3]}-${m[4]}`;
  return `+${d}`;
}
