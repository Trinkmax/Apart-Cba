import type { DepositRule } from "@/lib/types/database";
import { formatMoney } from "@/lib/format";
import { computeSena, isSenaCovered, resolveBookingSena, restoAlLlegar, roundMoney, type DepositPolicy } from "./sena";
import { digitsOnly } from "./display";
import type { TransferDetails } from "./web-settings";

/**
 * Lógica pura del panel del equipo para la web: opciones de seña al confirmar
 * un pedido, validación de "Web y cobros", etiquetas de fechas y vencimientos y
 * el mensaje para pegar en WhatsApp cuando el mail no sale. Sin I/O: la usan
 * las server actions (validan) y los formularios (validan en línea) por igual.
 */

// ─── Seña al confirmar ───────────────────────────────────────────────────────

export interface SenaOption {
  /** "1 noche", "2 noches", "50 %", "Sin seña". */
  label: string;
  /** Monto (0 = sin seña). */
  amount: number;
}

export interface StayMoney {
  nights: number;
  /** Total cobrado al huésped (con limpieza). */
  total: number;
  /** Limpieza incluida en el total (se excluye del valor por noche). */
  cleaningFee?: number | null;
  currency?: string;
}

/** Subtotal de alojamiento (total sin limpieza), nunca negativo. */
export function staySubtotal(m: StayMoney): number {
  const total = Number.isFinite(m.total) ? m.total : 0;
  const cleaning = m.cleaningFee != null && Number.isFinite(Number(m.cleaningFee)) ? Number(m.cleaningFee) : 0;
  return Math.max(0, total - Math.max(0, cleaning));
}

/**
 * Chips del modal "Confirmar reserva": "1 noche" primero, después "2 noches"
 * (si la estadía tiene más de una), el % de la política si es otro, "50 %" y
 * "Sin seña". Montos repetidos se quedan con la primera etiqueta.
 */
export function buildSenaOptions(m: StayMoney & { policy?: Pick<DepositPolicy, "rule" | "percent"> }): SenaOption[] {
  const currency = m.currency ?? "ARS";
  const subtotal = staySubtotal(m);
  const base = { nights: m.nights, subtotal, total: m.total, currency };
  const oneNight = computeSena({ ...base, policy: { rule: "one_night", percent: null } });

  const raw: Array<{ label: string; amount: number | null }> = [{ label: "1 noche", amount: oneNight }];
  if (m.nights >= 2 && oneNight != null) {
    raw.push({ label: "2 noches", amount: roundMoney(Math.min(oneNight * 2, m.total), currency) });
  }
  const policyPct = m.policy?.rule === "percent" ? Number(m.policy.percent) : null;
  if (policyPct != null && Number.isFinite(policyPct) && policyPct > 0 && policyPct !== 50) {
    raw.push({
      label: `${policyPct.toLocaleString("es-AR")} %`,
      amount: computeSena({ ...base, policy: { rule: "percent", percent: policyPct } }),
    });
  }
  raw.push({ label: "50 %", amount: computeSena({ ...base, policy: { rule: "percent", percent: 50 } }) });

  const out: SenaOption[] = [];
  const seen = new Set<number>();
  for (const o of raw) {
    if (o.amount == null || o.amount <= 0 || seen.has(o.amount)) continue;
    seen.add(o.amount);
    out.push({ label: o.label, amount: o.amount });
  }
  out.push({ label: "Sin seña", amount: 0 });
  return out;
}

/**
 * Seña que propone el modal: la estimada que vio el huésped al pedir manda
 * (así el mail de confirmación dice lo mismo que la pantalla del pedido); si
 * no hay (pedidos viejos), la que da la política de hoy. null = sin seña.
 */
export function suggestedSena(
  m: StayMoney & { estimate: number | null | undefined; policy: Pick<DepositPolicy, "rule" | "percent"> },
): number | null {
  const fallback = computeSena({
    policy: m.policy,
    nights: m.nights,
    subtotal: staySubtotal(m),
    total: m.total,
    currency: m.currency ?? "ARS",
  });
  const sena = resolveBookingSena({ depositAmount: null, estimate: m.estimate, fallback });
  return sena != null ? Math.min(sena, m.total) : null;
}

/**
 * Normaliza la seña elegida en el modal: vacío/0/negativo → 0 (sin seña);
 * nunca más que el total; pesos enteros en ARS. NaN → null (inválida).
 */
