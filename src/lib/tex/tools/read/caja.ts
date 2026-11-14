/**
 * Caja: `caja` (saldos), `movimientos` (qué entró y salió en un rango),
 * `buscar_movimientos` (la lupa de Caja) y `cuotas_por_cobrar`.
 *
 * `occurred_at` es timestamptz y las actions lo comparan crudo: los días se
 * convierten acá a un rango UTC en la zona de la organización. Nunca se suman
 * monedas distintas.
 */
import { z } from "zod/v4";
import { getAccountBalances, listAccounts, listMovements, searchCashMovements } from "@/lib/actions/cash";
import { listUpcomingSchedule } from "@/lib/actions/payment-schedule";
import { addDaysYmd } from "@/lib/dates";
import type { CashAccount, MovementCategory } from "@/lib/types/database";
import type { CardRow, TexCard } from "../../types";
import { attempt, defineRead, hrefs, type ReadResult } from "../../tool";
import { clip, isYmd, money, moneyByCurrency, nightsBetween, shortDate, sumByCurrency } from "../../format";
import { resolveAccount } from "../_resolve";
import { cashCategoryLabel, isDeadBooking, localYmd, num, round2, tzRangeIso, unitLabel } from "./_shared";

const ACCOUNT_TYPE: Record<string, string> = {
  efectivo: "Efectivo",
  banco: "Banco",
  mp: "Mercado Pago",
  crypto: "Cripto",
  tarjeta: "Tarjeta",
  otro: "Otra",
};

export const caja = defineRead({
  name: "caja",
  label: "Mirando los saldos…",
  description:
    "El saldo de cada cuenta de Caja (efectivo, banco, Mercado Pago…) y el total por moneda. " +
    "Usala para «¿cuánta plata hay?», «¿cuánto queda en la caja chica?». Para qué entró o salió en un período usá movimientos; " +
    "para encontrar un pago puntual, buscar_movimientos.",
  input: z.object({}),
  resource: "cash",
  action: "view",
  async run(_input, ctx) {
    const [aR, bR] = await Promise.all([attempt(() => listAccounts()), attempt(() => getAccountBalances())]);
    if (!aR.ok) return aR;
    if (!bR.ok) return bR;
    const balances = bR.value;
    const rows = aR.value
      .filter((a) => a.active)
      .map((a) => ({ a, saldo: round2(balances[a.id] ?? num(a.opening_balance)) }));
    const totales = sumByCurrency(rows, (r) => r.saldo, (r) => r.a.currency);

    return {
      ok: true,
      data: {
        cuentas: rows.map((r) => ({
          cuenta: r.a.name,
          cuenta_id: r.a.id,
          tipo: ACCOUNT_TYPE[r.a.type] ?? r.a.type,
          saldo: money(r.saldo, r.a.currency),
          ...(r.a.is_expense_default ? { gastos_corrientes: true } : {}),
        })),
        total_por_moneda: Object.entries(totales).map(([c, v]) => money(v, c)),
        hoy: ctx.today,
      },
      card: {
        kind: "list",
        title: rows.length ? `Caja: ${moneyByCurrency(totales)}` : "Caja",
        icon: "wallet",
        rows: rows.slice(0, 20).map((r) => ({
          title: r.a.name,
          subtitle: [ACCOUNT_TYPE[r.a.type] ?? r.a.type, r.a.currency].join(" · "),
          amount: { value: money(r.saldo, r.a.currency), tone: r.saldo < -0.004 ? "bad" : undefined },
          href: hrefs.cashAccount(r.a.id),
        })),
        more: Math.max(0, rows.length - 20),
        empty: "No hay cuentas de Caja activas.",
        footer: { label: "Ir a Caja", href: hrefs.cash() },
      },
    };
  },
});

