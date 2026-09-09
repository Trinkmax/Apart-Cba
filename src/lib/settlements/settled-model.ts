import type { SettlementLine, SettlementStatus } from "@/lib/types/database";

/**
 * Pivotea las liquidaciones de un mes a "lo que realmente pasó", por
 * departamento y por propietario. Es la fuente de Resultados > Liquidado.
 *
 * Por qué existe (y por qué no alcanza con proyectar desde `bookings`):
 * Resultados calcula el mes *estimando* desde las reservas. La liquidación es
 * el hecho consumado: lleva los ajustes manuales, los gastos que el operador
 * cargó a mano y los egresos de Caja imputados al propietario. Para responder
 * "¿cuánto le transferimos y cuánto le descontamos?" el único dato honesto es
 * el documento firmado, no la proyección.
 *
 * TRES REGLAS QUE NO SE PUEDEN VIOLAR (verificadas contra los datos reales):
 *
 * 1. **La aritmética la manda `sign`, NUNCA `line_type`.** En producción hay
 *    198 líneas `expenses_fraction` con signo `+` — "LUZ", "AGUA", "GAS",
 *    "EXPENSAS", "MUNICIPALIDAD": servicios que el inquilino reembolsa y que
 *    se le transfieren al dueño, ~$11,7M que SUMAN. Clasificar "gasto" por
 *    `line_type IN (maintenance_charge, expenses_fraction, adjustment)` los
 *    restaría. `adjustment` también aparece con los dos signos. Sólo
 *    `commission` y `channel_commission` son confiables como tipo, y sólo
 *    para separar la columna: al neto entran por su signo igual que el resto.
 *
 * 2. **`settlement_lines.unit_id` es la ÚNICA fuente de la unidad.** No
 *    reconstruir desde `bookings` vía `ref_id`: no tiene FK y está roto en 132
 *    de 540 líneas (la reserva se borró y la línea quedó apuntando al vacío),
 *    y donde funciona es redundante porque esas líneas ya traen `unit_id`.
 *
 * 3. **Los totales de la cabecera son cache y están desincronizados** en
 *    varias liquidaciones (`deductions_amount` en 0 con líneas `-` presentes).
 *    Todo se recalcula desde las líneas.
 *
 * Multi-moneda: cada línea trae su moneda nativa y se convierte a la base del
 * documento con `exchange_rates`. Sin tasa cargada la conversión da 0 — el
 * "silent-zero" conocido —, así que la moneda se reporta en `missing_rates`
 * para que la UI avise en vez de mostrar un cero que parece un dato.
 */

export type SettledLineInput = Pick<
  SettlementLine,
  "line_type" | "amount" | "sign" | "unit_id"
> & {
  currency?: string | null;
  /** `'booking'` en las líneas de reserva; sirve para la reconciliación. */
  ref_type?: string | null;
  ref_id?: string | null;
  unit?: { id: string; code: string; name: string } | null;
};

export interface SettledSettlementInput {
  id: string;
  status: SettlementStatus;
  /** Moneda BASE del documento — en la que se totaliza. */
  currency: string;
  exchange_rates?: Record<string, number> | null;
  paid_at?: string | null;
  owner: { id: string; full_name: string } | null;
  lines: SettledLineInput[];
}

/** Los bolsillos de un bloque liquidado, siempre en moneda base. */
export interface SettledAmounts {
  /**
   * Todo lo que suma. Es el mismo `gross_revenue` que imprime el documento del
   * propietario, así que incluye los servicios que el inquilino reembolsa —
   * divergir del PDF sería la peor confusión posible. El desglose está en
   * `reimbursements`.
   */
  gross: number;
  /**
   * Parte de `gross` que NO es alquiler: luz, gas, agua, expensas y municipales
   * que el inquilino reembolsa y se le giran al dueño. Se muestra aparte
   * porque, contado como venta, infla el bruto y hace parecer más chica la
   * comisión.
   */
  reimbursements: number;
  /** Comisión de la administración (`line_type='commission'`). */
  commission: number;
  /** Comisión de plataforma (`line_type='channel_commission'`). */
  channel: number;
  /** Todo lo demás que resta: limpieza, mantenimiento, expensas, ajustes. */
  expenses: number;
  /** gross − commission − channel − expenses. Lo que se le transfiere. */
  net: number;
}

export interface SettledUnitRow extends SettledAmounts {
  /** `null` = líneas que nadie imputó a una unidad y no se pudieron inferir. */
  unit_id: string | null;
  unit_code: string;
  unit_name: string;
  currency: string;
  /**
   * Dueños del departamento en el mes. Una unidad con co-propietarios se
   * liquida en un documento por cabeza; acá se suma, porque la pregunta
   * "cuánto produjo este depto" no depende de entre cuántos se reparte.
   */
  owners: Array<{ owner_id: string | null; owner_name: string }>;
  /** Liquidaciones que aportaron a esta fila (1 salvo co-propiedad). */
  settlement_ids: string[];
  /** true si algún importe llegó acá por la regla de "única unidad del documento". */
  inferred: boolean;
}

