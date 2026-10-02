import type { RentalProofStatus, RentalServiceKind } from "@/lib/types/database";
import { SERVICE_KIND_META, monthLabelOf } from "@/lib/rentals/labels";
import { addMonthsToMonth, monthOf } from "@/lib/rentals/ymd";
import type { MissingProofKind, ProofCellState, ProofGridRow, ProofItem } from "./proof-types";

/**
 * Lógica pura de "Comprobantes": grilla meses × tipos, qué falta en un mes,
 * el mensaje para pedirlo por WhatsApp y formatos chicos. Sin I/O: la usan
 * las server actions y los componentes por igual (tests en __tests__/).
 */

/** Orden fijo de los tipos (el de SERVICE_KIND_META: expensas primero). */
export const PROOF_KIND_ORDER = Object.keys(SERVICE_KIND_META) as RentalServiceKind[];

export function isProofKind(v: unknown): v is RentalServiceKind {
  return typeof v === "string" && (PROOF_KIND_ORDER as string[]).includes(v);
}

export function sortKinds<T extends string>(kinds: Iterable<T>): T[] {
  const order = new Map(PROOF_KIND_ORDER.map((k, i) => [k as string, i]));
  return [...new Set(kinds)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** Los `count` meses anteriores + el actual, del más viejo al más nuevo (YYYY-MM-01). */
export function lastMonths(current: string, count: number): string[] {
  const base = monthOf(current);
  const out: string[] = [];
  for (let i = count; i >= 0; i--) out.push(addMonthsToMonth(base, -i));
  return out;
}

/** "YYYY-MM" (query string) → "YYYY-MM-01"; null si no es un mes válido. */
export function parseMonthParam(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return null;
  const m = Number(v.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return `${v}-01`;
}

const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "oct" (o "oct 26" si `withYear`). */
export function monthShort(month: string, withYear = false): string {
  const label = SHORT[Number(month.slice(5, 7)) - 1] ?? "?";
  return withYear ? `${label} ${month.slice(2, 4)}` : label;
}

/** "Octubre 2026" en minúscula para usar dentro de una frase ("de octubre 2026"). */
export function monthInSentence(month: string): string {
  const label = monthLabelOf(month);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Estados que cuentan como "ya lo tenemos" (no se pide de nuevo). */
const SETTLED: ReadonlySet<RentalProofStatus> = new Set(["validado", "en_revision", "no_corresponde"]);

export function cellStateOf(
  proof: Pick<ProofItem, "status"> | null,
  expected: boolean,
  inRange: boolean,
): ProofCellState {
  if (proof) {
    // Una fila pendiente es un pedido concreto (lo creó el cron o alguien del equipo).
    return proof.status === "pendiente" ? "falta" : proof.status;
  }
  if (!inRange) return "fuera";
  return expected ? "falta" : "no_pedido";
}

export interface GridInput {
  months: string[];
  /** Mes → tipos que se piden ese mes (vacío si el mes está fuera del contrato). */
  expectedByMonth: Record<string, string[]>;
  /** Mes → está dentro del período que se cobra. */
  inRangeByMonth: Record<string, boolean>;
  proofs: ProofItem[];
}

/**
 * Filas (un tipo por fila) con una celda por mes. Aparecen los tipos que se
 * piden en algún mes de la ventana y los que tienen alguna fila guardada
 * (aunque hoy ya no se pidan: el historial no se esconde).
 */
export function buildProofGrid(input: GridInput): ProofGridRow[] {
  const byKey = new Map(input.proofs.map((p) => [`${p.kind}|${monthOf(p.period)}`, p]));
  const kinds = sortKinds<RentalServiceKind>([
    ...input.months.flatMap((m) => (input.expectedByMonth[m] ?? []).filter(isProofKind)),
    ...input.proofs.filter((p) => input.months.includes(monthOf(p.period))).map((p) => p.kind),
  ]);
  return kinds.map((kind) => ({
    kind,
    cells: input.months.map((month) => {
      const proof = byKey.get(`${kind}|${month}`) ?? null;
      const expected = (input.expectedByMonth[month] ?? []).includes(kind);
      return { kind, month, expected, proof, state: cellStateOf(proof, expected, input.inRangeByMonth[month] ?? false) };
    }),
  }));
}

export interface MissingInputProof {
  id: string;
  kind: string;
  status: RentalProofStatus;
  rejection_reason: string | null;
}

/**
 * Qué falta de un contrato en un mes: lo que se pide (`expected`) menos lo que
 * ya está validado, en revisión o marcado "no corresponde". Las filas
 * pendientes o rechazadas cuentan como faltantes (con su id y motivo); una fila
 * pendiente de un tipo que ya no se pide, también (alguien la pidió).
 */
export function missingKindsOf(expected: string[], proofs: MissingInputProof[]): MissingProofKind[] {
  const byKind = new Map(proofs.map((p) => [p.kind, p]));
  const kinds = sortKinds([...expected, ...proofs.filter((p) => p.status === "pendiente" || p.status === "rechazado").map((p) => p.kind)]);
  const out: MissingProofKind[] = [];
  for (const kind of kinds) {
    if (!isProofKind(kind)) continue;
    const p = byKind.get(kind);
    if (p && SETTLED.has(p.status)) continue;
    out.push({
      kind,
      proofId: p?.id ?? null,
      status: p ? (p.status === "rechazado" ? "rechazado" : "pendiente") : null,
      rejectionReason: p?.status === "rechazado" ? p.rejection_reason : null,
    });
  }
  return out;
}

/** "expensas", "expensas y luz", "expensas, luz y gas". */
export function joinSpanishList(items: string[]): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Nombre del tipo en minúscula para usar en una frase ("la tasa municipal"). */
export function kindInSentence(kind: RentalServiceKind): string {
  const label = SERVICE_KIND_META[kind]?.label ?? kind;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Mensaje para pedir los comprobantes que faltan. Sin emojis (wa.me?text= los
 * rompe en iOS) y con el link del portal si lo hay.
 */
export function proofRequestMessage(input: {
  tenantName: string | null;
  orgName: string;
  kinds: RentalServiceKind[];
  month: string;
  address: string;
  portalUrl: string | null;
}): string {
  const name = firstName(input.tenantName);
  const what = joinSpanishList(input.kinds.map(kindInSentence));
  const plural = input.kinds.length > 1 ? "los comprobantes" : "el comprobante";
  const lines = [
    `Hola${name ? ` ${name}` : ""}! Te escribimos de ${input.orgName}.`,
    `Nos falta ${plural} de ${what} de ${monthInSentence(input.month)} de ${input.address}.`,
    input.portalUrl
      ? `Lo podés subir desde tu link, con una foto o un PDF: ${input.portalUrl}`
      : "Nos lo podés mandar por acá, con una foto o un PDF.",
    "Gracias!",
  ];
  return lines.join("\n");
}

export type ProofFileKind = "image" | "pdf" | "heic" | "other";

export function fileKindOf(mime: string | null | undefined): ProofFileKind {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "image/heic" || m === "image/heif") return "heic";
  if (m.startsWith("image/")) return "image";
  return "other";
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

/** Motivos de rechazo frecuentes (chips): el inquilino los lee en su portal. */
export const QUICK_REJECT_REASONS = [
  "No se lee bien",
  "Es de otro mes",
  "No figura el pago",
  "Es de otra propiedad",
  "El importe no coincide",
];
