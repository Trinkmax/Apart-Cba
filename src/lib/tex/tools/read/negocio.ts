/**
 * El negocio: `resumen_del_negocio` (el inicio), `resultados_del_mes` (la
 * conciliación de Resultados) y `liquidaciones` (sólo lectura: nunca genera).
 */
import { z } from "zod/v4";
import { getDashboardKPIs } from "@/lib/actions/kpis";
import { getMonthlyResults } from "@/lib/actions/results";
import { listSettlements } from "@/lib/actions/settlements";
import { listOwners } from "@/lib/actions/owners";
import { defaultSettlementPeriod, isPeriodUnfinished } from "@/lib/settlements/period-guard";
import { can } from "@/lib/permissions";
import type { StatTile, TexCard } from "../../types";
import { attempt, defineRead, hrefs, type ReadResult } from "../../tool";
import { fold, money, moneyByCurrency, shortDate, sumByCurrency } from "../../format";
import {
  SETTLEMENT_STATUS_LABEL,
  localYmd,
  monthLabel,
  num,
  plural,
  round2,
  settlementStatusTone,
  sourceLabel,
  unitLabel,
} from "./_shared";

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export const resumenDelNegocio = defineRead({
  name: "resumen_del_negocio",
  label: "Armando el resumen…",
  description:
    "Cómo viene el negocio: unidades por estado, ocupación aproximada de los próximos 30 días, entradas y salidas de hoy, próximas llegadas, " +
    "reservas que faltan completar (sin huésped o sin precio) y pendientes del equipo (arreglos, limpiezas, tareas). Con permiso de pagos " +
    "suma lo cobrado en 30 días y lo que falta cobrar. Usala para «¿cómo venimos?», «dame un resumen». " +
    "Para el detalle exacto de un día usá parte_del_dia; para la plata de un mes, resultados_del_mes.",
  input: z.object({}),
  resource: "bookings",
  action: "view",
  async run(_input, ctx) {
    const r = await attempt(() => getDashboardKPIs());
    if (!r.ok) return r;
    const k = r.value;
    // La action devuelve la plata a todos los roles: acá se filtra.
    const showMoney = can(ctx.role, "payments", "view");
    const occupancy = Math.round(Math.min(100, Math.max(0, k.occupancy_pct_30d)));
    const porCompletar = k.bookings.pending_guest_data + k.bookings.pending_price;

    const tiles: StatTile[] = [
      { label: "Ocupación 30 días", value: `${occupancy} %`, hint: "aprox." },
      { label: "Entran hoy", value: String(k.bookings.today_check_ins) },
      { label: "Salen hoy", value: String(k.bookings.today_check_outs), hint: "aprox." },
      { label: "Entran en 30 días", value: String(k.bookings.upcoming_30d) },
      {
        label: "Arreglos abiertos",
        value: String(k.service.open_tickets),
        hint: k.service.urgent_tickets ? `${k.service.urgent_tickets} urgentes` : undefined,
        tone: k.service.urgent_tickets ? "bad" : undefined,
      },
      { label: "Por completar", value: String(porCompletar), hint: "sin huésped o sin precio", tone: porCompletar ? "warn" : undefined },
      ...(showMoney
        ? [
            { label: "Cobrado 30 días", value: moneyByCurrency(k.finance.collected_30d_by_currency), tone: "good" as const },
            { label: "Saldo por cobrar", value: moneyByCurrency(k.finance.pending_payment_by_currency) },
          ]
        : []),
    ];
    const cards: TexCard[] = [
      { kind: "stats", title: "Cómo viene el negocio", icon: "chart", tiles, footer: { label: "Ir al inicio", href: "/dashboard" } },
    ];
    if (k.next_check_ins.length > 0) {
      cards.push({
        kind: "list",
        title: "Próximas llegadas",
        icon: "calendar",
        rows: k.next_check_ins.map((b) => ({
          title: unitLabel({ code: b.unit_code, name: b.unit_name }),
          subtitle: b.guest_name ?? "Sin huésped cargado",
          meta: [shortDate(b.check_in_date, ctx.today), hhmm(b.check_in_time)].filter(Boolean).join(" "),
          href: hrefs.booking(b.id),
        })),
      });
    }

    return {
      ok: true,
      data: {
        unidades: {
          total: k.totals.units,
          disponibles: k.totals.available_units,
          ocupadas: k.totals.occupied_units,
          en_limpieza: k.totals.cleaning_units,
          en_mantenimiento: k.totals.maintenance_units,
        },
        ocupacion_aprox_30_dias: `${occupancy} %`,
        hoy: { entradas_confirmadas: k.bookings.today_check_ins, salidas_aprox: k.bookings.today_check_outs },
        entran_en_30_dias: k.bookings.upcoming_30d,
        proximas_entradas: k.next_check_ins.map((b) => ({
          reserva_id: b.id,
          unidad: unitLabel({ code: b.unit_code, name: b.unit_name }),
          huesped: b.guest_name ?? "Sin huésped cargado",
          entra: b.check_in_date,
          hora: hhmm(b.check_in_time),
        })),
        proximas_salidas: k.next_check_outs.map((b) => ({
          reserva_id: b.id,
          unidad: unitLabel({ code: b.unit_code, name: b.unit_name }),
          huesped: b.guest_name ?? "Sin huésped cargado",
          sale: b.check_out_date,
          hora: hhmm(b.check_out_time),
        })),
        por_completar: { sin_huesped: k.bookings.pending_guest_data, sin_precio: k.bookings.pending_price },
        equipo: {
          arreglos_abiertos: k.service.open_tickets,
          arreglos_urgentes: k.service.urgent_tickets,
          limpiezas_pendientes: k.service.cleaning_pending,
          tareas_pendientes: k.service.concierge_pending,
        },
        ...(showMoney
          ? {
              plata: {
                cobrado_ultimos_30_dias: moneyByCurrency(k.finance.collected_30d_by_currency),
                saldo_por_cobrar: moneyByCurrency(k.finance.pending_payment_by_currency),
                total_reservas_con_salida_entre_hace_30_y_en_30_dias: moneyByCurrency(k.finance.revenue_30d_by_currency),
              },
            }
          : {}),
        notas: [
          "Unidades por estado = lo que figura en el tablero.",
          "La ocupación sale de las noches de las reservas confirmadas que ENTRAN en los próximos 30 días: es aproximada.",
          "Entradas de hoy cuenta sólo confirmadas; salidas puede incluir canceladas. Para el dato exacto de hoy usá parte_del_dia.",
        ],
      },
      cards,
    };
  },
});