/** Categorías de Caja como las dice la gente → las de la base. */
const CATEGORIA = {
  cobro_reserva: "booking_payment",
  cobro_extra: "extra_charge",
  devolucion: "refund",
  mantenimiento: "maintenance",
  limpieza: "cleaning",
  liquidacion_propietario: "owner_settlement",
  transferencia: "transfer",
  ajuste: "adjustment",
  sueldos: "salary",
  servicios: "utilities",
  impuestos: "tax",
  insumos: "supplies",
  comision: "commission",
  cobro_alquiler: "rent_collection",
  rendicion_propietario: "rent_owner_payout",
  deposito_garantia: "security_deposit",
  honorarios: "agency_fee",
  otro: "other",
} as const satisfies Record<string, MovementCategory>;
type CategoriaEs = keyof typeof CATEGORIA;
const CATEGORIA_KEYS = Object.keys(CATEGORIA) as [CategoriaEs, ...CategoriaEs[]];

const DIRECCION = z.enum(["ingreso", "egreso"]);
const toDirection = (d: "ingreso" | "egreso" | undefined) => (d === "ingreso" ? "in" : d === "egreso" ? "out" : null);

type Mov = {
  id: string;
  account_id: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  account: { name: string } | null;
  unit: { code: string } | null;
  owner: { full_name: string } | null;
  party_name: string | null;
  place_label: string | null;
};

function movementRow(m: Mov, tz: string, today: string): CardRow {
  const ymd = localYmd(m.occurred_at, tz);
  return {
    title: clip(m.description, 60) ?? cashCategoryLabel(m.category),
    subtitle: [m.party_name, m.place_label ?? m.unit?.code, m.account?.name].filter(Boolean).join(" · ") || undefined,
    meta: ymd ? shortDate(ymd, today) : undefined,
    amount: { value: `${m.direction === "in" ? "+" : "−"}${money(m.amount, m.currency)}`, tone: m.direction === "in" ? "good" : "bad" },
    href: hrefs.cashAccount(m.account_id),
  };
}

function movementData(m: Mov, tz: string) {
  return {
    fecha: localYmd(m.occurred_at, tz),
    tipo: m.direction === "in" ? "ingreso" : "egreso",
    importe: money(m.amount, m.currency),
    concepto: cashCategoryLabel(m.category),
    detalle: clip(m.description, 80),
    quien: m.party_name ?? m.owner?.full_name ?? undefined,
    donde: m.place_label ?? m.unit?.code ?? undefined,
    cuenta: m.account?.name,
  };
}

/** La cuenta que nombró la persona, si la nombró. `choose` vuelve como pregunta para el modelo. */
async function accountFor(cuenta: string | undefined): Promise<{ ok: true; account: CashAccount | null } | ReadResult> {
  if (!cuenta?.trim()) return { ok: true, account: null };
  const a = await resolveAccount(cuenta);
  if (a.ok === false) return a;
  if (a.ok === "choose") return { ok: true, data: { necesito_elegir: a.question, opciones: a.options } };
  return { ok: true, account: a.value };
}

