/**
 * Resolver lo que la persona nombra ("el 525", "caja chica", "la reserva de
 * Pérez") a ids de verdad. Regla de oro heredada de sharp-app: con más de un
 * candidato NUNCA se elige solo — se devuelve `choose` y Tex pregunta.
 */
import { listUnitRefs } from "@/lib/actions/units";
import { listAccounts } from "@/lib/actions/cash";
import { getBooking, searchBookingsGlobal } from "@/lib/actions/bookings";
import type { CashAccount } from "@/lib/types/database";
import { attempt, type ChoiceOption } from "../tool";
import { dateRange, fold } from "../format";

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string } | { ok: "choose"; question: string; options: ChoiceOption[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnitRef = { id: string; code: string; name: string };

/** "525", "SAL525", "Salta 525" o el id → la unidad. */
export async function resolveUnit(query: string): Promise<Resolved<UnitRef>> {
  const r = await attempt(() => listUnitRefs());
  if (!r.ok) return r;
  const units = r.value.map((u) => ({ id: u.id, code: u.code, name: u.name }));
  const q = fold(query);
  if (!q) return { ok: false, error: "¿Qué unidad? Decime el código o el nombre." };
  if (UUID.test(query.trim())) {
    const byId = units.find((u) => u.id === query.trim());
    return byId ? { ok: true, value: byId } : { ok: false, error: "Esa unidad no existe o está archivada." };
  }
  const exact = units.filter((u) => fold(u.code) === q || fold(u.name) === q);
  if (exact.length === 1) return { ok: true, value: exact[0] };
  const loose = (exact.length > 1 ? exact : units).filter((u) => {
    const code = fold(u.code);
    const name = fold(u.name);
    return code.includes(q) || name.includes(q) || (code.length >= 3 && q.includes(code));
  });
  if (loose.length === 1) return { ok: true, value: loose[0] };
  if (loose.length === 0) {
    return { ok: false, error: `No encontré ninguna unidad que se llame «${query}». Pedile a la persona el código exacto.` };
  }
  return {
    ok: "choose",
    question: `Hay ${loose.length} unidades que coinciden con «${query}». ¿Cuál?`,
    options: loose.slice(0, 8).map((u) => ({ id: u.id, label: `${u.code} · ${u.name}` })),
  };
}

/**
 * La cuenta de Caja. Con nombre: la que coincide. Sin nombre: la de gastos
 * corrientes (`preferExpenseDefault`) o la única activa en esa moneda.
 */
export async function resolveAccount(
  query: string | null | undefined,
  opts: { currency?: string; preferExpenseDefault?: boolean } = {},
): Promise<Resolved<CashAccount>> {
  const r = await attempt(() => listAccounts());
  if (!r.ok) return r;
  const accounts = (r.value as CashAccount[]).filter((a) => a.active);
  if (accounts.length === 0) return { ok: false, error: "No hay cuentas de Caja activas. Se crean en Caja." };
  const inCurrency = opts.currency
    ? accounts.filter((a) => a.currency.toUpperCase() === opts.currency!.toUpperCase())
    : accounts;
  const list = (as: CashAccount[]) => as.slice(0, 8).map((a) => ({ id: a.id, label: a.name, detail: a.currency }));

  if (query && query.trim()) {
    if (UUID.test(query.trim())) {
      const byId = accounts.find((a) => a.id === query.trim());
      return byId ? { ok: true, value: byId } : { ok: false, error: "Esa cuenta no existe o está inactiva." };
    }
    const q = fold(query);
    const pool = inCurrency.length ? inCurrency : accounts;
    const exact = pool.filter((a) => fold(a.name) === q);
    if (exact.length === 1) return { ok: true, value: exact[0] };
    const hits = pool.filter((a) => fold(a.name).includes(q) || q.includes(fold(a.name)));
    if (hits.length === 1) return { ok: true, value: hits[0] };
    if (hits.length > 1) return { ok: "choose", question: `¿En qué cuenta? Hay ${hits.length} parecidas.`, options: list(hits) };
    return {
      ok: false,
      error: `No hay una cuenta «${query}». Las activas${opts.currency ? ` en ${opts.currency}` : ""} son: ${pool.map((a) => a.name).join(", ")}.`,
    };
  }

  if (opts.preferExpenseDefault) {
    // Con moneda pedida, la cuenta de gastos de otra moneda no sirve (US$ 100 no son $ 100).
    const def =
      inCurrency.find((a) => a.is_expense_default) ?? (opts.currency ? undefined : accounts.find((a) => a.is_expense_default));
    if (def) return { ok: true, value: def };
  }
  if (inCurrency.length === 1) return { ok: true, value: inCurrency[0] };
  if (inCurrency.length === 0) {
    return { ok: false, error: `No hay ninguna cuenta activa en ${opts.currency}. Hay que crearla en Caja.` };
  }
  return { ok: "choose", question: "¿En qué cuenta de Caja?", options: list(inCurrency) };
}

export type BookingRef = {
  id: string;
  guest: string | null;
  unit: string;
  checkIn: string;
  checkOut: string;
  status: string;
};

/** "la reserva de Pérez", "HMABC123", "Pérez en el 525" o el id → la reserva. */
export async function resolveBooking(query: string): Promise<Resolved<BookingRef>> {
  const q = query.trim();
  if (UUID.test(q)) {
    const r = await attempt(() => getBooking(q));
    if (!r.ok) return r;
    const b = r.value as unknown as {
      id: string;
      check_in_date: string;
      check_out_date: string;
      status: string;
      unit?: { code?: string | null; name?: string | null } | null;
      guest?: { full_name?: string | null } | null;
    } | null;
    if (!b) return { ok: false, error: "No encontré esa reserva." };
    return {
      ok: true,
      value: {
        id: b.id,
        guest: b.guest?.full_name ?? null,
        unit: [b.unit?.code, b.unit?.name].filter(Boolean).join(" · "),
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        status: b.status,
      },
    };
  }
  if (q.length < 2) return { ok: false, error: "Decime el nombre del huésped, la unidad o el código de la reserva." };
  const r = await attempt(() => searchBookingsGlobal(q, 10));
  if (!r.ok) return r;
  const rows = r.value.map((b) => ({
    id: b.id,
    guest: b.guest?.full_name ?? null,
    unit: [b.unit?.code, b.unit?.name].filter(Boolean).join(" · "),
    checkIn: b.check_in_date,
    checkOut: b.check_out_date,
    status: b.status,
  }));
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return { ok: false, error: `No encontré reservas para «${query}».` };
  return {
    ok: "choose",
    question: `Encontré ${rows.length} reservas para «${query}». ¿Cuál es?`,
    options: rows.slice(0, 8).map((b) => ({
      id: b.id,
      label: `${b.guest ?? "Sin huésped"} · ${b.unit}`,
      detail: `${dateRange(b.checkIn, b.checkOut)} · ${b.status}`,
    })),
  };
}