export const resultadosDelMes = defineRead({
  name: "resultados_del_mes",
  label: "Calculando los resultados del mes…",
  description:
    "Los números de un mes, igual que la pantalla Resultados: ventas (lo que paga el huésped), cobrado y saldo, lo que se llevan las " +
    "plataformas, tu comisión, lo que va a los propietarios, el cierre de liquidaciones y las 5 unidades que más vendieron, por moneda. " +
    "Las estadías cortas cuentan en el mes de su SALIDA; los alquileres mensuales se prorratean. Lo que todavía no se liquidó va estimado. " +
    "Usala para «¿cuánto facturamos en octubre?», «¿cuánto ganamos este mes?». Es lenta: no la llames dos veces para lo mismo.",
  input: z.object({
    anio: z.number().int().min(2020).max(2100).describe("Año (por defecto, el de hoy).").optional(),
    mes: z.number().int().min(1).max(12).describe("Mes 1-12 (por defecto, el mes en curso).").optional(),
  }),
  resource: "payments",
  action: "view",
  async run(input, ctx) {
    const year = input.anio ?? Number(ctx.today.slice(0, 4));
    const month = input.mes ?? Number(ctx.today.slice(5, 7));
    const r = await attempt(() => getMonthlyResults(year, month));
    if (!r.ok) return r;
    const res = r.value;
    const periodo = monthLabel(res.year, res.month);
    const enCurso = isPeriodUnfinished({ year: res.year, month: res.month }, ctx.today);
    const link = `${hrefs.results()}?year=${res.year}&month=${res.month}`;

    const totals = res.totals.map((t) => {
      const m = (n: number) => money(round2(n), t.currency);
      const est = t.estimated;
      return {
        t,
        data: {
          moneda: t.currency,
          reservas: t.bookings,
          ventas: m(t.guest_total),
          cobrado: m(t.paid),
          saldo_por_cobrar: m(t.pending),
          plataformas: m(t.settled.channel + est.channel),
          tu_comision: m(t.settled.commission + est.commission),
          ...(Math.abs(t.settled.rate_diff) > 0.004 ? { margen_por_tarifa: m(t.settled.rate_diff) } : {}),
          a_propietarios: m(t.settled.owner_net + est.owner_net),
          ...(est.bookings > 0
            ? {
                estimado_sin_liquidar: {
                  reservas: est.bookings,
                  plataformas: m(est.channel),
                  tu_comision: m(est.commission),
                  a_propietarios: m(est.owner_net),
                },
              }
            : {}),
          ...(t.unreconciled_bookings ? { reservas_sin_conciliar: t.unreconciled_bookings } : {}),
        },
      };
    });

    const topUnits = [...res.by_unit].sort((a, b) => b.guest_total - a.guest_total).slice(0, 5);
    const cards: TexCard[] = totals.slice(0, 3).map(({ t }) => {
      const m = (n: number) => money(round2(n), t.currency);
      const hasEst = t.estimated.bookings > 0;
      return {
        kind: "stats",
        title: `Resultados de ${periodo}${totals.length > 1 ? ` · ${t.currency}` : ""}`,
        icon: "chart",
        tiles: [
          { label: "Ventas", value: m(t.guest_total), hint: plural(t.bookings, "reserva", "reservas") },
          { label: "Cobrado", value: m(t.paid), hint: `Saldo ${m(t.pending)}`, tone: t.pending > 0.004 ? "warn" : "good" },
          { label: "Plataformas", value: m(t.settled.channel + t.estimated.channel), hint: hasEst ? "con estimado" : undefined },
          { label: "Tu comisión", value: m(t.settled.commission + t.estimated.commission), hint: hasEst ? "con estimado" : undefined },
          { label: "A propietarios", value: m(t.settled.owner_net + t.estimated.owner_net), hint: hasEst ? "con estimado" : undefined },
        ],
        note: enCurso ? "El mes no terminó: los números todavía cambian." : undefined,
        footer: { label: "Abrir Resultados", href: link },
      };
    });
    if (cards.length === 0) {
      cards.push({
        kind: "stats",
        title: `Resultados de ${periodo}`,
        icon: "chart",
        tiles: [{ label: "Reservas", value: "0" }],
        note: "No hay reservas que cuenten en este mes.",
        footer: { label: "Abrir Resultados", href: link },
      });
    }

    return {
      ok: true,
      data: {
        periodo,
        ...(enCurso ? { en_curso: "El mes no terminó: los números todavía cambian." } : {}),
        por_moneda: totals.map((x) => x.data),
        top_unidades: topUnits.map((u) => ({
          unidad: [u.label, u.sublabel].filter(Boolean).join(" · "),
          ventas: money(round2(u.guest_total), u.currency),
          reservas: u.bookings,
        })),
        cierre_liquidaciones: res.close.map((c) => ({
          moneda: c.currency,
          liquidaciones: c.settlements,
          pagadas: c.settlements_paid,
          neto_a_pagar: money(c.net_payable, c.currency),
          falta_transferir: money(c.net_pending, c.currency),
          reservas_sin_liquidar: c.bookings_not_settled,
        })),
        ...(res.missing_price_count ? { reservas_sin_precio: res.missing_price_count } : {}),
        ...(res.channels_without_pct.length ? { canales_sin_porcentaje: res.channels_without_pct.map(sourceLabel) } : {}),
        nota: "Ventas = lo que paga el huésped (sale de las reservas). A propietarios = lo liquidado, más lo estimado de lo que falta liquidar.",
      },
      cards,
    };
  },
});