export function clampSena(amount: number | null | undefined, total: number, currency = "ARS"): number | null {
  if (amount == null) return 0;
  if (!Number.isFinite(amount)) return null;
  if (amount <= 0) return 0;
  return roundMoney(Math.min(amount, Math.max(0, total)), currency);
}

/** Ejemplo vivo de la configuración: "Para 3 noches a $70.000: seña …, al llegar …". */
export const SENA_EXAMPLE = { nights: 3, nightly: 70_000 } as const;

export function senaExample(policy: Pick<DepositPolicy, "rule" | "percent">): {
  nights: number;
  nightly: number;
  total: number;
  sena: number | null;
  resto: number;
} {
  const total = SENA_EXAMPLE.nights * SENA_EXAMPLE.nightly;
  const sena = computeSena({ policy, nights: SENA_EXAMPLE.nights, subtotal: total, total });
  return { ...SENA_EXAMPLE, total, sena, resto: restoAlLlegar(total, sena) };
}

/** "1 noche" / "3 noches". */
export function nightsLabel(n: number): string {
  return n === 1 ? "1 noche" : `${n} noches`;
}

export type { DepositRule, TransferDetails };

// ─── Validación de "Web y cobros" ────────────────────────────────────────────

/**
 * WhatsApp → dígitos con código de país, como los quiere wa.me. Contempla lo
 * que tipea la gente en Argentina: "+54 9 351 …", "0351 15 …", "351 …" o
 * "54 351 …" (sin el 9 de celular, que wa.me necesita). Otros países pasan
 * tal cual (sólo dígitos).
 */
export function toWhatsappDigits(raw: string | null | undefined): string {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  // Nacional con 0 de larga distancia: 0351 …
  if (d.startsWith("0")) d = d.slice(1);
  // Nacional con el "15" de celular: 351 15 1234567 (Córdoba) / 11 15 12345678 (AMBA).
  if (d.length === 12 && !d.startsWith("54")) {
    if (d.startsWith("11") && d.slice(2, 4) === "15") d = d.slice(0, 2) + d.slice(4);
    else if (d.slice(3, 5) === "15") d = d.slice(0, 3) + d.slice(5);
  }
  // Número argentino de 10 cifras sin código de país → celular de Argentina.
  if (d.length === 10 && !d.startsWith("54")) return `549${d}`;
  // 54 + 10 cifras sin el 9 → se lo agregamos.
  if (d.length === 12 && d.startsWith("54") && d[2] !== "9") return `549${d.slice(2)}`;
  return d;
}

export function whatsappError(digits: string): string | null {
  if (!digits) return null;
  if (!/^\d{8,15}$/.test(digits)) {
    return "Revisá el número: tiene que tener el código de país y entre 8 y 15 cifras (por ejemplo, +54 9 351 123-4567).";
  }
  return null;
}

/** CBU/CVU: sólo dígitos. */
export function normalizeCbu(raw: string | null | undefined): string {
  return digitsOnly(raw);
}

export function cbuError(digits: string): string | null {
  if (!digits) return null;
  if (digits.length !== 22) return `El CBU o CVU tiene 22 números (cargaste ${digits.length}).`;
  return null;
}

/**
 * Dígitos verificadores del CBU (bloque 1: banco+sucursal; bloque 2: cuenta).
 * Es un aviso, no un bloqueo: si algún CVU no siguiera la regla, igual se
 * puede guardar.
 */
export function cbuChecksumOk(digits: string): boolean {
  if (!/^\d{22}$/.test(digits)) return false;
  const n = digits.split("").map(Number);
  const check = (vals: number[], weights: number[]) => {
    const sum = vals.reduce((acc, v, i) => acc + v * weights[i % weights.length], 0);
    return (10 - (sum % 10)) % 10;
  };
  const b1 = check(n.slice(0, 7), [7, 1, 3, 9]);
  const b2 = check(n.slice(8, 21), [3, 9, 7, 1]);
  return b1 === n[7] && b2 === n[21];
}