export const movimientos = defineRead({
  name: "movimientos",
  label: "Sumando los movimientos…",
  description:
    "Lo que entró y salió de Caja en un período: totales por moneda, el desglose por categoría y los últimos movimientos. " +
    "Usala para «¿cuánto entró este mes?», «¿cuánto gastamos en limpieza en octubre?», «¿qué salió de la caja chica esta semana?». " +
    "Por defecto, del 1 del mes en curso a hoy. Sin cuenta, los totales no cuentan las transferencias entre cuentas propias.",
  input: z.object({
    desde: z.string().describe("Primer día, YYYY-MM-DD. Si no se indica, el 1 del mes en curso.").optional(),
    hasta: z.string().describe("Último día inclusive, YYYY-MM-DD. Si no se indica, hoy.").optional(),
    cuenta: z.string().max(80).describe("Nombre de la cuenta de Caja si la nombraron (ej. «Caja chica», «Mercado Pago»).").optional(),
    categoria: z
      .enum(CATEGORIA_KEYS)
      .describe("Sólo una categoría: cobro_reserva, cobro_extra, devolucion, limpieza, mantenimiento, servicios, insumos, sueldos, impuestos, liquidacion_propietario, etc.")
      .optional(),
    direccion: DIRECCION.describe("Sólo lo que entró (ingreso) o sólo lo que salió (egreso).").optional(),
  }),
  resource: "cash",
  action: "view",
  async run(input, ctx) {
    const desde = input.desde ?? `${ctx.today.slice(0, 8)}01`;
    const hasta = input.hasta ?? ctx.today;
    if (!isYmd(desde) || !isYmd(hasta)) return { ok: false, error: "Las fechas tienen que ser días reales en formato YYYY-MM-DD." };
    if (hasta < desde) return { ok: false, error: "«Hasta» tiene que ser igual o posterior a «desde»." };
    if (nightsBetween(desde, hasta) > 400) return { ok: false, error: "Pedí un período de hasta un año." };

    const acc = await accountFor(input.cuenta);
    if (!("account" in acc)) return acc;
    const account = acc.account;
    const tz = ctx.org.timezone;
    const { fromIso, toIso } = tzRangeIso(desde, hasta, tz);
    const r = await attempt(() =>
      listMovements({
        accountId: account?.id,
        fromDate: fromIso,
        toDate: toIso,
        category: input.categoria ? CATEGORIA[input.categoria] : undefined,
        limit: 1000,
      }),
    );
    if (!r.ok) return r;
    const truncado = r.value.length >= 1000;
    const dir = toDirection(input.direccion);
    const rows = (r.value as unknown as Mov[]).filter((m) => !dir || m.direction === dir);

    // Sin cuenta, una transferencia entre cuentas propias no es ni ingreso ni gasto.
    const withTransfers = Boolean(account) || input.categoria === "transferencia";
    const forTotals = withTransfers ? rows : rows.filter((m) => m.category !== "transfer");
    const entro = sumByCurrency(forTotals.filter((m) => m.direction === "in"), (m) => m.amount, (m) => m.currency);
    const salio = sumByCurrency(forTotals.filter((m) => m.direction === "out"), (m) => m.amount, (m) => m.currency);
    const neto: Record<string, number> = {};
    for (const c of new Set([...Object.keys(entro), ...Object.keys(salio)])) neto[c] = round2((entro[c] ?? 0) - (salio[c] ?? 0));

    const byCat = new Map<string, { inn: Mov[]; out: Mov[] }>();
    for (const m of rows) {
      const g = byCat.get(m.category) ?? { inn: [], out: [] };
      (m.direction === "in" ? g.inn : g.out).push(m);
      byCat.set(m.category, g);
    }
    const categorias = [...byCat.entries()]
      .sort((a, b) => b[1].inn.length + b[1].out.length - (a[1].inn.length + a[1].out.length))
      .map(([cat, g]) => ({
        categoria: cashCategoryLabel(cat),
        ...(g.inn.length ? { entro: moneyByCurrency(sumByCurrency(g.inn, (m) => m.amount, (m) => m.currency)) } : {}),
        ...(g.out.length ? { salio: moneyByCurrency(sumByCurrency(g.out, (m) => m.amount, (m) => m.currency)) } : {}),
        movimientos: g.inn.length + g.out.length,
      }));

    const periodo = `${shortDate(desde, ctx.today)} al ${shortDate(hasta, ctx.today)}`;
    const cards: TexCard[] = [
      {
        kind: "stats",
        title: `Caja del ${periodo}${account ? ` · ${account.name}` : ""}`,
        icon: "wallet",
        tiles: [
          ...(dir !== "out" ? [{ label: "Entró", value: moneyByCurrency(entro), tone: "good" as const }] : []),
          ...(dir !== "in" ? [{ label: "Salió", value: moneyByCurrency(salio), tone: "bad" as const }] : []),
          ...(!dir ? [{ label: "Neto", value: moneyByCurrency(neto) }] : []),
          { label: "Movimientos", value: String(rows.length) },
        ],
        note: withTransfers ? undefined : "Sin contar transferencias entre cuentas propias.",
        footer: { label: account ? `Ver ${account.name}` : "Ir a Caja", href: account ? hrefs.cashAccount(account.id) : hrefs.cash() },
      },
    ];
    if (rows.length > 0) {
      cards.push({
        kind: "list",
        title: "Últimos movimientos",
        icon: "list",
        rows: rows.slice(0, 10).map((m) => movementRow(m, tz, ctx.today)),
        more: Math.max(0, rows.length - 10),
      });
    }

    return {
      ok: true,
      data: {
        desde,
        hasta,
        ...(account ? { cuenta: account.name } : {}),
        entro: moneyByCurrency(entro),
        salio: moneyByCurrency(salio),
        neto: moneyByCurrency(neto),
        incluye_transferencias: withTransfers,
        movimientos: rows.length,
        por_categoria: categorias.slice(0, 20),
        ultimos: rows.slice(0, 40).map((m) => movementData(m, tz)),
        ...(truncado ? { aviso: "El período tiene más de 1000 movimientos: los totales pueden estar incompletos. Pedí un rango más corto." } : {}),
      },
      cards,
    };
  },
});

