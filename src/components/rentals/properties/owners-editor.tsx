"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, RotateCw, Scale, Star, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parsePercentInput } from "@/lib/format";
import { joinNamesEs } from "@/lib/rentals/renewal";
import { formatPctEs, round2 } from "./property-helpers";
import type { CreatedOwnerRef, OwnerOption } from "./property-types";
import {
  blankOwnerDraft,
  draftHasData,
  evenRows,
  findOwnerByName,
  newKey,
  sameOwnerRows,
  undoOwnerDiscard,
  type OwnerDiscardSnapshot,
  type OwnerRowState,
} from "./owner-rows";
import { OwnerPicker } from "./owner-picker";
import { QuickOwnerPanel, type QuickOwnerError } from "./quick-owner-panel";

/** id del buscador de la fila i (el formulario lo enfoca cuando falta el dueño). */
export const ownerPickerId = (i: number) => `property-owner-${i}`;

/**
 * Titulares de la propiedad con su %. Con un solo dueño no se pide nada más
 * que elegirlo (100 % y principal). Con varios: % por fila, uno principal y
 * una barra que muestra en vivo si suman 100. Si el dueño no está cargado, la
 * fila pasa a "propietario nuevo" y se crea al guardar la propiedad.
 */
export function OwnersEditor({
  rows,
  onChange,
  options,
  archived,
  error,
  loadError,
  loadAction,
  draftError,
  sessionCreated,
}: {
  rows: OwnerRowState[];
  onChange: (rows: OwnerRowState[]) => void;
  options: OwnerOption[] | null;
  /** Archivados: no se eligen, pero tampoco se puede crear otro con el mismo nombre. */
  archived: OwnerOption[] | null;
  error: string | null;
  loadError: string | null;
  /** Qué hacer si no se pudo cargar la lista: reintentar, o recargar si hubo un deploy. */
  loadAction?: { label: string; onClick: () => void } | null;
  draftError: QuickOwnerError | null;
  /** Propietarios que este formulario ya creó (en un guardado que después falló): existen aunque la propiedad no. */
  sessionCreated: CreatedOwnerRef[];
}) {
  // Sólo el panel que se abre con un toque toma el foco (no uno que vuelve con un borrador).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const single = rows.length === 1;
  const sum = round2(rows.reduce((s, r) => s + (parsePercentInput(r.pct) ?? 0), 0));
  const sumOk = Math.abs(sum - 100) < 0.005;

  /**
   * Lo último que se sacó de una fila, para "Deshacer": un propietario nuevo a
   * medio cargar ("No crear", elegir otro en el buscador, quitar la fila) o uno
   * que este formulario ya creó. Va acá adentro y no en un aviso flotante: con
   * el diálogo abierto, el aviso flotante no se puede tocar (en el celu, el
   * toque caía en «Guardar propiedad», que está debajo). Se ve mientras las
   * filas sigan como quedaron; con el próximo cambio, deja de corresponder.
   */
  const [undo, setUndo] = useState<{ snap: OwnerDiscardSnapshot; message: string; warn: boolean } | null>(null);
  const undoVisible = undo !== null && sameOwnerRows(rows, undo.snap.after);

  const update = (key: string, patch: Partial<OwnerRowState>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Cambia una fila (o la saca) sin que nada se pierda en silencio. */
  function commitRows(next: OwnerRowState[], row: OwnerRowState) {
    onChange(next);
    const after = next.find((r) => r.key === row.key);
    const snap = { before: rows, after: next, key: row.key };
    // Ya existe (lo creó un guardado que después falló): sacarlo de acá no lo borra de Propietarios.
    const created = row.owner_id && !next.some((r) => r.owner_id === row.owner_id) ? sessionCreated.find((o) => o.id === row.owner_id) : undefined;
    if (created) {
      setUndo({ snap, warn: true, message: `${created.full_name} ya quedó cargado en Propietarios: si no va, eliminalo desde ahí.` });
      return;
    }
    if (!row.owner_id && draftHasData(row.draft) && !after?.draft) {
      const name = row.draft?.full_name.trim();
      setUndo({ snap, warn: false, message: name ? `No se va a crear «${name}».` : "No se va a crear el propietario nuevo." });
      return;
    }
    setUndo(null);
  }

  function addRow() {
    const next = [...rows, { key: newKey(), owner_id: "", pct: "", is_primary: false, draft: null }];
    // Recién agregado: si los % venían parejos (o era uno solo al 100), se reparte en partes iguales.
    const wasEven = rows.every((r) => Math.abs((parsePercentInput(r.pct) ?? 0) - 100 / rows.length) < 0.02);
    onChange(wasEven ? evenRows(next) : next.map((r, i) => (i === next.length - 1 ? { ...r, pct: sum < 100 ? formatPctEs(round2(100 - sum)) : "" } : r)));
  }

  function removeRow(row: OwnerRowState) {
    let next = rows.filter((r) => r.key !== row.key);
    if (!next.length) next = [{ key: newKey(), owner_id: "", pct: "100", is_primary: true, draft: null }];
    if (!next.some((r) => r.is_primary)) next = next.map((r, i) => ({ ...r, is_primary: i === 0 }));
    if (next.length === 1) next = [{ ...next[0], pct: "100", is_primary: true }];
    commitRows(next, row);
  }

  function startNew(row: OwnerRowState, name: string) {
    const draft = row.draft ? { ...row.draft, full_name: name.trim() || row.draft.full_name } : blankOwnerDraft(name);
    commitRows(rows.map((x) => (x.key === row.key ? { ...x, owner_id: "", draft } : x)), row);
    setFocusKey(row.key);
  }

  const selectedIds = rows.map((r) => r.owner_id).filter(Boolean);
  // "Listo: X quedó creado…", mientras siga elegido en una fila (si se sacó, lo dice el aviso de arriba).
  const createdNames = sessionCreated.filter((o) => rows.some((r) => r.owner_id === o.id)).map((o) => o.full_name);

  return (
    <div className="space-y-3" id="property-owners" tabIndex={-1}>
      {loadError && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-rose-600 dark:text-rose-400" role="alert">
          <span className="min-w-0 flex-1">{loadError}</span>
          {loadAction && (
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={loadAction.onClick}>
              <RotateCw size={13} /> {loadAction.label}
            </Button>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((r, i) => {
          // Sin contar al que esta misma fila ya creó (si la respuesta se perdió, no es un homónimo).
          const sameName = r.draft ? findOwnerByName(options, r.draft.full_name, r.draft.id) : null;
          const sameArchived = r.draft && !sameName ? findOwnerByName(archived, r.draft.full_name, r.draft.id) : null;
          return (
            <li key={r.key} className={cn("grid gap-2 items-center", single ? "grid-cols-1" : "grid-cols-[1fr_auto] sm:grid-cols-[1fr_7.5rem_auto_auto]")}>
              <div className={cn("min-w-0", !single && "col-span-2 sm:col-span-1")}>
                <OwnerPicker
                  id={ownerPickerId(i)}
                  value={r.owner_id}
                  pendingName={r.draft ? r.draft.full_name : null}
                  options={options}
                  archived={archived}
                  excludeIds={selectedIds.filter((id) => id !== r.owner_id)}
                  onChange={(ownerId) => commitRows(rows.map((x) => (x.key === r.key ? { ...x, owner_id: ownerId, draft: null } : x)), r)}
                  onCreate={(name) => startNew(r, name)}
                  invalid={Boolean(error) && !r.owner_id && !r.draft}
                />
              </div>
              {!single && (
                <>
                  <div className="relative">
                    <Input
                      inputMode="decimal"
                      value={r.pct}
                      onChange={(e) => update(r.key, { pct: e.target.value })}
                      aria-label="Porcentaje"
                      placeholder="50"
                      className="h-10 pr-7 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onChange(rows.map((x) => ({ ...x, is_primary: x.key === r.key })))}
                      aria-pressed={r.is_primary}
                      title="Titular principal: figura primero y recibe los avisos"
                      className={cn("h-10 gap-1.5 px-2.5", r.is_primary ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
                    >
                      <Star size={15} className={cn(r.is_primary && "fill-current")} />
                      <span className="text-xs">{r.is_primary ? "Principal" : "Hacer principal"}</span>
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground hover:text-rose-600" onClick={() => removeRow(r)} aria-label="Quitar propietario">
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </>
              )}
              {r.draft && (
                <div className="col-span-full">
                  <QuickOwnerPanel
                    rowKey={r.key}
                    draft={r.draft}
                    onChange={(draft) => update(r.key, { draft })}
                    onDiscard={() => commitRows(rows.map((x) => (x.key === r.key ? { ...x, draft: null } : x)), r)}
                    error={draftError?.rowKey === r.key ? draftError : null}
                    sameName={sameName}
                    sameNameInOtherRow={Boolean(sameName && selectedIds.includes(sameName.id))}
                    sameArchived={sameArchived}
                    onUseExisting={(o) => commitRows(rows.map((x) => (x.key === r.key ? { ...x, owner_id: o.id, draft: null } : x)), r)}
                    autoFocus={focusKey === r.key}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {undoVisible && undo && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-xs",
            undo.warn ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "bg-muted/50 text-foreground",
          )}
          role="status"
        >
          {undo.warn && <AlertTriangle size={14} className="shrink-0 text-amber-700 dark:text-amber-300" />}
          <span className="min-w-0 flex-1">{undo.message}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              onChange(undoOwnerDiscard(rows, undo.snap));
              setUndo(null);
            }}
          >
            <Undo2 size={13} /> Deshacer
          </Button>
        </div>
      )}

      {createdNames.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300" role="status">
          <CheckCircle2 size={14} className="mt-px shrink-0" />
          <span>
            Listo: {joinNamesEs(createdNames)} {createdNames.length === 1 ? "quedó creado y elegido" : "quedaron creados y elegidos"} como{" "}
            {createdNames.length === 1 ? "dueño" : "dueños"}. Falta guardar la propiedad: corregí lo marcado y tocá «Guardar propiedad».
          </span>
        </p>
      )}

      {!single && (
        <div className="space-y-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Suman ${formatPctEs(sum)} %`}>
            <div
              className={cn("h-full transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]", sumOk ? "bg-emerald-500" : sum > 100 ? "bg-rose-500" : "bg-amber-500")}
              style={{ width: `${Math.min(100, Math.max(0, sum))}%` }}
            />
          </div>
          <p className={cn("text-xs tabular-nums", sumOk ? "text-emerald-700 dark:text-emerald-400" : sum > 100 ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-300")}>
            {sumOk ? "Suman 100 %" : sum > 100 ? `Suman ${formatPctEs(sum)} % · sobra ${formatPctEs(round2(sum - 100))} %` : `Suman ${formatPctEs(sum)} % · falta ${formatPctEs(round2(100 - sum))} %`}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 -ml-2 h-9" onClick={addRow} disabled={rows.length >= 20}>
          <Plus size={14} /> Agregar otro propietario
        </Button>
        {!single && (
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 h-9 text-muted-foreground" onClick={() => onChange(evenRows(rows))}>
            <Scale size={14} /> Repartir en partes iguales
          </Button>
        )}
      </div>
    </div>
  );
}
