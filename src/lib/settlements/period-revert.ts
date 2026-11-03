/**
 * Revertir un mes generado por error: qué se puede borrar en lote y qué no.
 *
 * Sólo lo que no perdió nada al borrarse, es decir, lo que «Generar todas» vuelve a
 * armar igual: un borrador automático que nadie tocó. Todo lo demás lleva trabajo
 * de una persona o ya salió de acá (se le mandó al propietario, se pagó), y se
 * resuelve de a uno desde su detalle. Si un mes correcto se revierte por error, se
 * regenera y queda como estaba.
 */

export type RevertKeepReason =
  | "pagada"
  | "enviada"
  | "disputada"
  | "revisada"
  | "manual"
  | "editada";

export const REVERT_KEEP_LABEL: Record<RevertKeepReason, string> = {
  pagada: "Pagada: primero hay que anular el pago",
  enviada: "Ya se le envió al propietario",
  disputada: "En disputa",
  revisada: "Ya está revisada",
  manual: "Armada a mano",
  editada: "Tiene cambios hechos a mano",
};

export interface PeriodRevertCandidate {
  id: string;
  status: string;
  origin: string | null;
  paid_movement_id: string | null;
  last_edited_by: string | null;
  /** Líneas cargadas o editadas a mano (`settlement_lines.is_manual`). */
  has_manual_lines: boolean;
  /** Historial que no sea una regeneración: alguien la editó o le cambió el estado. */
  has_edits: boolean;
  net_payable: number;
  currency: string;
  owner_name: string;
}

/** `null` = se puede borrar. Ante un estado desconocido no se borra. */
export function revertKeepReason(candidate: PeriodRevertCandidate): RevertKeepReason | null {
  if (candidate.status === "pagada" || candidate.paid_movement_id) return "pagada";
  if (candidate.status === "enviada") return "enviada";
  if (candidate.status === "disputada") return "disputada";
  if (candidate.status !== "borrador") return "revisada";
  if (candidate.origin !== "auto") return "manual";
  if (candidate.has_manual_lines || candidate.has_edits || candidate.last_edited_by) {
    return "editada";
  }
  return null;
}

export interface PeriodRevertPreview {
  ids: string[];
  /** Por moneda, porque no se pueden sumar: lo normal es una sola, ARS. */
  totals: { currency: string; amount: number }[];
  kept: { id: string; owner_name: string; reason: RevertKeepReason }[];
}

export function summarizePeriodRevert(candidates: PeriodRevertCandidate[]): PeriodRevertPreview {
  const preview: PeriodRevertPreview = { ids: [], totals: [], kept: [] };
  const byCurrency = new Map<string, number>();
  for (const candidate of candidates) {
    const reason = revertKeepReason(candidate);
    if (reason) {
      preview.kept.push({ id: candidate.id, owner_name: candidate.owner_name, reason });
      continue;
    }
    preview.ids.push(candidate.id);
    byCurrency.set(
      candidate.currency,
      (byCurrency.get(candidate.currency) ?? 0) + candidate.net_payable,
    );
  }
  preview.totals = [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
  preview.kept.sort((a, b) => a.owner_name.localeCompare(b.owner_name, "es"));
  return preview;
}