export const buscarMovimientos = defineRead({
  name: "buscar_movimientos",
  label: "Buscando en Caja…",
  description:
    "La lupa de Caja: busca movimientos en TODO el historial por depto, persona (huésped, propietario, inquilino), concepto o importe " +
    "(«50.000» encuentra ese importe exacto). Tienen que aparecer todas las palabras; no importan las tildes. " +
    "Usala para «¿cuándo pagó Gómez?», «¿registramos el pago de 50.000?», «gastos del SAL525». Para totales de un período usá movimientos.",
  input: z.object({
    texto: z.string().min(2).max(120).describe("Lo que hay que buscar: depto, nombre, concepto o importe."),
    cuenta: z.string().max(80).describe("Nombre de la cuenta de Caja, si la nombraron.").optional(),
    direccion: DIRECCION.describe("Sólo ingresos o sólo egresos.").optional(),
  }),
  resource: "cash",
  action: "view",
  async run(input, ctx) {
    const acc = await accountFor(input.cuenta);
    if (!("account" in acc)) return acc;
    const account = acc.account;
    const texto = input.texto.trim();
    const dir = toDirection(input.direccion);
    const r = await attempt(() =>
      searchCashMovements({ query: texto, accountId: account?.id, direction: dir ?? "all", offset: 0, limit: 30, withTotals: true }),
    );
    if (!r.ok) return r;
    if (!r.value.ok) return { ok: false, error: r.value.error };
    const { total, totals } = r.value;
    const rows = r.value.rows as unknown as Mov[];
    const tz = ctx.org.timezone;

    return {
      ok: true,
      data: {
        texto,
        ...(account ? { cuenta: account.name } : {}),
        encontrados: total,
        totales: (totals ?? []).map((t) => ({
          moneda: t.currency,
          entro: money(t.in, t.currency),
          salio: money(t.out, t.currency),
          movimientos: t.count_in + t.count_out,
        })),
        ...(dir ? { nota: "Los totales suman entradas y salidas de todo lo encontrado, sin el filtro de dirección." } : {}),
        movimientos: rows.slice(0, 30).map((m) => movementData(m, tz)),
      },
      card: {
        kind: "list",
        title: total ? `«${texto}» en Caja (${total})` : `«${texto}» en Caja`,
        icon: "search",
        rows: rows.slice(0, 12).map((m) => movementRow(m, tz, ctx.today)),
        more: Math.max(0, total - Math.min(12, rows.length)),
        empty: "No hay movimientos con ese texto.",
        footer: { label: "Buscar en Caja", href: `${hrefs.cash()}?q=${encodeURIComponent(texto)}` },
      },
    };
  },
});

