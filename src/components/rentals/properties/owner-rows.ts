import { parsePercentInput } from "@/lib/format";
import { foldText } from "@/components/rentals/people/person-helpers";
import { splitEvenly } from "./property-helpers";
import type { OwnerOption, PropertyOwnerInput } from "./property-types";

/**
 * Propietario nuevo que se está tipeando en una fila del formulario. Se crea
 * recién al tocar "Guardar propiedad", junto con la propiedad: antes había un
 * "Crear y agregar" aparte y se lo tomaba por el guardado de todo (el 05/10
 * quedaron dos propietarios creados y ninguna propiedad).
 */
export interface NewOwnerDraft {
  full_name: string;
  phone: string;
  email: string;
  cbu: string;
  alias_cbu: string;
}

/** Filas editables de titulares (el % se tipea como texto es-AR). */
export interface OwnerRowState {
  key: string;
  owner_id: string;
  pct: string;
  is_primary: boolean;
  /** Si viene, la fila es un propietario nuevo (owner_id vacío hasta guardar). */
  draft?: NewOwnerDraft | null;
}

let keySeq = 0;
export const newKey = (): string => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const pctText = (n: number): string => String(Math.round(n * 100) / 100).replace(".", ",");

export function ownerRowsFrom(owners: PropertyOwnerInput[] | null | undefined): OwnerRowState[] {
  if (!owners?.length) return [{ key: newKey(), owner_id: "", pct: "100", is_primary: true, draft: null }];
  return owners.map((o) => ({ key: newKey(), owner_id: o.owner_id, pct: pctText(Number(o.ownership_pct)), is_primary: o.is_primary, draft: null }));
}

export function evenRows(rows: OwnerRowState[]): OwnerRowState[] {
  const parts = splitEvenly(rows.length);
  return rows.map((r, i) => ({ ...r, pct: pctText(parts[i] ?? 0) }));
}

export function blankOwnerDraft(name = ""): NewOwnerDraft {
  return { full_name: name.trim(), phone: "", email: "", cbu: "", alias_cbu: "" };
}

const foldName = (s: string) => foldText(s).replace(/\s+/g, " ").trim();

/**
 * Propietario ya cargado con el mismo nombre (sin tildes ni mayúsculas), o
 * null. Es la misma regla con la que el servidor rechaza el duplicado, dicha
 * antes: "ya está, usalo".
 */
export function findOwnerByName(options: OwnerOption[] | null | undefined, name: string): OwnerOption | null {
  const needle = foldName(name);
  if (needle.length < 2 || !options?.length) return null;
  return options.find((o) => foldName(o.full_name) === needle) ?? null;
}

export interface OwnershipRow {
  key: string;
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
  draft: NewOwnerDraft | null;
}

/**
 * Filas que cuentan al guardar: con dueño (elegido o nuevo) o con un %
 * tipeado. Con un solo dueño es el 100 % y el principal (el formulario ni pregunta).
 */
export function ownershipRowsOf(rows: OwnerRowState[]): OwnershipRow[] {
  const out = rows
    .filter((r) => r.owner_id || r.draft || r.pct.trim())
    .map((r) => ({
      key: r.key,
      owner_id: r.owner_id,
      ownership_pct: parsePercentInput(r.pct) ?? Number.NaN,
      is_primary: r.is_primary,
      draft: r.owner_id ? null : (r.draft ?? null),
    }));
  return out.length === 1 ? [{ ...out[0], ownership_pct: 100, is_primary: true }] : out;
}

/** Para validar antes de crear a los nuevos: cada uno ocupa su fila con un id provisorio. */
export function withProvisionalIds(rows: OwnershipRow[]): OwnershipRow[] {
  return rows.map((r) => (r.owner_id || !r.draft ? r : { ...r, owner_id: `nuevo:${r.key}` }));
}
