import type { RentalStatementLineType, RentalStatementStatus } from "@/lib/types/database";
import { formatMoney } from "@/lib/format";
import { formatContractNumber, formatStatementNumber, monthLabelOf, statementStatusMeta, type StatusMeta } from "@/lib/rentals/labels";

/**
 * Modelo del documento "Rendición al propietario" (puro, sin DB).
 *
 * Lo comparten el detalle del panel, el link público, el PDF y el mail: los
 * cuatro tienen que mostrar EXACTAMENTE lo mismo. Agrupa los renglones por
 * propiedad (con subtotales), limpia la dirección repetida de cada renglón y
 * deja los totales de la cabecera (los recalcula la base al generar).
 */

export const STATEMENT_LINE_META: Record<RentalStatementLineType, StatusMeta> = {
  cobro_alquiler: { label: "Alquiler cobrado", color: "#10b981" },
  cobro_punitorio: { label: "Intereses por mora", color: "#14b8a6" },
  cobro_otro: { label: "Otro cobro", color: "#22c55e" },
  honorarios_administracion: { label: "Honorarios de administración", color: "#7c3aed" },
  iva_honorarios: { label: "IVA de honorarios", color: "#a78bfa" },
  comision_locacion: { label: "Honorarios por la locación", color: "#a855f7" },
  gasto: { label: "Gasto", color: "#06b6d4" },
  ajuste: { label: "Ajuste", color: "#64748b" },
};

const LINE_RANK: Record<RentalStatementLineType, number> = {
  cobro_alquiler: 0,
  cobro_punitorio: 0,
  cobro_otro: 0,
  honorarios_administracion: 1,
  iva_honorarios: 2,
  comision_locacion: 3,
  gasto: 4,
  ajuste: 5,
};

export interface StatementHeaderInput {
  id: string;
  number: number;
  status: RentalStatementStatus;
  currency: string;
  cutoff_date: string;
  collected_amount: number;
  fees_amount: number;
  vat_amount: number;
  expenses_amount: number;
  other_amount: number;
  net_amount: number;
  generated_at: string;
  sent_at: string | null;
  sent_to: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
}

export interface StatementLineInput {
  id: string;
  line_type: RentalStatementLineType;
  sign: number;
  amount: number;
  description: string;
  contract_id: string | null;
  property_id: string | null;
  share_pct: number;
  sort_order: number;
}

export interface StatementOwnerInput {
  full_name: string;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  cbu: string | null;
  alias_cbu: string | null;
}

export interface PropertyRef {
  id: string;
  label: string;
  code: string | null;
}

export interface ContractRef {
  id: string;
  number: number;
  tenantName: string | null;
}

export interface StatementPaymentRef {
  accountName: string;
  amount: number;
}

export interface StatementLineView {
  id: string;
  lineType: RentalStatementLineType;
  kindLabel: string;
  color: string;
  description: string;
  sign: 1 | -1;
  amount: number;
  /** Con signo: + suma al propietario, − descuenta. */
  signedAmount: number;
  contractNumber: string | null;
}

export interface StatementGroupContract {
  number: string;
  tenantName: string | null;
}

export interface StatementGroup {
  key: string;
  propertyId: string | null;
  label: string;
  code: string | null;
  contracts: StatementGroupContract[];
  /** % de titularidad cuando el propietario no es único dueño. */
  sharePct: number | null;
  lines: StatementLineView[];
  subtotal: { collected: number; deductions: number; net: number };
}

