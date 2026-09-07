/**
 * Economía de una reserva — fuente única de verdad.
 *
 * Reglas (compartidas por el form de reserva, el detalle, las liquidaciones y
 * la página de Resultados; si cambian, cambian acá y en ningún otro lado):
 *
 *   total        = lo que paga el huésped, TODO incluido (alojamiento + limpieza).
 *   alojamiento  = total − limpieza.
 *   canal        = total × channel_commission_pct   (lo que se lleva Booking / Airbnb…)
 *   base         = total                          si commission_base = 'gross'
 *                = total − canal                   si commission_base = 'net_of_channel'
 *   comisión     = base × commission_pct           (lo que cobra la administración)
 *   neto dueño   = total − canal − comisión − limpieza
 *
 * La limpieza NO va al propietario: la cobra la administración dentro del total
 * y con eso paga a quien limpia. Por eso se descuenta al final igual que la
 * comisión.
 *
 * Todo es puro y sin dependencias: se puede usar en cliente y servidor.
 */

export type CommissionBase = "gross" | "net_of_channel";

export const DEFAULT_COMMISSION_BASE: CommissionBase = "net_of_channel";

export const COMMISSION_BASE_META: Record<
  CommissionBase,
  { label: string; description: string }
> = {
  net_of_channel: {
    label: "Sobre lo que queda después de la plataforma",
    description:
      "Comisión = (total − comisión del canal) × %. Es lo habitual: la plataforma cobra primero y vos cobrás sobre lo que efectivamente entra.",
  },
  gross: {
    label: "Sobre el total que paga el huésped",
    description:
      "Comisión = total × %. La comisión de la plataforma se descuenta aparte al propietario.",
  },
};

export interface BookingEconomicsInput {
  /** Lo que paga el huésped, con limpieza incluida. */
  total: number | null | undefined;
  /** Fee de limpieza incluido en `total`. */
  cleaningFee?: number | null;
  /** % que se lleva la plataforma (Booking, Airbnb…). null/undefined = 0. */
  channelPct?: number | null;
  /** % de comisión de administración. null/undefined = 0. */
  commissionPct?: number | null;
  commissionBase?: CommissionBase | null;
  /**
   * Participación del propietario (0–1). Sólo la liquidación lo usa para
   * prorratear entre co-dueños; default 1.
   */
  ownerShare?: number;
}

export interface BookingEconomics {
  total: number;
  lodging: number;
  cleaning: number;
  channelPct: number;
  channelCommission: number;
  commissionPct: number;
  commissionBase: CommissionBase;
  /** Importe sobre el que se aplicó `commissionPct`. */
  commissionBaseAmount: number;
  commission: number;
  /** total − canal − comisión − limpieza. */
  ownerNet: number;
  /** Lo que queda en la administración: comisión + limpieza. */
  managerGross: number;
}

/**
 * Redondeo a 2 decimales igual que Postgres `numeric(14,2)` (mitad hacia afuera
 * sobre la representación DECIMAL). Redondear `n * 100` en binario falla justo
 * en los .xx5: 27 × 17,5 % = 4.725 → 472.49999… → 4,72, mientras la base
 * guardaba 4,73 cuando le llegaba el número sin redondear. Con la notación
 * exponencial ("4.725e2" → 472.5 exacto) el resultado coincide con lo que
 * siempre guardó la base. El signo va aparte porque Math.round(-472.5) tira
 * hacia +∞.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= 1e15) return Math.round(n * 100) / 100; // fuera de rango de dinero real
  const sign = n < 0 ? -1 : 1;
  return sign * Number(Math.round(Number(Math.abs(n) + "e2")) + "e-2");
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function computeBookingEconomics(input: BookingEconomicsInput): BookingEconomics {
  const share = input.ownerShare ?? 1;
  const total = round2(num(input.total) * share);
  // Sin tope en `total`: la limpieza es un costo real aunque el huésped haya
  // pagado menos (o $0, reserva de OTA sin precio). Es lo que descuenta la
  // liquidación; si acá se recortara, el detalle y Resultados dirían otra cosa.
  const cleaning = round2(num(input.cleaningFee) * share);
  const channelPct = clampPct(num(input.channelPct));
  const commissionPct = clampPct(num(input.commissionPct));
  const commissionBase: CommissionBase = input.commissionBase ?? DEFAULT_COMMISSION_BASE;

  // Mismo orden de multiplicación que la liquidación histórica (base × (pct/100)).
  const channelCommission = round2(total * (channelPct / 100));
  const commissionBaseAmount =
    commissionBase === "gross" ? total : round2(total - channelCommission);
  const commission = round2(commissionBaseAmount * (commissionPct / 100));
  const ownerNet = round2(total - channelCommission - commission - cleaning);

  return {
    total,
    lodging: round2(total - cleaning),
    cleaning,
    channelPct,
    channelCommission,
    commissionPct,
    commissionBase,
    commissionBaseAmount,
    commission,
    ownerNet,
    managerGross: round2(commission + cleaning),
  };
}

/** Comisión de canal de una reserva: total × pct. Para los caminos de escritura. */
export function channelCommissionAmount(
  total: number | null | undefined,
  pct: number | null | undefined
): number | null {
  if (pct === null || pct === undefined) return null;
  return round2(num(total) * (clampPct(num(pct)) / 100));
}

/** Comisión de administración de una reserva según la base configurada. */
export function managementCommissionAmount(input: {
  total: number | null | undefined;
  commissionPct: number | null | undefined;
  channelPct?: number | null;
  commissionBase?: CommissionBase | null;
}): number | null {
  if (input.commissionPct === null || input.commissionPct === undefined) return null;
  return computeBookingEconomics({
    total: input.total,
    commissionPct: input.commissionPct,
    channelPct: input.channelPct,
    commissionBase: input.commissionBase,
  }).commission;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

// ── Defaults por canal ───────────────────────────────────────────────────────

/** Mapa canal → % que guarda `organizations.channel_commissions`. */
export type ChannelCommissionMap = Partial<Record<string, number>>;

/** % default de la org para un canal de venta; 0 si no está configurado. */
export function channelCommissionPctFor(
  map: ChannelCommissionMap | null | undefined,
  source: string | null | undefined
): number {
  if (!map || !source) return 0;
  const raw = map[source];
  const n = Number(raw);
  return Number.isFinite(n) ? clampPct(n) : 0;
}

/** Normaliza lo que viene de un form: descarta vacíos, negativos y >100. */
export function normalizeChannelCommissionMap(
  input: Record<string, unknown> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = clampPct(round2(n));
  }
  return out;
}
