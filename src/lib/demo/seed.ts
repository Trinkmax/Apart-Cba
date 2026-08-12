import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  DEFAULT_ORG_TIMEZONE,
  addDaysYmd,
  todayYmdInTz,
  zonedTimeToUtc,
} from "@/lib/dates";

/**
 * Datos de ejemplo para una cuenta de prueba recién creada desde la landing.
 *
 * La promesa de la landing es "la mejor forma de probar un sistema es usándolo",
 * y un panel vacío la rompe en la primera pantalla: sin unidades no hay grilla,
 * sin reservas no hay KPIs y sin movimientos no hay Caja. Por eso el alta siembra
 * ~8 unidades y ~40 reservas antes de soltar al visitante adentro.
 *
 * Tres invariantes que NO se pueden relajar:
 *
 *  1. `bookings_no_overlap` es una exclusion constraint (btree_gist) sobre
 *     (unit_id, stay_range) para los estados pendiente/confirmada/check_in. Un
 *     solo solapamiento aborta el INSERT del lote entero y el alta explota en la
 *     cara del visitante. Por eso las estadías se generan con un cursor que
 *     avanza por unidad y nunca retrocede.
 *  2. Nada de lo sembrado puede despertar a un cron. No se crean `channel_links`,
 *     `ical_feeds` ni `crm_channels`: el dispatcher de canales corre cada minuto
 *     y saldría a pegarle a Airbnb por cada org de prueba.
 *  3. Las unidades quedan con `slug = null` y `marketplace_published = false`.
 *     `searchListings()` agrega unidades de TODAS las orgs sin filtrar por
 *     organization_id, así que una unidad de ejemplo publicada aparecería en el
 *     buscador público como oferta real para un huésped real.
 *
 * El generador es determinista (PRNG con semilla fija): todas las cuentas de
 * prueba ven el mismo panel, lo que hace que soporte y demos sean reproducibles.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

const SEED = 0x5eed_c0de;
const TZ = DEFAULT_ORG_TIMEZONE;

/** mulberry32: PRNG chico y determinista. No se usa para nada criptográfico. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

function weighted<T extends string>(
  rand: () => number,
  table: readonly (readonly [T, number])[]
): T {
  const total = table.reduce((acc, [, w]) => acc + w, 0);
  let roll = rand() * total;
  for (const [value, w] of table) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return table[table.length - 1]![0];
}

// ─────────────────────────── Catálogo de ejemplo ───────────────────────────
// Direcciones y barrios reales de Córdoba capital: el visitante tiene que
// reconocer el mapa mental de su propio negocio, no leer "Unidad 1 / Unidad 2".

const UNITS = [
  { code: "NC-4B",   name: "Rondeau 240, 4°B",              neighborhood: "Nueva Córdoba",  bedrooms: 1, bathrooms: 1, maxGuests: 3, price: 68_000,  cleaning: 12_000, mode: "temporario" },
  { code: "NC-9A",   name: "Chacabuco 1120, 9°A",           neighborhood: "Nueva Córdoba",  bedrooms: 2, bathrooms: 2, maxGuests: 5, price: 96_000,  cleaning: 15_000, mode: "temporario" },
  { code: "GUE-2C",  name: "Belgrano 760, 2°C",             neighborhood: "Güemes",         bedrooms: 1, bathrooms: 1, maxGuests: 2, price: 61_000,  cleaning: 11_000, mode: "temporario" },
  { code: "GUE-PH",  name: "Achával Rodríguez 340, PH",     neighborhood: "Güemes",         bedrooms: 2, bathrooms: 1, maxGuests: 4, price: 87_000,  cleaning: 14_000, mode: "mixto"      },
  { code: "COF-3A",  name: "Jerónimo Cortés 455, 3°A",      neighborhood: "Cofico",         bedrooms: 1, bathrooms: 1, maxGuests: 3, price: 54_000,  cleaning: 10_000, mode: "temporario" },
  { code: "GP-1B",   name: "25 de Mayo 1580, 1°B",          neighborhood: "General Paz",    bedrooms: 2, bathrooms: 1, maxGuests: 4, price: 72_000,  cleaning: 12_500, mode: "temporario" },
  { code: "ALB-5D",  name: "Duarte Quirós 1345, 5°D",       neighborhood: "Alberdi",        bedrooms: 1, bathrooms: 1, maxGuests: 2, price: 49_000,  cleaning: 10_000, mode: "mensual"    },
  { code: "VBEL-DX", name: "Recta Martinoli 5820, dúplex",  neighborhood: "Villa Belgrano", bedrooms: 3, bathrooms: 2, maxGuests: 6, price: 129_000, cleaning: 19_000, mode: "temporario" },
] as const;

/** La unidad de índice 6 (ALB-5D) va con contrato mensual, no con estadías cortas. */
const MONTHLY_UNIT_INDEX = 6;