/** Alias: minúsculas, sin espacios. */
export function normalizeAlias(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function aliasError(alias: string): string | null {
  if (!alias) return null;
  if (alias.length < 6 || alias.length > 20) return "El alias tiene entre 6 y 20 caracteres.";
  if (!/^[a-z0-9.-]+$/.test(alias)) return "El alias sólo lleva letras, números, puntos y guiones.";
  return null;
}

/** CUIT/CUIL: sólo dígitos. */
export function normalizeCuit(raw: string | null | undefined): string {
  return digitsOnly(raw);
}

export function cuitError(digits: string): string | null {
  if (!digits) return null;
  if (digits.length !== 11) return `El CUIT o CUIL tiene 11 números (cargaste ${digits.length}).`;
  return null;
}

/** Dígito verificador del CUIT/CUIL (módulo 11). Aviso, no bloqueo. */
export function cuitChecksumOk(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((acc, wi, i) => acc + wi * Number(digits[i]), 0);
  const mod = 11 - (sum % 11);
  const dv = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return dv === Number(digits[10]);
}

/** "20123456789" → "20-12345678-9". */
export function formatCuit(raw: string | null | undefined): string {
  const d = digitsOnly(raw);
  if (d.length !== 11) return (raw ?? "").trim();
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Instagram: sin @ ni URL ("https://instagram.com/apart.cba/" → "apart.cba"). */
export function normalizeInstagram(raw: string | null | undefined): string {
  let t = (raw ?? "").trim();
  const url = t.match(/instagram\.com\/([^/?#\s]+)/i);
  if (url) t = url[1];
  return t.replace(/^@+/, "").replace(/\/+$/, "").trim();
}

export function instagramError(handle: string): string | null {
  if (!handle) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return "El usuario de Instagram lleva letras, números, puntos o guiones bajos (hasta 30).";
  return null;
}

export function emailError(email: string): string | null {
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Revisá el email.";
  return null;
}

/** Entero dentro de [min, max] o mensaje de error. */
export function intInRangeError(value: number | null, min: number, max: number, what: string): string | null {
  if (value == null || !Number.isFinite(value) || !Number.isInteger(value)) return `${what}: poné un número entero.`;
  if (value < min || value > max) return `${what}: entre ${min} y ${max}.`;
  return null;
}

/** Lo que manda el formulario de "Web y cobros" (texto tal cual lo tipearon). */
export interface WebSettingsInput {
  whatsapp_number: string;
  public_email: string;
  instagram_handle: string;
  response_hours: number | string;
  deposit_rule: DepositRule;
  /** Sólo para deposit_rule = "percent". */
  deposit_percent: number | string | null;
  deposit_due_hours: number | string;
  transfer_holder: string;
  transfer_cuit: string;
  transfer_bank: string;
  transfer_cbu: string;
  transfer_alias: string;
  transfer_notes: string;
  cancellation_text: string;
}

export type WebSettingsField = keyof WebSettingsInput;

/** Fila lista para `org_web_settings` (sin organization_id ni auditoría). */
export interface NormalizedWebSettings {
  whatsapp_number: string | null;
  public_email: string | null;
  instagram_handle: string | null;
  response_hours: number;
  deposit_rule: DepositRule;
  deposit_percent: number | null;
  deposit_due_hours: number;
  transfer_holder: string | null;
  transfer_cuit: string | null;
  transfer_bank: string | null;
  transfer_cbu: string | null;
  transfer_alias: string | null;
  transfer_notes: string | null;
  cancellation_text: string | null;
}

const TEXT_LIMITS: Partial<Record<WebSettingsField, number>> = {
  transfer_holder: 120,
  transfer_bank: 80,
  transfer_notes: 500,
  cancellation_text: 2000,
};

const toNum = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const textOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Error de un campo del formulario (el primero que encuentra, en orden de pantalla). */
export type WebSettingsValidation =
  | { ok: true; value: NormalizedWebSettings }
  | { ok: false; error: string; field: WebSettingsField };

/**
 * Valida y normaliza "Web y cobros". El mismo código corre en el formulario
 * (errores en línea) y en la server action (la verdad), así nunca discrepan.
 */
export function validateWebSettingsInput(input: WebSettingsInput): WebSettingsValidation {
  const fail = (field: WebSettingsField, error: string): WebSettingsValidation => ({ ok: false, error, field });

  const whatsapp = toWhatsappDigits(input.whatsapp_number);
  const wErr = whatsappError(whatsapp);
  if (wErr) return fail("whatsapp_number", wErr);

  const email = (input.public_email ?? "").trim().toLowerCase();
  const eErr = emailError(email);
  if (eErr) return fail("public_email", eErr);

  const instagram = normalizeInstagram(input.instagram_handle);
  const iErr = instagramError(instagram);
  if (iErr) return fail("instagram_handle", iErr);

  const responseHours = toNum(input.response_hours);
  // Hasta 36 h: el pedido vence solo a las 48 h y el recordatorio al equipo
  // tiene que llegar antes de eso.
  const rErr = intInRangeError(responseHours, 1, 36, "Respondemos en");
  if (rErr) return fail("response_hours", rErr);

  const rule = input.deposit_rule;
  if (rule !== "one_night" && rule !== "percent" && rule !== "none") return fail("deposit_rule", "Elegí cómo se calcula la seña.");
  let percent: number | null = null;
  if (rule === "percent") {
    percent = toNum(input.deposit_percent);
    if (percent == null || percent < 1 || percent > 100) return fail("deposit_percent", "El porcentaje va de 1 a 100.");
    percent = Math.round(percent * 100) / 100;
  }

  const dueHours = toNum(input.deposit_due_hours);
  const dErr = intInRangeError(dueHours, 1, 168, "Plazo para transferir");
  if (dErr) return fail("deposit_due_hours", dErr);

  const cuit = normalizeCuit(input.transfer_cuit);
  const cErr = cuitError(cuit);
  if (cErr) return fail("transfer_cuit", cErr);

  const cbu = normalizeCbu(input.transfer_cbu);
  const bErr = cbuError(cbu);
  if (bErr) return fail("transfer_cbu", bErr);

  const alias = normalizeAlias(input.transfer_alias);
  const aErr = aliasError(alias);
  if (aErr) return fail("transfer_alias", aErr);

  for (const [field, max] of Object.entries(TEXT_LIMITS) as Array<[WebSettingsField, number]>) {
    const v = String(input[field] ?? "").trim();
    if (v.length > max) return fail(field, `Es muy largo (máximo ${max} caracteres).`);
  }

  return {
    ok: true,
    value: {
      whatsapp_number: whatsapp || null,
      public_email: email || null,
      instagram_handle: instagram || null,
      response_hours: responseHours as number,
      deposit_rule: rule,
      deposit_percent: percent,
      deposit_due_hours: dueHours as number,
      transfer_holder: textOrNull(input.transfer_holder),
      transfer_cuit: cuit ? formatCuit(cuit) : null,
      transfer_bank: textOrNull(input.transfer_bank),
      transfer_cbu: cbu || null,
      transfer_alias: alias || null,
      transfer_notes: textOrNull(input.transfer_notes),
      cancellation_text: textOrNull(input.cancellation_text),
    },
  };
}

// ─── Fechas y vencimientos ───────────────────────────────────────────────────

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "vie 3 oct" desde un YYYY-MM-DD (sin zonas horarias en el medio). */
export function shortDayLabel(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** Noches entre dos YYYY-MM-DD. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseIso(checkIn);
  const b = parseIso(checkOut);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** "vie 3 oct → dom 5 oct · 2 noches". */
export function stayRangeLabel(checkIn: string, checkOut: string, nights?: number): string {
  const n = nights ?? nightsBetween(checkIn, checkOut);
  return `${shortDayLabel(checkIn)} → ${shortDayLabel(checkOut)} · ${nightsLabel(n)}`;
}

/**
 * "5 h 20 min", "40 min", "30 h", "3 días 2 h". Hasta 48 h cuenta en horas: los
 * pedidos vencen a las 48 h y "1 día" esconde si es mañana temprano o a la noche.
 */
export function durationLabel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const totalHours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (totalHours >= 48) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `${days} días ${hours} h` : `${days} días`;
  }
  if (totalHours > 0) return mins > 0 && totalHours < 6 ? `${totalHours} h ${mins} min` : `${totalHours} h`;
  return `${Math.max(1, mins)} min`;
}

export const URGENT_EXPIRY_MS = 6 * 60 * 60 * 1000;

/** Estado del vencimiento de un pedido: "Vence en 5 h 20 min" (urgente si < 6 h). */
export function expiryInfo(expiresAtIso: string, nowMs: number): { expired: boolean; urgent: boolean; label: string } {
  const at = Date.parse(expiresAtIso);
  if (!Number.isFinite(at)) return { expired: false, urgent: false, label: "" };
  const left = at - nowMs;
  if (left <= 0) return { expired: true, urgent: true, label: "Venció" };
  return { expired: false, urgent: left < URGENT_EXPIRY_MS, label: `Vence en ${durationLabel(left)}` };
}

/** ¿Se pisan dos estadías? Intervalos [entrada, salida): el día de salida queda libre. */
export function staysOverlap(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < bOut && bIn < aOut;
}

// ─── Resumen de la seña de una reserva ───────────────────────────────────────

export interface SenaStatus {
  sena: number | null;
  paid: number;
  covered: boolean;
  /** Lo que falta de la seña (0 si está cubierta o no hay). */
  missing: number;
  /** Venció el plazo y todavía falta. */
  overdue: boolean;
}

export function senaStatus(p: { sena: number | null; paid: number | null | undefined; dueAt: string | null; nowMs: number }): SenaStatus {
  const sena = p.sena != null && p.sena > 0 ? p.sena : null;
  const paid = p.paid != null && Number.isFinite(Number(p.paid)) ? Number(p.paid) : 0;
  const covered = isSenaCovered(paid, sena);
  const missing = covered || sena == null ? 0 : Math.max(0, sena - paid);
  const due = p.dueAt ? Date.parse(p.dueAt) : NaN;
  return { sena, paid, covered, missing, overdue: !covered && Number.isFinite(due) && due < p.nowMs };
}

// ─── Mensaje para WhatsApp cuando el mail no sale ────────────────────────────

export interface ConfirmationMessageInput {
  guestName: string;
  unitTitle: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  currency: string;
  /** Seña elegida al confirmar (null/0 = sin seña). */
  sena: number | null;
  dueHours: number;
  transfer: TransferDetails | null;
  /** Link absoluto de seguimiento (/reserva/<token>). */
  trackingUrl: string | null;
}

function money(n: number, currency: string): string {
  // Para el huésped, como en la web y los mails: "$ 279.000", sin ",00" si el
  // monto es redondo (el panel sí muestra centavos; acá no aportan nada).
  const text = Number.isInteger(n)
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
    : formatMoney(n, currency);
  // Espacio normal (Intl usa uno duro) para que se pegue prolijo en WhatsApp.
  return text.replace(/\u00a0/g, " ");
}

/** Primer nombre para saludar ("María José Pérez" → "María"). */
export function firstName(full: string | null | undefined): string {
  const t = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** Datos de transferencia en líneas "Etiqueta: valor" (sólo los cargados). */
export function transferLines(t: TransferDetails | null): string[] {
  if (!t) return [];
  const rows: Array<[string, string | null]> = [
    ["Titular", t.holder],
    ["CUIT/CUIL", t.cuit],
    ["Banco", t.bank],
    ["CBU/CVU", t.cbu],
    ["Alias", t.alias],
  ];
  const out = rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v!.trim()}`);
  if (t.notes?.trim()) out.push(t.notes.trim());
  return out;
}

/**
 * Texto para pegar en WhatsApp con lo mismo que dice el mail de confirmación:
 * estadía, seña, a dónde transferir, plazo, el resto al llegar y el link de
 * seguimiento. Sin emojis.
 */
export function buildConfirmationMessage(p: ConfirmationMessageInput): string {
  const name = firstName(p.guestName);
  const sena = p.sena != null && p.sena > 0 ? Math.min(p.sena, p.total) : null;
  const resto = restoAlLlegar(p.total, sena);
  const hours = Number.isFinite(p.dueHours) && p.dueHours > 0 ? p.dueHours : 24;
  const lines: string[] = [];
  lines.push(`Hola${name ? ` ${name}` : ""}, te confirmamos la reserva en ${p.unitTitle}.`);
  lines.push(`${stayRangeLabel(p.checkIn, p.checkOut, p.nights)} · ${p.guests === 1 ? "1 huésped" : `${p.guests} huéspedes`}. Total: ${money(p.total, p.currency)}.`);
  lines.push("");
  if (sena != null) {
    lines.push(`Para asegurar tus fechas, transferí la seña de ${money(sena, p.currency)} dentro de las próximas ${hours === 1 ? "1 hora" : `${hours} horas`}.`);
    const tl = transferLines(p.transfer);
    if (tl.length > 0) {
      lines.push("Datos para transferir:");
      lines.push(...tl);
    } else {
      lines.push("Te pasamos los datos para transferir por acá.");
    }
    lines.push("");
    lines.push(`El resto (${money(resto, p.currency)}) lo pagás al llegar, en efectivo o por transferencia.`);
  } else {
    lines.push(`No hace falta seña: el total (${money(p.total, p.currency)}) lo pagás al llegar, en efectivo o por transferencia.`);
  }
  if (p.trackingUrl) {
    lines.push("");
    lines.push(`Seguí tu reserva acá: ${p.trackingUrl}`);
    if (sena != null) lines.push("Cuando transfieras, avisanos desde ese link.");
  }
  return lines.join("\n");
}

// ─── Fecha y hora para el panel ──────────────────────────────────────────────

/** "vie 2 oct · 14:30" de un timestamp, en la zona de la organización. */
export function dateTimeLabel(iso: string | null | undefined, timeZone = "America/Argentina/Cordoba"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${shortDayLabel(ymd)} · ${hm}`;
}
