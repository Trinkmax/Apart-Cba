/**
 * Lo que comparten las herramientas de escritura de Tex (nov-2026).
 *
 * - Resolver la reserva o el huésped que la persona nombra con la regla de oro:
 *   con más de un candidato, o con uno que NO coincide tal cual con lo que se
 *   dijo, se pregunta (`choose`). "Zulma Pereyra" nunca se resuelve sola a
 *   "Camila Pereyra".
 * - Leer la reserva completa (org-scoped, vía `getBooking`).
 * - Traducir las actions que devuelven `{ ok: false, error }` en vez de tirar.
 *
 * Búsqueda tolerante a tildes: `searchBookingsGlobal`/`searchGuests` usan
 * `ilike`, que distingue "Perez" de "Pérez". Como tercera pasada se busca la
 * palabra más larga con las vocales (y la n, por la ñ) como comodín `_` de
 * ilike, y la precisión la pone el filtro en memoria con `fold()`: el resultado
 * tiene que contener TODAS las palabras que dijo la persona.
 */
import { z } from "zod/v4";
import { getBooking, searchBookingsGlobal } from "@/lib/actions/bookings";
import { getGuest, searchGuests } from "@/lib/actions/guests";
import { normalizeEmail, normalizePhoneE164 } from "@/lib/channels/guest";
import { BOOKING_STATUS_META } from "@/lib/constants";
import type { BookingSearchResult, BookingStatus, Guest } from "@/lib/types/database";
import { attempt, type ChoiceOption } from "../../tool";
import { dateRange, fold, isYmd } from "../../format";
import type { Resolved } from "../_resolve";

// ── Esquemas y utilidades ───────────────────────────────────────────────────

/**
 * Ids del payload. `z.guid()` y no `z.string().uuid()`: el de zod v4 exige la
 * versión RFC y las actions (zod v3) aceptan cualquier hex 8-4-4-4-12; un id
 * válido para la base no puede romper la confirmación.
 */
export const idSchema = z.guid();
export const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const round2 = (n: number) => Math.round(n * 100) / 100;

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const last8 = (s: string | null | undefined) => digits(s).slice(-8);

export function statusLabel(status: string): string {
  return BOOKING_STATUS_META[status as BookingStatus]?.label ?? status;
}

export function unitLabel(unit: { code?: string | null; name?: string | null } | null | undefined): string {
  return [unit?.code, unit?.name].filter(Boolean).join(" · ") || "Sin unidad";
}

/** "Hoy figura … " → varias advertencias en un solo `note`. */
export function joinNotes(notes: Array<string | null | undefined | false>): string | undefined {
  const out = notes.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return out.length ? out.join(" ") : undefined;
}

/** Las actions con patrón `{ ok:false, error }`: su error pasa a ser el de la herramienta. */
export async function attemptResult<T extends { ok: boolean }>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: Extract<T, { ok: true }> } | { ok: false; error: string }> {
  const r = await attempt(fn);
  if (!r.ok) return r;
  const v = r.value;
  if (v.ok !== true) {
    const error = (v as { error?: unknown }).error;
    return { ok: false, error: typeof error === "string" && error ? error : "No se pudo hacer." };
  }
  return { ok: true, value: v as Extract<T, { ok: true }> };
}

/** "Pérez" → "p_r_z": en ilike `_` es cualquier letra, así encuentra "Perez" y "Pérez". */
function accentTolerant(word: string): string {
  return fold(word).replace(/[aeioun]/g, "_");
}