const OWNERS = [
  { full_name: "Silvana Recalde",  email: "s.recalde@ejemplo.test",  phone: "+54 9 351 000 0071", bank: "Banco de Córdoba",  alias: "silvana.recalde.arq" },
  { full_name: "Héctor Bermúdez",  email: "h.bermudez@ejemplo.test", phone: "+54 9 351 000 0072", bank: "Banco Galicia",     alias: "hector.bermudez.cba" },
  { full_name: "Alicia Zanotti",   email: "a.zanotti@ejemplo.test",  phone: "+54 9 351 000 0073", bank: "Banco Macro",       alias: "zanotti.alicia" },
] as const;

/**
 * Reparto de unidades por propietario. El dúplex va en condominio 60/40 para que
 * la cuenta de prueba muestre el caso N:M real (unit_owners con ownership_pct),
 * que es donde se rompen las planillas de Excel.
 */
const OWNERSHIP: readonly { unit: number; owner: number; pct: number; primary: boolean }[] = [
  { unit: 0, owner: 0, pct: 100, primary: true },
  { unit: 1, owner: 0, pct: 100, primary: true },
  { unit: 2, owner: 0, pct: 100, primary: true },
  { unit: 3, owner: 1, pct: 100, primary: true },
  { unit: 4, owner: 1, pct: 100, primary: true },
  { unit: 5, owner: 1, pct: 100, primary: true },
  { unit: 6, owner: 2, pct: 100, primary: true },
  { unit: 7, owner: 2, pct: 60,  primary: true },
  { unit: 7, owner: 0, pct: 40,  primary: false },
];

const GUESTS = [
  { full_name: "Camila Ferreyra",   country: "AR", city: "Rosario" },
  { full_name: "Tomás Bustos",      country: "AR", city: "Buenos Aires" },
  { full_name: "Rocío Aguirre",     country: "AR", city: "Mendoza" },
  { full_name: "Julián Ceballos",   country: "AR", city: "Santa Fe" },
  { full_name: "Malena Sosa",       country: "AR", city: "Salta" },
  { full_name: "Federico Ledesma",  country: "AR", city: "Río Cuarto" },
  { full_name: "Ana Clara Peralta", country: "AR", city: "La Plata" },
  { full_name: "Nicolás Brizuela",  country: "AR", city: "San Juan" },
  { full_name: "Sofía Maidana",     country: "AR", city: "Córdoba" },
  { full_name: "Gonzalo Vitali",    country: "UY", city: "Montevideo" },
  { full_name: "Emma Lindqvist",    country: "SE", city: "Gotemburgo" },
  { full_name: "Mateo Quiroga",     country: "CL", city: "Santiago" },
] as const;

const SOURCE_WEIGHTS = [
  ["airbnb", 38],
  ["booking", 24],
  ["directo", 28],
  ["whatsapp", 10],
] as const;

// ────────────────────────────── Generación ──────────────────────────────

type PlannedBooking = {
  unitIndex: number;
  guestIndex: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: "pendiente" | "confirmada" | "check_in" | "check_out" | "cancelada";
  source: (typeof SOURCE_WEIGHTS)[number][0];
  mode: "temporario" | "mensual";
  total: number;
  paid: number;
  guests: number;
};