type SettlementRow = {
  id: string;
  status: string;
  origin?: string | null;
  currency: string;
  net_payable: number | string;
  gross_revenue: number | string;
  commission_amount: number | string;
  paid_at: string | null;
  sent_at: string | null;
  owner: { id: string; full_name: string } | null;
};

export const liquidaciones = defineRead({
  name: "liquidaciones",
  label: "Mirando las liquidaciones…",
  description:
    "Las liquidaciones a propietarios de un mes: estado (borrador, revisada, enviada, pagada, en disputa), neto a pagar por moneda y " +
    "cuánto falta pagar. Usala para «¿cómo vienen las liquidaciones?», «¿ya le pagamos a López?». Por defecto es el mes que se está " +
    "liquidando (hasta el 15, el mes anterior). Sólo lee: nunca genera ni modifica liquidaciones.",
  input: z.object({
    anio: z.number().int().min(2020).max(2100).describe("Año del período.").optional(),
    mes: z.number().int().min(1).max(12).describe("Mes del período, 1-12.").optional(),
    propietario: z.string().max(120).describe("Nombre del propietario, si preguntan por uno.").optional(),
  }),
  resource: "settlements",
  action: "view",
  async run(input, ctx): Promise<ReadResult> {
    const def = defaultSettlementPeriod(ctx.today);
    const todayYear = Number(ctx.today.slice(0, 4));
    const todayMonth = Number(ctx.today.slice(5, 7));
    let year = input.anio ?? def.year;
    const month = input.mes ?? def.month;
    // «Las de diciembre» en enero: un mes que todavía no llegó es del año pasado.
    if (input.mes && !input.anio) year = input.mes > todayMonth ? todayYear - 1 : todayYear;

    let ownerId: string | undefined;
    if (input.propietario?.trim()) {
      const o = await attempt(() => listOwners());
      if (!o.ok) return o;
      const q = fold(input.propietario);
      const exact = o.value.filter((x) => fold(x.full_name) === q);
      const hits = exact.length ? exact : o.value.filter((x) => fold(x.full_name).includes(q));
      if (hits.length === 0) return { ok: false, error: `No encontré un propietario «${input.propietario}».` };
      if (hits.length > 1) {
        return {
          ok: true,
          data: {
            necesito_elegir: `Hay ${hits.length} propietarios que coinciden con «${input.propietario}». ¿Cuál?`,
            opciones: hits.slice(0, 8).map((x) => ({ id: x.id, label: x.full_name })),
          },
        };
      }
      ownerId = hits[0].id;
    }

    const r = await attempt(() => listSettlements({ year, month, ownerId }));
    if (!r.ok) return r;
    const rows = (r.value as unknown as SettlementRow[]).sort((a, b) =>
      (a.owner?.full_name ?? "").localeCompare(b.owner?.full_name ?? ""),
    );
    const periodo = monthLabel(year, month);
    const porEstado: Record<string, number> = {};
    for (const s of rows) {
      const k = SETTLEMENT_STATUS_LABEL[s.status] ?? s.status;
      porEstado[k] = (porEstado[k] ?? 0) + 1;
    }
    const neto = sumByCurrency(rows, (s) => num(s.net_payable), (s) => s.currency);
    const faltaPagar = sumByCurrency(
      rows.filter((s) => s.status !== "pagada" && num(s.net_payable) > 0),
      (s) => num(s.net_payable),
      (s) => s.currency,
    );
    const link = `${hrefs.settlements()}?year=${year}&month=${month}`;

    return {
      ok: true,
      data: {
        periodo,
        liquidaciones: rows.length,
        por_estado: porEstado,
        neto_total: moneyByCurrency(neto),
        falta_pagar: moneyByCurrency(faltaPagar),
        lista: rows.slice(0, 40).map((s) => ({
          liquidacion_id: s.id,
          propietario: s.owner?.full_name ?? "Sin propietario",
          estado: s.status,
          neto: money(s.net_payable, s.currency),
          ...(num(s.net_payable) < 0 ? { a_cargo_del_propietario: true } : {}),
          ...(s.paid_at ? { pagada_el: localYmd(s.paid_at, ctx.org.timezone) } : {}),
          ...(s.origin === "manual" ? { cargada_a_mano: true } : {}),
        })),
        ...(rows.length === 0
          ? { nota: "No hay liquidaciones de ese mes. Se generan desde la pantalla Liquidaciones (Tex no las genera)." }
          : {}),
      },
      card: {
        kind: "list",
        title: rows.length ? `Liquidaciones de ${periodo} (${rows.length})` : `Liquidaciones de ${periodo}`,
        icon: "file",
        rows: rows.slice(0, 14).map((s) => ({
          title: s.owner?.full_name ?? "Sin propietario",
          subtitle: num(s.net_payable) < 0 ? "A cargo del propietario" : undefined,
          badge: { label: SETTLEMENT_STATUS_LABEL[s.status] ?? s.status, tone: settlementStatusTone(s.status) },
          amount: { value: money(s.net_payable, s.currency), tone: num(s.net_payable) < 0 ? "warn" : undefined },
          href: hrefs.settlement(s.id),
        })),
        more: Math.max(0, rows.length - 14),
        empty: "No hay liquidaciones generadas para ese mes.",
        footer: { label: "Abrir Liquidaciones", href: link },
      },
    };
  },
});