export interface SettledOwnerRow extends SettledAmounts {
  owner_id: string | null;
  owner_name: string;
  currency: string;
  settlement_id: string;
  status: SettlementStatus;
  paid_at: string | null;
  /** Códigos de las unidades que aparecen en el documento, ordenados. */
  unit_codes: string[];
  /** Monedas de líneas sin tipo de cambio cargado: sus importes cuentan 0. */
  missing_rates: string[];
}

export interface SettledTotals extends SettledAmounts {
  currency: string;
  settlements: number;
  /** Cuántas liquidaciones ya se pagaron (`paid_at`). */
  paid: number;
  /**
   * Neto de las liquidaciones ya pagadas. `net` es el total a girar; esto es
   * lo que efectivamente salió. En producción casi todas las liquidaciones
   * están en 'revisada', así que llamar "transferido" al total sería falso.
   */
  net_paid: number;
}

export interface SettledResults {
  totals: SettledTotals[];
  by_unit: SettledUnitRow[];
  by_owner: SettledOwnerRow[];
  /** Importe neto que quedó en el bucket "Sin asignar" (por moneda base). */
  unassigned_net: number;
  /** Cuántas liquidaciones tienen algo sin imputar a una unidad. */
  unassigned_settlements: number;
  /** Monedas sin TC en alguna liquidación del mes. */
  missing_rates: string[];
  /**
   * `booking_id` de todas las reservas que aparecen en alguna liquidación. La
   * página lo cruza con las reservas del mes para detectar las que quedaron
   * afuera — el hueco silencioso entre la proyección y lo liquidado.
   */
  booking_ref_ids: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const REVENUE_TYPES = new Set(["booking_revenue", "monthly_rent_fraction"]);

function emptyAmounts(): SettledAmounts {
  return { gross: 0, reimbursements: 0, commission: 0, channel: 0, expenses: 0, net: 0 };
}

/**
 * Suma una línea ya convertida a moneda base en el bolsillo que le toca.
 * `sign` decide el aporte al neto; el `line_type` sólo elige en qué columna de
 * descuento se muestra (ver regla 1 del encabezado).
 */
function addLine(
  acc: SettledAmounts,
  lineType: SettlementLine["line_type"],
  sign: "+" | "-",
  amountInBase: number,
): void {
  if (sign === "+") {
    acc.gross += amountInBase;
    acc.net += amountInBase;
    if (!REVENUE_TYPES.has(lineType)) acc.reimbursements += amountInBase;
    return;
  }
  acc.net -= amountInBase;
  if (lineType === "commission") acc.commission += amountInBase;
  else if (lineType === "channel_commission") acc.channel += amountInBase;
  else acc.expenses += amountInBase;
}

function roundAmounts(a: SettledAmounts): void {
  a.gross = round2(a.gross);
  a.reimbursements = round2(a.reimbursements);
  a.commission = round2(a.commission);
  a.channel = round2(a.channel);
  a.expenses = round2(a.expenses);
  a.net = round2(a.net);
}

/**
 * Convierte a la moneda base del documento. Sin tasa devuelve 0 y avisa: es el
 * mismo criterio que `computeTotals` en settlements.ts, así que los totales de
 * esta vista y los del documento coinciden exactamente (incluso en el error).
 */
function convertToBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  rates: Record<string, number>,
): { value: number; missingRate: boolean } {
  if (currency === baseCurrency) return { value: amount, missingRate: false };
  const rate = Number(rates?.[currency] ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return { value: 0, missingRate: true };
  return { value: amount * rate, missingRate: false };
}

/**
 * Unidad a la que imputar una línea que vino sin `unit_id`.
 *
 * En producción el 12% de las líneas de gasto se cargan a mano sin elegir
 * unidad, pero el 93% de ésas viven en liquidaciones de una sola unidad: ahí
 * no hay ambigüedad posible y adivinarlo es correcto, no una heurística.
 * Con dos o más unidades NO se prorratea ni se elige una: el importe va al
 * bucket "Sin asignar" y la UI lo muestra, porque inventar el reparto de un
 * gasto entre departamentos de un mismo dueño es peor que no saberlo.
 */
function soleUnitOf(lines: SettledLineInput[]): string | null {
  const ids = new Set<string>();
  for (const l of lines) if (l.unit_id) ids.add(l.unit_id);
  return ids.size === 1 ? [...ids][0] : null;
}

export function buildSettledResults(
  settlements: SettledSettlementInput[],
): SettledResults {
  const unitMap = new Map<string, SettledUnitRow>();
  const ownerRows: SettledOwnerRow[] = [];
  const totalsByCurrency = new Map<string, SettledTotals>();
  const missingRatesAll = new Set<string>();
  const bookingRefIds = new Set<string>();
  let unassignedNet = 0;
  let unassignedSettlements = 0;

  for (const s of settlements) {
    const base = s.currency;
    const rates = s.exchange_rates ?? {};
    const ownerId = s.owner?.id ?? null;
    const ownerName = s.owner?.full_name ?? "Propietario";
    // Con una sola unidad en el documento, lo que vino sin imputar es de ella.
    const fallbackUnitId = soleUnitOf(s.lines);

    const ownerAcc: SettledOwnerRow = {
      ...emptyAmounts(),
      owner_id: ownerId,
      owner_name: ownerName,
      currency: base,
      settlement_id: s.id,
      status: s.status,
      paid_at: s.paid_at ?? null,
      unit_codes: [],
      missing_rates: [],
    };
    const unitCodes = new Set<string>();
    const missingRates = new Set<string>();
    let docUnassignedNet = 0;

    for (const l of s.lines) {
      const raw = Number(l.amount);
      if (!Number.isFinite(raw)) continue;
      if (l.ref_type === "booking" && l.ref_id) bookingRefIds.add(l.ref_id);
      const lineCurrency = l.currency ?? base;
      const { value, missingRate } = convertToBase(raw, lineCurrency, base, rates);
      if (missingRate) {
        missingRates.add(lineCurrency);
        missingRatesAll.add(lineCurrency);
      }

      // Imputación: la unidad propia, si no la única del documento, si no nada.
      const inferred = !l.unit_id && fallbackUnitId !== null;
      const unitId = l.unit_id ?? fallbackUnitId;
      // Una línea inferida no trae su `unit` embebido: el código/nombre se
      // toman de cualquier otra línea de esa misma unidad (siempre hay una,
      // porque el fallback existe justamente porque el documento tiene una).
      const embedded = l.unit ?? null;

      // Una fila por departamento y moneda: con co-propiedad la unidad viene
      // en dos documentos y las dos mitades son el mismo departamento.
      const key = `${unitId ?? "__none__"}|${base}`;
      let row = unitMap.get(key);
      if (!row) {
        row = {
          ...emptyAmounts(),
          unit_id: unitId,
          unit_code: embedded?.code ?? (unitId ? "—" : "Sin asignar"),
          unit_name: embedded?.name ?? (unitId ? "" : "Cargos sin departamento"),
          currency: base,
          owners: [],
          settlement_ids: [],
          inferred: false,
        };
        unitMap.set(key, row);
      }
      // El nombre real gana sobre el placeholder que dejó una línea inferida.
      if (embedded && row.unit_code === "—") {
        row.unit_code = embedded.code;
        row.unit_name = embedded.name;
      }
      if (inferred) row.inferred = true;
      if (!row.settlement_ids.includes(s.id)) row.settlement_ids.push(s.id);
      if (!row.owners.some((o) => o.owner_id === ownerId)) {
        row.owners.push({ owner_id: ownerId, owner_name: ownerName });
      }
      if (unitId && embedded) unitCodes.add(embedded.code);

      addLine(row, l.line_type, l.sign, value);
      addLine(ownerAcc, l.line_type, l.sign, value);
      if (!unitId) docUnassignedNet += l.sign === "+" ? value : -value;
    }

    if (docUnassignedNet !== 0) {
      unassignedNet += docUnassignedNet;
      unassignedSettlements += 1;
    }

    ownerAcc.unit_codes = [...unitCodes].sort();
    ownerAcc.missing_rates = [...missingRates].sort();
    roundAmounts(ownerAcc);
    ownerRows.push(ownerAcc);

    const t =
      totalsByCurrency.get(base) ??
      ({
        ...emptyAmounts(),
        currency: base,
        settlements: 0,
        paid: 0,
        net_paid: 0,
      } as SettledTotals);
    t.gross += ownerAcc.gross;
    t.reimbursements += ownerAcc.reimbursements;
    t.commission += ownerAcc.commission;
    t.channel += ownerAcc.channel;
    t.expenses += ownerAcc.expenses;
    t.net += ownerAcc.net;
    t.settlements += 1;
    if (s.paid_at) {
      t.paid += 1;
      t.net_paid += ownerAcc.net;
    }
    totalsByCurrency.set(base, t);
  }

  const byUnit = [...unitMap.values()];
  for (const r of byUnit) roundAmounts(r);
  for (const t of totalsByCurrency.values()) {
    roundAmounts(t);
    t.net_paid = round2(t.net_paid);
  }

  return {
    totals: [...totalsByCurrency.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    // Por bruto desc: el depto que más produjo, arriba. Los "Sin asignar"
    // ordenan solos al final porque casi nunca tienen ingresos.
    by_unit: byUnit.sort((a, b) => b.gross - a.gross || b.net - a.net),
    by_owner: ownerRows.sort((a, b) => b.net - a.net),
    unassigned_net: round2(unassignedNet),
    unassigned_settlements: unassignedSettlements,
    missing_rates: [...missingRatesAll].sort(),
    booking_ref_ids: [...bookingRefIds],
  };
}