/**
 * Recorre cada unidad con un cursor que sólo avanza: estadía, hueco, estadía.
 * Un hueco de 0 días es un recambio el mismo día (check-out 11h → check-in 15h),
 * que es el caso que más se usa en el calendario y el que más rompe las planillas.
 * Como el cursor nunca retrocede, dos reservas de la misma unidad no se pueden
 * solapar y `bookings_no_overlap` nunca se dispara.
 */
function planBookings(today: string): PlannedBooking[] {
  const start = addDaysYmd(today, -35);
  const horizon = addDaysYmd(today, 52);
  const planned: PlannedBooking[] = [];

  UNITS.forEach((unit, unitIndex) => {
    const rand = makeRng(SEED + unitIndex * 7919);

    if (unitIndex === MONTHLY_UNIT_INDEX) {
      // Contrato mensual: una sola barra larga que atraviesa toda la ventana.
      planned.push({
        unitIndex,
        guestIndex: 3,
        checkIn: addDaysYmd(today, -12),
        checkOut: addDaysYmd(today, 48),
        nights: 60,
        status: "check_in",
        source: "directo",
        mode: "mensual",
        total: 520_000 * 2,
        paid: 520_000,
        guests: 2,
      });
      return;
    }

    let cursor = addDaysYmd(start, between(rand, 0, 4));

    while (cursor < horizon) {
      const nights = between(rand, 2, 7);
      const checkIn = cursor;
      const checkOut = addDaysYmd(checkIn, nights);
      if (checkOut > horizon) break;

      const source = weighted(rand, SOURCE_WEIGHTS);
      const guests = between(rand, 1, unit.maxGuests);
      const total = unit.price * nights + unit.cleaning;

      let status: PlannedBooking["status"];
      if (checkOut <= today) status = "check_out";
      else if (checkIn <= today) status = "check_in";
      else if (rand() < 0.07) status = "cancelada";
      else if (rand() < 0.18) status = "pendiente";
      else status = "confirmada";

      // Cobrado: lo pasado y lo que está adentro ya está cobrado; lo futuro tiene
      // seña o nada. Así "Por cobrar" del dashboard arranca con un número real.
      let paid = 0;
      if (status === "check_out" || status === "check_in") paid = total;
      else if (status === "confirmada") paid = rand() < 0.55 ? Math.round(total * 0.3) : 0;

      planned.push({
        unitIndex,
        guestIndex: between(rand, 0, GUESTS.length - 1),
        checkIn,
        checkOut,
        nights,
        status,
        source,
        mode: "temporario",
        total,
        paid,
        guests,
      });

      cursor = addDaysYmd(checkOut, between(rand, 0, 4));
    }
  });

  return planned;
}

/** "Ana Clara Peralta" → "ana.clara.peralta", para armar emails de ejemplo. */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".");
}

function otaReference(source: string, index: number): string | null {
  if (source === "airbnb") return `HM${(index * 7919).toString(36).toUpperCase().padStart(6, "X")}`;
  if (source === "booking") return `${4_200_000_000 + index * 1373}`;
  return null;
}

// ─────────────────────────────── Inserción ───────────────────────────────

export type SeedResult = {
  units: number;
  bookings: number;
  guests: number;
  movements: number;
};

/**
 * Siembra la org con el catálogo de ejemplo. Asume que la org acaba de crearse y
 * está vacía. No es idempotente: correrla dos veces sobre la misma org duplica
 * todo (y probablemente choque contra `bookings_no_overlap`).
 *
 * Si algo falla, tira. El llamador borra la organización, y como todas las FK
 * a `organizations` son ON DELETE CASCADE, eso limpia lo que haya quedado.
 */
