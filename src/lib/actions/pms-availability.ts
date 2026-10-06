"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { getOwnerScope, scopeFilter } from "@/lib/auth/owner-scope";
import { checkAvailabilityRange } from "@/lib/units/availability";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { listChannelRequestsInRange } from "./channel-requests";

/**
 * Foto autoritativa de la ocupación de un rango, para "Buscar disp" del PMS.
 *
 * El board sólo tiene en memoria la ventana que fue cargando al navegar; para
 * decir "esta unidad está libre del X al Y" hace falta preguntar por ese rango
 * exacto. Devuelve filas livianas (la decisión la toma
 * `computeUnitAvailability`, que las une con el state local) y COMPLETAS: si
 * no se pudo leer todo, falla — una lista corta declararía libres unidades
 * ocupadas.
 */

export interface AvailabilityBookingRow {
  id: string;
  unit_id: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  is_block: boolean;
}

export interface AvailabilityRequestRow {
  id: string;
  unit_id: string | null;
  check_in: string | null;
  check_out: string | null;
  channel: string;
  confirmation_code: string | null;
  holds_availability: boolean;
}

export type AvailabilitySnapshot =
  | {
      ok: true;
      from: string;
      to: string;
      bookings: AvailabilityBookingRow[];
      requests: AvailabilityRequestRow[];
    }
  | { ok: false; error: string };

// PostgREST corta en 1000 filas sin avisar (max-rows de Supabase). Se pagina
// por cursor (check_in_date, id) y no por offset: un alta o un borrado entre
// páginas corre los offsets y puede saltear justo la fila del borde.
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** El `.limit()` de `listChannelRequestsInRange`. */
const REQUESTS_CAP = 500;

const READ_ERROR = "No se pudo verificar la disponibilidad. Probá de nuevo.";

export async function getAvailabilitySnapshot(
  from: string,
  to: string,
): Promise<AvailabilitySnapshot> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "bookings", "view")) {
    return { ok: false, error: "No tenés permiso para ver la disponibilidad de las unidades." };
  }
  const range = checkAvailabilityRange(String(from ?? ""), String(to ?? ""));
  if (!range.ok) {
    return { ok: false, error: range.message ?? "Elegí las fechas de entrada y salida." };
  }

  const ownerScope = await getOwnerScope();
  const admin = createAdminClient();

  const readBookings = async (): Promise<AvailabilityBookingRow[] | null> => {
    const rows: AvailabilityBookingRow[] = [];
    // Total de la primera página (`count: "exact"`): la única forma de saber
    // que se leyó todo aunque el max-rows del proyecto fuera menor que
    // PAGE_SIZE (una página corta no prueba que no haya más).
    let total: number | null = null;
    let cursor: { date: string; id: string } | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = admin
        .from("bookings")
        .select(
          "id, unit_id, check_in_date, check_out_date, status, is_block",
          page === 0 ? { count: "exact" } : undefined,
        )
        .eq("organization_id", organization.id)
        .filter(...scopeFilter(ownerScope))
        // Mismo criterio que listBookingsInRange: lo cancelado no ocupa.
        .not("status", "in", "(cancelada,no_show)")
        .lt("check_in_date", range.to)
        .gt("check_out_date", range.from);
      if (cursor) {
        q = q.or(
          `check_in_date.gt.${cursor.date},and(check_in_date.eq.${cursor.date},id.gt.${cursor.id})`,
        );
      }
      const { data, error, count } = await q
        .order("check_in_date", { ascending: true })
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (error) {
        console.error("[pms-availability] bookings page", page, error.message);
        return null;
      }
      if (page === 0) total = typeof count === "number" ? count : null;
      const batch = (data ?? []) as AvailabilityBookingRow[];
      rows.push(...batch);
      if (total === null) {
        // Sin total no hay cómo probar que la lista está completa.
        console.error("[pms-availability] la consulta no devolvió el total", range.key);
        return null;
      }
      if (rows.length >= total) return rows;
      if (batch.length === 0) break;
      const last = batch[batch.length - 1];
      cursor = { date: last.check_in_date, id: last.id };
    }
    // Más de PAGE_SIZE × MAX_PAGES reservas en el rango, o filas que se
    // borraron entre páginas: no podemos afirmar nada.
    console.error("[pms-availability] lectura incompleta del rango", range.key);
    return null;
  };

  const [bookings, requests] = await Promise.all([
    readBookings(),
    listChannelRequestsInRange(range.from, range.to).catch((err: unknown) => {
      console.error("[pms-availability] solicitudes", err);
      return null;
    }),
  ]);
  // Sin solicitudes tampoco se responde: las que retienen la venta (Booking)
  // ocupan, y omitirlas mostraría libre una unidad comprometida.
  if (!bookings || !requests) return { ok: false, error: READ_ERROR };
  // listChannelRequestsInRange corta en REQUESTS_CAP filas: si llegó al tope,
  // la lista puede estar incompleta y no se puede afirmar disponibilidad.
  if (requests.length >= REQUESTS_CAP) {
    console.error("[pms-availability] solicitudes en el tope", range.key);
    return { ok: false, error: READ_ERROR };
  }

  return {
    ok: true,
    from: range.from,
    to: range.to,
    bookings,
    requests: requests.map((r) => ({
      id: r.id,
      unit_id: r.unit_id,
      check_in: r.check_in,
      check_out: r.check_out,
      channel: r.channel,
      confirmation_code: r.confirmation_code,
      holds_availability: r.holds_availability,
    })),
  };
}
