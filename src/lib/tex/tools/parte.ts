/**
 * `parte_del_dia`: quién entra, quién sale, qué está sucio, qué tareas y
 * arreglos hay, para un día. Envuelve `getParteDiario(fecha)`.
 *
 * Ojo: `getParteDiario()` SIN fecha devuelve MAÑANA (es el parte que se arma
 * la noche anterior). Acá la fecha siempre va explícita y por defecto es hoy
 * en la zona de la organización.
 */
import { z } from "zod/v4";
import { getParteDiario } from "@/lib/actions/parte-diario";
import { can } from "@/lib/permissions";
import type { CardRow, TexCard } from "../types";
import { attempt, defineRead, hrefs } from "../tool";
import { isYmd, shortDate } from "../format";

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export const parteDelDia = defineRead({
  name: "parte_del_dia",
  label: "Mirando el parte del día…",
  description:
    "El parte de un día: llegadas (check-in), salidas (check-out), unidades sucias para limpiar, tareas pendientes y arreglos abiertos. " +
    "Usala para «¿quién entra hoy?», «¿qué salidas hay mañana?», «¿qué hay que limpiar?», «¿cómo viene el día?». " +
    "Incluye reservas pendientes (ocupan fecha). Si no te dicen el día, es hoy.",
  input: z.object({
    fecha: z
      .string()
      .describe("Día en formato YYYY-MM-DD (calculalo con la fecha de hoy del contexto). Si no se indica, hoy.")
      .optional(),
  }),
  resource: "parte_diario",
  action: "view",
  async run(input, ctx) {
    const fecha = input.fecha && isYmd(input.fecha) ? input.fecha : ctx.today;
    const r = await attempt(() => getParteDiario(fecha));
    if (!r.ok) return r;
    const p = r.value;
    const label = fecha === ctx.today ? "Hoy" : fecha === ctx.tomorrow ? "Mañana" : shortDate(fecha, ctx.today);
    // Limpieza y mantenimiento ven el parte sin huéspedes (como en la app: el
    // parte del panel muestra llegadas y salidas sólo con permiso de reservas).
    const seesGuests = can(ctx.role, "bookings", "view");

    const entradas = p.check_ins.map((b) => ({
      unidad: `${b.unit_code} · ${b.unit_name}`,
      huesped: b.is_owner_use ? "Uso propietario" : (b.guest_name ?? "Sin nombre"),
      hora: hhmm(b.check_in_time),
      estado: b.status,
      reserva_id: b.booking_id,
    }));
    const salidas = p.check_outs.map((b) => ({
      unidad: `${b.unit_code} · ${b.unit_name}`,
      huesped: b.is_owner_use ? "Uso propietario" : (b.guest_name ?? "Sin nombre"),
      hora: hhmm(b.check_out_time),
      estado: b.status,
      reserva_id: b.booking_id,
    }));
    const sucios = p.sucios.map((c) => ({
      unidad: `${c.unit_code} · ${c.unit_name}`,
      asignada_a: c.assigned_to_name,
      estado_tarea: c.status ?? "sin tarea creada",
      atrasada: Boolean(c.overdue),
    }));

    const moveRows: CardRow[] = [
      ...p.check_ins.map<CardRow>((b) => ({
        title: `${b.unit_code} · ${b.unit_name}`,
        subtitle: b.is_owner_use ? "Uso propietario" : (b.guest_name ?? "Sin nombre"),
        badge: { label: `Entra${hhmm(b.check_in_time) ? ` ${hhmm(b.check_in_time)}` : ""}`, tone: "good" },
        href: hrefs.booking(b.booking_id),
      })),
      ...p.check_outs.map<CardRow>((b) => ({
        title: `${b.unit_code} · ${b.unit_name}`,
        subtitle: b.is_owner_use ? "Uso propietario" : (b.guest_name ?? "Sin nombre"),
        badge: { label: `Sale${hhmm(b.check_out_time) ? ` ${hhmm(b.check_out_time)}` : ""}`, tone: "info" },
        href: hrefs.booking(b.booking_id),
      })),
    ];
    const cards: TexCard[] = [];
    if (seesGuests) cards.push(
      {
        kind: "list",
        title: `${label}: ${p.check_ins.length} ${p.check_ins.length === 1 ? "llegada" : "llegadas"} y ${p.check_outs.length} ${p.check_outs.length === 1 ? "salida" : "salidas"}`,
        icon: "calendar",
        rows: moveRows.slice(0, 14),
        more: Math.max(0, moveRows.length - 14),
        empty: "No entra ni sale nadie.",
        footer: { label: "Ver el parte completo", href: hrefs.parte() },
      },
    );
    if (p.sucios.length > 0) {
      cards.push({
        kind: "list",
        title: `Para limpiar (${p.sucios.length})`,
        icon: "broom",
        rows: p.sucios.slice(0, 10).map((c) => ({
          title: `${c.unit_code} · ${c.unit_name}`,
          subtitle: c.assigned_to_name ? `Asignada a ${c.assigned_to_name}` : "Sin asignar",
          badge: c.overdue ? { label: "Atrasada", tone: "bad" } : { label: "Sucio", tone: "warn" },
        })),
        more: Math.max(0, p.sucios.length - 10),
        footer: { label: "Ir a Limpieza", href: hrefs.cleaning() },
      });
    }

    return {
      ok: true,
      data: {
        fecha,
        ...(seesGuests
          ? { entradas: entradas.slice(0, 40), salidas: salidas.slice(0, 40) }
          : { llegadas: p.check_ins.length, salidas_cantidad: p.check_outs.length, nota: "Tu rol no ve huéspedes ni reservas." }),
        para_limpiar: sucios.slice(0, 40),
        tareas_pendientes: p.tareas_pendientes.slice(0, 20).map((t) => ({
          unidad: t.unit_code,
          tarea: t.description.slice(0, 140),
          prioridad: t.priority,
          estado: t.status,
          asignada_a: t.assigned_to_name,
        })),
        arreglos_abiertos: p.arreglos.slice(0, 20).map((a) => ({
          unidad: a.unit_code,
          arreglo: a.title,
          prioridad: a.priority,
          estado: a.status,
        })),
      },
      cards,
    };
  },
});