export async function seedDemoData(
  admin: AdminClient,
  orgId: string,
  userId: string
): Promise<SeedResult> {
  const today = todayYmdInTz(TZ);

  // 1. Propietarios ────────────────────────────────────────────────────────
  const { data: owners, error: ownersErr } = await admin
    .from("owners")
    .insert(
      OWNERS.map((o) => ({
        organization_id: orgId,
        full_name: o.full_name,
        email: o.email,
        phone: o.phone,
        city: "Córdoba",
        bank_name: o.bank,
        alias_cbu: o.alias,
        preferred_currency: "ARS",
      }))
    )
    .select("id");
  if (ownersErr) throw new Error(`owners: ${ownersErr.message}`);

  // 2. Unidades ────────────────────────────────────────────────────────────
  // slug null + marketplace_published false: ver invariante 3 del encabezado.
  const { data: units, error: unitsErr } = await admin
    .from("units")
    .insert(
      UNITS.map((u, i) => ({
        organization_id: orgId,
        code: u.code,
        name: u.name,
        neighborhood: u.neighborhood,
        city: "Córdoba",
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        max_guests: u.maxGuests,
        base_price: u.price,
        base_price_currency: "ARS",
        cleaning_fee: u.cleaning,
        default_commission_pct: 20,
        default_mode: u.mode,
        position: i,
        marketplace_published: false,
        slug: null,
      }))
    )
    .select("id");
  if (unitsErr) throw new Error(`units: ${unitsErr.message}`);

  const unitIds = (units ?? []).map((u) => u.id as string);
  const ownerIds = (owners ?? []).map((o) => o.id as string);

  const { error: uoErr } = await admin.from("unit_owners").insert(
    OWNERSHIP.map((o) => ({
      unit_id: unitIds[o.unit]!,
      owner_id: ownerIds[o.owner]!,
      ownership_pct: o.pct,
      is_primary: o.primary,
    }))
  );
  if (uoErr) throw new Error(`unit_owners: ${uoErr.message}`);

  // 3. Huéspedes ───────────────────────────────────────────────────────────
  // Emails en .test y teléfonos 000 00XX: nada de lo sembrado puede recibir un
  // mensaje real si alguien dispara una difusión desde la cuenta de prueba.
  const { data: guests, error: guestsErr } = await admin
    .from("guests")
    .insert(
      GUESTS.map((g, i) => ({
        organization_id: orgId,
        full_name: g.full_name,
        email: `${slugifyName(g.full_name)}@ejemplo.test`,
        phone: `+54 9 351 000 ${String(10 + i).padStart(4, "0")}`,
        country: g.country,
        city: g.city,
        document_type: "DNI",
        document_number: `${30_000_000 + i * 471_233}`,
      }))
    )
    .select("id");
  if (guestsErr) throw new Error(`guests: ${guestsErr.message}`);

  const guestIds = (guests ?? []).map((g) => g.id as string);

  // 4. Reservas ────────────────────────────────────────────────────────────
  const planned = planBookings(today);
  const { data: bookings, error: bookingsErr } = await admin
    .from("bookings")
    .insert(
      planned.map((b, i) => {
        const unit = UNITS[b.unitIndex]!;
        return {
          organization_id: orgId,
          unit_id: unitIds[b.unitIndex]!,
          guest_id: guestIds[b.guestIndex]!,
          source: b.source,
          external_id: otaReference(b.source, i),
          // El status va en el propio INSERT: un UPDATE posterior despertaría a
          // trg_bookings_sync_unit y generaría limpiezas fantasma.
          status: b.status,
          check_in_date: b.checkIn,
          check_out_date: b.checkOut,
          guests_count: b.guests,
          currency: "ARS",
          total_amount: b.total,
          paid_amount: b.paid,
          commission_pct: 20,
          commission_amount: Math.round(b.total * 0.2),
          cleaning_fee: unit.cleaning,
          mode: b.mode,
          monthly_rent: b.mode === "mensual" ? 520_000 : null,
          rent_billing_day: b.mode === "mensual" ? 5 : null,
          monthly_inflation_adjustment_pct: b.mode === "mensual" ? 8.5 : null,
          created_by: userId,
        };
      })
    )
    .select("id, unit_id, check_out_date, status");
  if (bookingsErr) throw new Error(`bookings: ${bookingsErr.message}`);

  const bookingRows = bookings ?? [];

  // 5. Caja ────────────────────────────────────────────────────────────────
  // OJO: en un insert en lote, PostgREST unifica las columnas de todos los
  // objetos y manda NULL explícito donde una clave falta. NO cae al DEFAULT de
  // la columna. Por eso todas las filas de un mismo lote llevan exactamente las
  // mismas claves, incluso cuando el valor es el default (is_expense_default es
  // NOT NULL y reventaba el alta entera si una fila lo omitía).
  const { data: accounts, error: accErr } = await admin
    .from("cash_accounts")
    .insert([
      {
        organization_id: orgId,
        name: "Caja chica",
        type: "efectivo",
        currency: "ARS",
        opening_balance: 150_000,
        color: "#647560",
        icon: "wallet",
        display_order: 0,
        is_expense_default: true,
      },
      {
        organization_id: orgId,
        name: "Cuenta bancaria",
        type: "banco",
        currency: "ARS",
        opening_balance: 2_400_000,
        color: "#0F766E",
        icon: "landmark",
        display_order: 1,
        is_expense_default: false,
      },
    ])
    .select("id");
  if (accErr) throw new Error(`cash_accounts: ${accErr.message}`);

  const cashAccountIds = (accounts ?? []).map((a) => a.id as string);
  const movements = buildMovements({
    orgId,
    userId,
    today,
    planned,
    bookingRows,
    unitIds,
    cashAccountIds,
  });

  if (movements.length) {
    const { error: movErr } = await admin.from("cash_movements").insert(movements);
    if (movErr) throw new Error(`cash_movements: ${movErr.message}`);
  }

  // 6. Mantenimiento y limpieza ────────────────────────────────────────────
  const { error: ticketsErr } = await admin.from("maintenance_tickets").insert([
    {
      organization_id: orgId,
      unit_id: unitIds[4]!,
      title: "El termotanque no calienta",
      description: "La huésped avisó que sale agua fría desde anoche. Hay check-in el jueves.",
      category: "plomeria",
      priority: "urgente",
      status: "abierto",
      billable_to: "owner",
      related_owner_id: ownerIds[1]!,
      estimated_cost: 145_000,
      actual_cost: null,
      cost_currency: "ARS",
      opened_by: userId,
      opened_at: zonedTimeToUtc(today, "08:20", TZ).toISOString(),
      resolved_at: null,
    },
    {
      organization_id: orgId,
      unit_id: unitIds[1]!,
      title: "Cortina de enrollar trabada en el dormitorio",
      description: "Traba a mitad de recorrido. El cortinero pasa el viernes a la mañana.",
      category: "carpinteria",
      priority: "media",
      status: "en_progreso",
      billable_to: "owner",
      related_owner_id: ownerIds[0]!,
      estimated_cost: 62_000,
      actual_cost: null,
      cost_currency: "ARS",
      opened_by: userId,
      opened_at: zonedTimeToUtc(addDaysYmd(today, -3), "16:05", TZ).toISOString(),
      resolved_at: null,
    },
    {
      organization_id: orgId,
      unit_id: unitIds[3]!,
      title: "Filtración en el baño de servicio",
      description: "Mancha de humedad en el cielorraso. Falta la termofusora para cerrar.",
      category: "plomeria",
      priority: "alta",
      status: "esperando_repuesto",
      billable_to: "owner",
      related_owner_id: ownerIds[1]!,
      estimated_cost: 210_000,
      actual_cost: null,
      cost_currency: "ARS",
      opened_by: userId,
      opened_at: zonedTimeToUtc(addDaysYmd(today, -8), "11:40", TZ).toISOString(),
      resolved_at: null,
    },
    {
      organization_id: orgId,
      unit_id: unitIds[0]!,
      title: "Cambio de cerradura por llave perdida",
      description: "Se cambió el bombín y se hicieron tres copias nuevas.",
      category: "cerrajeria",
      priority: "baja",
      status: "resuelto",
      billable_to: "apartcba",
      related_owner_id: null,
      estimated_cost: null,
      actual_cost: 48_000,
      cost_currency: "ARS",
      opened_by: userId,
      opened_at: zonedTimeToUtc(addDaysYmd(today, -14), "09:15", TZ).toISOString(),
      resolved_at: zonedTimeToUtc(addDaysYmd(today, -13), "18:30", TZ).toISOString(),
    },
  ]);
  if (ticketsErr) throw new Error(`maintenance_tickets: ${ticketsErr.message}`);

  // Limpiezas de los check-out de ayer, hoy y mañana. `scheduled_for` es
  // timestamptz con la hora de check-out en la timezone de la org: filtrar por
  // .eq(fecha) sobre esta columna da resultados distintos según el huso.
  const cleaningSource = bookingRows
    .filter((b) => {
      const d = b.check_out_date as string;
      return d >= addDaysYmd(today, -1) && d <= addDaysYmd(today, 2);
    })
    .slice(0, 6);

  if (cleaningSource.length) {
    const { error: cleanErr } = await admin.from("cleaning_tasks").insert(
      cleaningSource.map((b) => {
        const checkOut = b.check_out_date as string;
        const isPast = checkOut < today;
        return {
          organization_id: orgId,
          unit_id: b.unit_id as string,
          booking_out_id: b.id as string,
          scheduled_for: zonedTimeToUtc(checkOut, "11:00", TZ).toISOString(),
          status: isPast ? "completada" : "pendiente",
          cost: 13_000,
          cost_currency: "ARS",
          completed_at: isPast
            ? zonedTimeToUtc(checkOut, "13:40", TZ).toISOString()
            : null,
        };
      })
    );
    if (cleanErr) throw new Error(`cleaning_tasks: ${cleanErr.message}`);
  }

  // 7. Estado visible de las unidades ──────────────────────────────────────
  // El trigger trg_bookings_mark_reservado ya pasó las unidades con reserva
  // próxima a "reservado". Acá sólo fijamos los estados que el trigger no
  // deduce, para que las 4 tarjetas de estado del dashboard arranquen con
  // números distintos de cero.
  await admin.from("units").update({ status: "limpieza" }).eq("id", unitIds[2]!);
  await admin.from("units").update({ status: "mantenimiento" }).eq("id", unitIds[4]!);

  const occupiedUnitIds = [
    ...new Set(
      bookingRows.filter((b) => b.status === "check_in").map((b) => b.unit_id as string)
    ),
  ].filter((id) => id !== unitIds[2] && id !== unitIds[4]);

  if (occupiedUnitIds.length) {
    await admin.from("units").update({ status: "ocupado" }).in("id", occupiedUnitIds);
  }

  // El trigger deja en "reservado" toda unidad con reserva confirmada dentro de
  // los 7 días, y "reservado" no es una de las cuatro tarjetas del dashboard.
  // Sin esto, "Disponible" arranca en 0 y la primera pantalla de la cuenta de
  // prueba muestra un cero donde debería haber una operación viva.
  const spokenFor = new Set([...occupiedUnitIds, unitIds[2]!, unitIds[4]!]);
  const freeUnitIds = unitIds.filter((id) => !spokenFor.has(id)).slice(0, 2);
  if (freeUnitIds.length) {
    await admin.from("units").update({ status: "disponible" }).in("id", freeUnitIds);
  }

  return {
    units: unitIds.length,
    bookings: bookingRows.length,
    guests: guestIds.length,
    movements: movements.length,
  };
}

