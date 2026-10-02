import { splitEvenly } from "./property-helpers";
import type { PropertyOwnerInput } from "./property-types";

/** Filas editables de titulares (el % se tipea como texto es-AR). */
export interface OwnerRowState {
  key: string;
  owner_id: string;
  pct: string;
  is_primary: boolean;
}

let keySeq = 0;
export const newKey = (): string => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const pctText = (n: number): string => String(Math.round(n * 100) / 100).replace(".", ",");

export function ownerRowsFrom(owners: PropertyOwnerInput[] | null | undefined): OwnerRowState[] {
  if (!owners?.length) return [{ key: newKey(), owner_id: "", pct: "100", is_primary: true }];
  return owners.map((o) => ({ key: newKey(), owner_id: o.owner_id, pct: pctText(Number(o.ownership_pct)), is_primary: o.is_primary }));
}

export function evenRows(rows: OwnerRowState[]): OwnerRowState[] {
  const parts = splitEvenly(rows.length);
  return rows.map((r, i) => ({ ...r, pct: pctText(parts[i] ?? 0) }));
}
