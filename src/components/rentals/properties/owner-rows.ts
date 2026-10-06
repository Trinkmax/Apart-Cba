import { parsePercentInput } from "@/lib/format";
import { newClientId } from "@/lib/rentals/property-input";
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
  /**
   * Id con el que se va a crear (queda en el borrador). Si la respuesta del
   * alta se pierde, reintentar con el mismo id devuelve el propietario ya
   * creado en vez de rechazarlo por nombre repetido.
   */
  id: string;
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
  return { id: newClientId(), full_name: name.trim(), phone: "", email: "", cbu: "", alias_cbu: "" };
}

/** ¿Hay algo tipeado en el propietario nuevo? (para no tirarlo en silencio) */
export function draftHasData(draft: NewOwnerDraft | null | undefined): boolean {
  return Boolean(draft && [draft.full_name, draft.phone, draft.email, draft.cbu, draft.alias_cbu].some((v) => v.trim()));
}

/** Teléfono, mail y DNI en una línea: para saber si un homónimo es la misma persona. */
export function ownerDetails(o: Pick<OwnerOption, "phone" | "email" | "document_number">): string {
  return [o.phone, o.email, o.document_number ? `DNI ${o.document_number}` : null].filter(Boolean).join(" · ");
}

const foldName = (s: string) => foldText(s).replace(/\s+/g, " ").trim();

/**
 * Propietario ya cargado con el mismo nombre (sin tildes ni mayúsculas), o
 * null. Es la misma regla con la que el servidor rechaza el duplicado, dicha
 * antes: "ya está, usalo".
 */
export function findOwnerByName(options: OwnerOption[] | null | undefined, name: string, exceptId?: string): OwnerOption | null {
  const needle = foldName(name);
  if (needle.length < 2 || !options?.length) return null;
  // `exceptId`: el propietario que esta misma fila ya creó (respuesta perdida) no es un homónimo.
  return options.find((o) => o.id !== exceptId && foldName(o.full_name) === needle) ?? null;
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

/**
 * Para validar antes de crear a los nuevos: cada uno ocupa su fila con el id
 * con el que se va a crear (un UUID, así pasa el mismo esquema que el servidor).
 */
export function withProvisionalIds(rows: OwnershipRow[]): OwnershipRow[] {
  return rows.map((r) => (r.owner_id || !r.draft ? r : { ...r, owner_id: r.draft.id }));
}

/**
 * Filas cuyo propietario nuevo YA existe (se creó, pero la respuesta se
 * perdió): pasan a tenerlo elegido. Devuelve también a quiénes adoptó.
 */
export function adoptCreatedOwners(rows: OwnerRowState[], known: OwnerOption[]): { rows: OwnerRowState[]; adopted: OwnerOption[] } {
  const byId = new Map(known.map((o) => [o.id, o]));
  const adopted: OwnerOption[] = [];
  const next = rows.map((r) => {
    const owner = !r.owner_id && r.draft ? byId.get(r.draft.id) : undefined;
    if (!owner) return r;
    adopted.push(owner);
    return { ...r, owner_id: owner.id, draft: null };
  });
  return { rows: adopted.length ? next : rows, adopted };
}

/** Cómo estaban las filas antes de tirar un propietario nuevo, para "Deshacer". */
export interface OwnerDiscardSnapshot {
  before: OwnerRowState[];
  after: OwnerRowState[];
  key: string;
}

const sameRow = (a: OwnerRowState, b: OwnerRowState) =>
  a.key === b.key && a.owner_id === b.owner_id && a.pct === b.pct && a.is_primary === b.is_primary && JSON.stringify(a.draft ?? null) === JSON.stringify(b.draft ?? null);

/**
 * "Deshacer": si nada cambió desde que se tiró, vuelve todo como estaba; si
 * entretanto se tocó otra cosa, sólo devuelve esa fila (en su lugar).
 */
export function undoOwnerDiscard(current: OwnerRowState[], snap: OwnerDiscardSnapshot): OwnerRowState[] {
  if (current.length === snap.after.length && current.every((r, i) => sameRow(r, snap.after[i]))) return snap.before;
  const index = snap.before.findIndex((r) => r.key === snap.key);
  const row = snap.before[index];
  if (!row) return current;
  let next = current.some((r) => r.key === snap.key)
    ? current.map((r) => (r.key === snap.key ? row : r))
    : [...current.slice(0, index), row, ...current.slice(index)];
  // Siempre un solo principal.
  if (row.is_primary) next = next.map((r) => ({ ...r, is_primary: r.key === row.key }));
  else if (!next.some((r) => r.is_primary)) next = next.map((r, i) => ({ ...r, is_primary: i === 0 }));
  return next;
}