type MovementInput = {
  orgId: string;
  userId: string;
  today: string;
  planned: PlannedBooking[];
  bookingRows: { id: unknown; unit_id: unknown; check_out_date: unknown; status: unknown }[];
  unitIds: string[];
  cashAccountIds: string[];
};

/**
 * Ledger de los últimos ~35 días: los cobros de las reservas que ya entraron,
 * más los egresos operativos típicos. Alimenta "Revenue 30 días" del dashboard
 * y los saldos por cuenta de Caja.
 */
function buildMovements(input: MovementInput) {
  const { orgId, userId, today, planned, bookingRows, unitIds, cashAccountIds } = input;
  const [cashId, bankId] = cashAccountIds;
  const rand = makeRng(SEED + 31);
  const rows: Record<string, unknown>[] = [];

  planned.forEach((b, i) => {
    if (b.paid <= 0) return;
    if (b.checkIn < addDaysYmd(today, -32) || b.checkIn > today) return;
    const row = bookingRows[i];
    if (!row) return;

    // Las OTA liquidan por transferencia; el directo y el whatsapp suelen entrar
    // en efectivo. Que la Caja tenga dos cuentas con movimientos distintos es lo
    // que hace visible el módulo.
    const viaBank = b.source === "airbnb" || b.source === "booking";
    rows.push({
      organization_id: orgId,
      account_id: (viaBank ? bankId : cashId)!,
      direction: "in",
      amount: b.paid,
      currency: "ARS",
      category: "booking_payment",
      ref_type: "booking",
      ref_id: row.id as string,
      unit_id: row.unit_id as string,
      description: `Cobro reserva ${UNITS[b.unitIndex]!.code}`,
      occurred_at: zonedTimeToUtc(b.checkIn, "15:30", TZ).toISOString(),
      created_by: userId,
      billable_to: "apartcba",
    });
  });

  const expenses = [
    { day: -2,  cat: "cleaning",  amount: 13_000, unit: 0, text: "Limpieza de recambio" },
    { day: -5,  cat: "cleaning",  amount: 13_000, unit: 1, text: "Limpieza de recambio" },
    { day: -9,  cat: "cleaning",  amount: 15_000, unit: 7, text: "Limpieza profunda post estadía larga" },
    { day: -13, cat: "maintenance", amount: 48_000, unit: 0, text: "Cerrajería: cambio de bombín" },
    { day: -18, cat: "supplies",  amount: 92_400, unit: null, text: "Reposición de amenities y blanco" },
    { day: -21, cat: "utilities", amount: 137_500, unit: 3, text: "Expensas del mes" },
    { day: -26, cat: "utilities", amount: 84_200, unit: 1, text: "Luz y gas" },
    { day: -29, cat: "commission", amount: 61_000, unit: null, text: "Comisión inmobiliaria contrato mensual" },
  ] as const;

  expenses.forEach((e) => {
    rows.push({
      organization_id: orgId,
      account_id: (rand() < 0.5 ? cashId : bankId)!,
      direction: "out",
      amount: e.amount,
      currency: "ARS",
      category: e.cat,
      // Mismas claves que las filas de cobro de arriba (ver nota del lote).
      ref_type: null,
      ref_id: null,
      unit_id: e.unit === null ? null : unitIds[e.unit]!,
      description: e.text,
      occurred_at: zonedTimeToUtc(addDaysYmd(today, e.day), "10:00", TZ).toISOString(),
      created_by: userId,
      billable_to: e.cat === "utilities" ? "owner" : "apartcba",
    });
  });

  return rows;
}