export interface StatementDocModel {
  id: string;
  number: string;
  status: RentalStatementStatus;
  statusLabel: string;
  statusColor: string;
  currency: string;
  cutoffDate: string;
  periodLabel: string;
  owner: StatementOwnerInput;
  totals: { collected: number; fees: number; vat: number; expenses: number; other: number; net: number };
  groups: StatementGroup[];
  collectedCount: number;
  generatedAt: string;
  sentAt: string | null;
  sentTo: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  notes: string | null;
  payments: StatementPaymentRef[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Saca la dirección repetida del final ("… — Dean Funes 450 · 3°B") cuando el renglón ya está bajo esa propiedad. */
export function stripPropertySuffix(description: string, label: string | null): string {
  if (!label) return description;
  for (const sep of [" — ", " · "]) {
    const suffix = `${sep}${label}`;
    if (description.endsWith(suffix) && description.length > suffix.length) return description.slice(0, -suffix.length);
  }
  return description;
}

export function buildStatementDoc(input: {
  header: StatementHeaderInput;
  lines: StatementLineInput[];
  owner: StatementOwnerInput;
  properties: PropertyRef[];
  contracts: ContractRef[];
  payments?: StatementPaymentRef[];
}): StatementDocModel {
  const { header } = input;
  const propertyById = new Map(input.properties.map((p) => [p.id, p]));
  const contractById = new Map(input.contracts.map((c) => [c.id, c]));
  const groups = new Map<string, StatementGroup>();
  const contractIdsByGroup = new Map<string, string[]>();

  const sorted = [...input.lines].sort(
    (a, b) => LINE_RANK[a.line_type] - LINE_RANK[b.line_type] || a.sort_order - b.sort_order,
  );
  for (const l of sorted) {
    const prop = l.property_id ? propertyById.get(l.property_id) ?? null : null;
    const key = prop ? prop.id : "general";
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        propertyId: prop?.id ?? null,
        label: prop?.label ?? "Otros conceptos",
        code: prop?.code ?? null,
        contracts: [],
        sharePct: null,
        lines: [],
        subtotal: { collected: 0, deductions: 0, net: 0 },
      };
      groups.set(key, g);
      contractIdsByGroup.set(key, []);
    }
    const sign: 1 | -1 = l.sign < 0 ? -1 : 1;
    const amount = round2(Number(l.amount));
    const contract = l.contract_id ? contractById.get(l.contract_id) ?? null : null;
    if (contract && !contractIdsByGroup.get(key)!.includes(contract.id)) {
      contractIdsByGroup.get(key)!.push(contract.id);
      g.contracts.push({ number: formatContractNumber(contract.number), tenantName: contract.tenantName });
    }
    const pct = Number(l.share_pct);
    if (pct > 0 && pct < 100) g.sharePct = pct;
    const meta = STATEMENT_LINE_META[l.line_type] ?? STATEMENT_LINE_META.ajuste;
    g.lines.push({
      id: l.id,
      lineType: l.line_type,
      kindLabel: meta.label,
      color: meta.color,
      description: stripPropertySuffix(l.description, prop?.label ?? null),
      sign,
      amount,
      signedAmount: sign * amount,
      contractNumber: contract ? formatContractNumber(contract.number) : null,
    });
    if (l.line_type.startsWith("cobro_")) g.subtotal.collected = round2(g.subtotal.collected + sign * amount);
    else if (sign < 0) g.subtotal.deductions = round2(g.subtotal.deductions + amount);
    g.subtotal.net = round2(g.subtotal.net + sign * amount);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.key === "general") return 1;
    if (b.key === "general") return -1;
    return a.label.localeCompare(b.label, "es");
  });
  const meta = statementStatusMeta(header.status, round2(Number(header.net_amount)));
  return {
    id: header.id,
    number: formatStatementNumber(header.number),
    status: header.status,
    statusLabel: meta.label,
    statusColor: meta.color,
    currency: header.currency,
    cutoffDate: header.cutoff_date,
    periodLabel: monthLabelOf(header.cutoff_date),
    owner: input.owner,
    totals: {
      collected: round2(Number(header.collected_amount)),
      fees: round2(Number(header.fees_amount)),
      vat: round2(Number(header.vat_amount)),
      expenses: round2(Number(header.expenses_amount)),
      other: round2(Number(header.other_amount)),
      net: round2(Number(header.net_amount)),
    },
    groups: ordered,
    collectedCount: input.lines.filter((l) => l.line_type.startsWith("cobro_")).length,
    generatedAt: header.generated_at,
    sentAt: header.sent_at,
    sentTo: header.sent_to,
    paidAt: header.paid_at,
    voidedAt: header.voided_at,
    voidReason: header.void_reason,
    notes: header.notes,
    payments: input.payments ?? [],
  };
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/**
 * Mensaje para mandar por WhatsApp (sin emojis: iOS los rompe en `?text=`).
 * Si el neto no es positivo, no promete transferencia.
 */
export function statementWhatsappText(model: Pick<StatementDocModel, "number" | "periodLabel" | "currency" | "totals" | "owner" | "status">, url: string, orgName: string): string {
  const hello = `Hola ${firstName(model.owner.full_name)}, te paso la rendición N° ${model.number} (${model.periodLabel}) de ${orgName}.`;
  const net = model.totals.net;
  const money = formatMoney(Math.abs(net), model.currency);
  const body =
    net > 0
      ? model.status === "pagada"
        ? `Neto transferido: ${money}.`
        : `Neto a transferirte: ${money}.`
      : net < 0
        ? `Este período los gastos superaron lo cobrado: quedan ${money} a tu cargo, que se descuentan de tu próxima rendición.`
        : "Este período no hay saldo para transferir.";
  return `${hello}\n${body}\nAcá ves el detalle y podés bajar el PDF: ${url}`;
}

export interface SplitDraft {
  accountId: string;
  amount: number | null;
}

/**
 * Valida el pago dividido de una rendición: cada cuenta una vez, importes
 * positivos y la suma igual al neto (tolerancia de un centavo, igual que la base).
 */
export function validateSplits(splits: SplitDraft[], net: number, currency = "ARS"): { ok: true; total: number } | { ok: false; error: string; total: number } {
  const total = round2(splits.reduce((s, x) => s + (x.amount && x.amount > 0 ? x.amount : 0), 0));
  if (!splits.length) return { ok: false, error: "Elegí al menos una cuenta.", total };
  const seen = new Set<string>();
  for (const s of splits) {
    if (!s.accountId) return { ok: false, error: "Elegí la cuenta de cada pago.", total };
    if (seen.has(s.accountId)) return { ok: false, error: "Repetiste una cuenta: juntá esos importes en una sola fila.", total };
    seen.add(s.accountId);
    if (s.amount == null || !(s.amount > 0)) return { ok: false, error: "Cada cuenta tiene que tener un importe mayor a cero.", total };
  }
  const diff = round2(net - total);
  if (Math.abs(diff) > 0.01) {
    return {
      ok: false,
      error: diff > 0 ? `Faltan asignar ${formatMoney(diff, currency)} para llegar al neto.` : `Te pasaste por ${formatMoney(-diff, currency)} del neto.`,
      total,
    };
  }
  return { ok: true, total };
}