export const cuotasPorCobrar = defineRead({
  name: "cuotas_por_cobrar",
  label: "Mirando las cuotas…",
  description:
    "Las cuotas de alquileres mensuales que falta cobrar: las vencidas (siempre) y las que vencen en los próximos días. " +
    "Usala para «¿quién debe el alquiler?», «¿qué cuotas vencen esta semana?». No cuenta cuotas de reservas canceladas ni de reservas " +
    "que ya figuran cobradas enteras (hay quien cobra sobre la reserva y no marca cada cuota).",
  input: z.object({
    dias: z.number().int().min(1).max(120).describe("Cuántos días para adelante mirar (por defecto 14).").optional(),
  }),
  resource: "payments",
  action: "view",
  async run(input, ctx) {
    const dias = input.dias ?? 14;
    const r = await attempt(() => listUpcomingSchedule(dias));
    if (!r.ok) return r;
    const horizon = addDaysYmd(ctx.today, dias);
    let canceladas = 0;
    let yaCobradas = 0;
    const items = r.value
      .filter((s) => {
        const b = s.booking;
        if (b && isDeadBooking(b.status)) {
          canceladas++;
          return false;
        }
        if (b && num(b.total_amount) > 0 && num(b.paid_amount) >= num(b.total_amount)) {
          yaCobradas++;
          return false;
        }
        return s.status !== "paid" && s.status !== "cancelled" && s.due_date <= horizon;
      })
      .map((s) => ({ s, falta: round2(Math.max(0, num(s.expected_amount) - num(s.paid_amount))), vencida: s.due_date < ctx.today }))
      .filter((x) => x.falta > 0.004)
      .sort((a, b) => a.s.due_date.localeCompare(b.s.due_date));
    const vencidas = items.filter((x) => x.vencida);
    const porVencer = items.filter((x) => !x.vencida);
    const totalOf = (xs: typeof items) => moneyByCurrency(sumByCurrency(xs, (x) => x.falta, (x) => x.s.currency));

    return {
      ok: true,
      data: {
        hasta: horizon,
        vencidas: vencidas.length,
        total_vencido: totalOf(vencidas),
        por_vencer: porVencer.length,
        total_por_vencer: totalOf(porVencer),
        ...(yaCobradas ? { omitidas_reserva_ya_cobrada: yaCobradas } : {}),
        ...(canceladas ? { omitidas_reserva_cancelada: canceladas } : {}),
        cuotas: items.slice(0, 40).map((x) => ({
          reserva_id: x.s.booking_id,
          inquilino: x.s.booking?.guest?.full_name ?? "Sin nombre",
          unidad: unitLabel(x.s.booking?.unit),
          cuota: `${x.s.sequence_number}/${x.s.total_count}`,
          vence: x.s.due_date,
          falta: money(x.falta, x.s.currency),
          ...(x.vencida ? { vencida: true, dias_de_atraso: nightsBetween(x.s.due_date, ctx.today) } : {}),
        })),
      },
      card: {
        kind: "list",
        title: items.length ? `Cuotas por cobrar (${items.length})` : "Cuotas por cobrar",
        icon: "wallet",
        rows: items.slice(0, 12).map((x) => ({
          title: x.s.booking?.guest?.full_name ?? "Sin nombre",
          subtitle: `${x.s.booking?.unit?.code ?? "Sin unidad"} · cuota ${x.s.sequence_number} de ${x.s.total_count}`,
          meta: shortDate(x.s.due_date, ctx.today),
          badge: x.vencida
            ? { label: "Vencida", tone: "bad" }
            : x.s.due_date === ctx.today
              ? { label: "Vence hoy", tone: "warn" }
              : undefined,
          amount: { value: money(x.falta, x.s.currency), tone: x.vencida ? "bad" : undefined },
          href: hrefs.booking(x.s.booking_id),
        })),
        more: Math.max(0, items.length - 12),
        empty: `No hay cuotas por cobrar hasta el ${shortDate(horizon, ctx.today)}.`,
      },
    };
  },
});