/**
 * Vacía los datos de ejemplo dejando la organización, el usuario y la
 * configuración intactos. Es el camino por el que una cuenta de prueba se
 * convierte en cuenta real: no hay que migrar nada ni volver a registrarse.
 *
 * El orden importa porque las FK entre estas tablas no son todas CASCADE.
 */
export async function purgeDemoData(admin: AdminClient, orgId: string): Promise<void> {
  const tables = [
    "cleaning_events",
    "cleaning_tasks",
    "ticket_events",
    "maintenance_tickets",
    "cash_movements",
    "cash_accounts",
    "bookings",
    "guests",
    "unit_photos",
    "units",
    "owners",
  ];

  // unit_owners no tiene organization_id: se borra por las unidades de la org.
  const { data: units } = await admin.from("units").select("id").eq("organization_id", orgId);
  const unitIds = (units ?? []).map((u) => u.id as string);
  if (unitIds.length) {
    await admin.from("unit_owners").delete().in("unit_id", unitIds);
  }

  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq("organization_id", orgId);
    if (error) throw new Error(`purge ${table}: ${error.message}`);
  }

  const { error } = await admin
    .from("organizations")
    .update({ demo_data_seeded_at: null })
    .eq("id", orgId);
  if (error) throw new Error(`purge organizations: ${error.message}`);
}