function words(s: string | null | undefined): string[] {
  return fold(s)
    .replace(/[.,;:¿?¡!"'()]/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Palabras de relleno que el modelo a veces manda ("la reserva de Pérez"). */
const FILLER = new Set(["la", "el", "los", "las", "de", "del", "en", "y", "reserva", "reservas", "depto", "departamento", "unidad", "huesped"]);

function queryWords(s: string): string[] {
  const ws = words(s);
  const meaningful = ws.filter((w) => !FILLER.has(w));
  return meaningful.length ? meaningful : ws;
}

function longestWord(ws: string[]): string | undefined {
  return [...ws].sort((a, b) => b.length - a.length)[0];
}

/** Las pasadas de búsqueda: tal cual, sin tildes, la palabra más larga y tolerante a tildes. */
function searchPasses(query: string): string[] {
  const q = query.trim();
  const passes = [q];
  const folded = fold(q);
  if (folded && folded !== q.toLowerCase()) passes.push(folded);
  const ws = queryWords(q);
  const longest = longestWord(ws);
  if (longest && longest.length >= 3) {
    if (ws.length > 1 || longest !== folded) passes.push(longest);
    const tolerant = accentTolerant(longest);
    // Con menos de dos letras fijas el patrón encuentra cualquier cosa.
    if (longest.length >= 4 && tolerant !== longest && tolerant.replace(/_/g, "").length >= 2) passes.push(tolerant);
  }
  return [...new Set(passes)];
}

// ── La reserva completa ─────────────────────────────────────────────────────

export type BookingDetail = {
  id: string;
  unit_id: string;
  guest_id: string | null;
  status: BookingStatus;
  mode: "temporario" | "mensual";
  source: string;
  is_block: boolean;
  check_in_date: string;
  check_out_date: string;
  currency: string;
  total_amount: number;
  paid_amount: number;
  cleaning_fee: number | null;
  lease_group_id: string | null;
  unit: { id: string; code: string; name: string } | null;
  guest: { id: string; full_name: string; phone: string | null; email: string | null } | null;
};

export async function loadBooking(
  id: string,
): Promise<{ ok: true; value: BookingDetail } | { ok: false; error: string }> {
  const r = await attempt(() => getBooking(id));
  if (!r.ok) return r;
  const b = r.value as unknown as BookingDetail | null;
  if (!b) return { ok: false, error: "No encontré esa reserva (o ya no está)." };
  return {
    ok: true,
    value: {
      ...b,
      // Tal cual está guardada: las actions comparan la moneda de la cuenta con
      // un `!==` exacto, y las herramientas tienen que validar con la misma vara.
      currency: b.currency || "ARS",
      total_amount: Number(b.total_amount ?? 0),
      paid_amount: Number(b.paid_amount ?? 0),
      is_block: Boolean(b.is_block),
    },
  };
}

/** "Juan Pérez (SAL525, 14 al 18 nov)". */
export function describeBooking(b: {
  guest: string | null;
  unitCode: string | null;
  checkIn: string;
  checkOut: string;
}): string {
  return `${b.guest ?? "Sin huésped"} (${b.unitCode ?? "sin unidad"}, ${dateRange(b.checkIn, b.checkOut)})`;
}

// ── Buscar la reserva que la persona nombra ─────────────────────────────────

export type BookingCandidate = {
  id: string;
  guest: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  source: string;
};

function toCandidate(r: BookingSearchResult): BookingCandidate {
  return {
    id: r.id,
    guest: r.guest?.full_name ?? null,
    unitId: r.unit?.id ?? null,
    unitCode: r.unit?.code ?? null,
    unitName: r.unit?.name ?? null,
    checkIn: r.check_in_date,
    checkOut: r.check_out_date,
    status: r.status,
    source: r.source,
  };
}

export function candidateFromDetail(b: BookingDetail): BookingCandidate {
  return {
    id: b.id,
    guest: b.guest?.full_name ?? null,
    unitId: b.unit?.id ?? b.unit_id,
    unitCode: b.unit?.code ?? null,
    unitName: b.unit?.name ?? null,
    checkIn: b.check_in_date,
    checkOut: b.check_out_date,
    status: b.status,
    source: b.source,
  };
}

/** Todo lo buscable de una fila, para el filtro laxo (las coincidencias parciales se preguntan). */
function haystack(r: BookingSearchResult): string {
  return fold(
    [r.guest?.full_name, r.guest?.email, r.guest?.phone, r.unit?.code, r.unit?.name, r.external_id]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Coincidencia firme de UNA palabra: en los nombres (huésped, unidad), palabra
 * entera — "Ana" no es "Mariana" —; en los códigos (unidad, reserva, mail,
 * teléfono), alcanza con que esté adentro ("525" es "SAL525").
 */
function wordMatches(r: BookingSearchResult, w: string): boolean {
  if (words(r.guest?.full_name).includes(w) || words(r.unit?.name).includes(w)) return true;
  if (w.length < 3) return fold(r.unit?.code) === w;
  return [r.unit?.code, r.external_id, r.guest?.email, digits(r.guest?.phone)].some((c) => fold(c).includes(w));
}

function unitMatches(unit: { id?: string | null; code?: string | null; name?: string | null } | null, query: string) {
  const raw = query.trim();
  if (UUID_RE.test(raw)) return unit?.id === raw;
  const u = fold(raw);
  const code = fold(unit?.code);
  const name = fold(unit?.name);
  if (!u) return true;
  return code === u || name === u || code.includes(u) || name.includes(u) || (code.length >= 3 && u.includes(code));
}

/** Para las listas de opciones: la estadía en curso primero, después las próximas, después las pasadas. */
function sortCandidates(cands: BookingCandidate[], today: string): BookingCandidate[] {
  const rank = (c: BookingCandidate) => (c.checkIn <= today && today < c.checkOut ? 0 : c.checkIn > today ? 1 : 2);
  return [...cands].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return ra === 2 ? b.checkIn.localeCompare(a.checkIn) : a.checkIn.localeCompare(b.checkIn);
  });
}

export function bookingOptions(cands: BookingCandidate[]): ChoiceOption[] {
  return cands.slice(0, 8).map((c) => ({
    id: c.id,
    label: `${c.guest ?? "Sin huésped"} · ${c.unitCode ?? "—"}`,
    detail: `${dateRange(c.checkIn, c.checkOut)} · ${statusLabel(c.status)}`,
  }));
}

export type FindBookingOptions = {
  /** Código o nombre (o id) de la unidad, para acotar. */
  unidad?: string;
  /** Un día de la estadía (YYYY-MM-DD), para acotar. */
  fecha?: string;
  today: string;
  /** `null` = sirve; un texto = por qué esa reserva no sirve para lo que se pide. */
  eligible?: (c: BookingCandidate) => string | null;
};

/**
 * La reserva que la persona nombra ("Pérez", "Pérez 525", "HMABC123" o el id
 * de una lista anterior). Las canceladas no aparecen (la búsqueda las excluye).
 * Si ninguna coincide con TODAS las palabras, las que coinciden en parte se
 * ofrecen como pregunta, nunca se eligen solas.
 */
export async function findBooking(query: string, opts: FindBookingOptions): Promise<Resolved<BookingCandidate>> {
  const q = query.trim();
  if (UUID_RE.test(q)) {
    const b = await loadBooking(q);
    if (!b.ok) return b;
    const c = candidateFromDetail(b.value);
    const why = opts.eligible?.(c) ?? null;
    return why ? { ok: false, error: why } : { ok: true, value: c };
  }
  const ws = queryWords(q);
  if (q.length < 2 || ws.length === 0) {
    return { ok: false, error: "Decime el nombre del huésped, la unidad o el código de la reserva." };
  }

  const seen = new Map<string, BookingSearchResult>();
  let strong: BookingSearchResult[] = [];
  for (const pass of searchPasses(q)) {
    const r = await attempt(() => searchBookingsGlobal(pass, 30));
    if (!r.ok) return r;
    for (const row of r.value) seen.set(row.id, row);
    strong = [...seen.values()].filter((row) => ws.every((w) => wordMatches(row, w)));
    if (strong.length > 0) break;
  }
  const partial = strong.length === 0;
  let pool = partial
    ? [...seen.values()].filter((row) => ws.some((w) => w.length >= 3 && haystack(row).includes(w)))
    : strong;
  if (pool.length === 0) {
    return { ok: false, error: `No encontré reservas para «${q}» (las canceladas no cuentan).` };
  }

  if (opts.unidad?.trim()) {
    const byUnit = pool.filter((row) => unitMatches(row.unit, opts.unidad!));
    if (byUnit.length === 0) {
      return { ok: false, error: `Encontré reservas para «${q}», pero ninguna en «${opts.unidad}».` };
    }
    pool = byUnit;
  }
  if (opts.fecha && isYmd(opts.fecha)) {
    const f = opts.fecha;
    const byDate = pool.filter((row) => row.check_in_date <= f && f <= row.check_out_date);
    if (byDate.length === 0) {
      return { ok: false, error: `Encontré reservas para «${q}», pero ninguna que incluya el ${f}.` };
    }
    pool = byDate;
  }

  let cands = pool.map(toCandidate);
  if (opts.eligible) {
    const reasons: string[] = [];
    const fit: BookingCandidate[] = [];
    for (const c of cands) {
      const why = opts.eligible(c);
      if (why) reasons.push(why);
      else fit.push(c);
    }
    if (fit.length === 0) {
      const unique = [...new Set(reasons)];
      return {
        ok: false,
        error: unique.length === 1 ? unique[0] : `Ninguna de las reservas de «${q}» sirve para esto: ${unique.slice(0, 4).join(" ")}`,
      };
    }
    cands = fit;
  }

  cands = sortCandidates(cands, opts.today);
  if (!partial && cands.length === 1) return { ok: true, value: cands[0] };
  return {
    ok: "choose",
    question: partial
      ? `No encontré una reserva que coincida tal cual con «${q}». ¿Es alguna de estas?`
      : `Encontré ${cands.length} reservas para «${q}». ¿Cuál es?`,
    options: bookingOptions(cands),
  };
}

// ── El huésped de una reserva nueva ─────────────────────────────────────────

export type GuestPick =
  | {
      kind: "existing";
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      blacklisted: boolean;
      blacklistReason: string | null;
    }
  | { kind: "new"; name: string; phone: string | null; phoneE164: string | null; email: string | null };

/** Mismas palabras, sin importar orden, tildes ni mayúsculas ("Pereyra Zulma" = "Zulma Pereyra"). */
function sameName(a: string, b: string): boolean {
  const wa = words(a).sort().join(" ");
  return wa.length > 0 && wa === words(b).sort().join(" ");
}

/** Una contiene todas las palabras de la otra ("Juan Pérez" ⊂ "Juan Carlos Pérez"). */
function nameContains(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.some((w) => w.length >= 3) && short.every((w) => long.includes(w));
}

function existingPick(g: Guest): GuestPick {
  return {
    kind: "existing",
    id: g.id,
    name: g.full_name,
    phone: g.phone ?? null,
    email: g.email ?? null,
    blacklisted: Boolean(g.blacklisted),
    blacklistReason: g.blacklist_reason ?? null,
  };
}

export const NEW_GUEST_OPTION_ID = "nuevo";

/**
 * Quién es el huésped de una reserva que se está creando:
 * - un id (de una lista anterior) → ese;
 * - mismo nombre (y sin un teléfono o mail que lo contradiga) → ese;
 * - parecidos (mismo teléfono/mail, o un nombre que contiene al otro) → se pregunta;
 * - nadie → se crea al confirmar.
 */
export async function resolveGuestForBooking(input: {
  name: string;
  phone?: string;
  email?: string;
  guestId?: string;
  forceNew?: boolean;
}): Promise<Resolved<GuestPick>> {
  const name = input.name.replace(/\s+/g, " ").trim();
  const rawId = (input.guestId ?? "").trim() || (UUID_RE.test(name) ? name : "");
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  if (input.email?.trim() && !email) return { ok: false, error: `El mail «${input.email}» no parece válido.` };
  const phone = input.phone?.trim() ? input.phone.trim().slice(0, 40) : null;
  if (phone && digits(phone).length < 6) return { ok: false, error: `El teléfono «${input.phone}» no parece completo.` };

  const asNew = (): Resolved<GuestPick> => {
    if (words(name).length < 2 || name.length < 4) {
      return { ok: false, error: "Para cargar un huésped nuevo necesito nombre y apellido." };
    }
    return {
      ok: true,
      value: { kind: "new", name: name.slice(0, 200), phone, phoneE164: normalizePhoneE164(phone), email },
    };
  };

  if (input.forceNew || rawId.toLowerCase() === NEW_GUEST_OPTION_ID) return asNew();
  if (rawId) {
    if (!UUID_RE.test(rawId)) return { ok: false, error: "No entendí qué huésped elegiste. Pasame el id de la lista." };
    const r = await attempt(() => getGuest(rawId));
    if (!r.ok) return r;
    const g = r.value as Guest | null;
    if (!g) return { ok: false, error: "Ese huésped no existe en esta organización." };
    return { ok: true, value: existingPick(g) };
  }
  if (name.length < 2) return { ok: false, error: "¿A nombre de quién es la reserva?" };

  const passes = searchPasses(name);
  if (phone && last8(phone).length >= 6) passes.push(last8(phone));
  if (email) passes.push(email);
  const results = await Promise.all(passes.map((p) => attempt(() => searchGuests(p))));
  const found = new Map<string, Guest>();
  for (const r of results) {
    if (!r.ok) return r;
    for (const g of r.value) found.set(g.id, g);
  }
  const all = [...found.values()];

  const contactMatch = (g: Guest) =>
    Boolean((phone && g.phone && last8(g.phone) === last8(phone)) || (email && g.email && normalizeEmail(g.email) === email));
  const contactConflict = (g: Guest) =>
    Boolean((phone && g.phone && last8(g.phone) !== last8(phone)) || (email && g.email && normalizeEmail(g.email) !== email));

  const options = (gs: Guest[]): ChoiceOption[] => [
    ...gs.slice(0, 7).map((g) => ({
      id: g.id,
      label: g.full_name,
      detail: [g.phone, g.email, g.blacklisted ? "en lista negra" : null].filter(Boolean).join(" · ") || "sin contacto cargado",
    })),
    { id: NEW_GUEST_OPTION_ID, label: `Es otra persona: cargar a «${name}» como huésped nuevo` },
  ];

  const exact = all.filter((g) => sameName(g.full_name, name));
  if (exact.length > 0) {
    const byContact = exact.filter(contactMatch);
    if (byContact.length === 1) return { ok: true, value: existingPick(byContact[0]) };
    if (exact.length === 1 && !contactConflict(exact[0])) return { ok: true, value: existingPick(exact[0]) };
    return {
      ok: "choose",
      question:
        exact.length === 1
          ? `Ya hay un huésped «${exact[0].full_name}» pero con otro teléfono o mail. ¿Es la misma persona?`
          : `Hay ${exact.length} huéspedes que se llaman «${name}». ¿Cuál es, o es otra persona?`,
      options: options(exact),
    };
  }

  const similar = all.filter((g) => contactMatch(g) || nameContains(g.full_name, name));
  if (similar.length > 0) {
    return {
      ok: "choose",
      question: `No hay un huésped que se llame exactamente «${name}», pero hay parecidos. ¿Es alguno de estos o es otra persona?`,
      options: options(similar),
    };
  }
  return asNew();
}
