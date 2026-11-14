/**
 * `registrar_gasto`: propone un egreso de Caja (gasto corriente) que la
 * persona confirma. Envuelve `registerExpense` (src/lib/actions/cash.ts), el
 * mismo del botón "Registrar gasto" del inicio: la cuenta por defecto es la de
 * gastos corrientes y la moneda sale de la cuenta.
 */
import { z } from "zod/v4";
import { registerExpense } from "@/lib/actions/cash";
import { attempt, defineWrite, hrefs } from "../tool";
import { clip, money } from "../format";
import { resolveAccount, resolveUnit } from "./_resolve";

const CATEGORY = {
  servicios: "utilities",
  insumos: "supplies",
  sueldos: "salary",
  impuestos: "tax",
  mantenimiento: "maintenance",
  limpieza: "cleaning",
  otro: "other",
} as const;
type CategoryEs = keyof typeof CATEGORY;

const CATEGORY_LABEL: Record<CategoryEs, string> = {
  servicios: "Servicios (luz, gas, internet)",
  insumos: "Insumos",
  sueldos: "Sueldos",
  impuestos: "Impuestos",
  mantenimiento: "Mantenimiento",
  limpieza: "Limpieza",
  otro: "Otro",
};

const payloadSchema = z.object({
  amount: z.number().positive(),
  category: z.enum(["utilities", "supplies", "salary", "tax", "maintenance", "cleaning", "other"]),
  account_id: z.guid(),
  unit_id: z.guid().nullable(),
  billable_to: z.enum(["apartcba", "owner"]),
  description: z.string().max(300).nullable(),
});

export const registrarGasto = defineWrite({
  name: "registrar_gasto",
  label: "Preparando el gasto…",
  description:
    "Prepara un GASTO (egreso) de Caja para que la persona lo confirme con un botón: no se registra hasta que confirma. " +
    "Por defecto sale de la cuenta de gastos corrientes. Si se imputa a una unidad y es a cargo del propietario, se le " +
    "descuenta en su liquidación. Para cobros de reservas usá registrar_cobro, no esto.",
  input: z.object({
    monto: z.number().positive().describe("Importe positivo."),
    moneda: z
      .enum(["ARS", "USD", "EUR", "BRL"])
      .describe("Moneda del gasto si la persona la dijo (US$, dólares → USD). Si no la dijo, omitir: sale de la cuenta.")
      .optional(),
    categoria: z
      .enum(["servicios", "insumos", "sueldos", "impuestos", "mantenimiento", "limpieza", "otro"])
      .describe("servicios = luz/gas/agua/internet/expensas; insumos = compras para los deptos."),
    detalle: z.string().max(300).describe("Qué fue, en pocas palabras (ej. «Productos de limpieza Día»).").optional(),
    cuenta: z
      .string()
      .describe("Nombre de la cuenta de Caja si la persona la dijo (ej. «Caja chica», «Mercado Pago»). Si no, omitir.")
      .optional(),
    unidad: z.string().describe("Código o nombre de la unidad si el gasto es de un depto puntual.").optional(),
    a_cargo_del_propietario: z
      .boolean()
      .describe("true si el gasto se le descuenta al propietario en la liquidación (requiere unidad).")
      .optional(),
  }),
  payload: payloadSchema,
  resource: "cash",
  action: "create",
  async propose(input) {
    const account = await resolveAccount(input.cuenta, { currency: input.moneda, preferExpenseDefault: true });
    if (account.ok !== true) return account;

    let unit: { id: string; code: string; name: string } | null = null;
    if (input.unidad) {
      const u = await resolveUnit(input.unidad);
      if (u.ok !== true) return u;
      unit = u.value;
    }
    const ownerPays = Boolean(input.a_cargo_del_propietario);
    if (ownerPays && !unit) {
      return { ok: false, error: "Para cargárselo al propietario necesito saber de qué unidad es el gasto." };
    }

    const description = clip(input.detalle, 300) ?? null;
    const a = account.value;
    return {
      ok: true,
      payload: {
        amount: Math.round(input.monto * 100) / 100,
        category: CATEGORY[input.categoria],
        account_id: a.id,
        unit_id: unit?.id ?? null,
        billable_to: ownerPays ? ("owner" as const) : ("apartcba" as const),
        description,
      },
      summary: {
        title: "Registrar un gasto",
        lines: [
          { label: "Importe", value: money(input.monto, a.currency) },
          { label: "Categoría", value: CATEGORY_LABEL[input.categoria] },
          { label: "Sale de", value: `${a.name} (${a.currency})` },
          ...(unit ? [{ label: "Unidad", value: `${unit.code} · ${unit.name}` }] : []),
          ...(unit ? [{ label: "A cargo de", value: ownerPays ? "El propietario (va a su liquidación)" : "Apart" }] : []),
          ...(description ? [{ label: "Detalle", value: description }] : []),
        ],
        confirmLabel: "Registrar gasto",
      },
    };
  },
  async execute(p) {
    const r = await attempt(() =>
      registerExpense({
        amount: p.amount,
        category: p.category,
        account_id: p.account_id,
        unit_id: p.unit_id,
        billable_to: p.billable_to,
        description: p.description,
      }),
    );
    if (!r.ok) return r;
    const mv = r.value as { id?: string; currency?: string } | null;
    return {
      ok: true,
      message: `Gasto registrado: ${money(p.amount, mv?.currency ?? "ARS")}.`,
      href: hrefs.cashAccount(p.account_id),
      data: { movimiento_id: mv?.id ?? null },
    };
  },
});
